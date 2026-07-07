# Documento de Contexto Técnico para IAs y Manual de Usuario

Este documento contiene toda la información de contexto necesaria para que cualquier modelo de Inteligencia Artificial (IA) o desarrollador entienda la arquitectura, el flujo de datos, la lógica fiscal y los pasos de despliegue/compilación del **Generador de Avisos Fiscales**.

---

## 1. Propósito de la Aplicación

La aplicación es un software de escritorio y web diseñado para **asesorías y despachos fiscales en España**. Su función principal es agilizar y automatizar la generación de avisos de liquidación de impuestos para enviar a los clientes (principalmente vía WhatsApp en formato texto y con fichas visuales de alta definición en formato imagen).

### Características Clave:
1. **Flujo de Portapapeles Automático**: El usuario puede pulsar la tecla `Impr Pant` (o hacer una captura de pantalla) en su programa de gestión fiscal (como A3, Sage, la Sede Electrónica de la AEAT, etc.) y pulsar `Ctrl+V` (o el botón de pegar) en la aplicación.
2. **Lectura con IA mediante Gemini 3.5 Flash**: La aplicación procesa la captura de pantalla de forma segura a nivel de servidor, extrayendo campos clave como:
   - Número de Modelo (ej. 303, 111, 115, 130, 200, 202, etc.)
   - Nombre o concepto del impuesto.
   - Periodo o trimestre (ej. 1T, 2T, 3T, 4T, 01, 10, etc.)
   - Ejercicio (año fiscal, ej. 2026).
   - Datos del cliente: NIF/CIF y Nombre Completo.
   - Importe de la liquidación (positivo o negativo).
   - Tipo de resultado: Domiciliación, A ingresar, A compensar, Sin actividad, Devolución.
   - Código IBAN de la cuenta si figura en la captura.
3. **Cálculo Automático de Plazos AEAT**: La aplicación calcula de forma automática los plazos límite y de cobro oficiales del calendario del contribuyente español para la AEAT. Además, **desplaza de forma automática el plazo al siguiente día hábil** si la fecha cae en fin de semana (sábados o domingos) o festivo nacional.
4. **Unificación por Cliente**: Si el usuario realiza y pega varias capturas correspondientes al mismo cliente, la aplicación unifica de forma inteligente los impuestos bajo un único cliente, desglosando los importes, calculando el resultado total y consolidando la información en un único aviso.
5. **Generación Multiformato**:
   - **Vista WhatsApp**: Genera un texto limpio, profesional y con formato Markdown (`*negritas*` y viñetas) listo para copiar al portapapeles con un clic y enviar por WhatsApp.
   - **Vista Tarjeta**: Dibuja mediante HTML5 Canvas una ficha corporativa estética de alta definición con el desglose, que se puede copiar directamente como imagen al portapapeles o descargar como archivo PNG.
6. **Almacenamiento Local (Privacy-First)**: Los avisos se guardan de forma local en el navegador del usuario utilizando `localStorage`. No se requiere una base de datos externa, preservando al máximo la confidencialidad de los datos de los clientes.

---

## 2. Arquitectura de Archivos del Proyecto

El proyecto está estructurado como una aplicación **Full-Stack (Vite React + Express)** lista para compilarse como aplicación nativa de escritorio de Windows mediante **Electron**:

- `/server.ts`: Servidor backend Express que se comunica con la API oficial de Google GenAI (`@google/genai` v2) utilizando el modelo `gemini-3.5-flash` con esquemas de respuesta JSON estrictos (`responseSchema`).
- `/main-electron.cjs`: Archivo principal de entrada de Electron. Levanta el servidor Express interno localmente de fondo (puerto 3000) de forma segura y abre una ventana nativa de escritorio.
- `/src/types.ts`: Contiene las interfaces TypeScript del sistema (`TaxNotice`, `JointNotice`) y la función principal de cálculo de plazos de la AEAT (`calculateAEATDeadlines`) que gestiona el desplazamiento de fines de semana.
- `/src/App.tsx`: Interfaz de usuario interactiva y refinada basada en Tailwind CSS, con área activa de arrastrar/soltar imágenes y control global de eventos de pegado (`paste`).
- `/src/components/NoticeCardCanvas.tsx`: Componente de dibujo con HTML5 Canvas en alta resolución (escala 2x para evitar pixelado) y botones para copiar la imagen directamente al portapapeles.
- `/src/components/NoticeEditor.tsx`: Formulario dinámico para corregir, editar, o añadir manualmente impuestos y cuentas IBAN por si el programa de contabilidad tuviera datos incompletos.
- `/src/components/LoaderOverlay.tsx`: Pantalla de carga animada que muestra en tiempo real las fases del procesamiento del modelo fiscal por la IA.
- `/package.json`: Configura todos los scripts de compilación web, bundling del servidor backend mediante `esbuild` y el empaquetado del instalador nativo de Windows `.exe` mediante `electron-builder`.

---

## 3. Lógica de Negocio: Reglas AEAT de Domiciliaciones y Plazos

La función `calculateAEATDeadlines` en `/src/types.ts` aplica las siguientes directrices fiscales:
- **Trimestrales (1T, 2T, 3T)**: La fecha de cargo y plazo límite es el día **20** del mes posterior al trimestre (Abril, Julio, Octubre). El plazo límite de domiciliación es el día **15**.
- **Trimestral (4T)**: El plazo límite de pago es el día **30 de Enero** del año siguiente. El plazo límite de domiciliación es el día **25 de Enero**.
- **Mensuales (01 a 11)**: El plazo de pago es el día **20** del mes siguiente. El de domiciliación el día **15**.
- **Mensual (12 - Diciembre)**: Equivalente al 4T, vence el **30 de Enero** del año posterior (domiciliación el **25**).
- **Desplazamiento por fin de semana**: Si cualquiera de estas fechas (ej. el día 20 o el día 15) es sábado o domingo, la fecha se desplaza automáticamente al siguiente lunes (día hábil).

---

## 4. Cómo Gestionar el Repositorio de GitHub

Este proyecto está listo para integrarse con GitHub. Al subirlo a GitHub, podrás realizar actualizaciones (`updates`) periódicas y desplegar versiones de forma sencilla.

### Pasos para vincular a tu cuenta de GitHub:
1. En la esquina superior derecha o en la configuración de la interfaz de AI Studio, selecciona la opción **"Exportar a GitHub"** (esto creará de forma automática un repositorio privado o público con este código).
2. De forma alternativa, puedes descargar el archivo ZIP del proyecto, extraerlo en tu PC local e iniciar Git de forma estándar:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Generador de Avisos Fiscales con IA"
   git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
   git branch -M main
   git push -u origin main
   ```
3. Cada vez que realices una mejora o actualización del código, simplemente haz commit y push a GitHub:
   ```bash
   git add .
   git commit -m "Mensaje descriptivo del cambio"
   git push
   ```

---

## 5. Cómo Crear el Instalador `.exe` para Windows

Para ejecutar esta aplicación en Windows como un programa instalable de escritorio (.exe) independiente que funcione 100% en local en el PC de tu asesoría, sigue estos sencillos pasos:

### Prerrequisitos en tu PC Windows:
- Tener instalado **Node.js** (versión 18 o superior). Puedes descargarlo gratis desde [nodejs.org](https://nodejs.org/).

### Pasos de compilación local:
1. Abre la terminal (`PowerShell` o `Símbolo de sistema`) en la carpeta raíz del proyecto clonado de GitHub.
2. Instala las dependencias necesarias:
   ```bash
   npm install
   ```
3. Configura tu API Key de Gemini:
   Ya no hace falta crear ningún archivo `.env` a mano. Al abrir la app (en desarrollo o ya instalada), pulsa el botón
   **"Configurar API Key"** de la cabecera y pega tu clave de Google Gemini (gratis en Google AI Studio). Se guarda
   de forma local en `%USERPROFILE%\.generador-avisos-fiscales\config.json` en tu propio PC, y sobrevive a
   reinstalaciones/actualizaciones del programa. Si prefieres seguir usando un `.env` en desarrollo, sigue
   funcionando como variable de respaldo (`GEMINI_API_KEY=...`), pero la clave guardada desde Ajustes tiene prioridad.
4. **Genera el instalador de Windows `.exe`**:
   Ejecuta el comando de empaquetado automatizado:
   ```bash
   npm run electron:build
   ```
5. ¡Listo! El proceso compilará el código de React, empaquetará el servidor Express y creará una carpeta llamada **`dist-electron/`**.
   Dentro de esa carpeta encontrarás el archivo de instalación:
   - **`Generador de Avisos Fiscales Setup 1.0.0.exe`**
   Al hacer doble clic sobre él, se instalará de forma automática en tu Windows, agregando un acceso directo en tu escritorio y menú de inicio con interfaz nativa rápida.

### Desarrollo local rápido en Windows:
Si solo deseas probarlo en tu escritorio sin empaquetar en instalador:
```bash
# Terminal 1: Inicia el servidor de backend y de desarrollo
npm run dev

# Terminal 2: Levanta la ventana nativa de Electron conectada al desarrollo
npm run electron:dev
```

---

## 6. Recomendaciones para el Siguiente prompt o IA

- **Privacidad y Seguridad**: Si otra IA propone integrar una base de datos en la nube (como Firebase o PostgreSQL), recuerda que la política preferida del cliente es la **privacidad extrema en local** (`localStorage` o SQLite/JSON local) para no comprometer datos sensibles de NIF y cuentas bancarias de las empresas clientes fuera de su ordenador corporativo.
- **Modelos de Impuestos**: Si necesitas expandir la precisión de Gemini para nuevos modelos (como el Modelo 115 o Modelo 130), puedes editar la instrucción `promptText` en `/server.ts` para agregar especificaciones o ejemplos visuales en el prompt del sistema.
