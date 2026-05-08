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
    permissions: ['emit_invoice', 'manage_inventory', 'manage_third_parties', 'run_ocr', 'manage_users'],
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
    permissions: ['emit_invoice', 'manage_inventory', 'manage_third_parties', 'run_ocr'],
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
    permissions: ['emit_invoice', 'manage_third_parties', 'run_ocr'],
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
    id: 'Usuario nomina',
    permissions: [],
    views: ['dashboard'],
    access: {
      dashboard: ['view'],
      billing: [],
      inventory: [],
      accounting: [],
      'third-parties': ['view'],
      users: [],
      ai: [],
    },
  },
  {
    id: 'Gerencia',
    permissions: [],
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
    permissions: [],
    views: ['dashboard'],
    access: {
      dashboard: ['view'],
      billing: ['view'],
      inventory: ['view'],
      accounting: ['view'],
      'third-parties': ['view'],
      users: [],
      ai: [],
    },
  },
]
