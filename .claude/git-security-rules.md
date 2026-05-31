# Normas de Seguridad en Git (Git Security Rules)

Este documento establece las políticas y directrices de seguridad para la gestión del repositorio y el control de versiones en el proyecto backend de **Contex360**. El objetivo principal es prevenir la exposición accidental de credenciales, configuraciones locales, archivos de agentes de IA y datos sensibles.

---

## 🚫 Archivos que DEBEN ser Ignorados

Para proteger la integridad del proyecto y de los entornos de producción/desarrollo, se deben excluir del control de versiones (a través del archivo `.gitignore`) las siguientes categorías de archivos:

### 1. Secretos y Tokens (Secrets & Tokens)
Cualquier archivo que contenga credenciales de acceso, llaves de API, tokens de autenticación o contraseñas debe ser ignorado de manera estricta.
*   **Archivos de Variables de Entorno:** `.env`, `.env.local`, `.env.production`, y cualquier archivo `.env.*` que contenga variables específicas de un entorno con información confidencial.
*   **Llaves y Certificados:** Archivos con extensiones `*.pem`, `*.key`, `*.pub`, `*.cert`, `*.crt`, `*.pfx`, `*.p12`.
*   **Credenciales locales de Git/npm:** `.npmrc`, `.yarnrc`, `auth.json`, `.git-credentials`.

### 2. Archivos y Directorios de IA (AI & Agent Artifacts)
Los agentes de inteligencia artificial y los asistentes de código generan sus propias configuraciones locales, historiales de chat, cachés o reglas específicas de la sesión de trabajo.
*   **Directorio del agente actual:** `.claude/` (contiene configuraciones de permisos locales, worktrees, y reglas temporales).
*   **Otros directorios de agentes y herramientas de IA:** `.gemini/`, `.agents/`, `.roo/`, `.continue/`, `.windsurf/`, `.aider/`, `.devin/`, entre otros.
*   **Archivos de configuración de ignore para IA:** `.claudeignore`, `.cursorrules`, etc.

### 3. Configuraciones y Ajustes Locales (Local Settings)
Configuraciones específicas del editor de código o del entorno local del desarrollador que no deben compartirse, ya que pueden diferir entre sistemas operativos y preferencias individuales.
*   **Configuración de VS Code:** `.vscode/` (excepto `.vscode/extensions.json` que contiene extensiones recomendadas para el equipo).
*   **Otros editores:** Directorios `.idea/` (JetBrains), archivos `*.suo`, `*.ntvs*`, `*.njsproj`, `*.sln`, y archivos de intercambio `*.sw?` (Vim).
*   **Archivos del Sistema Operativo:** Archivos de indexación como `.DS_Store` (macOS) o `Thumbs.db` (Windows).

### 4. Archivos Temporales y Salidas de Construcción (Temporary Files & Build Outputs)
Archivos generados automáticamente durante el proceso de instalación, compilación, pruebas o ejecución del servidor de desarrollo.
*   **Dependencias de Node:** `node_modules/` (deben ser descargadas mediante `npm install` localmente).
*   **Compilaciones y Distribución:** Directorios de compilación como `dist/`, `.pgdata/` (datos de base de datos PostgreSQL local), carpetas de cobertura de pruebas `coverage/`.
*   **Cachés y Metadatos de Compilación:** Archivos de estado de TypeScript `*.tsbuildinfo`, `.cache/`, carpetas de cobertura de pruebas `coverage/`.
*   **Archivos temporales genéricos:** Archivos con extensiones `*.tmp` y `*.temp`.

### 5. Logs e Historiales (Logs)
Archivos de registro que acumulan detalles de la ejecución de comandos u operaciones locales y que a menudo pueden contener rutas absolutas o datos del sistema.
*   Archivos de log generales: `*.log`, `logs/`.
*   Logs de gestores de paquetes: `npm-debug.log*`, `yarn-debug.log*`, `yarn-error.log*`, `pnpm-debug.log*`.

### 6. Contextos Privados y Scratchpads (Private Contexts)
Borradores, scripts de prueba rápidos, anotaciones de desarrollo o directorios de pruebas locales que no forman parte de la arquitectura del software.
*   Directorios como `scratch/` (para scripts temporales o de depuración).
*   Directorios de pruebas locales como `tests-local/`.
*   Colecciones de pruebas locales como `api-tests/` o scripts locales archivados `_archive_scripts/`.

---

## 🛠️ Buenas Prácticas de Git y Seguridad

1.  **Revisión del Estado de Git:** Antes de realizar cualquier confirmación, ejecuta siempre `git status` para comprobar qué archivos están modificados o sin seguimiento (untracked).
2.  **Verificación de Cambios (Diff):** Utiliza `git diff` o `git diff --cached` para revisar línea por línea lo que estás a punto de añadir al commit. Asegúrate de que no se estén colando secretos en formato de texto plano (por ejemplo, llaves de API hardcodeadas temporalmente para pruebas).
3.  **Uso de Variables de Entorno:** Nunca escribas llaves de API o contraseñas directamente en el código de producción. Utiliza variables de configuración del sistema (`ConfigService` de NestJS) referenciando las variables cargadas desde archivos `.env` locales protegidos.
4.  **No Forzar Pushes:** Evita el uso de `git push --force` en ramas compartidas (como `main` o `staging`), ya que esto sobrescribe el historial de commits y dificulta el rastreo de cambios y auditorías de seguridad.
5.  **Exclusiones mediante .gitignore:** Si descubres que un archivo sensible ha sido rastreado por error, debes eliminarlo del índice de Git usando `git rm --cached <nombre-archivo>` antes de añadirlo a `.gitignore`.
6.  **Exclusión Estricta de Archivos no Productivos (Regla Enterprise):** Todo archivo temporal, experimental, generado por IA, skill, MCP, benchmark, script de prueba, contexto privado, prompt temporal o workspace local debe permanecer fuera del repositorio Git. Si un archivo no es necesario para compilar, probar o desplegar Contex360 en producción, debe estar incluido en `.gitignore`.

