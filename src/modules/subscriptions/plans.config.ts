export interface PlanConfig {
  name: string;
  priceMonthly: number;
  priceAnnual: number;
  maxUsers: number | null;
  maxInvoicesPerMonth: number | null;
  maxAiQueriesPerMonth: number | null;
  maxOcrRunsPerMonth: number | null;
  maxEmailsPerMonth: number | null;
  modules: string[];
}

export const PLANS: Record<'starter' | 'pyme' | 'enterprise', PlanConfig> = {
  starter: {
    name: 'Starter',
    priceMonthly: 89000,
    priceAnnual: 801000,
    maxUsers: 1,
    maxInvoicesPerMonth: 50,
    maxAiQueriesPerMonth: 100,
    maxOcrRunsPerMonth: 10,
    maxEmailsPerMonth: 200,
    modules: ['dashboard', 'billing', 'quotes', 'third-parties'],
  },
  pyme: {
    name: 'Pyme',
    priceMonthly: 189000,
    priceAnnual: 1701000,
    maxUsers: 5,
    maxInvoicesPerMonth: null,
    maxAiQueriesPerMonth: 500,
    maxOcrRunsPerMonth: 50,
    maxEmailsPerMonth: 1000,
    modules: [
      'dashboard',
      'billing',
      'purchases',
      'quotes',
      'inventory',
      'third-parties',
      'treasury',
      'reports',
      'users',
      'ai',
    ],
  },
  enterprise: {
    name: 'Enterprise',
    priceMonthly: 389000,
    priceAnnual: 3501000,
    maxUsers: null,
    maxInvoicesPerMonth: null,
    maxAiQueriesPerMonth: null,
    maxOcrRunsPerMonth: null,
    maxEmailsPerMonth: null,
    modules: ['*'],
  },
};
