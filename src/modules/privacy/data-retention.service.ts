import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Delete tenant data based on inactivity (LGPD Art. 15-17 compliance)
   * @param monthsInactivity Number of months of inactivity before deletion
   */
  async deleteInactiveTenants(monthsInactivity: number = 24): Promise<{ deletedCount: number; tenants: string[] }> {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsInactivity);

    // Find tenants that have been inactive for the specified period
    // Inactivity defined as: no login, no updates, no transactions in the period
    const inactiveTenants = await this.prisma.tenant.findMany({
      where: {
        OR: [
          { updatedAt: { lt: cutoffDate } },
          {
            AND: [
              { updatedAt: { gte: cutoffDate } },
              {
                userSessions: {
                  none: {
                    lastSeenAt: { gte: cutoffDate }
                  }
                }
              }
            ]
          },
          {
            AND: [
              { updatedAt: { gte: cutoffDate } },
              {
                transactions: {
                  none: {
                    date: { gte: cutoffDate }
                  }
                }
              }
            ]
          }
        ]
      },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        _count: {
          select: {
            userSessions: true,
            transactions: true
          }
        }
      }
    });

    const tenantIds = inactiveTenants.map(t => t.id);
    const deletedCount = tenantIds.length;

    if (deletedCount > 0) {
      this.logger.log(`Found ${deletedCount} inactive tenants for deletion (${monthsInactivity} months inactivity)`);

      // Delete tenants in batches to avoid overwhelming the database
      const batchSize = 50;
      for (let i = 0; i < tenantIds.length; i += batchSize) {
        const batch = tenantIds.slice(i, i + batchSize);
        await this.prisma.$transaction(
          batch.map(tenantId => this.prisma.tenant.delete({ where: { id: tenantId } })
        ));
        
        this.logger.log(`Deleted batch of ${batch.length} tenants (${i + batch.length}/${tenantIds.length})`);
      }

      // Notify system administrators about the cleanup
      await this.notificationService.sendGenericEmail(
        process.env.ADMIN_ALERT_EMAIL || 'admin@contex360.com',
        'Data Retention Cleanup Completed',
        `Automated data retention policy has been executed.\n\n` +
        `Deleted ${deletedCount} tenant(s) due to ${monthsInactivity} months of inactivity.\n` +
        `Cleanup completed at: ${new Date().toISOString()}`
      );
    }

    return { deletedCount, tenants: tenantIds };
  }

  /**
   * Delete specific tenant data upon request (LGPD Art. 15-17 - Right to deletion)
   * @param tenantId ID of the tenant to delete
   * @param requestedBy User ID who requested the deletion
   */
  async deleteTenantData(tenantId: string, requestedBy: string): Promise<{ success: boolean }> {
    this.logger.log(`Processing data deletion request for tenant ${tenantId} requested by ${requestedBy}`);

    // Verify tenant exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new Error(`Tenant with ID ${tenantId} not found`);
    }

    try {
      // Use a transaction to ensure all related data is deleted
      await this.prisma.$transaction(async (prisma) => {
        // Delete related data in proper order to avoid foreign key constraints
        
        // 1. Delete specific module data that might have restrictions
        await prisma.consentimiento.deleteMany({ where: { tenantId } });
        await prisma.solicitudDerechos.deleteMany({ where: { tenantId } });
        await prisma.contratoAceptacion.deleteMany({ where: { tenantId } });
        await prisma.contrato.deleteMany({ where: { tenantId } });
        await prisma.supportTicket.deleteMany({ where: { tenantId } });
        await prisma.integrationCredential.deleteMany({ where: { tenantId } });
        await prisma.transaction.deleteMany({ where: { tenantId } });
        await prisma.ledgerEntry.deleteMany({ where: { tenantId } });
        await prisma.ledgerLine.deleteMany({ where: { ledgerEntry: { tenantId } } });
        await prisma.inventoryTransfer.deleteMany({ where: { tenantId } });
        await prisma.inventoryMovement.deleteMany({ where: { tenantId } });
        await prisma.ocrRun.deleteMany({ where: { tenantId } });
        const userIds = (await prisma.user.findMany({ where: { memberships: { some: { tenantId } } }, select: { id: true } })).map(u => u.id);
        await prisma.userSecurityProfile.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.userSession.deleteMany({ where: { tenantId } });
        await prisma.auditEvent.deleteMany({ where: { tenantId } });
        await prisma.roleAccessHistory.deleteMany({ where: { tenantId } });
        await prisma.quote.deleteMany({ where: { tenantId } });
        await prisma.quoteItem.deleteMany({ where: { quote: { tenantId } } });
        await prisma.purchase.deleteMany({ where: { tenantId } });
        await prisma.purchaseItem.deleteMany({ where: { purchase: { tenantId } } });
        await prisma.product.deleteMany({ where: { tenantId } });
        await prisma.invoice.deleteMany({ where: { tenantId } });
        await prisma.invoiceItem.deleteMany({ where: { invoice: { tenantId } } });
        await prisma.thirdParty.deleteMany({ where: { tenantId } });
        
        // 2. Delete subscription-related data
        await prisma.subscriptionInvoice.deleteMany({ where: { tenantId } });
        await prisma.payment.deleteMany({ where: { tenantId } });
        await prisma.subscription.deleteMany({ where: { tenantId } });
        
        // 3. Delete memberships (this will cascade to user updates where applicable)
        await prisma.membership.deleteMany({ where: { tenantId } });
        
        // 4. Finally delete the tenant itself
        await prisma.tenant.delete({ where: { id: tenantId } });
      });

      // Create audit log for the deletion request
      await this.prisma.auditEvent.create({
        data: {
          tenantId: 'system', // System-level audit
          entity: 'tenant',
          action: 'Data deletion request fulfilled',
          description: `Tenant ${tenantId} data deleted upon user request (LGPD Art. 15-17 compliance). Requested by: ${requestedBy}`,
          actor: requestedBy,
          severity: 'info',
        }
      });

      this.logger.log(`Successfully deleted all data for tenant ${tenantId}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to delete data for tenant ${tenantId}:`, error);
      throw error;
    }
  }

  /**
   * Get data retention statistics
   */
  async getRetentionStatistics(): Promise<{
    totalTenants: number;
    inactiveTenants24m: number;
    inactiveTwelveMonths: number;
    inactiveSixMonths: number;
  }> {
    const now = new Date();
    const twentyFourMonthsAgo = new Date(now.getTime() - (24 * 30 * 24 * 60 * 60 * 1000));
    const twelveMonthsAgo = new Date(now.getTime() - (12 * 30 * 24 * 60 * 60 * 1000));
    const sixMonthsAgo = new Date(now.getTime() - (6 * 30 * 24 * 60 * 60 * 1000));

    const [totalTenants, inactive24m, inactive12m, inactive6m] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({
        where: {
          OR: [
            { updatedAt: { lt: twentyFourMonthsAgo } },
            {
              AND: [
                { updatedAt: { gte: twentyFourMonthsAgo } },
                {
                  userSessions: {
                    none: {
                      lastSeenAt: { gte: twentyFourMonthsAgo }
                    }
                  }
                }
              ]
            },
            {
              AND: [
                { updatedAt: { gte: twentyFourMonthsAgo } },
                {
                  transactions: {
                    none: {
                      date: { gte: twentyFourMonthsAgo }
                    }
                  }
                }
              ]
            }
          ]
        }
      }),
      this.prisma.tenant.count({
        where: {
          OR: [
            { updatedAt: { lt: twelveMonthsAgo } },
            {
              AND: [
                { updatedAt: { gte: twelveMonthsAgo } },
                {
                  userSessions: {
                    none: {
                      lastSeenAt: { gte: twelveMonthsAgo }
                    }
                  }
                }
              ]
            },
            {
              AND: [
                { updatedAt: { gte: twelveMonthsAgo } },
                {
                  transactions: {
                    none: {
                      date: { gte: twelveMonthsAgo }
                    }
                  }
                }
              ]
            }
          ]
        }
      }),
      this.prisma.tenant.count({
        where: {
          OR: [
            { updatedAt: { lt: sixMonthsAgo } },
            {
              AND: [
                { updatedAt: { gte: sixMonthsAgo } },
                {
                  userSessions: {
                    none: {
                      lastSeenAt: { gte: sixMonthsAgo }
                    }
                  }
                }
              ]
            },
            {
              AND: [
                { updatedAt: { gte: sixMonthsAgo } },
                {
                  transactions: {
                    none: {
                      date: { gte: sixMonthsAgo }
                    }
                  }
                }
              ]
            }
          ]
        }
      })
    ]);

    return {
      totalTenants,
      inactiveTenants24m: inactive24m,
      inactiveTwelveMonths: inactive12m,
      inactiveSixMonths: inactive6m
    };
  }
}