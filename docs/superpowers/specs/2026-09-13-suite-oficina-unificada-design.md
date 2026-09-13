# Avisos fiscales dentro de la suite de oficina

Estado: aprobado por el usuario el 13 de septiembre de 2026.

## Objetivo

Unificar la interfaz del Generador de Avisos Fiscales con Facturas a Aplifisa y convertir el pegado de capturas en una bandeja de trabajo recuperable. Se mantiene React + Electron + Express local y el uso de Gemini.

## Límites

- Facturas a Aplifisa es referencia de solo lectura; FocusNotch y repositorios históricos quedan fuera.
- `NoticeCard`, el texto de WhatsApp, las reglas fiscales, validaciones y cálculos permanecen funcional y visualmente intactos.
- La nueva presentación envuelve el resultado actual; no modifica la imagen exportada.
- No se sustituye el proveedor de IA ni se amplía el alcance de seguridad.

## Sistema visual compartido

La interfaz de trabajo usa `#F5F8FC`, blanco, `#24384D`, `#5D7084`, `#DCE5F0`, `#326FA6`, `#19724E`, `#86500A` y `#B43737`, con Segoe UI Variable/Segoe UI. Se eliminan restos de paletas anteriores en el shell, no dentro de la ficha exportada.

La pantalla conserva entrada a la izquierda y resultado a la derecha. Una barra superior clara agrupa identidad, configuración y actualización. La bandeja y el historial comparten tablas/tarjetas, filtros y estados de la suite. El icono mantiene el pictograma fiscal en la forma común.

## Automatización del flujo

1. Pegar o soltar varias capturas crea una bandeja persistente. Un trabajador secuencial procesa automáticamente la siguiente sin bloquear la revisión del resultado anterior.
2. Los errores temporales usan reintentos acotados con espera creciente; los errores de datos pasan a revisión sin frenar el resto.
3. Las capturas se agrupan por NIF normalizado y, con validación suficiente, por nombre. El usuario puede separar o unir y deshacer esa decisión.
4. “Copiar, archivar y continuar” copia el texto o imagen mediante el código actual, mueve el aviso al historial y selecciona el siguiente pendiente.
5. El historial permite buscar por nombre, NIF, modelo, periodo y fecha, reabrir un aviso y ver la captura original. Los activos y archivados se guardan en disco; `localStorage` conserva solo preferencias ligeras y una migración compatible.
6. Exportar/importar copia de seguridad incluye avisos, capturas y directorio de clientes con un manifiesto versionado.

## Directorio compartido de clientes

Los datos viven en `%LOCALAPPDATA%\AsesoriaEMarin\Suite\clientes.json`. Esta app solo publica automáticamente campos que hayan superado la verificación determinista y, cuando aplique, la segunda lectura. Los campos dudosos quedan como propuesta. Las demás apps pueden reutilizar nombre, NIF e IBAN sin depender del almacenamiento interno de React.

## Actualizaciones y publicación

`electron-updater` comprueba al arrancar y periódicamente, descarga en segundo plano y deja el paquete preparado. Antes de reiniciar se persisten bandeja, avisos y edición actual. La instalación se aplica al cerrar o mediante “Reiniciar y actualizar”, y la app recupera el punto de trabajo.

El flujo de GitHub construye y prueba en Windows, publica instalador y metadatos de `electron-updater` en el repositorio principal y evita versiones sin los assets necesarios.

## Errores y recuperación

Cada captura conserva estado, número de intentos y error legible. Ningún fallo borra la captura. La limpieza de huérfanos respeta elementos de la bandeja, historial y copias. Los fallos de almacenamiento se muestran antes de aceptar más trabajo.

## Verificación

- Pruebas de cola, reintentos, agrupación, historial, migración y cliente compartido.
- Pruebas de `electron-updater` con eventos simulados y recuperación de sesión.
- Capturas de UI en los tamaños de escritorio soportados.
- Pruebas de regresión de `NoticeCard` y del texto de WhatsApp con fixtures representativos; la salida debe coincidir exactamente.
- `npm run lint`, `npm test`, build de Vite/servidor y build Windows antes de publicar.

