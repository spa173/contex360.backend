export interface RoleDefinition {
  id: string
  permissions: string[]
  views: string[]
  access: Record<string, string[]>
}

export const PERMISSION_MODULES = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'billing', label: 'Facturacion' },
  { id: 'inventory', label: 'Inventario' },
  { id: 'accounting', label: 'Contabilidad' },
  { id: 'third-parties', label: 'Terceros' },
  { id: 'users', label: 'Usuarios' },
  { id: 'ai', label: 'IA / OCR' },
]

export const PERMISSION_ACTIONS = [
  { id: 'view', label: 'Ver' },
  { id: 'create', label: 'Crear' },
  { id: 'edit', label: 'Editar' },
  { id: 'approve', label: 'Aprobar' },
  { id: 'export', label: 'Exportar' },
  { id: 'configure', label: 'Configurar' },
]

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: 'Administrador',
    permissions: [
      'view_dashboard', 'export_dashboard', 'manage_dashboard',
      'view_billing', 'create_billing', 'manage_billing',
      'view_inventory', 'manage_inventory',
      'view_third_parties', 'manage_third_parties',
      'view_accounting', 'manage_accounting',
      'run_ocr', 'manage_users'
    ],
    views: ['dashboard', 'billing', 'inventory', 'accounting', 'third-parties', 'users', 'ai'],
    access: {
      dashboard: ['view', 'export', 'configure'],
      billing: ['view', 'create', 'edit', 'approve', 'export', 'configure'],
      inventory: ['view', 'create', 'edit', 'approve', 'export', 'configure'],
      accounting: ['view', 'create', 'edit', 'approve', 'export', 'configure'],
      'third-parties': ['view', 'create', 'edit', 'export', 'configure'],
      users: ['view', 'create', 'edit', 'approve', 'export', 'configure'],
      ai: ['view', 'create', 'edit', 'export', 'configure'],
    },
  },
  {
    id: 'Contador',
    permissions: [
      'view_dashboard', 'export_dashboard',
      'view_billing', 'create_billing', 'manage_billing',
      'view_inventory', 'manage_inventory',
      'view_third_parties', 'manage_third_parties',
      'view_accounting', 'manage_accounting',
      'run_ocr'
    ],
    views: ['dashboard', 'billing', 'inventory', 'accounting', 'third-parties', 'ai'],
    access: {
      dashboard: ['view', 'export'],
      billing: ['view', 'create', 'edit', 'export'],
      inventory: ['view', 'create', 'edit', 'export'],
      accounting: ['view', 'create', 'edit', 'approve', 'export'],
      'third-parties': ['view', 'create', 'edit'],
      users: [],
      ai: ['view', 'create'],
    },
  },
  {
    id: 'Auxiliar contable',
    permissions: [
      'view_dashboard',
      'view_billing', 'create_billing',
      'view_accounting', 'create_accounting',
      'view_third_parties', 'manage_third_parties',
      'run_ocr'
    ],
    views: ['dashboard', 'billing', 'accounting', 'third-parties', 'ai'],
    access: {
      dashboard: ['view'],
      billing: ['view', 'create'],
      inventory: ['view'],
      accounting: ['view', 'create'],
      'third-parties': ['view', 'create'],
      users: [],
      ai: ['view', 'create'],
    },
  },
  {
    id: 'Gerencia',
    permissions: [
      'view_dashboard', 'export_dashboard',
      'view_billing', 'export_billing',
      'view_inventory', 'export_inventory',
      'view_accounting', 'export_accounting',
      'view_third_parties'
    ],
    views: ['dashboard', 'accounting'],
    access: {
      dashboard: ['view', 'export'],
      billing: ['view', 'export'],
      inventory: ['view', 'export'],
      accounting: ['view', 'export'],
      'third-parties': ['view'],
      users: [],
      ai: ['view'],
    },
  },
  {
    id: 'Visor',
    permissions: [
      'view_dashboard', 'export_dashboard',
      'view_billing', 'export_billing',
      'view_inventory', 'export_inventory',
      'view_accounting', 'export_accounting',
      'view_third_parties'
    ],
    views: ['dashboard', 'billing', 'inventory', 'accounting', 'third-parties'],
    access: {
      dashboard: ['view', 'export'],
      billing: ['view', 'export'],
      inventory: ['view', 'export'],
      accounting: ['view', 'export'],
      'third-parties': ['view', 'export'],
      users: [],
      ai: [],
    },
  },
]
