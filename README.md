# Generador de Avisos Fiscales

App de escritorio (Windows) para asesorías y despachos fiscales. Automatiza la
generación de avisos de liquidación de impuestos para enviar a los clientes,
leyendo capturas de pantalla del programa de gestión (A3, Sage, Sede Electrónica
de la AEAT...) mediante IA.

## Qué hace

1. **Pegar captura → datos extraídos solos**: copia una captura de pantalla
   (`Impr Pant`) del programa de gestión fiscal y pégala (`Ctrl+V`) en la app.
   Gemini extrae modelo, periodo/trimestre, ejercicio, NIF/nombre del cliente,
   importe, tipo de resultado (domiciliación, a ingresar, a compensar, sin
   actividad, devolución) e IBAN si aparece.
2. **Plazos AEAT automáticos**: calcula el plazo límite y de domiciliación
   oficiales (trimestral o mensual), desplazando al siguiente día hábil si cae
   en fin de semana o festivo.
3. **Varios impuestos, un mismo cliente**: si se pegan varias capturas del
   mismo cliente, las unifica en un único aviso con el desglose y el total.
4. **Genera el aviso en dos formatos**: texto para WhatsApp (con negritas y
   viñetas, listo para copiar) y una ficha visual en imagen (HTML5 Canvas, para
   copiar o descargar en PNG).
5. **Todo en local**: los avisos se guardan en el propio equipo (`localStorage`),
   sin base de datos externa, para no sacar datos de clientes fuera del PC.

## Arquitectura

Aplicación Full-Stack (Vite + React + Express) empaquetada como app nativa de
escritorio con Electron:

- `server.ts` — backend Express que llama a la API de Google GenAI (Gemini) con
  esquema de respuesta JSON estricto.
- `main-electron.cjs` — punto de entrada de Electron, levanta el servidor local
  (puerto 3000) y abre la ventana nativa.
- `src/types.ts` — tipos (`TaxNotice`, `JointNotice`) y `calculateAEATDeadlines`
  (cálculo de plazos AEAT).
- `src/App.tsx` — interfaz principal (arrastrar/soltar y pegado global).
- `src/components/` — editor de avisos, ficha visual y overlay de carga.

Ver [INSTRUCTIONS_Y_CONTEXTO_IA.md](INSTRUCTIONS_Y_CONTEXTO_IA.md) para el
detalle técnico completo y las reglas fiscales exactas.

## Desarrollo local

**Requisitos:** Node.js 18+

```bash
npm install
npm run dev          # servidor + web
npm run electron:dev # ventana nativa conectada al dev server
```

La clave de Gemini se configura desde la propia app (botón "Configurar API
Key" en la cabecera) y se guarda en `%USERPROFILE%\.generador-avisos-fiscales\config.json`.
También se puede definir como variable de entorno `GEMINI_API_KEY` en `.env.local`.

## Compilar el instalador (.exe)

```bash
npm run electron:build
```

Genera el instalador en `dist-electron/`. Para publicar una nueva versión en
GitHub Releases (auto-actualización vía `electron-updater`):

```bash
npm run electron:publish
```

Los instaladores se publican en
[Generador-Avisos-Fiscales-releases](https://github.com/Soakkk/Generador-Avisos-Fiscales-releases).
