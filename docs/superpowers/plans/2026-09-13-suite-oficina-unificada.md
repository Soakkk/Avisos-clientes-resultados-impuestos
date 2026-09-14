# Avisos fiscales — Suite de oficina Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el pegado de capturas en una bandeja recuperable y unificar el shell, manteniendo idénticas las fichas y los mensajes de WhatsApp.

**Architecture:** El estado durable sale de `App.tsx` hacia servicios TypeScript de bandeja, repositorio e historial, expuestos por API local. Los componentes exportadores permanecen protegidos por snapshots; Electron coordina actualización y reinicio.

**Tech Stack:** TypeScript 5.8, React 19, Electron 43, Express, Vite, Node test runner, electron-builder/NSIS.

**Spec:** `docs/superpowers/specs/2026-09-13-suite-oficina-unificada-design.md`

## Global Constraints

- Windows 10/11 y almacenamiento local.
- No modificar la estructura, estilos o texto generado por `NoticeCard.tsx` ni `buildWhatsAppText` salvo extracción mecánica sin cambio de resultado.
- Mantener reglas fiscales y doble verificación actuales.
- La paleta común se aplica al workspace, no al nodo capturado como imagen.

---

### Task 1: Caracterizar ficha y WhatsApp

**Files:**
- Create: `tests/output-contracts.test.ts`
- Create: `src/whatsapp.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `buildWhatsAppText(notice: JointNotice): string` y snapshots de sus resultados; snapshot DOM/estilos en línea de `NoticeCard` para formatos A/B/C.

- [ ] **Step 1: Copiar la función actual a un módulo puro sin cambiar su cuerpo y escribir fixtures de domiciliación, compensación y multi-impuesto**

```ts
test('domiciliación conserva el texto exacto', () => {
  assert.equal(buildWhatsAppText(DOMICILIACION), EXPECTED_DOMICILIACION);
});
```

- [ ] **Step 2: Ejecutar `npm test -- --test-name-pattern="conserva"`; Expected: PASS tras extracción mecánica**
- [ ] **Step 3: Añadir render estático de A/B/C y comparar estructura, textos y estilos críticos**
- [ ] **Step 4: Ejecutar `npm run lint && npm test`; Expected: PASS**
- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/whatsapp.ts tests/output-contracts.test.ts
git commit -m "test: proteger fichas y mensajes fiscales"
```

### Task 2: Repositorio durable y directorio común

**Files:**
- Create: `src/storage/types.ts`
- Create: `src/storage/clientDirectory.ts`
- Create: `src/storage/noticeRepository.ts`
- Create: `tests/storage.test.ts`
- Modify: `server.ts`

**Interfaces:**
- Produces: `ClientDirectory.mergeVerified(client, source)`, `NoticeRepository.saveQueue`, `loadQueue`, `archive`, `search`, `exportBackup`, `importBackup`.

- [ ] **Step 1: Probar fusión por NIF, rechazo de campos no verificados, escritura atómica, archivo y búsqueda**

```ts
test('solo publica datos verificados', async () => {
  const result = await directory.mergeVerified(unverifiedClient, 'avisos-fiscales');
  assert.equal(result.written, false);
});
```

- [ ] **Step 2: Ejecutar `npm test -- --test-name-pattern="almacenamiento|verificados"`; Expected: FAIL**
- [ ] **Step 3: Implementar esquema 1 bajo `%LOCALAPPDATA%/AsesoriaEMarin/Suite` y repositorio propio bajo el directorio existente de la app**

```ts
export interface StoredField<T = string> {
  value: T; source: string; updatedAt: string;
}
export interface ClientRecord {
  nif: string; fields: Record<string, StoredField>; conflicts: Record<string, StoredField[]>;
}
```
- [ ] **Step 4: Añadir API `/api/notices/state`, `/api/notices/archive`, `/api/notices/search`, `/api/backup/export` y `/api/backup/import`**
- [ ] **Step 5: Ejecutar `npm run lint && npm test`; Expected: PASS**
- [ ] **Step 6: Commit**

```bash
git add src/storage server.ts tests/storage.test.ts
git commit -m "feat: guardar avisos y clientes en disco"
```

### Task 3: Bandeja secuencial con reintentos

**Files:**
- Create: `src/queue/types.ts`
- Create: `src/queue/reducer.ts`
- Create: `src/queue/useCaptureQueue.ts`
- Create: `tests/queue.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `CaptureItem{id,fileId,status,attempts,error}`, `queueReducer`, `useCaptureQueue({process,persist})`.

- [ ] **Step 1: Probar orden FIFO, una sola captura en proceso, espera 1s/2s/4s y continuidad tras fallo definitivo**
- [ ] **Step 2: Ejecutar `npm test -- --test-name-pattern="bandeja"`; Expected: FAIL**
- [ ] **Step 3: Implementar reducer puro y hook con máximo tres intentos para errores temporales**

```ts
export type CaptureStatus = 'pending' | 'processing' | 'review' | 'failed';
export interface CaptureItem {
  id: string; fileId: string; status: CaptureStatus; attempts: number; error?: string;
}
```
- [ ] **Step 4: Conectar pegado, botón y drag/drop para encolar todos los archivos admitidos**
- [ ] **Step 5: Persistir cada transición mediante `NoticeRepository.saveQueue`**
- [ ] **Step 6: Ejecutar `npm run lint && npm test`; Expected: PASS**
- [ ] **Step 7: Commit**

```bash
git add src/queue src/App.tsx tests/queue.test.ts
git commit -m "feat: procesar capturas fiscales en una bandeja recuperable"
```

### Task 4: Historial y continuidad

**Files:**
- Create: `src/components/CaptureQueue.tsx`
- Create: `src/components/NoticeHistory.tsx`
- Modify: `src/App.tsx`
- Create: `tests/history.test.ts`

**Interfaces:**
- Produces: filtros `query`, `model`, `period`, `from`, `to`; `completeAndContinue(jointId, mode)`.

- [ ] **Step 1: Probar búsqueda normalizada, archivado idempotente y selección del siguiente pendiente**
- [ ] **Step 2: Ejecutar pruebas y observar FAIL**
- [ ] **Step 3: Construir bandeja e historial usando estados comunes; mantener `NoticeCard` como hijo sin estilos heredados que alteren su captura**

```tsx
<section className="workspace-results">
  <CaptureQueue items={queue} onRetry={retryCapture} />
  {selectedJoint && <div data-export-surface><NoticeCard notice={selectedJoint} format={cardFormat} /></div>}
</section>
```
- [ ] **Step 4: Implementar “Copiar, archivar y continuar” llamando primero al exportador actual y archivando solo tras éxito**
- [ ] **Step 5: Añadir separar/unir con una acción inversa guardada para deshacer**
- [ ] **Step 6: Ejecutar `npm run lint && npm test`; Expected: PASS**
- [ ] **Step 7: Commit**

```bash
git add src/components/CaptureQueue.tsx src/components/NoticeHistory.tsx src/App.tsx tests/history.test.ts
git commit -m "feat: añadir historial y continuidad fiscal"
```

### Task 5: Actualización recuperable

**Files:**
- Create: `src/update-status.ts`
- Modify: `main-electron.cjs`
- Modify: `src/App.tsx`
- Modify: `package.json`
- Modify: `.github/workflows/build.yml`
- Create: `tests/update-status.test.ts`

**Interfaces:**
- Produces: `UpdateState = checking|downloading|ready|installing|error`; puente IPC `update-status`, `restart-and-install`, `check-for-updates`.

- [ ] **Step 1: Probar transiciones y que ready no instala hasta confirmar persistencia de estado**
- [ ] **Step 2: Ejecutar prueba; Expected: FAIL**
- [ ] **Step 3: Añadir preload aislado para IPC, `autoDownload=true`, progreso y aplicación al cierre/reinicio**

```js
contextBridge.exposeInMainWorld('updates', {
  check: () => ipcRenderer.invoke('check-for-updates'),
  restart: () => ipcRenderer.invoke('restart-and-install'),
  onStatus: (fn) => ipcRenderer.on('update-status', (_event, state) => fn(state)),
});
```
- [ ] **Step 4: Hacer que `App` persista bandeja/edición antes de responder `state-saved`**
- [ ] **Step 5: Configurar workflow de tag para lint, test, build y publicación de `.exe`, `latest.yml` y blockmap**
- [ ] **Step 6: Ejecutar `npm run lint && npm test && npm run build`; Expected: PASS**
- [ ] **Step 7: Commit**

```bash
git add src/update-status.ts main-electron.cjs src/App.tsx package.json .github/workflows/build.yml tests/update-status.test.ts
git commit -m "feat: aplicar actualizaciones sin perder la bandeja"
```

### Task 6: Shell visual e icono

**Files:**
- Create: `src/ui/tokens.ts`
- Modify: `src/index.css`
- Modify: `src/App.tsx`
- Modify: `src/components/ApiKeySettings.tsx`
- Modify: `src/components/LoaderOverlay.tsx`
- Modify: `assets/app-icon.png`
- Modify: `assets/app.ico`
- Create: `tests/workspace-ui.test.ts`

**Interfaces:**
- Produces: tokens exactos, barra superior clara, layout adaptable y estados de suite.

- [ ] **Step 1: Probar tokens, regiones principales y aislamiento `data-export-surface`**
- [ ] **Step 2: Ejecutar test; Expected: FAIL sobre tokens/paleta actuales**
- [ ] **Step 3: Reorganizar solo el workspace; envolver la ficha con `data-export-surface` y evitar selectores globales que la afecten**

```css
:root{--page:#F5F8FC;--card:#FFF;--ink:#24384D;--muted:#5D7084;
--border:#DCE5F0;--accent:#326FA6;--success:#19724E;--warning:#86500A;--danger:#B43737}
.workspace-shell{background:var(--page);color:var(--ink)}
.workspace-shell :where(button,input,select){font-family:"Segoe UI Variable","Segoe UI",sans-serif}
```
- [ ] **Step 4: Generar icono rombo azul con documento fiscal blanco y acento dorado**
- [ ] **Step 5: Capturar 1480×900 y 1120×720, corregir en un lote y confirmar una vez**
- [ ] **Step 6: Ejecutar detector una sola vez sobre `src/App.tsx src/index.css src/components` y corregir hallazgos mecánicos**
- [ ] **Step 7: Ejecutar `npm run lint && npm test && npm run build`; Expected: PASS y snapshots exactos**
- [ ] **Step 8: Commit**

```bash
git add src/ui/tokens.ts src/index.css src/App.tsx src/components assets/app-icon.png assets/app.ico tests/workspace-ui.test.ts
git commit -m "feat: integrar avisos fiscales en la suite"
```

### Task 7: Verificación final

- [ ] **Step 1: Ejecutar `npm run lint`**
- [ ] **Step 2: Ejecutar `npm test`**
- [ ] **Step 3: Ejecutar `npm run build`**
- [ ] **Step 4: Revisar capturas y contratos de salida**
- [ ] **Step 5: Ejecutar `git diff --check` y revisar commits**
