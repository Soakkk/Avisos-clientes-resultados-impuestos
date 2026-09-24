# Contexto técnico del Generador de Avisos Fiscales

Documento de referencia para cualquier persona o IA que trabaje en el proyecto.
Describe el estado real del código; si cambias algo importante, actualízalo aquí.

## 1. Qué hace la aplicación

App de escritorio para Windows (Electron) de la asesoría. El flujo diario es:

1. Se hace una captura de la declaración presentada (A3, Sage, Sede de la AEAT…)
   y se pega con `Ctrl+V` (o se arrastran varias imágenes).
2. Cada captura entra en una **bandeja persistente** y se lee con Gemini. Se hacen
   **dos lecturas a la vez con modelos distintos** y se comparan campo a campo.
3. Se aplican **comprobaciones deterministas** (sin IA) y el aviso queda como
   «Verificado», «Revisar datos» o «Sin verificar».
4. Las capturas del mismo cliente (mismo NIF) se agrupan en un único aviso.
5. Se genera el aviso en dos formatos: **ficha en imagen** (lo que se suele enviar)
   y **texto de WhatsApp** (a partir de plantillas editables).
6. «Copiar y siguiente» copia la ficha o el texto, archiva el aviso y pasa al
   siguiente.

Todo se guarda en el propio PC; los datos de clientes solo salen hacia la API de
Gemini (la imagen de la captura).

## 2. Mapa del código

| Archivo | Qué contiene |
|---|---|
| `server.ts` | Servidor Express local (puerto 3000 en el `.exe`). Configuración, capturas en disco, lectura con IA y almacenamiento. |
| `src/server/aiSettings.ts` | Ajustes de IA en `config.json`: clave, modelo principal, modelo de verificación y capturas en paralelo. Modelos recomendados y cadenas de respaldo. |
| `src/server/taxReader.ts` | Esquema JSON, prompts, llamadas a Gemini con reintentos, respaldo de modelo, comparación de las dos lecturas y códigos de error. |
| `src/aeatCalendar.ts` | **Calendario del contribuyente**: plazos por modelo y periodo, festivos nacionales, traslados y tabla de fechas oficiales. |
| `src/noticeFactory.ts` | Construye un aviso a partir de la lectura de la IA y reúne todas las comprobaciones. |
| `src/validation.ts` | Comprobaciones deterministas: IBAN (mod-97), NIF/NIE/CIF, modelo, periodo, ejercicio, importe, resultado, justificante, titular, plazo y directorio de clientes. |
| `src/summary.ts` | Resumen de un aviso con varios impuestos: qué se paga, qué no, total, fechas. Lo usan la ficha, el texto y la interfaz. |
| `src/whatsapp.ts` | Plantillas de texto por situación y su sustitución de variables. |
| `src/types.ts` | Tipos (`TaxNotice`, `JointNotice`), normalización del resultado y fechas. |
| `src/history.ts` | Agrupación por cliente, separar/deshacer y «copiar, archivar y continuar». |
| `src/queue/*` | Bandeja de capturas: estados, reintentos y paralelismo. |
| `src/storage/*` | Estado en disco (`notices.json`), historial compacto y directorio común de clientes. |
| `src/components/NoticeCard.tsx` | **Ficha exportada a imagen.** Diseño aprobado: no cambiar su aspecto sin pedirlo. |
| `src/components/*` | Interfaz: cinta (`Ribbon`), lista de avisos, panel de datos, editor, ajustes, historial y avisos flotantes. |
| `main-electron.cjs` / `preload.cjs` | Ventana de Electron, actualizaciones automáticas y guardado antes de cerrar. |

## 3. Reglas fiscales (calendario AEAT)

Hay que distinguir tres fechas, y la interfaz las nombra siempre así:

- **Fin del plazo**: último día para presentar e ingresar.
- **Cargo en cuenta**: si la declaración está domiciliada, la AEAT carga el
  importe el **último día del plazo**, es decir, el mismo día que el fin del plazo.
- **Domiciliar hasta**: último día para presentar eligiendo domiciliación.

Reglas implementadas en `getAeatDeadlines`:

| Periodo | Fin del plazo | Domiciliación |
|---|---|---|
| 1T / 2T / 3T | 20 de abril / julio / octubre | 15 |
| 4T de 303, 130, 131 (y 349) | 30 de enero del año siguiente | 27 de enero |
| 4T de 111, 115, 123 | 20 de enero del año siguiente | 15 de enero |
| 202: 1P / 2P / 3P | 20 de abril / octubre / diciembre | 15 |
| Mensual (111, 115, 123…) | 20 del mes siguiente (diciembre → 20 de enero) | 15 |
| Mensual 303 (SII) | 30 del mes siguiente (febrero: último día) | estimada |
| 390 · 349 anual | 30 de enero | — |
| 180 · 190 | 31 de enero | — |
| 347 | último día de febrero | — |
| 200 | 25 de julio | 22 de julio |
| 100 (Renta) | 30 de junio | 25 de junio |

- Si el último día cae en **sábado, domingo o festivo nacional**, pasa al primer
  día hábil siguiente. Los festivos nacionales se calculan (incluido Viernes Santo).
- La **fecha de domiciliación nunca se retrasa** por calendario (criterio
  prudente): si cae en día inhábil se adelanta, y se respeta el margen mínimo de
  la Orden HAC/241/2025 (3 días hábiles o 5 naturales hasta el fin del plazo).
- Las fechas publicadas por la AEAT prevalecen: tabla `OFFICIAL_DEADLINES`
  (2025 y 2026). **Cada diciembre, al publicarse el calendario del año siguiente,
  conviene añadir sus fechas a esa tabla.**
- Los festivos autonómicos o locales no se tienen en cuenta (la AEAT puede
  ampliar el plazo en un municipio, como el Lunes de Pascua de 2025).
- Si no se puede calcular el plazo (periodo o modelo ilegibles), las fechas quedan
  vacías y el aviso pide revisión. **Nunca se inventa una fecha.**

## 4. Lectura con IA

- Modelos por defecto: **Gemini 3.8 Flash** (lectura principal) y **Gemini 3.7
  Flash** (verificación). Se cambian en Ajustes → Inteligencia artificial, donde
  también se puede consultar la lista de modelos que admite la clave.
- Si un modelo no está disponible (retirado, no incluido en la clave…) se prueba
  el siguiente de la cadena (`MAIN_FALLBACKS`, `VERIFY_FALLBACKS`). La
  verificación nunca usa el mismo modelo que la lectura principal.
- Se usa `thinkingLevel: LOW` (los 3.7/3.8 no admiten `MINIMAL`); si un modelo no
  admite el nivel de razonamiento, se repite la llamada sin él.
- Las dos lecturas van en paralelo en `POST /api/gemini/read-tax`. Si falla la
  verificación, el aviso queda «Sin verificar» pero no se bloquea.
- Errores: clave o modelo no válidos → 400 (no se reintenta); cuota → 429;
  saturación o cuelgue → 503 (la bandeja reintenta a 1, 2 y 4 s).
- Si la IA no lee un dato, **se deja vacío**: la app no rellena valores habituales.

## 5. Comprobaciones de cada aviso

Además de comparar las dos lecturas:

- IBAN con dígito de control mod-97 y NIF/NIE/CIF con su letra o dígito de control.
- Modelo conocido, periodo válido (1T-4T, 01-12, 1P-3P solo en el 202, 0A),
  ejercicio razonable, importe coherente con el resultado.
- **Justificante**: 13 dígitos que empiezan por el número de modelo.
- **Titular**: 100/130/131 son de personas físicas; 200/202, de sociedades.
- **Plazo**: avisa si el periodo venció hace más de ~2,5 meses o aún no toca.
- **Directorio común de clientes** (`%LOCALAPPDATA%\AsesoriaEMarin\Suite\clientes.json`,
  compartido con el Escáner): avisa si el IBAN o el nombre no coinciden con los
  últimos guardados para ese NIF. Tras revisarlo a mano en el editor, se acepta.

## 6. Almacenamiento

- `%USERPROFILE%\.generador-avisos-fiscales\config.json`: clave y ajustes de IA.
- `…\notices.json`: bandeja, avisos activos, agrupaciones, borrador del editor e
  historial. El historial guarda solo datos (sin miniaturas) de los **300 avisos
  más recientes**; así el archivo no crece sin límite.
- `…\capturas\`: capturas originales. Se borran las huérfanas de más de 90 días.
- `localStorage`: solo preferencias (nombre de la asesoría, firma, formato de
  ficha y plantillas de texto modificadas).
- No hay copias de seguridad: se retiraron porque no aportaban nada a esta app.

## 7. Recomendaciones para quien continúe

- **Privacidad**: nada de bases de datos en la nube. Todo local.
- **La ficha (`NoticeCard`) no se rediseña** salvo petición expresa. Los tests de
  `tests/output-contracts.test.ts` guardan su huella: si cambias la ficha a
  propósito, revísala visualmente y actualiza la huella.
- Para un modelo nuevo de Gemini: añádelo a `RECOMMENDED_MODELS` y, si procede, a
  las cadenas de respaldo en `src/server/aiSettings.ts`.
- Antes de publicar: `npm run lint`, `npm test` y `npm run build`.

## 8. Desarrollo y publicación

```bash
npm install
npm run dev          # servidor + interfaz (http://localhost:3000)
npm run electron:dev # ventana de Electron conectada al servidor de desarrollo
npm test             # pruebas
npm run electron:build   # instalador en dist-electron/
```

Las versiones se publican al subir una etiqueta `vX.Y.Z` (GitHub Actions compila
el instalador en Windows y lo sube a las releases del repositorio). La app busca
actualizaciones al arrancar y cada seis horas.
