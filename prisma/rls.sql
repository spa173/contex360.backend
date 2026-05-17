-- ================================================================
-- Row Level Security - Contex360
-- ================================================================
-- Modelo de aislamiento: multi-tenant (cada usuario solo ve datos
-- de los tenants a los que pertenece via tabla Membership).
--
-- Cómo funciona:
--   1. El backend llama a set_config('app.user_id', userId, true)
--      y set_config('app.is_system_owner', 'true'|'false', true)
--      dentro de una transacción antes de ejecutar queries.
--   2. Las políticas leen esas variables mediante app_user_id()
--      y app_is_system_owner().
--   3. El service_role (usado por Prisma por defecto) tiene BYPASSRLS,
--      por lo que las políticas sólo aplican a conexiones con roles
--      sin ese privilegio (acceso directo a la Data API de Supabase).
--
-- Para enforcement completo en el backend: usar PrismaService.runAsUser()
-- ================================================================

-- ----------------------------------------------------------------
-- Funciones helper (SECURITY DEFINER para evitar escalada)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_user_id()
  RETURNS TEXT
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_is_system_owner()
  RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT current_setting('app.is_system_owner', true) = 'true'
$$;

-- Retorna TRUE si el usuario activo tiene membresía en el tenant dado,
-- o si es system owner.
CREATE OR REPLACE FUNCTION app_has_tenant_access(p_tenant_id TEXT)
  RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT app_is_system_owner()
      OR EXISTS (
        SELECT 1 FROM "Membership"
        WHERE "userId"   = app_user_id()
          AND "tenantId" = p_tenant_id
      )
$$;

-- ----------------------------------------------------------------
-- Habilitar RLS en todas las tablas
-- ----------------------------------------------------------------

ALTER TABLE "User"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ThirdParty"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceItem"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Quote"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QuoteItem"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Purchase"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseItem"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerEntry"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerLine"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovement"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryTransfer"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OcrRun"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserSecurityProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserSession"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoleAccessHistory"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DemoRequest"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transaction"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription"        ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- Políticas
-- ----------------------------------------------------------------

-- User: solo el propio registro, o system owner
CREATE POLICY "rls_user" ON "User"
  FOR ALL
  USING (id = app_user_id() OR app_is_system_owner());

-- Tenant: solo los tenants a los que el usuario pertenece
CREATE POLICY "rls_tenant" ON "Tenant"
  FOR ALL
  USING (app_has_tenant_access(id));

-- Membership: propias membresías, o system owner
CREATE POLICY "rls_membership" ON "Membership"
  FOR ALL
  USING ("userId" = app_user_id() OR app_is_system_owner());

-- ThirdParty: via membresía al tenant
CREATE POLICY "rls_third_party" ON "ThirdParty"
  FOR ALL
  USING (app_has_tenant_access("tenantId"));

-- Product: via membresía al tenant
CREATE POLICY "rls_product" ON "Product"
  FOR ALL
  USING (app_has_tenant_access("tenantId"));

-- Invoice: via membresía al tenant
CREATE POLICY "rls_invoice" ON "Invoice"
  FOR ALL
  USING (app_has_tenant_access("tenantId"));

-- InvoiceItem: a través de la factura → tenant
CREATE POLICY "rls_invoice_item" ON "InvoiceItem"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Invoice" i
      WHERE i.id = "invoiceId"
        AND app_has_tenant_access(i."tenantId")
    )
  );

-- Quote: via membresía al tenant
CREATE POLICY "rls_quote" ON "Quote"
  FOR ALL
  USING (app_has_tenant_access("tenantId"));

-- QuoteItem: a través de la cotización → tenant
CREATE POLICY "rls_quote_item" ON "QuoteItem"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Quote" q
      WHERE q.id = "quoteId"
        AND app_has_tenant_access(q."tenantId")
    )
  );

-- Purchase: via membresía al tenant
CREATE POLICY "rls_purchase" ON "Purchase"
  FOR ALL
  USING (app_has_tenant_access("tenantId"));

-- PurchaseItem: a través de la compra → tenant
CREATE POLICY "rls_purchase_item" ON "PurchaseItem"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Purchase" p
      WHERE p.id = "purchaseId"
        AND app_has_tenant_access(p."tenantId")
    )
  );

-- LedgerEntry: via membresía al tenant
CREATE POLICY "rls_ledger_entry" ON "LedgerEntry"
  FOR ALL
  USING (app_has_tenant_access("tenantId"));

-- LedgerLine: a través del asiento contable → tenant
CREATE POLICY "rls_ledger_line" ON "LedgerLine"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "LedgerEntry" le
      WHERE le.id = "ledgerEntryId"
        AND app_has_tenant_access(le."tenantId")
    )
  );

-- InventoryMovement: via membresía al tenant
CREATE POLICY "rls_inventory_movement" ON "InventoryMovement"
  FOR ALL
  USING (app_has_tenant_access("tenantId"));

-- InventoryTransfer: via membresía al tenant
CREATE POLICY "rls_inventory_transfer" ON "InventoryTransfer"
  FOR ALL
  USING (app_has_tenant_access("tenantId"));

-- OcrRun: via membresía al tenant
CREATE POLICY "rls_ocr_run" ON "OcrRun"
  FOR ALL
  USING (app_has_tenant_access("tenantId"));

-- UserSecurityProfile: solo el propio perfil
CREATE POLICY "rls_security_profile" ON "UserSecurityProfile"
  FOR ALL
  USING ("userId" = app_user_id() OR app_is_system_owner());

-- UserSession: propias sesiones, o miembros del tenant
CREATE POLICY "rls_user_session" ON "UserSession"
  FOR ALL
  USING (
    "userId" = app_user_id()
    OR app_has_tenant_access("tenantId")
  );

-- RefreshToken: propios tokens
CREATE POLICY "rls_refresh_token" ON "RefreshToken"
  FOR ALL
  USING ("userId" = app_user_id() OR app_is_system_owner());

-- AuditEvent: via tenant o como actor (tenantId puede ser NULL)
CREATE POLICY "rls_audit_event" ON "AuditEvent"
  FOR ALL
  USING (
    ("tenantId" IS NOT NULL AND app_has_tenant_access("tenantId"))
    OR "actorUserId" = app_user_id()
    OR app_is_system_owner()
  );

-- RoleAccessHistory: via tenant o como actor
CREATE POLICY "rls_role_access_history" ON "RoleAccessHistory"
  FOR ALL
  USING (
    ("tenantId" IS NOT NULL AND app_has_tenant_access("tenantId"))
    OR "actorUserId" = app_user_id()
    OR app_is_system_owner()
  );

-- DemoRequest: solo system owner
CREATE POLICY "rls_demo_request" ON "DemoRequest"
  FOR ALL
  USING (app_is_system_owner());

-- Transaction: via membresía al tenant
CREATE POLICY "rls_transaction" ON "Transaction"
  FOR ALL
  USING (app_has_tenant_access("tenantId"));

-- Subscription: via membresía al tenant
CREATE POLICY "rls_subscription" ON "Subscription"
  FOR ALL
  USING (app_has_tenant_access("tenantId"));
