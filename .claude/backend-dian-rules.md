# Reglas de Facturación Electrónica DIAN — Contex360 Backend

Este documento establece las reglas técnicas y de negocio para el módulo de facturación electrónica de la DIAN en **Contex360 ERP**. Estas directrices garantizan la validez legal de los documentos XML, el correcto cálculo del CUFE/CUDE, la consistencia en la numeración, la gestión de resoluciones y la segregación estricta de ambientes.

---

## 🔐 1. Certificado Digital y Firma de XML

### 1.1 Seguridad de los Certificados
*   **Prohibición de Disco:** Bajo ninguna circunstancia se debe almacenar un certificado digital (`.p12` o `.pfx`) físicamente en el disco del servidor o contenedor.
*   **Variable de Entorno Base64:** Los certificados deben almacenarse en variables de entorno cifradas (`SAAS_DIAN_CERTIFICATE`) codificadas en Base64.
*   **Procesamiento en Memoria:** Al momento de firmar, decodifica el Base64 a un buffer de memoria:
    ```typescript
    const certificateBuffer = Buffer.from(process.env.SAAS_DIAN_CERTIFICATE, 'base64');
    ```
*   **Cero Logs de Secretos:** Está estrictamente prohibido loggear el buffer del certificado, la clave privada, la contraseña del certificado o el PIN del software de la DIAN en las herramientas de observabilidad (Pino/Sentry).

### 1.2 Firma Digital (XML DSig)
*   Todo documento XML (Factura, Nota Crédito, Nota Débito, Eventos) debe firmarse digitalmente siguiendo la especificación **W3C XML Signature (XML DSig)** con algoritmo **SHA-256** (`http://www.w3.org/2001/04/xmlenc#sha256`).
*   Debe contener el elemento `ds:Signature` incrustado en el tag de la DIAN `ExtensionContent` según el estándar UBL 2.1 de Colombia.

---

## 🧮 2. Estructura y Cálculo de CUFE y CUDE

### 2.1 Fórmula del CUFE (Código Único de Factura Electrónica)
El CUFE se calcula concatenando de forma estricta los siguientes valores en orden y aplicando el algoritmo de hashing **SHA-384**:
1.  `NumFac`: Número de factura (con prefijo).
2.  `FecFac`: Fecha de expedición (YYYY-MM-DD).
3.  `HorFac`: Hora de expedición (HH:MM:SS-ZZ:ZZ).
4.  `ValFac`: Valor de la factura (antes de tributos).
5.  `CodImp1`: Código de impuesto 1 (`01` para IVA).
6.  `ValImp1`: Valor del impuesto 1.
7.  `CodImp2`: Código de impuesto 2 (`04` para INC).
8.  `ValImp2`: Valor del impuesto 2.
9.  `CodImp3`: Código de impuesto 3 (`03` para ICA).
10. `ValImp3`: Valor del impuesto 3.
11. `ValTot`: Valor total de la factura.
12. `NitOfe`: NIT del facturador.
13. `NumAdq`: NIT del adquiriente.
14. `CltCod`: Clave técnica de la resolución DIAN.
15. `TipoAmb`: Código de ambiente (`1` para Producción, `2` para Pruebas).

*   *Importante:* Si un impuesto no aplica, su valor debe sumarse como `0.00`.
*   *Implementación:* Asegurar que los decimales y el formateo de números no varíen el string de entrada (usar redondeo a dos decimales y punto como separador).

### 2.2 Fórmula del CUDE (Código Único de Documento Electrónico)
*   Se aplica a **Notas Crédito**, **Notas Débito** y **Eventos de Recepción**.
*   Utiliza la misma lógica SHA-384, pero concatena el CUFE de la factura de referencia y excluye la Clave Técnica (reemplazándola por el PIN del software).

---

## 🗂️ 3. Notas Crédito y Notas Débito

*   **Referencia Obligatoria:** Todo documento de ajuste (Nota Crédito/Débito) debe apuntar explícitamente a la factura original mediante el `InvoiceReference` incluyendo:
    *   Número de la factura afectada.
    *   CUFE de la factura afectada.
    *   Fecha de emisión de la factura afectada.
*   **Códigos de Concepto:** El DTO de entrada debe validar obligatoriamente los códigos de concepto estandarizados de la DIAN:
    *   *Nota Crédito:* `1` (Devolución parcial), `2` (Anulación), `3` (Rebaja), etc.
    *   *Nota Débito:* `1` (Intereses), `2` (Gastos no previstos), etc.
*   **Asiento Contable Inverso:** Las notas crédito y débito deben disparar automáticamente asientos contables inversos (`LedgerEntry`) en el libro contable de manera atómica con la actualización de estado del documento.

---

## 🎫 4. Gestión de Resoluciones y Secuencialidad (Numeración)

### 4.1 Validación de Resoluciones de Facturación
Antes de emitir cualquier factura electrónica, el servicio de facturación debe validar:
1.  **Vigencia Temporal:** Que la fecha actual se encuentre dentro del rango `resolutionFrom` y `resolutionTo`.
2.  **Rango de Folios:** Que el folio a emitir esté dentro del rango `fromNumber` y `toNumber` autorizado.
3.  **Alerta de Límite (Threshold):** Si la cantidad de folios disponibles cae por debajo del `dianResolutionAlertThreshold` (por defecto 50), registrar un warning y encolar una alerta vía email (`mailer.sendResolutionExpiryAlert`) para el administrador del tenant.

### 4.2 Secuencialidad e Idempotencia
*   **Cero Saltos de Folios:** Para evitar sanciones fiscales por pérdida de folios, el número consecutivo de factura debe reservarse dentro de una transacción de base de datos (`prisma.$transaction`).
*   **Control ante Fallos DIAN:** Si el XML se firma y se le asigna un número de folio, ese número **nunca debe volver a usarse**, incluso si el servidor de la DIAN responde con un error de rechazo temporal. La factura debe quedar en estado `failed` en el timeline y reintentarse con el mismo número, o anularse administrativamente, pero nunca re-utilizar el folio para otra factura distinta.

---

## ⚡ 5. Eventos DIAN (Radicación y Aceptación)

Contex360 ERP debe soportar los eventos obligatorios para facturas a crédito (acuerdo de tres pasos):
1.  **Acuse de Recibo (Evento 030):** Confirmación de que el adquiriente recibió la factura electrónica.
2.  **Recibo del Bien o Servicio (Evento 032):** Confirmación de entrega física o prestación del servicio.
3.  **Aceptación Expresa (Evento 033):** Aprobación directa del adquiriente.
4.  **Aceptación Tácita (Evento 034):** Generada automáticamente por el emisor tras 3 días hábiles si no hay reclamo y se cuenta con el Evento 032.

*   **Timeline de Documento:** Cada evento procesado y firmado debe registrarse en la columna `timeline` del documento `Invoice` correspondiente, guardando la respuesta, firma y trackId de la DIAN.

---

## 🌐 6. Ambiente de Pruebas vs. Producción

*   **Segregación de Entornos (`dianEnvironment`):** Cada `Tenant` opera bajo un ambiente específico definido en `dianEnvironment` (`'test'` o `'production'`).
*   **URLs del Web Service:** El servicio DIAN debe mapear dinámicamente el endpoint del API/SOAP según este valor:
    *   *Test (Habilitación):* `https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc`
    *   *Producción:* `https://vpfe.dian.gov.co/WcfDianCustomerServices.svc`
*   **Protección de Datos Reales en Dev:** Si el backend corre en un entorno que no sea producción (`process.env.NODE_ENV !== 'production'`) pero un tenant tiene configurado `dianEnvironment === 'production'`, el backend debe emitir un Warning explícito en los logs y **solamente** simular el envío o arrojar un error controlado de seguridad, evitando que un desarrollador emita facturas reales con valor legal desde su máquina local.
