export interface PlanConfig {
  name: string;
  priceMonthly: number;
  priceAnnual: number;
  maxUsers: number | null;
  maxInvoicesPerMonth: number | null;
  modules: string[];
}

export const PLANS: Record<'starter' | 'pyme' | 'enterprise', PlanConfig> = {
  starter: {
    name: 'Starter',
    priceMonthly: 89000,
    priceAnnual: 801000,
    maxUsers: 1,
    maxInvoicesPerMonth: 50,
    modules: ['dashboard', 'billing', 'quotes', 'third-parties'],
  },
  pyme: {
    name: 'Pyme',
    priceMonthly: 189000,
    priceAnnual: 1701000,
    maxUsers: 5,
    maxInvoicesPerMonth: null,
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
    modules: ['*'],
  },
};
