export const PLAN_LIMITS = {
  free: {
    maxProducts: 50,
    maxOrdersPerMonth: 30,
    maxCustomers: 100,
    features: {
      reports: false,
      exportData: false,
      multipleImages: false,
      prioritySupport: false,
      customBranding: false,
      apiAccess: false,
    },
  },
  pro: {
    maxProducts: 500,
    maxOrdersPerMonth: 500,
    maxCustomers: 1000,
    features: {
      reports: true,
      exportData: true,
      multipleImages: true,
      prioritySupport: false,
      customBranding: false,
      apiAccess: false,
    },
  },
  enterprise: {
    maxProducts: -1, // unlimited
    maxOrdersPerMonth: -1,
    maxCustomers: -1,
    features: {
      reports: true,
      exportData: true,
      multipleImages: true,
      prioritySupport: true,
      customBranding: true,
      apiAccess: true,
    },
  },
} as const

export type PlanType = keyof typeof PLAN_LIMITS
export type PlanFeatures = keyof (typeof PLAN_LIMITS)['free']['features']

export const PLAN_PRICES = {
  free: 0,
  pro: 4990, // R$ 49,90 em centavos
  enterprise: 14990, // R$ 149,90 em centavos
} as const

export const PLAN_NAMES = {
  free: 'Gratuito',
  pro: 'Profissional',
  enterprise: 'Empresarial',
} as const
