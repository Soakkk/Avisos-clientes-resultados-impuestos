import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { NoticeRepository } from "./src/storage/noticeRepository";
import { createStorageRouter } from "./src/storage/router";
import { ClientDirectory } from "./src/storage/clientDirectory";
import { ConfigStore, RECOMMENDED_MODELS, MAX_CONCURRENCY, normalizeSettings, type AiSettings } from "./src/server/aiSettings";
import { describeGeminiError, geminiErrorStatus, parseImagePayload, readTaxCapture, withTimeout } from "./src/server/taxReader";

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
const noticeRepository = new NoticeRepository(CONFIG_DIR);
const clientDirectory = new ClientDirectory();

app.use(createStorageRouter(noticeRepository, clientDirectory));

// El barrido conserva cualquier captura todavía referenciada por la bandeja,
// avisos activos o historial; solo elimina huérfanos antiguos.
noticeRepository.cleanupOrphanedCaptures(90 * 24 * 60 * 60 * 1000).catch((err) => {
  console.warn("No se pudo limpiar capturas antiguas:", err);
});

const configStore = new ConfigStore(CONFIG_FILE);
let aiSettings: AiSettings = normalizeSettings(configStore.read());

// Initialize Gemini API client safely
let ai: GoogleGenAI | null = null;

function initGemini(apiKey: string) {
  try {
    ai = new GoogleGenAI({ apiKey });
  } catch (err) {
    console.error("Failed to initialize GoogleGenAI:", err);
    ai = null;
  }
}

const initialApiKey = configStore.read().apiKey || process.env.GEMINI_API_KEY;
if (initialApiKey) {
  initGemini(initialApiKey);
} else {
  console.warn("WARNING: No hay ninguna clave de Gemini configurada todavía.");
}

const generate = (params: Parameters<GoogleGenAI["models"]["generateContent"]>[0]) => ai!.models.generateContent(params);

// API: Check health / whether Gemini is ready to use
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", geminiConfigured: !!ai, version: APP_VERSION });
});

// API: estado de la configuración (nunca devuelve la clave al frontend)
app.get("/api/config", (req, res) => {
  res.json({ hasApiKey: !!ai, ...aiSettings, maxConcurrency: MAX_CONCURRENCY, recommendedModels: RECOMMENDED_MODELS });
});

// API: guardar la clave y/o los ajustes de IA desde Ajustes
app.post("/api/config", (req, res) => {
  const { apiKey, model, verifyModel, concurrency } = req.body || {};
  if (apiKey !== undefined && (typeof apiKey !== "string" || !apiKey.trim())) {
    return res.status(400).json({ error: "La clave de API no puede estar vacía." });
  }
  try {
    const saved = configStore.write({
      ...(apiKey !== undefined ? { apiKey: apiKey.trim() } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(verifyModel !== undefined ? { verifyModel } : {}),
      ...(concurrency !== undefined ? { concurrency } : {}),
    });
    aiSettings = normalizeSettings(saved);
    if (apiKey !== undefined) initGemini(apiKey.trim());
    res.json({ success: true, hasApiKey: !!ai, ...aiSettings });
  } catch (err: any) {
    console.error("Error guardando la configuración:", err);
    res.status(500).json({ error: "No se pudo guardar la configuración en este equipo." });
  }
});

// API: modelos que admite la clave, para el selector de Ajustes
app.get("/api/config/models", async (req, res) => {
  if (!ai) return res.status(400).json({ error: "No hay ninguna clave configurada todavía." });
  try {
    const models: { id: string; label: string }[] = [];
    const pager = await withTimeout(ai.models.list({ config: { pageSize: 100 } }), 15_000);
    for await (const model of pager) {
      const id = String(model.name || "").replace(/^models\//, "");
      const actions = model.supportedActions || [];
      if (!id.startsWith("gemini-") || !actions.includes("generateContent")) continue;
      if (/embedding|image-generation|tts|live|audio/i.test(id)) continue;
      models.push({ id, label: model.displayName || id });
    }
    models.sort((a, b) => b.id.localeCompare(a.id, "es", { numeric: true }));
    res.json({ models });
  } catch (error) {
    res.status(400).json({ error: describeGeminiError(error) });
  }
});

// API: probar que la clave y el modelo elegido funcionan de verdad
app.post("/api/config/test", async (req, res) => {
  if (!ai) {
    return res.status(400).json({ ok: false, error: "No hay ninguna clave configurada todavía." });
  }
  try {
    const response = await withTimeout(
      ai.models.generateContent({ model: aiSettings.model, contents: [{ text: "Responde únicamente con la palabra OK." }] }),
      20_000
    );
    return res.json({ ok: true, respuesta: (response.text || "").trim(), modelo: aiSettings.model });
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: describeGeminiError(error) });
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
  const header = Buffer.alloc(12);
  const file = fs.openSync(ruta, 'r');
  try {
    fs.readSync(file, header, 0, header.length, 0);
  } finally {
    fs.closeSync(file);
  }
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isWebp = header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';
  res.setHeader("Content-Type", isJpeg ? "image/jpeg" : isWebp ? "image/webp" : "image/png");
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

// API: leer una captura. Hace a la vez la lectura principal y la segunda
// lectura de verificación (con otro modelo) y devuelve ambas comparadas.
app.post("/api/gemini/read-tax", async (req, res) => {
  if (!ai) {
    return res.status(500).json({
      error: "El servicio de IA no está configurado. Vaya a Ajustes → Inteligencia artificial y pegue su clave de Gemini."
    });
  }
  const { imageBase64 } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: "Falta la imagen en formato base64." });
  }
  let image: { data: string; mimeType: string };
  try {
    image = parseImagePayload(imageBase64);
  } catch {
    return res.status(400).json({ error: "Formato de imagen no admitido. Use PNG, JPEG o WebP." });
  }
  try {
    return res.json(await readTaxCapture(image, aiSettings, { generate }));
  } catch (error: any) {
    console.error("Error leyendo la captura con Gemini:", error);
    // Una clave o un modelo no válidos no se arreglan reintentando: la captura
    // pasa a revisión con el mensaje, en vez de agotar los reintentos.
    return res.status(geminiErrorStatus(error)).json({ error: describeGeminiError(error) });
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
