# Plan de mejoras — Generador de Avisos Fiscales

Documento de trabajo: qué se ha decidido, qué está hecho y qué queda pendiente,
para que cualquier sesión futura (o IA) pueda continuar sin perder contexto.
El detalle técnico vigente está en `INSTRUCTIONS_Y_CONTEXTO_IA.md`.

Última actualización: 2026-09-24 (versión 1.6.0).

---

## Hecho en la versión 1.6.0

Revisión completa del programa con el usuario. Decisiones y cambios:

1. **Fechas bien identificadas y calendario AEAT** (`src/aeatCalendar.ts`).
   Se separan fin del plazo, cargo en cuenta (= último día del plazo) y último
   día para domiciliar. El 4T de 303/130/131 vence el 30 de enero (domiciliación
   27) y el de 111/115/123 el 20 (domiciliación 15). Se añaden 202 (1P/2P/3P),
   anuales, mensuales, festivos nacionales y la tabla oficial 2025-2026. Antes el
   202 y los anuales caían siempre en «20 de abril».
2. **La app ya no inventa datos**. Si la IA no lee modelo, periodo, ejercicio o
   NIF, el campo queda vacío y el aviso pide revisión (antes se rellenaba con
   303 / 2T / año actual y salía como verificado).
3. **Gemini 3.8 Flash + 3.7 Flash** (clave de pago del usuario), elegibles en
   Ajustes, con respaldo automático si un modelo se retira y listado de los
   modelos de la clave. Las dos lecturas van en paralelo y se pueden leer hasta
   4 capturas a la vez.
4. **Totales**: solo suma lo que se paga. Un 303 domiciliado con un 130 negativo
   ya no sale como «Total 300 €». Una devolución ya no pide al cliente que pague.
5. **Almacenamiento ligero**: historial sin miniaturas y limitado a 300 avisos
   (antes crecía hasta superar el límite de 20 MB y dejaba de guardar). Guardado
   agrupado al escribir.
6. **Copias de seguridad eliminadas** (no se usaban).
7. **Más códigos de control**: justificante frente a modelo, NIF de persona o de
   sociedad según el modelo, plazo del periodo frente a la fecha actual, y cambio
   de IBAN o nombre respecto al directorio común de clientes.
8. **Plantillas de texto editables** en Ajustes, con vista previa y variables.
9. **Avisos dentro de la app** en vez de `alert()`/`confirm()`, con «Deshacer» al
   descartar, vaciar o archivar. Confirmación antes de copiar un aviso con datos
   por revisar.
10. **Interfaz de programa de oficina**: barra de título, cinta de herramientas,
    lista de avisos, panel de datos, vista previa y barra de estado. **La ficha en
    imagen mantiene su diseño**; solo se corrigen solapes del desglose, el
    interlineado de los importes, meses en minúscula y «Resultado de la
    liquidación».
11. Limpieza: se eliminan la interfaz antigua que ya no se mostraba (~550 líneas),
    componentes sin uso y restos de AI Studio; documentación al día.

## Pendiente

- **Control de campaña** (muy importante para el usuario): ver qué clientes
  faltan por avisar en cada trimestre. Necesita el listado de clientes de
  Gestión Fiscal; el usuario lo facilitará (formato por decidir: Excel/CSV con
  NIF, nombre y, si es posible, teléfono y modelos que presenta).
- **Teléfonos de clientes** (no prioritario): con el mismo listado se podría
  abrir el chat de WhatsApp de cada cliente directamente.
- **Calendario 2027**: al publicarse (diciembre de 2026) añadir sus fechas a
  `OFFICIAL_DEADLINES`, en particular la domiciliación del 4T de 2026 (la regla
  da 27 de enero de 2027, pendiente de confirmar) y los festivos nacionales 2027.
- **Domiciliación del IVA mensual (SII)**: la fecha es estimada; confirmar con el
  calendario oficial si algún cliente lo usa.
- **Iterar la interfaz** con capturas reales del usuario en su monitor.
- Revisar en Windows la ficha exportada con la fuente Georgia real (en el entorno
  de desarrollo no está instalada).

## Cómo publicar una versión nueva

1. Subir `version` en `package.json`.
2. `npm run lint && npm test && npm run build`.
3. Commit, push y etiqueta `vX.Y.Z`: GitHub Actions compila el instalador en
   Windows y lo publica en las releases del repositorio.
