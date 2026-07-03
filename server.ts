import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables in development
dotenv.config();

const app = express();
const PORT = 3000;

// Increase payload limit to handle base64 images
app.use(express.json({ limit: "20mb" }));

// Initialize Gemini API client safely
// Note: User-Agent set to 'aistudio-build' as required
let ai: GoogleGenAI | null = null;
try {
  if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  } else {
    console.warn("WARNING: GEMINI_API_KEY is not defined in the environment.");
  }
} catch (err) {
  console.error("Failed to initialize GoogleGenAI:", err);
}

// API: Check health
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", geminiConfigured: !!process.env.GEMINI_API_KEY });
});

// API: Analyze Tax Image using Gemini 3.5 Flash
app.post("/api/gemini/analyze-tax", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({ 
        error: "El servicio de IA no está configurado. Por favor, asegúrese de que la clave GEMINI_API_KEY esté presente en la sección de secretos." 
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

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
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
        responseSchema: {
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
              description: "Tipo de resultado. Debe ser exactamente uno de estos valores: 'Domiciliación', 'A ingresar', 'A compensar', 'Resultado cero / Sin actividad', 'Devolución'" 
            },
            iban: { 
              type: Type.STRING, 
              description: "Código IBAN completo sin espacios si se muestra en el formulario de pago, p. ej. 'ES2900811016100006298239'. Si no hay o es parcial, ponlo también." 
            }
          },
          required: ["modelo", "periodo", "ejercicio", "cliente_nif", "cliente_nombre", "importe", "tipo_resultado"]
        }
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
    return res.status(500).json({ 
      error: "Error al procesar la imagen con Gemini: " + (error.message || error) 
    });
  }
});

// Setup Vite development middleware or serve production build assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
