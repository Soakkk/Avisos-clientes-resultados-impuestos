import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toBlob, toPng } from 'html-to-image';
import { Check, Copy, Image as ImageIcon, LoaderCircle, MessageSquareText, Upload } from 'lucide-react';
import { CalendarClock, Landmark, WalletCards } from 'lucide-react';
import { TaxNotice, JointNotice, normalizeTaxResult, withDeadlines } from './types';
import { normalizeNifKey } from './validation';
import { NoticeEditor } from './components/NoticeEditor';
import { NoticeCard, type CardFormat } from './components/NoticeCard';
import { CaptureQueue } from './components/CaptureQueue';
import { NoticeHistory } from './components/NoticeHistory';
import { NoticeList, jointState } from './components/NoticeList';
import { NoticeDetails, verificationIssues } from './components/NoticeDetails';
import { Ribbon } from './components/Ribbon';
import { SettingsDialog, type AiConfig, type SettingsTab } from './components/SettingsDialog';
import { ConfirmDialog, ToastStack, useFeedback } from './components/ui/Feedback';
import { buildWhatsAppText } from './whatsapp';
import { applyManualEdit, buildNoticeFromReading, type ReadTaxResponse } from './noticeFactory';
import { loadPreferences, savePreferences, type Preferences } from './preferences';
import {
  completeAndContinue,
  createSplitOverride,
  groupNotices,
  undoGroupingOverride,
} from './history';
import { TemporaryCaptureError } from './queue/reducer';
import { useCaptureQueue } from './queue/useCaptureQueue';
import type { CaptureItem } from './queue/types';
import type { ArchivedNotice, GroupingOverride, NoticeState } from './storage/types';
import type { UpdateStatus } from './update-status';
import type { EditorDraft } from './editorDraft';

const appIcon = new URL('./assets/app-icon.png', import.meta.url).href;

// Comprime la captura a una miniatura JPEG pequeña (~10-30 KB) para la interfaz.
// La captura original se guarda en disco aparte.
function compressToThumbnail(dataUrl: string, maxSide = 640, quality = 0.72): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// La captura original se guarda en disco vía servidor; devuelve su id (o undefined si falla).
async function saveCaptureToDisk(imageBase64: string): Promise<string | undefined> {
  try {
    const res = await fetch('/api/capturas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64 }),
    });
    if (!res.ok) return undefined;
    return (await res.json()).id;
  } catch {
    return undefined;
  }
}

function deleteCaptureFromDisk(id?: string) {
  if (!id) return;
  fetch('/api/capturas/' + id, { method: 'DELETE' }).catch(() => {});
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer la captura.'));
    reader.readAsDataURL(file);
  });
}

async function lookupClient(nif: string): Promise<{ nombre?: string; iban?: string } | undefined> {
  if (!nif) return undefined;
  try {
    const response = await fetch(`/api/clients/${encodeURIComponent(nif)}`);
    if (!response.ok) return undefined;
    const data = await response.json();
    return data.nombre || data.iban ? { nombre: data.nombre || undefined, iban: data.iban || undefined } : undefined;
  } catch {
    return undefined;
  }
}

const ADVISORY_NOTE_PRESETS = [
  { id: 'aplazamiento', label: 'Aplazamiento', text: 'Avísenos si desea solicitar un aplazamiento.', icon: Landmark },
  { id: 'saldo', label: 'Saldo suficiente', text: 'Recuerde disponer de saldo suficiente.', icon: WalletCards },
  { id: 'domiciliacion', label: 'Confirmar domiciliación', text: 'Pendiente de confirmar la domiciliación.', icon: CalendarClock },
] as const;

const EXPORT_OPTIONS = { pixelRatio: 2, backgroundColor: '#FBF9F5', cacheBust: true, skipFonts: true };

const DISCARD_UNDO_MS = 8000;

export default function App() {
  const [rawNotices, setRawNotices] = useState<TaxNotice[]>([]);
  const [archivedNotices, setArchivedNotices] = useState<ArchivedNotice[]>([]);
  const [groupingOverrides, setGroupingOverrides] = useState<GroupingOverride[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [hydration] = useState(() => {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
    void promise.catch(() => {});
    return { promise, resolve, reject };
  });
  const rawNoticesRef = useRef<TaxNotice[]>([]);
  const queueItemsRef = useRef<CaptureItem[]>([]);
  const archivedNoticesRef = useRef<ArchivedNotice[]>([]);
  const groupingOverridesRef = useRef<GroupingOverride[]>([]);
  const selectedJointIdRef = useRef<string | null>(null);
  const workspaceWrites = useRef<Promise<unknown>>(Promise.resolve());
  const editorDraftRef = useRef<EditorDraft | null>(null);
  const processImageFileRef = useRef<(file: File, persistedFileId?: string) => Promise<{ jointId: string }>>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processingCount, setProcessingCount] = useState(0);
  const [editingJointId, setEditingJointId] = useState<string | null>(null);
  const [view, setView] = useState<'image' | 'text'>('image');
  const [copied, setCopied] = useState<'text' | 'image' | null>(null);
  const [selectedJointId, setSelectedJointId] = useState<string | null>(null);
  selectedJointIdRef.current = selectedJointId;
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const feedback = useFeedback();
  const { notify, confirm } = feedback;

  const persistWorkspace = useCallback(async (
    queueItems = queueItemsRef.current,
    activeNotices = rawNoticesRef.current,
  ) => {
    const state: NoticeState = {
      schemaVersion: 1,
      queue: queueItems,
      activeNotices,
      archivedNotices: archivedNoticesRef.current,
      groupingOverrides: groupingOverridesRef.current,
      selectedJointId: selectedJointIdRef.current,
      draft: editorDraftRef.current,
      updatedAt: new Date().toISOString(),
    };
    const body = JSON.stringify(state);
    const writing = workspaceWrites.current.catch(() => {}).then(async () => {
      const response = await fetch('/api/notices/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!response.ok) throw new Error('No se pudo guardar la bandeja en disco.');
    });
    workspaceWrites.current = writing;
    try {
      await writing;
    } catch (error) {
      setStorageReady(false);
      setStorageError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, []);

  // Escribir en la nota o en el editor no debe reescribir el archivo en cada
  // tecla: se agrupan los cambios y se guarda al dejar de escribir. Los datos
  // viven en las refs, así que un cierre inmediato guarda igualmente lo último.
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePersist = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      void persistWorkspace().catch(() => {});
    }, 600);
  }, [persistWorkspace]);

  const rememberDraft = useCallback((draft: EditorDraft) => {
    editorDraftRef.current = draft;
    if (storageReady) schedulePersist();
  }, [schedulePersist, storageReady]);

  const cancelEditing = () => {
    editorDraftRef.current = null;
    setEditingJointId(null);
    void persistWorkspace().catch(() => {});
  };

  useEffect(() => {
    const updates = window.updates;
    if (!updates) return;
    const stopStatus = updates.onStatus(setUpdateStatus);
    const stopSaveRequest = updates.onSaveRequested((requestId) => {
      void hydration.promise.then(() => persistWorkspace())
        .then(() => updates.stateSaved(requestId, true))
        .catch((error) => updates.stateSaved(requestId, false, error instanceof Error ? error.message : String(error)));
    });
    return () => {
      stopStatus();
      stopSaveRequest();
    };
  }, [hydration, persistWorkspace]);

  // Versión instalada y configuración de la IA (modelo y capturas en paralelo).
  const refreshAiConfig = useCallback(() => {
    fetch('/api/config')
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => { if (config) setAiConfig(config); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => { if (d.version) setAppVersion(d.version); })
      .catch(() => {});
    refreshAiConfig();
  }, [refreshAiConfig]);

  // Guarda la bandeja en disco
  const saveNoticesToLocal = (newNotices: TaxNotice[], { deferred = false } = {}) => {
    rawNoticesRef.current = newNotices;
    setRawNotices(newNotices);
    if (deferred) {
      schedulePersist();
      return;
    }
    void persistWorkspace(queueItemsRef.current, newNotices).catch((error) => {
      console.error('No se pudo guardar en disco', error);
      notify('No se han podido guardar los avisos en disco.', { tone: 'error', detail: 'No añada más capturas hasta reiniciar la aplicación.' });
    });
  };

  // Los avisos se hidratan desde disco y solo se consulta localStorage para
  // una migración única de versiones antiguas.
  useEffect(() => {
    void fetch('/api/notices/state')
      .then((response) => {
        if (!response.ok) throw new Error('No se pudo abrir el almacenamiento de avisos.');
        return response.json() as Promise<NoticeState>;
      })
      .then(async (stored) => {
        archivedNoticesRef.current = Array.isArray(stored.archivedNotices) ? stored.archivedNotices : [];
        groupingOverridesRef.current = Array.isArray(stored.groupingOverrides) ? stored.groupingOverrides : [];
        setArchivedNotices(archivedNoticesRef.current);
        setGroupingOverrides(groupingOverridesRef.current);
        const draft = stored.draft as EditorDraft | undefined;
        if (draft?.jointId && Array.isArray(draft.taxes)) {
          editorDraftRef.current = draft;
          setEditingJointId(draft.jointId);
        }
        if (stored.selectedJointId) {
          selectedJointIdRef.current = stored.selectedJointId;
          setSelectedJointId(stored.selectedJointId);
        }
        if (draft?.jointId) setSelectedJointId(draft.jointId);
        const diskNotices = Array.isArray(stored.activeNotices) ? stored.activeNotices as TaxNotice[] : [];
        let source = diskNotices;
        let savedNotices: string | null = null;
        try { savedNotices = localStorage.getItem('aeat_raw_notices'); } catch { savedNotices = null; }
        if (source.length === 0 && savedNotices) source = JSON.parse(savedNotices) as TaxNotice[];

        if (source.length > 0) {
          // Migra avisos antiguos con tildes dañadas y refresca las fechas con
          // el calendario actual.
          const normalized = source.map((notice) => withDeadlines({
            ...notice,
            tipo_resultado: normalizeTaxResult(notice.modelo, notice.tipo_resultado),
          }));
          rawNoticesRef.current = normalized;
          setRawNotices(normalized);

          // Avisos de versiones antiguas con la captura completa en base64: se
          // re-comprimen a miniatura para liberar espacio.
          const oversized = normalized.filter((n) => (n.screenshotUrl?.length || 0) > 150_000);
          if (oversized.length > 0) {
            Promise.all(
              normalized.map(async (n) =>
                (n.screenshotUrl?.length || 0) > 150_000
                  ? { ...n, screenshotUrl: await compressToThumbnail(n.screenshotUrl!) }
                  : n
              )
            ).then((migrated) => saveNoticesToLocal(migrated));
          }
        }
        const recoveredQueue = (Array.isArray(stored.queue) ? stored.queue as CaptureItem[] : []).map((item) => {
          const completed = rawNoticesRef.current.find(notice => notice.screenshotId === item.fileId);
          return completed ? { ...item, status: 'review' as const, jointId: normalizeNifKey(completed.cliente_nif, completed.cliente_nombre) } : item;
        });
        captureQueue.hydrate(recoveredQueue);
        queueItemsRef.current = recoveredQueue;
        await persistWorkspace(recoveredQueue, rawNoticesRef.current);
        const migration = await fetch('/api/notices/migration-complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (!migration.ok) throw new Error('No se pudo confirmar la migración de los avisos.');
        try { localStorage.removeItem('aeat_raw_notices'); } catch { /* nada que migrar */ }
        setStorageReady(true);
        hydration.resolve();
      })
      .catch((error) => {
        hydration.reject(error);
        console.error('Failed to load saved notices', error);
        setStorageError('No se ha podido abrir el almacenamiento local. Reinicie la aplicación antes de añadir más capturas.');
      });
  }, []);

  const handleSavePreferences = (next: Preferences) => {
    setPreferences(next);
    savePreferences(next);
    notify('Ajustes guardados.', { tone: 'success' });
  };

  const handleCardFormatChange = (format: CardFormat) => {
    const next = { ...preferences, cardFormat: format };
    setPreferences(next);
    savePreferences(next);
  };

  const loadExampleData = () => {
    const sample = withDeadlines({
      id: 'sample-' + Math.random().toString(36).substring(2, 9),
      modelo: '303',
      modelo_nombre: 'Impuesto sobre el Valor Añadido (IVA Trimestral)',
      periodo: '2T',
      ejercicio: '2026',
      cliente_nif: '22467169X',
      cliente_nombre: 'MALDONADO GARCIA MARIA PILAR',
      importe: 818.55,
      tipo_resultado: 'Domiciliación' as const,
      iban: 'ES2900811016100006298239',
      screenshotUrl: '',
      fechaCargo: '',
      fechaLimiteDomiciliacion: '',
      timestamp: Date.now(),
    });
    saveNoticesToLocal([sample, ...rawNoticesRef.current]);
    setSelectedJointId(normalizeNifKey(sample.cliente_nif, sample.cliente_nombre));
  };

  // Lee una captura: la lectura principal y la de verificación se hacen a la
  // vez en el servidor, con dos modelos distintos.
  const processImageFile = async (file: File, persistedFileId?: string) => {
    setProcessingCount((count) => count + 1);
    try {
      const base64Image = await fileToDataUrl(file);
      const [response, screenshotId, thumbnail] = await Promise.all([
        fetch('/api/gemini/read-tax', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64Image }),
        }),
        persistedFileId ? Promise.resolve(persistedFileId) : saveCaptureToDisk(base64Image),
        compressToThumbnail(base64Image),
      ]);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const message = errData.error || `Error en el servidor: ${response.status}`;
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          throw new TemporaryCaptureError(message);
        }
        throw new Error(message);
      }

      const result = await response.json() as ReadTaxResponse;
      const nif = String(result.data?.cliente_nif || '').replace(/[\s.-]+/g, '').toUpperCase();
      const clienteConocido = await lookupClient(nif);
      const newNotice = buildNoticeFromReading(result, { screenshotId, screenshotUrl: thumbnail, clienteConocido });
      saveNoticesToLocal([newNotice, ...rawNoticesRef.current]);
      const jointId = normalizeNifKey(newNotice.cliente_nif, newNotice.cliente_nombre);
      if (!selectedJointIdRef.current) setSelectedJointId(jointId);
      return { jointId };
    } catch (err: any) {
      console.error(err);
      if (err instanceof TemporaryCaptureError) throw err;
      if (err instanceof TypeError) throw new TemporaryCaptureError(err.message || 'Error de red');
      throw err;
    } finally {
      setProcessingCount((count) => Math.max(0, count - 1));
    }
  };

  processImageFileRef.current = processImageFile;

  const processQueuedCapture = useCallback(async (item: CaptureItem) => {
    const response = await fetch(`/api/capturas/${item.fileId}`);
    if (!response.ok) {
      if (response.status >= 500) throw new TemporaryCaptureError('No se pudo recuperar la captura guardada.');
      throw new Error('La captura original no está disponible; vuelva a seleccionarla.');
    }
    const blob = await response.blob();
    const file = new File([blob], `${item.fileId}.png`, { type: blob.type || 'image/png' });
    return processImageFileRef.current!(file, item.fileId);
  }, []);

  const persistQueue = useCallback(async (items: CaptureItem[]) => {
    queueItemsRef.current = items;
    await persistWorkspace(items, rawNoticesRef.current);
  }, [persistWorkspace]);

  const captureQueue = useCaptureQueue({
    ready: storageReady,
    concurrency: aiConfig?.concurrency || 1,
    process: processQueuedCapture,
    persist: persistQueue,
  });

  const enqueueFiles = useCallback(async (files: File[]) => {
    if (!storageReady) {
      notify('El almacenamiento todavía no está disponible. Espere un momento y vuelva a intentarlo.', { tone: 'warning' });
      return;
    }
    const accepted = files.filter((file) => file.type.startsWith('image/'));
    if (accepted.length === 0) {
      notify('Solo se pueden añadir imágenes (PNG, JPEG o WebP).', { tone: 'warning' });
      return;
    }
    try {
      const queued: CaptureItem[] = [];
      for (const [index, file] of accepted.entries()) {
        const dataUrl = await fileToDataUrl(file);
        const fileId = await saveCaptureToDisk(dataUrl);
        if (!fileId) throw new Error('No se pudo guardar una de las capturas.');
        queued.push({
          id: `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          fileId,
          status: 'pending',
          attempts: 0,
          createdAt: new Date().toISOString(),
        });
      }
      captureQueue.enqueue(queued);
      notify(queued.length === 1 ? 'Captura añadida. Leyendo…' : `${queued.length} capturas añadidas. Leyendo…`);
    } catch (error) {
      console.error(error);
      notify('No se ha podido guardar la captura en disco.', { tone: 'error', detail: error instanceof Error ? error.message : String(error) });
    }
  }, [captureQueue.enqueue, notify, storageReady]);

  // Pegado global (Ctrl+V en cualquier parte de la ventana)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) void enqueueFiles(files);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [enqueueFiles]);

  const handleReadClipboard = async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            files.push(new File([blob], `captura-${files.length + 1}.png`, { type }));
          }
        }
      }
      if (files.length > 0) {
        await enqueueFiles(files);
        return;
      }
      notify('No hay ninguna imagen en el portapapeles.', { tone: 'warning', detail: 'Haga una captura (Impr Pant o Win+Mayús+S) y pulse Ctrl+V en esta ventana.' });
    } catch (err) {
      console.error('Read clipboard failed', err);
      notify('No se pudo leer el portapapeles.', { tone: 'warning', detail: 'Pulse Ctrl+V directamente en esta ventana o arrastre la imagen.' });
    }
  };

  const groupedNotices = groupNotices(rawNotices, groupingOverrides);
  const selectedJoint = groupedNotices.find((joint) => joint.id === selectedJointId)
    || groupedNotices[0]
    || null;

  const generateWhatsAppText = (joint: JointNotice): string => buildWhatsAppText(joint, {
    agencyName: preferences.agencyName,
    signatureText: preferences.signatureText,
    templates: preferences.templates,
  });

  const flashCopied = (kind: 'text' | 'image') => {
    setCopied(kind);
    setTimeout(() => setCopied((current) => (current === kind ? null : current)), 2000);
  };

  const copyWhatsAppText = async (joint: JointNotice) => {
    await navigator.clipboard.writeText(generateWhatsAppText(joint));
    flashCopied('text');
  };

  const exportCard = (joint: JointNotice) => {
    const card = document.querySelector(`[data-export-surface="${CSS.escape(joint.id)}"] [data-notice-card]`) as HTMLElement | null;
    if (!card) throw new Error('No se encuentra la ficha para exportar.');
    return card;
  };

  const copyNoticeImage = async (joint: JointNotice) => {
    const card = exportCard(joint);
    // La primera pasada carga las imágenes en caché; la segunda sale completa.
    await toBlob(card, EXPORT_OPTIONS);
    const blob = await toBlob(card, EXPORT_OPTIONS);
    if (!blob) throw new Error('No se pudo generar la imagen.');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    flashCopied('image');
  };

  const downloadNoticeImage = async (joint: JointNotice) => {
    try {
      const card = exportCard(joint);
      await toPng(card, EXPORT_OPTIONS);
      const dataUrl = await toPng(card, EXPORT_OPTIONS);
      const link = document.createElement('a');
      link.download = `Aviso_${(joint.cliente_nombre || 'cliente').replace(/[^\p{L}\p{N}]+/gu, '_')}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      notify('No se pudo guardar la imagen.', { tone: 'error', detail: error instanceof Error ? error.message : String(error) });
    }
  };

  /** Antes de enviar algo al cliente, pide confirmación si hay datos por revisar. */
  const confirmIfNeedsReview = async (joint: JointNotice) => {
    if (jointState(joint) !== 'review') return true;
    const issues = verificationIssues(joint);
    return confirm({
      title: 'Este aviso tiene datos por revisar',
      message: `${issues.slice(0, 3).map((issue) => issue.text).join(' ')}${issues.length > 3 ? ` (y ${issues.length - 3} más)` : ''} ¿Quiere copiarlo de todos modos?`,
      confirmLabel: 'Copiar igualmente',
    });
  };

  const handleCopyText = async (joint: JointNotice) => {
    if (!(await confirmIfNeedsReview(joint))) return;
    try {
      await copyWhatsAppText(joint);
      notify('Texto copiado. Péguelo en WhatsApp.', { tone: 'success' });
    } catch (error) {
      notify('No se pudo copiar el texto.', { tone: 'error', detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleCopyImage = async (joint: JointNotice) => {
    if (!(await confirmIfNeedsReview(joint))) return;
    try {
      await copyNoticeImage(joint);
      notify('Imagen copiada. Péguela en WhatsApp.', { tone: 'success' });
    } catch (error) {
      notify('No se pudo copiar la imagen.', { tone: 'error', detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleAdvisoryNoteChange = (jointId: string, enabled: boolean, text: string) => {
    const cleanText = text.slice(0, 240);
    const noticeIds = new Set(groupNotices(rawNotices, groupingOverrides).find((joint) => joint.id === jointId)?.notices.map((notice) => notice.id) || []);
    const updated = rawNotices.map((notice) =>
      noticeIds.has(notice.id)
        ? { ...notice, mostrarNotaAsesoria: enabled, notaAsesoria: cleanText }
        : notice
    );
    saveNoticesToLocal(updated, { deferred: true });
  };

  const handleEditSave = (updatedJoint: JointNotice) => {
    // Tras una edición manual: recalcular fechas y comprobaciones.
    const editedIds = new Set(updatedJoint.notices.map((n) => n.id));
    const originalIds = new Set(groupNotices(rawNotices, groupingOverrides).find((joint) => joint.id === updatedJoint.id)?.notices.map((notice) => notice.id) || []);
    const belongsToGroup = (n: TaxNotice) => originalIds.has(n.id);
    // Los impuestos quitados en el editor se eliminan de verdad y se borra su captura.
    rawNotices
      .filter((n) => belongsToGroup(n) && !editedIds.has(n.id))
      .forEach((n) => deleteCaptureFromDisk(n.screenshotId));

    const kept = rawNotices.filter((n) => !belongsToGroup(n) || editedIds.has(n.id));
    const updatedNotices = kept.map((raw) => {
      const matchingEdit = updatedJoint.notices.find(n => n.id === raw.id);
      return matchingEdit ? applyManualEdit(matchingEdit) : raw;
    });
    const existingIds = new Set(rawNotices.map(r => r.id));
    const addedTaxes = updatedJoint.notices.filter(n => !existingIds.has(n.id)).map((notice) => applyManualEdit(notice));

    const finalNotices = [...updatedNotices, ...addedTaxes];
    editorDraftRef.current = null;
    saveNoticesToLocal(finalNotices);
    setEditingJointId(null);
    const edited = finalNotices.find((notice) => editedIds.has(notice.id));
    if (edited) setSelectedJointId(normalizeNifKey(edited.cliente_nif, edited.cliente_nombre));
    notify('Datos actualizados.', { tone: 'success' });
  };

  // Descartar y vaciar se pueden deshacer durante unos segundos; las capturas
  // solo se borran del disco cuando ya no se puede deshacer.
  const removeWithUndo = (removed: TaxNotice[], message: string) => {
    if (removed.length === 0) return;
    const removedIds = new Set(removed.map((notice) => notice.id));
    saveNoticesToLocal(rawNoticesRef.current.filter((notice) => !removedIds.has(notice.id)));
    let undone = false;
    const timer = setTimeout(() => {
      if (!undone) removed.forEach((notice) => deleteCaptureFromDisk(notice.screenshotId));
    }, DISCARD_UNDO_MS + 500);
    notify(message, {
      duration: DISCARD_UNDO_MS,
      action: {
        label: 'Deshacer',
        run: () => {
          undone = true;
          clearTimeout(timer);
          const current = new Set(rawNoticesRef.current.map((notice) => notice.id));
          saveNoticesToLocal([...removed.filter((notice) => !current.has(notice.id)), ...rawNoticesRef.current]);
        },
      },
    });
  };

  const handleDiscard = (joint: JointNotice) => {
    removeWithUndo(joint.notices, `Aviso de ${joint.cliente_nombre || 'cliente sin nombre'} descartado.`);
  };

  const handleClearAll = async () => {
    const ok = await confirm({
      title: 'Vaciar la bandeja',
      message: `Se quitarán los ${groupedNotices.length} avisos en curso. Podrá deshacerlo durante unos segundos.`,
      confirmLabel: 'Vaciar',
      danger: true,
    });
    if (ok) removeWithUndo(rawNoticesRef.current, 'Bandeja vaciada.');
  };

  const archiveJoint = async (joint: JointNotice) => {
    const archive: ArchivedNotice = {
      id: `${joint.id}:${Math.max(...joint.notices.map((notice) => notice.timestamp))}`,
      archivedAt: new Date().toISOString(),
      cliente_nombre: joint.cliente_nombre,
      cliente_nif: joint.cliente_nif,
      models: Array.from(new Set(joint.notices.map((notice) => notice.modelo))),
      periods: Array.from(new Set(joint.notices.map((notice) => notice.periodo))),
      noticeIds: joint.notices.map((notice) => notice.id),
      captureIds: joint.notices.flatMap((notice) => notice.screenshotId ? [notice.screenshotId] : []),
      // Sin miniaturas: el historial solo necesita los datos y el id de la captura.
      snapshot: { ...joint, notices: joint.notices.map(({ screenshotUrl: _thumbnail, ...rest }) => rest) },
    };
    if (!archivedNoticesRef.current.some((item) => item.id === archive.id)) {
      archivedNoticesRef.current = [archive, ...archivedNoticesRef.current];
      setArchivedNotices(archivedNoticesRef.current);
    }
    const removedIds = new Set(joint.notices.map((notice) => notice.id));
    const active = rawNoticesRef.current.filter((notice) => !removedIds.has(notice.id));
    rawNoticesRef.current = active;
    setRawNotices(active);
    // Se quitan solo las capturas de este aviso. No se rehidrata la bandeja:
    // eso devolvería a «pendiente» las capturas que se están leyendo en paralelo.
    const archivedItems = queueItemsRef.current.filter((item) => item.jointId === joint.id);
    const remainingQueue = queueItemsRef.current.filter((item) => item.jointId !== joint.id);
    queueItemsRef.current = remainingQueue;
    archivedItems.forEach((item) => captureQueue.remove(item.id));
    await persistWorkspace(remainingQueue, active);
    return archive;
  };

  const handleReopen = (archive: ArchivedNotice) => {
    const snapshot = archive.snapshot as JointNotice;
    const existing = new Set(rawNoticesRef.current.map((notice) => notice.id));
    const active = [...snapshot.notices.filter((notice) => !existing.has(notice.id)).map((notice) => withDeadlines(notice)), ...rawNoticesRef.current];
    const history = archivedNoticesRef.current.filter((item) => item.id !== archive.id);
    rawNoticesRef.current = active;
    archivedNoticesRef.current = history;
    setRawNotices(active);
    setArchivedNotices(history);
    selectedJointIdRef.current = snapshot.id;
    setSelectedJointId(snapshot.id);
    setHistoryOpen(false);
    void persistWorkspace(queueItemsRef.current, active).catch(() => {});
  };

  const handleCompleteAndContinue = async (joint: JointNotice) => {
    if (!(await confirmIfNeedsReview(joint))) return;
    let archived: ArchivedNotice | null = null;
    try {
      const next = await completeAndContinue({
        joint,
        mode: view,
        exportText: copyWhatsAppText,
        exportImage: copyNoticeImage,
        archive: async (item) => { archived = await archiveJoint(item); },
        pendingJointIds: groupedNotices.map((item) => item.id),
      });
      setSelectedJointId(next);
      setEditingJointId(null);
      const undoArchive = archived as ArchivedNotice | null;
      notify(`${view === 'image' ? 'Imagen copiada' : 'Texto copiado'} y aviso archivado.`, {
        tone: 'success',
        detail: next ? 'Pasando al siguiente aviso.' : 'No quedan más avisos en curso.',
        action: undoArchive ? { label: 'Deshacer', run: () => handleReopen(undoArchive) } : undefined,
      });
    } catch (error) {
      console.error(error);
      notify('No se pudo completar el aviso.', { tone: 'error', detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const applyGrouping = (override: GroupingOverride) => {
    const next = [...groupingOverridesRef.current, override];
    groupingOverridesRef.current = next;
    setGroupingOverrides(next);
    void persistWorkspace().catch(() => {});
  };

  const handleUndoGrouping = () => {
    const next = undoGroupingOverride(groupingOverridesRef.current);
    groupingOverridesRef.current = next;
    setGroupingOverrides(next);
    void persistWorkspace().catch(() => {});
  };

  const openCapture = (notice: TaxNotice) => {
    if (notice.screenshotId) window.open('/api/capturas/' + notice.screenshotId, '_blank');
    else if (notice.screenshotUrl) window.open(notice.screenshotUrl, '_blank');
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.relatedTarget || !(e.currentTarget as Node).contains(e.relatedTarget as Node)) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void enqueueFiles(files);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) void enqueueFiles(Array.from(files));
    e.target.value = '';
  };

  const reviewCount = groupedNotices.filter((joint) => jointState(joint) === 'review').length;
  const pendingCaptures = captureQueue.items.filter((item) => item.status === 'pending').length;
  const failedCaptures = captureQueue.items.filter((item) => item.status === 'failed').length;
  const modelLabel = aiConfig?.recommendedModels?.find((model) => model.id === aiConfig.model)?.label || aiConfig?.model || '';
  const activeNotePreset = selectedJoint
    ? ADVISORY_NOTE_PRESETS.find((preset) => preset.text === (selectedJoint.notaAsesoria || '').trim())?.id
    : undefined;

  return (
    <div
      className="workspace-shell"
      data-dragging={isDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header data-workspace-region="header" className="titlebar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <img src={appIcon} alt="" className="titlebar-icon" />
        <span className="titlebar-title">Generador de Avisos Fiscales</span>
        {selectedJoint && <span className="titlebar-doc">— {selectedJoint.cliente_nombre || 'Aviso sin nombre'}</span>}
      </header>

      <div data-workspace-region="ribbon">
        <Ribbon
          hasSelection={!!selectedJoint}
          hasNotices={rawNotices.length > 0}
          canSplit={!!selectedJoint && selectedJoint.notices.length > 1}
          canUndoGrouping={groupingOverrides.length > 0}
          onPaste={handleReadClipboard}
          onOpenFile={() => fileInputRef.current?.click()}
          onCopyImage={() => selectedJoint && void handleCopyImage(selectedJoint)}
          onCopyText={() => selectedJoint && void handleCopyText(selectedJoint)}
          onDownload={() => selectedJoint && void downloadNoticeImage(selectedJoint)}
          onComplete={() => selectedJoint && void handleCompleteAndContinue(selectedJoint)}
          onEdit={() => selectedJoint && setEditingJointId(selectedJoint.id)}
          onSplit={() => selectedJoint && applyGrouping(createSplitOverride(selectedJoint))}
          onUndoGrouping={handleUndoGrouping}
          onDiscard={() => selectedJoint && handleDiscard(selectedJoint)}
          onClearAll={() => void handleClearAll()}
          onHistory={() => setHistoryOpen(true)}
          onCalendar={() => setSettingsTab('calendario')}
          onSettings={() => setSettingsTab('general')}
          onExample={loadExampleData}
        />
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileInputChange} />

      {(storageError || captureQueue.storageError) && (
        <div role="alert" className="banner" data-tone="danger">
          No se puede guardar el trabajo: {storageError || captureQueue.storageError} La bandeja está detenida hasta que se recupere el almacenamiento.
        </div>
      )}
      {aiConfig && aiConfig.hasApiKey === false && (
        <div className="banner" data-tone="warning">
          Falta la clave de Gemini para leer capturas.
          <button type="button" className="btn btn-small" onClick={() => setSettingsTab('ia')}>Configurar clave</button>
        </div>
      )}

      <main className="workspace">
        <aside data-workspace-region="queue" className="pane sidebar">
          <CaptureQueue
            items={captureQueue.items}
            selectedJointId={selectedJoint?.id}
            onRetry={captureQueue.retry}
            onRemove={captureQueue.remove}
            onViewCapture={(fileId) => window.open(`/api/capturas/${encodeURIComponent(fileId)}`, '_blank')}
            onSelect={(jointId) => setSelectedJointId(jointId)}
          />
          <NoticeList
            joints={groupedNotices}
            selectedId={selectedJoint?.id}
            onSelect={(id) => { setSelectedJointId(id); setEditingJointId(null); }}
          />
        </aside>

        <section data-workspace-region="input" className="pane pane-details" aria-label="Datos extraídos">
          <div className="pane-header">
            <h2>Datos extraídos</h2>
            <span className="pane-subtitle">Revise la información antes de enviarla</span>
          </div>
          <div className="pane-body">
            {!selectedJoint ? (
              <div className="empty-state">
                <div className="drop-target" data-active={isDragOver}>
                  <Upload aria-hidden="true" />
                  <h3>Pegue una captura para empezar</h3>
                  <p>Haga una captura de la declaración en A3, Sage o la Sede de la AEAT y pulse <kbd>Ctrl</kbd>+<kbd>V</kbd> en esta ventana. También puede arrastrar varias imágenes a la vez.</p>
                  <div className="empty-actions">
                    <button type="button" className="btn btn-primary" onClick={handleReadClipboard}>Pegar captura</button>
                    <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>Abrir imagen…</button>
                  </div>
                </div>
              </div>
            ) : editingJointId === selectedJoint.id ? (
              <NoticeEditor
                key={selectedJoint.id}
                initialDraft={editorDraftRef.current}
                onDraftChange={rememberDraft}
                notice={selectedJoint}
                onSave={handleEditSave}
                onCancel={cancelEditing}
              />
            ) : (
              <NoticeDetails
                joint={selectedJoint}
                canUndoGrouping={groupingOverrides.length > 0}
                onEdit={() => setEditingJointId(selectedJoint.id)}
                onSplit={() => applyGrouping(createSplitOverride(selectedJoint))}
                onUndoGrouping={handleUndoGrouping}
                onAddCapture={() => fileInputRef.current?.click()}
                onViewCapture={openCapture}
                onDiscard={() => handleDiscard(selectedJoint)}
              />
            )}
          </div>
        </section>

        <section data-workspace-region="result" className="pane pane-preview" aria-label="Resultado para el cliente">
          <div className="pane-header">
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={view === 'image'} data-active={view === 'image'} onClick={() => setView('image')}>
                <ImageIcon aria-hidden="true" /> Ficha en imagen
              </button>
              <button type="button" role="tab" aria-selected={view === 'text'} data-active={view === 'text'} onClick={() => setView('text')}>
                <MessageSquareText aria-hidden="true" /> Texto WhatsApp
              </button>
            </div>
            {selectedJoint && (
              <div className="pane-actions">
                {view === 'image' && (
                  <div className="ribbon-segmented" role="radiogroup" aria-label="Formato de la ficha" title="Formato de la ficha">
                    {(['A', 'B', 'C'] as CardFormat[]).map((format) => (
                      <button key={format} type="button" role="radio" aria-checked={preferences.cardFormat === format} data-active={preferences.cardFormat === format} onClick={() => handleCardFormatChange(format)}>
                        {format}
                      </button>
                    ))}
                  </div>
                )}
                {view === 'image' ? (
                  <button type="button" className="btn btn-small" title="Copiar imagen" onClick={() => void handleCopyImage(selectedJoint)}>
                    {copied === 'image' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} <span className="btn-label">{copied === 'image' ? 'Copiada' : 'Copiar imagen'}</span>
                  </button>
                ) : (
                  <button type="button" className="btn btn-small" title="Copiar texto" onClick={() => void handleCopyText(selectedJoint)}>
                    {copied === 'text' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} <span className="btn-label">{copied === 'text' ? 'Copiado' : 'Copiar texto'}</span>
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="pane-body preview-body">
            {!selectedJoint ? (
              <div className="empty-state">
                <ImageIcon aria-hidden="true" className="empty-icon" />
                <h3>Todavía no hay ningún aviso</h3>
                <p>La vista previa aparecerá al leer la primera captura.</p>
              </div>
            ) : (
              <>
                {view === 'text' && (
                  <pre className="whatsapp-preview">{generateWhatsAppText(selectedJoint)}</pre>
                )}
                {/* La ficha se monta siempre (oculta en la vista de texto) para poder copiarla desde la cinta. */}
                <div className={view === 'image' ? 'card-stage' : 'card-stage card-stage-hidden'} aria-hidden={view !== 'image'}>
                  <div data-export-surface={selectedJoint.id}>
                    <NoticeCard notice={selectedJoint} format={preferences.cardFormat} />
                  </div>
                </div>
                {view === 'image' && (
                  <div className="note-box" data-active={!!selectedJoint.mostrarNotaAsesoria}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!selectedJoint.mostrarNotaAsesoria}
                        onChange={(event) => handleAdvisoryNoteChange(selectedJoint.id, event.target.checked, selectedJoint.notaAsesoria || '')}
                      />
                      Añadir una nota al pie de la ficha
                    </label>
                    {selectedJoint.mostrarNotaAsesoria && (
                      <>
                        <div className="note-presets">
                          {ADVISORY_NOTE_PRESETS.map((preset) => {
                            const PresetIcon = preset.icon;
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                aria-pressed={activeNotePreset === preset.id}
                                data-active={activeNotePreset === preset.id}
                                onClick={() => handleAdvisoryNoteChange(selectedJoint.id, true, preset.text)}
                              >
                                <PresetIcon aria-hidden="true" /> {preset.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="note-input">
                          <textarea
                            value={selectedJoint.notaAsesoria || ''}
                            onChange={(event) => handleAdvisoryNoteChange(selectedJoint.id, true, event.target.value)}
                            maxLength={240}
                            rows={2}
                            placeholder="Escriba la nota que aparecerá al pie de la ficha."
                          />
                          <span>{(selectedJoint.notaAsesoria || '').length}/240</span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          {selectedJoint && (
            <div className="pane-footer">
              <button type="button" className="btn btn-success btn-block" onClick={() => void handleCompleteAndContinue(selectedJoint)}>
                Copiar {view === 'image' ? 'imagen' : 'texto'}, archivar y pasar al siguiente
              </button>
            </div>
          )}
        </section>
      </main>

      <footer data-workspace-region="status" className="statusbar">
        <span>{groupedNotices.length} {groupedNotices.length === 1 ? 'aviso' : 'avisos'}</span>
        {reviewCount > 0 && <span className="status-warning">{reviewCount} por revisar</span>}
        {(processingCount > 0 || pendingCaptures > 0) && (
          <span className="status-busy">
            <LoaderCircle className="is-spinning" aria-hidden="true" />
            Leyendo {processingCount || 1}{pendingCaptures > 0 ? ` · ${pendingCaptures} en espera` : ''}
          </span>
        )}
        {failedCaptures > 0 && <span className="status-danger">{failedCaptures} con error</span>}
        <span className="statusbar-spacer" />
        {modelLabel && <button type="button" className="status-link" onClick={() => setSettingsTab('ia')}>IA: {modelLabel}{aiConfig && aiConfig.concurrency > 1 ? ` · ${aiConfig.concurrency} a la vez` : ''}</button>}
        {updateStatus && (
          <span>
            {updateStatus.status === 'downloading' && `Descargando actualización ${Math.round(updateStatus.percent || 0)}%`}
            {updateStatus.status === 'ready' && `Versión ${updateStatus.version || 'nueva'} lista`}
            {updateStatus.status === 'installing' && 'Instalando actualización'}
            {updateStatus.status === 'error' && 'Actualización pendiente de reintento'}
            {updateStatus.status === 'checking' && (updateStatus.message || 'Comprobando actualizaciones')}
          </span>
        )}
        {updateStatus?.status === 'ready' && (
          <button type="button" className="status-link status-strong" onClick={() => void window.updates?.restart()}>Reiniciar y actualizar</button>
        )}
        <span>Versión {appVersion || '…'}</span>
      </footer>

      {isDragOver && (
        <div className="drop-overlay" aria-hidden="true">
          <Upload />
          <span>Suelte las capturas para leerlas</span>
        </div>
      )}

      {historyOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryOpen(false); }}>
          <div className="dialog dialog-history" role="dialog" aria-modal="true" aria-label="Historial">
            <NoticeHistory
              items={archivedNotices}
              onReopen={handleReopen}
              onViewCapture={(captureId) => window.open(`/api/capturas/${captureId}`, '_blank')}
              onClose={() => setHistoryOpen(false)}
            />
          </div>
        </div>
      )}

      <SettingsDialog
        open={settingsTab !== null}
        initialTab={settingsTab || 'general'}
        preferences={preferences}
        aiConfig={aiConfig}
        appVersion={appVersion}
        onClose={() => setSettingsTab(null)}
        onSavePreferences={handleSavePreferences}
        onAiConfigChanged={setAiConfig}
      />
      <ConfirmDialog pending={feedback.pending} onAnswer={feedback.answer} />
      <ToastStack toasts={feedback.toasts} onDismiss={feedback.dismiss} />
    </div>
  );
}
