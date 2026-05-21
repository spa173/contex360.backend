import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Help Center data...');

  const categories = [
    { id: 'all', label: 'Todos', icon: 'apps' },
    { id: 'getting-started', label: 'Primeros pasos', icon: 'rocket_launch' },
    { id: 'billing', label: 'Facturación', icon: 'receipt_long' },
    { id: 'inventory', label: 'Inventario', icon: 'inventory_2' },
    { id: 'accounting', label: 'Contabilidad', icon: 'account_balance' },
    { id: 'security', label: 'Seguridad', icon: 'shield' },
    { id: 'integrations', label: 'Integraciones', icon: 'hub' },
  ];

  for (const cat of categories) {
    await prisma.helpCategory.upsert({
      where: { id: cat.id },
      update: cat,
      create: cat,
    });
  }

  const articles = [
    // Getting Started
    { id: 1, categoryId: 'getting-started', title: 'Cómo configurar tu empresa en Contex360', summary: 'Aprende a configurar los datos fiscales, logo, dirección y parámetros contables de tu empresa para empezar a operar.', readTime: '5 min', icon: 'business', steps: ['Navega a Configuración > Datos de la empresa', 'Completa el NIT, razón social y régimen tributario', 'Sube el logo y configura la dirección fiscal', 'Guarda los cambios y verifica en la vista previa de factura'] },
    { id: 2, categoryId: 'getting-started', title: 'Crear tu primer usuario y asignar roles', summary: 'Guía paso a paso para invitar colaboradores, asignar roles (Administrador, Contador, Visor, Operador) y gestionar permisos.', readTime: '4 min', icon: 'group_add', steps: ['Ve a Usuarios en el menú lateral', 'Haz clic en "Invitar usuario"', 'Ingresa el correo electrónico y selecciona el rol', 'El usuario recibirá un correo de activación con enlace seguro'] },
    { id: 3, categoryId: 'getting-started', title: 'Navegación y atajos de teclado', summary: 'Conoce la interfaz principal, el menú lateral, la barra de búsqueda rápida (⌘K) y los atajos de teclado disponibles.', readTime: '3 min', icon: 'keyboard', steps: ['Usa ⌘K (Ctrl+K) para abrir la búsqueda rápida', 'Usa ⌘J (Ctrl+J) para abrir el Asistente IA', 'Navega entre módulos con el menú lateral', 'Usa el selector de workspace para cambiar de empresa'] },

    // Billing
    { id: 4, categoryId: 'billing', title: 'Crear y enviar una factura electrónica', summary: 'Proceso completo para crear facturas electrónicas válidas ante la DIAN, incluyendo resolución de numeración, impuestos y firma digital.', readTime: '7 min', icon: 'description', steps: ['Accede a Facturación > Nueva factura', 'Selecciona el cliente o crea uno nuevo desde Terceros', 'Agrega los productos/servicios con cantidades y precios', 'El sistema calcula automáticamente IVA, ReteFuente e ICA', 'Revisa la vista previa y haz clic en "Emitir factura"', 'La factura se firma digitalmente y se envía a la DIAN'] },
    { id: 5, categoryId: 'billing', title: 'Configurar resolución de numeración DIAN', summary: 'Cómo registrar tu resolución de facturación electrónica autorizada por la DIAN para emitir documentos válidos.', readTime: '4 min', icon: 'pin', steps: ['Ve a Configuración > Facturación electrónica', 'Ingresa el número de resolución y el rango autorizado', 'Configura el prefijo asignado', 'El sistema validará la vigencia automáticamente'] },
    { id: 6, categoryId: 'billing', title: 'Notas crédito y débito', summary: 'Cómo emitir notas crédito para anular o corregir facturas, y notas débito para ajustes adicionales.', readTime: '5 min', icon: 'swap_horiz', steps: ['Busca la factura original en el listado', 'Haz clic en "Crear nota crédito" o "Crear nota débito"', 'Selecciona el concepto de corrección', 'El sistema vinculará automáticamente ambos documentos'] },

    // Inventory
    { id: 7, categoryId: 'inventory', title: 'Gestión de productos y stock', summary: 'Aprende a crear productos, gestionar existencias, configurar alertas de stock bajo y manejar múltiples bodegas.', readTime: '6 min', icon: 'inventory', steps: ['Accede a Inventario > Productos', 'Crea un producto con código, nombre, precio y stock inicial', 'Configura la alerta de stock mínimo para recibir notificaciones', 'Asigna el producto a una o más bodegas/ubicaciones'] },
    { id: 8, categoryId: 'inventory', title: 'Transferencias entre bodegas', summary: 'Cómo mover productos entre ubicaciones, registrar traslados y mantener la trazabilidad del inventario.', readTime: '4 min', icon: 'local_shipping', steps: ['Ve a Inventario > Transferencias', 'Selecciona bodega de origen y destino', 'Agrega los productos y cantidades a transferir', 'Confirma la transferencia — el stock se actualiza automáticamente en ambas bodegas'] },
    { id: 9, categoryId: 'inventory', title: 'Métodos de costeo (Promedio ponderado vs FIFO)', summary: 'Entiende las diferencias entre los métodos de costeo disponibles y cómo configurarlos según tu tipo de negocio.', readTime: '5 min', icon: 'calculate', steps: ['Ve a Configuración > Inventario', 'Selecciona "Promedio ponderado" o "FIFO" según tu necesidad', 'El promedio ponderado es ideal para productos homogéneos', 'FIFO es recomendado cuando los costos varían frecuentemente'] },

    // Accounting
    { id: 10, categoryId: 'accounting', title: 'Plan de cuentas y libro mayor', summary: 'Cómo navegar el plan de cuentas contable, consultar el libro mayor y verificar los saldos de cada cuenta.', readTime: '5 min', icon: 'menu_book', steps: ['Accede a Contabilidad > Plan de cuentas', 'Usa el buscador para localizar cuentas por código o nombre', 'Haz clic en una cuenta para ver su libro mayor detallado', 'Exporta los movimientos en PDF o Excel para auditoría'] },
    { id: 11, categoryId: 'accounting', title: 'Conciliación bancaria', summary: 'Proceso para conciliar los extractos bancarios con los registros contables de Contex360 y detectar diferencias.', readTime: '6 min', icon: 'account_balance_wallet', steps: ['Ve a Tesorería > Conciliación', 'Sube el extracto bancario en formato CSV o conecta tu banco', 'El sistema empareja automáticamente los movimientos coincidentes', 'Revisa y clasifica las diferencias manualmente', 'Confirma la conciliación para cerrar el período'] },

    // Security
    { id: 12, categoryId: 'security', title: 'Activar autenticación de dos factores (2FA)', summary: 'Protege tu cuenta con verificación en dos pasos usando una aplicación autenticadora como Google Authenticator o Authy.', readTime: '3 min', icon: 'verified_user', steps: ['Ve a tu perfil > Seguridad y 2FA', 'Haz clic en "Activar autenticación de dos factores"', 'Escanea el código QR con tu app autenticadora', 'Ingresa el código de 6 dígitos para confirmar la activación', 'Guarda los códigos de recuperación en un lugar seguro'] },
    { id: 13, categoryId: 'security', title: 'Gestión de sesiones activas', summary: 'Cómo visualizar, monitorear y revocar sesiones activas en otros dispositivos para mantener la seguridad de tu cuenta.', readTime: '3 min', icon: 'devices', steps: ['Accede a tu perfil > Seguridad y 2FA', 'En la sección "Sesiones activas" verás todos los dispositivos conectados', 'Identifica el navegador, sistema operativo e IP de cada sesión', 'Haz clic en "Revocar" para cerrar sesiones sospechosas inmediatamente'] },
    { id: 14, categoryId: 'security', title: 'Política de contraseñas y bloqueo de cuenta', summary: 'Configuración de requisitos mínimos de contraseña, expiración, historial y protección contra ataques de fuerza bruta.', readTime: '4 min', icon: 'lock', steps: ['Los administradores pueden configurar la política en Configuración > Seguridad', 'Requisitos por defecto: 10+ caracteres, mayúsculas, números y símbolos', 'Las contraseñas expiran cada 90 días con recordatorio automático', 'Tras 5 intentos fallidos, la cuenta se bloquea por 30 minutos'] },

    // Integrations
    { id: 15, categoryId: 'integrations', title: 'Integración con la DIAN (Facturación Electrónica)', summary: 'Cómo configurar la conexión con la DIAN para la emisión y validación de documentos electrónicos en Colombia.', readTime: '6 min', icon: 'cloud_sync', steps: ['Ve a Configuración > Facturación electrónica', 'Sube tu certificado digital (.p12) y configura la clave', 'Ingresa los datos del software registrado ante la DIAN', 'Realiza una prueba de conexión para verificar la integración', 'Una vez validada, las facturas se enviarán automáticamente'] },
    { id: 16, categoryId: 'integrations', title: 'Exportación de datos y reportes', summary: 'Opciones de exportación disponibles: PDF, Excel, CSV. Cómo programar reportes automáticos y compartirlos con tu equipo.', readTime: '4 min', icon: 'download', steps: ['Cada módulo tiene un botón "Exportar" en la esquina superior derecha', 'Selecciona el formato deseado (PDF, Excel o CSV)', 'Puedes filtrar por fechas, estado o categoría antes de exportar', 'Los reportes se generan en segundo plano y se descargan automáticamente'] },
  ];

  for (const article of articles) {
    await prisma.helpArticle.upsert({
      where: { id: article.id },
      update: article,
      create: article,
    });
  }

  const faqs = [
    { id: 1, question: '¿Cómo cambio el idioma de la interfaz?', answer: 'Haz clic en tu avatar en la esquina superior derecha, en la sección "Idioma" selecciona entre Español, Inglés o Portugués. El cambio se aplica inmediatamente a toda la interfaz.' },
    { id: 2, question: '¿Puedo tener varias empresas en una sola cuenta?', answer: 'Sí. Contex360 soporta múltiples workspaces. Usa el selector de empresa en la barra lateral para cambiar entre tus organizaciones. Cada workspace tiene su propia facturación, inventario y configuración independiente.' },
    { id: 3, question: '¿Qué pasa si olvido mi contraseña?', answer: 'En la pantalla de inicio de sesión, haz clic en "¿Olvidaste tu contraseña?". Recibirás un enlace de recuperación por correo electrónico. El enlace expira en 15 minutos por seguridad.' },
    { id: 4, question: '¿Los datos están encriptados?', answer: 'Sí. Todos los datos se almacenan con encriptación AES-256 en reposo y se transmiten con TLS 1.3 en tránsito. Las contraseñas se hashean con Argon2id. Cumplimos con SOC 2, ISO 27001 y la normativa de protección de datos personales (Ley 1581 de 2012).' },
    { id: 5, question: '¿Puedo usar Contex360 desde el celular?', answer: 'Sí. La interfaz es completamente responsiva y se adapta a cualquier tamaño de pantalla. Puedes acceder desde tu navegador móvil sin necesidad de instalar ninguna aplicación.' },
    { id: 6, question: '¿Cómo contacto al soporte técnico?', answer: 'Puedes usar el Asistente IA (⌘J) para resolver dudas inmediatas, o enviar un ticket de soporte desde el menú de usuario > "Contactar soporte". Nuestro equipo responde en un plazo máximo de 4 horas hábiles.' },
    { id: 7, question: '¿Qué roles de usuario existen?', answer: 'Contex360 tiene 4 roles: Administrador (acceso total), Contador (facturación, contabilidad, tesorería), Visor (solo lectura en todos los módulos) y Operador (facturación e inventario básico). Los permisos son configurables por el administrador.' },
    { id: 8, question: '¿Se pueden deshacer las facturas emitidas?', answer: 'Las facturas electrónicas emitidas ante la DIAN no se pueden eliminar. Para corregirlas, debes emitir una Nota Crédito que anule total o parcialmente la factura original. El sistema vincula ambos documentos automáticamente.' },
  ];

  for (const faq of faqs) {
    await prisma.helpFaq.upsert({
      where: { id: faq.id },
      update: faq,
      create: faq,
    });
  }

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
