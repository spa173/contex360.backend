# Arquitectura Frontend: Contex360 ERP

Esta es la estructura detallada de los módulos y vistas que componen el frontend de Contex360. El sistema utiliza **Vue 3** con **Pinia** para el estado global y **Tailwind CSS** para el diseño premium basado en Stitch.

## 1. Módulos de Operación (Core ERP)
Estas son las vistas donde se realiza la actividad comercial principal de las empresas.

| Módulo | Vista (`src/components/views/`) | Propósito |
| :--- | :--- | :--- |
| **Dashboard** | `DashboardView.vue` | Centro de mando (Operational Copilot) con métricas en tiempo real, KPIs de ventas y widget de IA. |
| **Facturación** | `BillingView.vue` | Gestión de facturas electrónicas, emisión, anulación y validación ante la DIAN. |
| **Compras** | `PurchasesView.vue` | Registro de facturas de proveedores, gastos y costos de operación. |
| **Inventario** | `InventoryView.vue` | Control de stock, movimientos de almacén, alertas de existencias bajas y categorización. |
| **Contabilidad** | `AccountingView.vue` | Libro diario, asientos contables automáticos, PUC y estados financieros. |
| **Tesorería** | `TreasuryView.vue` | Gestión de caja y bancos, conciliaciones, pagos y recaudos. |
| **Cotizaciones** | `QuotesView.vue` | Generación de presupuestos y propuestas comerciales para clientes. |
| **Terceros** | `ThirdPartiesView.vue` | Directorio de Clientes, Proveedores y Empleados (CRM/SRM básico). |

## 2. Control y Herramientas (Intelligence)
Módulos dedicados a la automatización y el análisis de datos.

| Módulo | Vista | Propósito |
| :--- | :--- | :--- |
| **IA / OCR** | `AiView.vue` | Interfaz de escaneo de documentos para extracción automática de datos mediante visión artificial. |
| **Reportes** | `ReportsView.vue` | Generación de informes detallados, exportación a Excel/PDF y analítica avanzada. |
| **Administración** | `AdminConsoleView.vue` | Panel exclusivo para dueños del sistema para gestionar Tenants y configuraciones globales. |

## 3. Gestión de Usuario y Seguridad
Vistas transversales para la configuración de la cuenta y seguridad.

| Módulo | Vista | Propósito |
| :--- | :--- | :--- |
| **Perfil** | `ProfileView.vue` | Configuración de datos personales, avatar y preferencias. |
| **Seguridad (2FA)** | `TwoFactorView.vue` | Configuración de autenticación de dos factores para mayor protección. |
| **Usuarios** | `UsersView.vue` | Gestión de roles, permisos (RBAC) e invitaciones al equipo. |
| **Password** | `ChangePasswordView.vue` | Flujo de cambio y recuperación de contraseña. |

## 4. Sistema de Estado (Pinia Stores)
El cerebro de la aplicación reside en `src/stores/`, donde se sincronizan los datos con el backend:

*   **authStore**: Maneja la sesión, el usuario actual y el tenant activo.
*   **billingStore**: Sincroniza facturas y estados DIAN.
*   **inventoryStore**: Centraliza los productos y alertas de stock.
*   **aiStore**: Maneja los estados de procesamiento de documentos OCR.
*   **rbacStore**: Controla qué vistas puede ver cada usuario según su rol.

## 5. Diseño y Layout Premium
*   **AppShell.vue**: El contenedor principal que orquesta la navegación.
*   **AppSidebar.vue**: El menú lateral flotante con auto-ocultado (hover trigger).
*   **TopNavigation.vue**: La cabecera centrada con selector de empresa.
*   **styles.css**: Define la paleta de colores "Navy Tech" y las variables de diseño premium.

> [!TIP]
> Cada vista está diseñada para ser reactiva. Si cambias de **Tenant (Empresa)** en la cabecera, todos los stores se limpian y vuelven a cargar la información específica de la nueva empresa seleccionada automáticamente.
