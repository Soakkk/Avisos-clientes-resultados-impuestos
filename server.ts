import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

// Load environment variables in development
dotenv.config();

const app = express();
// Puerto fijo 3000 en producción (Electron carga localhost:3000); en desarrollo
// puede cambiarse con la variable PORT si el 3000 está ocupado (p. ej. por la
// propia app instalada corriendo a la vez).
const PORT = parseInt(process.env.PORT || "3000", 10);

// Versión de la app: en el .exe la inyecta Electron (APP_VERSION = app.getVersion());
// en desarrollo se lee de package.json.
const APP_VERSION = (() => {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")).version || "dev";
  } catch {
    return "dev";
  }
})();

// Increase payload limit to handle base64 images
app.use(express.json({ limit: "20mb" }));

// Local, per-PC storage for the Gemini API key (set via the in-app Settings screen).
// This lives outside the installed app folder so it survives updates/reinstalls
// and works both in "npm run dev" and in the packaged .exe.
const CONFIG_DIR = path.join(os.homedir(), ".generador-avisos-fiscales");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Las capturas originales se guardan en disco (no en el localStorage del
// navegador, que tiene un límite de ~5MB y se llenaba con 2-3 capturas en
// base64, dejando de guardar avisos en silencio). El frontend solo conserva
// una miniatura pequeña y el id del archivo.
const CAPTURAS_DIR = path.join(CONFIG_DIR, "capturas");

// Barrido al arrancar: capturas huérfanas de más de 90 días se eliminan para
// que la carpeta no crezca sin límite (los avisos activos rara vez viven tanto).
function limpiarCapturasAntiguas() {
  try {
    if (!fs.existsSync(CAPTURAS_DIR)) return;
    const limite = Date.now() - 90 * 24 * 60 * 60 * 1000;
    for (const nombre of fs.readdirSync(CAPTURAS_DIR)) {
      const ruta = path.join(CAPTURAS_DIR, nombre);
      try {
        if (fs.statSync(ruta).mtimeMs < limite) fs.unlinkSync(ruta);
      } catch { /* si un archivo falla, seguimos con el resto */ }
    }
  } catch (err) {
    console.warn("No se pudo limpiar capturas antiguas:", err);
  }
}
limpiarCapturasAntiguas();

function loadStoredApiKey(): string | undefined {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      return parsed.apiKey || undefined;
    }
  } catch (err) {
    console.error("No se pudo leer la configuración local:", err);
  }
  return undefined;
}

function saveApiKeyLocally(apiKey: string) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ apiKey }, null, 2), "utf-8");
}

// Initialize Gemini API client safely
// Note: User-Agent set to 'aistudio-build' as required
let ai: GoogleGenAI | null = null;

function initGemini(apiKey: string) {
  try {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  } catch (err) {
    console.error("Failed to initialize GoogleGenAI:", err);
    ai = null;
  }
}

const initialApiKey = loadStoredApiKey() || process.env.GEMINI_API_KEY;
if (initialApiKey) {
  initGemini(initialApiKey);
} else {
  console.warn("WARNING: No hay ninguna clave de Gemini configurada todavía.");
}

// API: Check health / whether Gemini is ready to use
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", geminiConfigured: !!ai, version: APP_VERSION });
});

// API: Read current config state (never returns the raw key back to the frontend)
app.get("/api/config", (req, res) => {
  res.json({ hasApiKey: !!ai });
});

// API: Save/update the Gemini API key from the Settings screen
app.post("/api/config", (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return res.status(400).json({ error: "La clave de API no puede estar vacía." });
  }
  try {
    saveApiKeyLocally(apiKey.trim());
    initGemini(apiKey.trim());
    res.json({ success: true, hasApiKey: !!ai });
  } catch (err: any) {
    console.error("Error guardando la clave de API:", err);
    res.status(500).json({ error: "No se pudo guardar la clave de API en este equipo." });
  }
});

// API: Probar que la clave guardada funciona de verdad contra Gemini
// (hasta ahora solo se comprobaba que había "algo" guardado, no que fuera válida).
app.post("/api/config/test", async (req, res) => {
  if (!ai) {
    return res.status(400).json({ ok: false, error: "No hay ninguna clave configurada todavía." });
  }
  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ text: "Responde únicamente con la palabra OK." }],
      }),
      15_000
    );
    const text = (response.text || "").trim();
    return res.json({ ok: true, respuesta: text });
  } catch (error: any) {
    const text = String(error?.message || error || "");
    const lower = text.toLowerCase();
    let message: string;
    if (text.includes("429") || lower.includes("quota")) {
      message = "La clave funciona pero ha agotado su cuota gratuita en este momento.";
    } else if (lower.includes("api key") || lower.includes("api_key") || lower.includes("invalid") ||
               text.includes("400") || text.includes("401") || text.includes("403")) {
      message = "La clave no es válida o ha caducado. Cree una nueva en Google AI Studio.";
    } else if (text.includes("TIMEOUT_GEMINI")) {
      message = "Gemini no ha respondido (red lenta o servicio saturado). Inténtelo de nuevo.";
    } else {
      message = "No se pudo comprobar la clave: " + text;
    }
    return res.status(400).json({ ok: false, error: message });
  }
});

// ---- Almacén de capturas en disco ----

// Guarda la captura original y devuelve un id para recuperarla después.
app.post("/api/capturas", (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return res.status(400).json({ error: "Falta la imagen." });
  }
  try {
    fs.mkdirSync(CAPTURAS_DIR, { recursive: true });
    const clean = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    fs.writeFileSync(path.join(CAPTURAS_DIR, id + ".png"), Buffer.from(clean, "base64"));
    return res.json({ id });
  } catch (err) {
    console.error("Error guardando la captura:", err);
    return res.status(500).json({ error: "No se pudo guardar la captura en disco." });
  }
});

app.get("/api/capturas/:id", (req, res) => {
  // El id lo genera el servidor (base36 + guion); rechazamos cualquier otra cosa
  // para que nadie pueda pedir rutas arbitrarias del disco.
  const id = String(req.params.id || "");
  if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).end();
  const ruta = path.join(CAPTURAS_DIR, id + ".png");
  if (!fs.existsSync(ruta)) return res.status(404).json({ error: "Captura no encontrada." });
  res.setHeader("Content-Type", "image/png");
  fs.createReadStream(ruta).pipe(res);
});

app.delete("/api/capturas/:id", (req, res) => {
  const id = String(req.params.id || "");
  if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).end();
  try {
    const ruta = path.join(CAPTURAS_DIR, id + ".png");
    if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Error borrando la captura:", err);
    return res.status(500).json({ error: "No se pudo borrar la captura." });
  }
});

// API: Analyze Tax Image using Gemini
function isRetryableGeminiError(error: any): boolean {
  const text = String(error?.message || error || "");
  return (
    text.includes("503") || text.includes("UNAVAILABLE") || text.includes("overloaded") ||
    text.includes("high demand") || text.includes("TIMEOUT_GEMINI")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Corta la espera si Gemini no responde en este tiempo. Se ha comprobado que la
// API se cuelga de forma intermitente en las llamadas con imagen (no responde ni
// da error). Las llamadas correctas tardan ~8-15s, así que 30s separa bien un
// cuelgue de una respuesta lenta legítima. Cuenta como fallo "reintentable".
const GEMINI_TIMEOUT_MS = 30_000;
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TIMEOUT_GEMINI: sin respuesta de Gemini")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// Gemini a veces devuelve 503 ("high demand") cuando el modelo está saturado.
// Es un error temporal de Google, no del código: reintentamos con espera creciente.
async function generateContentWithRetry(params: Parameters<GoogleGenAI["models"]["generateContent"]>[0]) {
  // 4 intentos: los cuelgues son intermitentes (~1 de cada 3), así que casi
  // siempre entra a la segunda o tercera antes de agotar los reintentos.
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await withTimeout(ai!.models.generateContent(params), GEMINI_TIMEOUT_MS);
    } catch (error: any) {
      const isLastAttempt = attempt === maxAttempts;
      if (!isRetryableGeminiError(error) || isLastAttempt) throw error;
      const waitMs = 1500 * attempt;
      console.warn(`Gemini saturado o sin respuesta (intento ${attempt}/${maxAttempts}), reintentando en ${waitMs}ms...`);
      await sleep(waitMs);
    }
  }
  throw new Error("No se pudo contactar con Gemini tras varios intentos.");
}

// Esquema compartido por la lectura principal y la segunda lectura de verificación.
const TAX_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    modelo: {
      type: Type.STRING,
      description: "Número del modelo tributario, p. ej. '303', '111', '115', '130', '190', '200', '202'"
    },
    modelo_nombre: {
      type: Type.STRING,
      description: "Nombre oficial o descriptivo del impuesto, p. ej. 'Impuesto sobre el Valor Añadido' o 'Retenciones de IRPF'"
    },
    periodo: {
      type: Type.STRING,
      description: "Periodo o trimestre, p. ej. '1T', '2T', '3T', '4T', '01', '10', '12'"
    },
    ejercicio: {
      type: Type.STRING,
      description: "Ejercicio fiscal, p. ej. '2026' o '2025'"
    },
    cliente_nif: {
      type: Type.STRING,
      description: "NIF, CIF o NIE del declarante o cliente"
    },
    cliente_nombre: {
      type: Type.STRING,
      description: "Nombre completo, apellidos y nombre, o denominación social del cliente"
    },
    importe: {
      type: Type.NUMBER,
      description: "Importe neto resultante de la liquidación como número real positivo o negativo, p. ej. 818.55"
    },
    tipo_resultado: {
      type: Type.STRING,
      description: "Tipo de resultado. Debe ser exactamente uno de estos valores: 'Domiciliación', 'A ingresar', 'A compensar', 'Resultado negativo', 'Resultado cero / Sin actividad', 'Devolución'. " +
        "Usa 'Resultado negativo' cuando el resultado de la declaración sea NEGATIVO y la AEAT no devuelva nada, sino que ese importe se descuente en declaraciones posteriores: " +
        "es el caso típico del modelo 130/131 con resultado negativo (aparece marcado como 'Negativa' o 'A deducir', y se arrastra a la casilla 'A deducir trimestres anteriores' del ejercicio). " +
        "Usa 'Devolución' SOLO si la AEAT va a ingresar el dinero al cliente (casilla de devolución con cuenta de abono), nunca por el mero hecho de que el importe sea negativo. " +
        "Usa 'A compensar' para el IVA (modelo 303) con saldo a compensar en periodos siguientes."
    },
    iban: {
      type: Type.STRING,
      description: "Código IBAN completo sin espacios si se muestra en el formulario de pago, p. ej. 'ES2900811016100006298239'. Si no hay o es parcial, ponlo también."
    },
    fecha_presentacion: {
      type: Type.STRING,
      description: "Fecha en la que se presentó la declaración, SOLO si aparece en la captura: suele estar junto al estado 'PRESENTADA' o el CSV, en un recuadro tipo 'Datos Present. Fecha: 15/07/2026'. " +
        "Formato dd/mm/aaaa. NO la confundas con la fecha de cargo, la fecha límite, el periodo ni el ejercicio, y NO la deduzcas ni la inventes: si no se ve una fecha de presentación en la captura, devuelve cadena vacía."
    }
  },
  required: ["modelo", "periodo", "ejercicio", "cliente_nif", "cliente_nombre", "importe", "tipo_resultado"]
};

app.post("/api/gemini/analyze-tax", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "El servicio de IA no está configurado. Ve a 'Ajustes' y pega tu clave de la API de Gemini."
      });
    }

    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "Falta la imagen en formato base64." });
    }

    // Clean base64 data if it contains the data:image/png;base64, prefix
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const promptText = "Analiza detenidamente esta captura de pantalla de un modelo tributario de la Agencia Tributaria Española (AEAT) " +
      "u otro programa de gestión fiscal (como A3, SAGE o la Sede Electrónica) y extrae la información solicitada en formato JSON " +
      "según el esquema proporcionado. Fíjate bien en el número del modelo (ej. 303, 111, 115, 130, etc.), el ejercicio fiscal (ej. 2026), " +
      "el período (ej. 2T, 3T, 1T, 01, 12, etc.), el NIF del cliente, el nombre completo del cliente, el importe total a ingresar o devolver, " +
      "la modalidad de pago (especialmente si es Domiciliación o Ingreso) y el IBAN si figura en pantalla (limpiando espacios).";

    const response = await generateContentWithRetry({
      // gemini-2.5-flash en vez de 3.5-flash: se comprobó que 3.5-flash se cuelga
      // de forma sistemática en las llamadas con imagen (no responde), mientras
      // que 2.5-flash las resuelve en 1-3s de forma fiable. Es la causa real del
      // "se queda en generando aviso...".
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: "image/png",
            data: cleanBase64
          }
        },
        { text: promptText }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: TAX_SCHEMA
      }
    });

    const textResult = response.text;
    if (!textResult) {
      throw new Error("No se pudo obtener una respuesta estructurada de Gemini.");
    }

    const parsedData = JSON.parse(textResult.trim());
    return res.json(parsedData);
  } catch (error: any) {
    console.error("Error analyzing tax image with Gemini:", error);
    const text = String(error?.message || error || "");
    const lower = text.toLowerCase();
    let message: string;
    if (text.includes("TIMEOUT_GEMINI")) {
      message = "Gemini no ha respondido tras varios intentos (a veces se satura o se cuelga). Vuelva a pegar la captura en unos segundos.";
    } else if (text.includes("429") || lower.includes("quota") || lower.includes("rate limit")) {
      message = "Ha alcanzado el límite de uso de la clave de Gemini (cuota). Espere un minuto y vuelva a intentarlo, o use una clave con más cuota.";
    } else if (text.includes("400") || text.includes("401") || text.includes("403") ||
               lower.includes("api key") || lower.includes("api_key") || lower.includes("invalid") ||
               lower.includes("expired") || lower.includes("permission")) {
      message = "La clave de Gemini no es válida o ha caducado. Ve a 'Ajustes' y pega una clave nueva creada en Google AI Studio (aistudio.google.com/apikey).";
    } else if (isRetryableGeminiError(error)) {
      message = "Gemini está saturado en este momento (mucha demanda en Google). Espere unos segundos y vuelva a pegar la captura.";
    } else {
      message = "Error al procesar la imagen con Gemini: " + (error.message || error);
    }
    return res.status(503).json({ error: message });
  }
});

// ---- Segunda lectura de verificación ----
// Vuelve a leer la MISMA captura con un prompt distinto, centrado en transcribir
// dígito a dígito los campos críticos, y compara con la primera lectura. Si dos
// lecturas independientes coinciden (y además el checksum del IBAN/NIF pasa en el
// frontend), la probabilidad de que un dígito esté mal leído es mínima.

function normalizarCampo(campo: string, valor: any): string {
  const s = valor === undefined || valor === null ? "" : String(valor);
  switch (campo) {
    case "iban":
    case "cliente_nif":
      return s.replace(/[\s.-]+/g, "").toUpperCase();
    case "periodo":
      return s.trim().toUpperCase();
    case "cliente_nombre":
      // Sin acentos, mayúsculas y espacios colapsados: "José Pérez " == "JOSE PEREZ"
      return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
    case "importe":
      return (Math.round((parseFloat(s) || 0) * 100) / 100).toFixed(2);
    default:
      return s.trim();
  }
}

app.post("/api/gemini/verify-tax", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({ error: "El servicio de IA no está configurado." });
    }
    const { imageBase64, extracted } = req.body;
    if (!imageBase64 || !extracted) {
      return res.status(400).json({ error: "Faltan la imagen o los datos a verificar." });
    }
    const cleanBase64 = String(imageBase64).replace(/^data:image\/\w+;base64,/, "");

    const promptText = "Eres un transcriptor de documentos fiscales españoles. Tu única tarea es LEER Y TRANSCRIBIR " +
      "con exactitud absoluta, dígito a dígito y letra a letra, los datos de esta captura de un modelo tributario " +
      "(AEAT, A3, SAGE...). No interpretes ni corrijas nada: copia exactamente lo que ves. Presta especial atención a: " +
      "el IBAN completo (verifica cada dígito dos veces), el importe exacto con sus decimales, el NIF/CIF con su letra, " +
      "y el nombre completo del cliente. Devuelve el JSON según el esquema.";

    // La verificación usa un MODELO DISTINTO al de la primera lectura
    // (gemini-2.5-flash): dos modelos diferentes casi nunca cometen el mismo
    // error de OCR en el mismo dígito, así el contraste es de verdad
    // independiente. Misma clave de API, sin coste extra. Si el modelo
    // preferido no está disponible para esta clave, se recurre al siguiente.
    const VERIFY_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash"];
    let segunda: any = null;
    let modeloUsado = "";
    let ultimoError: any = null;
    for (const model of VERIFY_MODELS) {
      try {
        const response = await generateContentWithRetry({
          model,
          contents: [
            { inlineData: { mimeType: "image/png", data: cleanBase64 } },
            { text: promptText }
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: TAX_SCHEMA
          }
        });
        const textResult = response.text;
        if (!textResult) throw new Error("Sin respuesta estructurada en la verificación.");
        segunda = JSON.parse(textResult.trim());
        modeloUsado = model;
        break;
      } catch (err: any) {
        ultimoError = err;
        console.warn(`Verificación con ${model} no disponible o fallida, probando el siguiente modelo...`);
      }
    }
    if (!segunda) throw ultimoError || new Error("Ningún modelo de verificación disponible.");

    // Solo comparamos los campos donde un error tiene consecuencias reales.
    const camposCriticos = ["iban", "importe", "cliente_nif", "cliente_nombre", "modelo", "periodo", "ejercicio", "tipo_resultado"];
    const discrepancias: { campo: string; primera: string; segunda: string }[] = [];
    for (const campo of camposCriticos) {
      const v1 = normalizarCampo(campo, (extracted as any)[campo]);
      const v2 = normalizarCampo(campo, segunda[campo]);
      // Si ninguna de las dos lecturas vio el campo, no hay nada que comparar.
      if (!v1 && !v2) continue;
      if (v1 !== v2) {
        discrepancias.push({
          campo,
          primera: String((extracted as any)[campo] ?? ""),
          segunda: String(segunda[campo] ?? ""),
        });
      }
    }

    return res.json({ coincide: discrepancias.length === 0, discrepancias, segunda, modeloVerificacion: modeloUsado });
  } catch (error: any) {
    console.error("Error en la verificación con segunda lectura:", error);
    // La verificación es una red de seguridad: si falla (cuota, red...), no
    // bloqueamos el flujo; el frontend lo marca como "sin verificar".
    return res.status(503).json({ error: "No se pudo completar la segunda lectura de verificación." });
  }
});

// Setup Vite development middleware or serve production build assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Loaded dynamically so the production bundle (used inside the packaged .exe,
    // which doesn't ship devDependencies) never needs to resolve 'vite' at all.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // __dirname (no process.cwd()): tras empaquetar, este archivo vive dentro
    // de resources/app.asar/dist junto al resto de los estáticos. process.cwd()
    // depende de desde dónde se lanzó el .exe (varía según acceso directo/carpeta)
    // y en producción normalmente NO es la carpeta de la app, lo que causaba
    // "Not Found" al abrir la app instalada en otro PC.
    const distPath = __dirname;
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Bind only to localhost: this is a private desktop app, no other device
  // on the network should be able to reach it or spend your Gemini quota.
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
