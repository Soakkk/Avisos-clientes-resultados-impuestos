# Generador de Avisos Fiscales

App de escritorio (Windows) de la asesoría para avisar a los clientes del
resultado de sus declaraciones. Lee capturas de pantalla del programa fiscal
(A3, Sage, Sede Electrónica de la AEAT…) con IA y prepara el aviso listo para
WhatsApp.

## Qué hace

1. **Pegar capturas**: `Ctrl+V` o arrastrar varias imágenes. Cada una entra en
   una bandeja y se lee sola, varias a la vez.
2. **Doble lectura con IA**: Gemini 3.8 Flash lee la captura y Gemini 3.7 Flash la
   vuelve a leer en paralelo; se comparan modelo, periodo, NIF, nombre, importe,
   resultado, IBAN y justificante.
3. **Comprobaciones sin IA**: dígitos de control del IBAN y del NIF, justificante
   frente al modelo, plazo del periodo, tipo de titular y cambios de IBAN respecto
   al directorio común de clientes. Si falta un dato, se deja vacío y se pide
   revisarlo: la app no inventa valores.
4. **Calendario AEAT**: fin del plazo, día del cargo en cuenta y último día para
   domiciliar de cada modelo, con traslados por fin de semana o festivo nacional y
   las fechas oficiales publicadas.
5. **Un aviso por cliente**: varias declaraciones del mismo NIF se unen; el total
   solo suma lo que se paga.
6. **Ficha en imagen y texto de WhatsApp**: la ficha se copia o se guarda en PNG;
   el texto sale de plantillas editables en Ajustes.
7. **Todo en local**: los avisos y las capturas se guardan en el propio equipo.

## Desarrollo local

**Requisitos:** Node.js 20+

```bash
npm install
npm run dev          # servidor + interfaz en http://localhost:3000
npm run electron:dev # ventana nativa conectada al servidor de desarrollo
npm test
```

La clave de Gemini se configura en la app (Ajustes → Inteligencia artificial) y
se guarda en `%USERPROFILE%\.generador-avisos-fiscales\config.json`. En
desarrollo también sirve la variable `GEMINI_API_KEY` en `.env.local`.

Detalle técnico y reglas fiscales: [INSTRUCTIONS_Y_CONTEXTO_IA.md](INSTRUCTIONS_Y_CONTEXTO_IA.md).

## Compilar y publicar

```bash
npm run electron:build   # instalador en dist-electron/
```

Para publicar una versión, sube `version` en `package.json` y crea la etiqueta
`vX.Y.Z`: GitHub Actions prueba, compila el instalador en Windows y lo publica en
las [releases del repositorio](https://github.com/Soakkk/Avisos-clientes-resultados-impuestos/releases).
La app busca una versión nueva al arrancar y cada seis horas.
