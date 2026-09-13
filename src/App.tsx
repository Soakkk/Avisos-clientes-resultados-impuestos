import React, { useCallback, useState, useEffect, useRef } from 'react';
import { TaxNotice, JointNotice, NoticeVerification, calculateAEATDeadlines, formatDateSpanish, normalizeTaxResult } from './types';
import { verifyNoticeFields, normalizeNifKey } from './validation';
import { LoaderOverlay } from './components/LoaderOverlay';
import { NoticeEditor } from './components/NoticeEditor';
import { NoticeCard, CardFormat } from './components/NoticeCard';
import { ApiKeySettings } from './components/ApiKeySettings';
import { buildWhatsAppText } from './whatsapp';
import { toBlob } from 'html-to-image';
import { CaptureQueue } from './components/CaptureQueue';
import { NoticeHistory } from './components/NoticeHistory';
import {
  completeAndContinue,
  createMergeOverride,
  createSplitOverride,
  groupNotices,
  undoGroupingOverride,
} from './history';
import { TemporaryCaptureError } from './queue/reducer';
import { useCaptureQueue } from './queue/useCaptureQueue';
import type { CaptureItem } from './queue/types';
import type { ArchivedNotice, GroupingOverride, NoticeState } from './storage/types';
import appIcon from './assets/app-icon.png';
import { 
  Clipboard, 
  Upload, 
  FileText, 
  Trash2, 
  Copy, 
  Check, 
  Plus, 
  Image as ImageIcon, 
  History, 
  Sparkles, 
  Sliders, 
  Calendar, 
  Info,
  ExternalLink,
  Edit2,
  Star,
  ChevronDown,
  ChevronUp,
  Settings2,
  X,
  MessageSquareText,
  Landmark,
  WalletCards,
  CalendarClock,
  PanelTop
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';

// Comprime la captura a una miniatura JPEG pequeña (~10-30 KB). En localStorage solo
// se guarda esta miniatura: el PNG original en base64 ocupaba 1-3 MB por captura y
// reventaba el límite de ~5 MB de localStorage con pocas capturas (QuotaExceededError
// silencioso = avisos que dejaban de guardarse).
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

// Combina la validación determinista (checksums) con el resultado de la segunda
// lectura de la IA para dar un veredicto por aviso.
function buildVerification(
  notice: Pick<TaxNotice, 'modelo' | 'periodo' | 'ejercicio' | 'cliente_nif' | 'cliente_nombre' | 'importe' | 'tipo_resultado' | 'iban'>,
  discrepanciasIA: { campo: string; primera: string; segunda: string }[],
  segundaLecturaHecha: boolean
): NoticeVerification {
  const checks = verifyNoticeFields(notice);
  const hasProblem = checks.some((c) => c.status !== 'ok') || discrepanciasIA.length > 0;
  return {
    estado: hasProblem ? 'revisar' : segundaLecturaHecha ? 'ok' : 'sin-verificar',
    checks,
    discrepanciasIA,
    segundaLecturaHecha,
  };
}

const FIELD_LABELS: Record<string, string> = {
  iban: 'IBAN',
  cliente_nif: 'NIF',
  cliente_nombre: 'Nombre',
  importe: 'Importe',
  modelo: 'Modelo',
  periodo: 'Periodo',
  ejercicio: 'Ejercicio',
  tipo_resultado: 'Resultado',
  fecha_presentacion: 'Fecha de presentación',
};

// Resultados en los que el cliente no paga nada: el importe no se ingresa ni lo
// devuelve Hacienda, se arrastra a declaraciones posteriores. Sin esto, a un 130
// negativo se le pedía "realice el pago antes de la fecha límite".
const ADVISORY_NOTE_PRESETS = [
  {
    id: 'aplazamiento',
    label: 'Aplazamiento',
    text: 'Avísenos si desea solicitar un aplazamiento.',
    icon: Landmark,
  },
  {
    id: 'saldo',
    label: 'Saldo suficiente',
    text: 'Recuerde disponer de saldo suficiente.',
    icon: WalletCards,
  },
  {
    id: 'domiciliacion',
    label: 'Confirmar domiciliación',
    text: 'Pendiente de confirmar la domiciliación.',
    icon: CalendarClock,
  },
] as const;

/**
 * El 130/131 no tiene resultado "a compensar": eso es del IVA. Cuando el pago
 * fraccionado sale negativo es una declaración NEGATIVA, que se deduce en los
 * trimestres siguientes del mismo año. La IA lo leía a veces como "A compensar"
 * y el aviso hablaba de un "saldo a su favor", que suena a dinero por cobrar.
 */
function normalizarResultado(modelo: unknown, tipo: unknown): TaxNotice['tipo_resultado'] {
  return normalizeTaxResult(modelo, tipo);
}

/**
 * Convierte la fecha de presentación que lee la IA ("15/07/2026") a ISO.
 * Devuelve undefined ante cualquier cosa rara: esta fecha va en el aviso del
 * cliente, así que mejor no enseñar ninguna que enseñar una inventada.
 */
function parseFechaEspanola(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const m = valor.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return undefined;
  const [, d, mes, a] = m;
  const fecha = new Date(Number(a), Number(mes) - 1, Number(d));
  // new Date(2026, 1, 31) no falla, "corrige" la fecha al 3 de marzo: hay que
  // comprobar que los componentes siguen siendo los mismos para colar un 31/02.
  if (fecha.getFullYear() !== Number(a) || fecha.getMonth() !== Number(mes) - 1 || fecha.getDate() !== Number(d)) {
    return undefined;
  }
  return fecha.toISOString();
}

export default function App() {
  const [rawNotices, setRawNotices] = useState<TaxNotice[]>([]);
  const [archivedNotices, setArchivedNotices] = useState<ArchivedNotice[]>([]);
  const [groupingOverrides, setGroupingOverrides] = useState<GroupingOverride[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const rawNoticesRef = useRef<TaxNotice[]>([]);
  const queueItemsRef = useRef<CaptureItem[]>([]);
  const archivedNoticesRef = useRef<ArchivedNotice[]>([]);
  const groupingOverridesRef = useRef<GroupingOverride[]>([]);
  const selectedJointIdRef = useRef<string | null>(null);
  const processImageFileRef = useRef<(file: File, persistedFileId?: string) => Promise<{ jointId: string }>>();
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [takingLong, setTakingLong] = useState(false);
  const [editingJointId, setEditingJointId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Record<string, 'text' | 'image'>>({});
  const [copiedTextId, setCopiedTextId] = useState<string | null>(null);
  const [selectedJointId, setSelectedJointId] = useState<string | null>(null);
  selectedJointIdRef.current = selectedJointId;
  const [openMenu, setOpenMenu] = useState<'file' | 'edit' | 'view' | 'history' | 'help' | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [showPreferences, setShowPreferences] = useState(false);

  
  // Custom settings saved in LocalStorage
  const [agencyName, setAgencyName] = useState('Asesoría E. Marín');
  const [signatureText, setSignatureText] = useState('Atentamente,\nAsesoría E. Marín');
  const [cardFormat, setCardFormat] = useState<CardFormat>('A');
  const [appVersion, setAppVersion] = useState('');

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
      updatedAt: new Date().toISOString(),
    };
    const response = await fetch('/api/notices/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    if (!response.ok) throw new Error('No se pudo guardar la bandeja en disco.');
  }, []);

  // Versión instalada (la expone el servidor en /api/health)
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => { if (d.version) setAppVersion(d.version); })
      .catch(() => {});
  }, []);

  // Las preferencias ligeras siguen en localStorage. Los avisos se hidratan
  // desde disco y solo se consulta localStorage para una migración única.
  useEffect(() => {
    const savedAgency = localStorage.getItem('aeat_agency_name');
    if (savedAgency) setAgencyName(savedAgency);

    const savedSignature = localStorage.getItem('aeat_signature_text');
    if (savedSignature) setSignatureText(savedSignature);

    const savedFormat = localStorage.getItem('aeat_card_format');
    if (savedFormat === 'A' || savedFormat === 'B' || savedFormat === 'C') setCardFormat(savedFormat);

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
        if (stored.selectedJointId) {
          selectedJointIdRef.current = stored.selectedJointId;
          setSelectedJointId(stored.selectedJointId);
        }
        const diskNotices = Array.isArray(stored.activeNotices) ? stored.activeNotices as TaxNotice[] : [];
        let source = diskNotices;
        const savedNotices = localStorage.getItem('aeat_raw_notices');
        if (source.length === 0 && savedNotices) source = JSON.parse(savedNotices) as TaxNotice[];

        if (source.length > 0) {
        // Migra avisos antiguos con tildes dañadas y refresca las fechas con
        // las reglas actuales.
        const normalized = source.map((notice) => {
          const deadlines = calculateAEATDeadlines(notice.modelo, notice.periodo, notice.ejercicio);
          return {
            ...notice,
            tipo_resultado: normalizeTaxResult(notice.modelo, notice.tipo_resultado),
            fechaCargo: deadlines.fechaCargo.toISOString(),
            fechaLimiteDomiciliacion: deadlines.fechaLimiteDomiciliacion.toISOString(),
          };
        });
        rawNoticesRef.current = normalized;
        setRawNotices(normalized);

        // Migración suave: avisos guardados por versiones anteriores llevan la
        // captura completa en base64 dentro de localStorage. Se re-comprimen a
        // miniatura para liberar espacio (la original de esos avisos ya no existe
        // en disco, pero la miniatura sigue siendo perfectamente legible).
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
        captureQueue.hydrate(Array.isArray(stored.queue) ? stored.queue as CaptureItem[] : []);
        await persistWorkspace(stored.queue as CaptureItem[] || [], rawNoticesRef.current);
        localStorage.removeItem('aeat_raw_notices');
        setStorageReady(true);
      })
      .catch((error) => {
        console.error('Failed to load saved notices', error);
        alert('No se ha podido abrir el almacenamiento local. Reinicie la aplicación antes de añadir más capturas.');
      });
  }, []);

  // Save changes to localStorage
  const saveNoticesToLocal = (newNotices: TaxNotice[]) => {
    rawNoticesRef.current = newNotices;
    setRawNotices(newNotices);
    void persistWorkspace(queueItemsRef.current, newNotices).catch((error) => {
      console.error('No se pudo guardar en disco', error);
      alert('Atención: no se han podido guardar los avisos en disco. No añada más capturas hasta reiniciar la aplicación.');
    });
  };

  const handleAgencyNameChange = (val: string) => {
    setAgencyName(val);
    localStorage.setItem('aeat_agency_name', val);
  };

  const handleCardFormatChange = (val: CardFormat) => {
    setCardFormat(val);
    localStorage.setItem('aeat_card_format', val);
  };

  const handleSignatureChange = (val: string) => {
    setSignatureText(val);
    localStorage.setItem('aeat_signature_text', val);
  };

  // Helper to load sample data from the user request
  const loadExampleData = () => {
    const sampleNotice: TaxNotice = {
      id: 'sample-' + Math.random().toString(36).substring(2, 9),
      modelo: '303',
      modelo_nombre: 'Impuesto sobre el Valor Añadido (IVA Trimestral)',
      periodo: '2T',
      ejercicio: '2026',
      cliente_nif: '22467169X',
      cliente_nombre: 'MALDONADO GARCIA MARIA PILAR',
      importe: 818.55,
      tipo_resultado: 'Domiciliación',
      iban: 'ES2900811016100006298239',
      screenshotUrl: '', // placeholder
      fechaCargo: '', // calculated below
      fechaLimiteDomiciliacion: '', // calculated below
      timestamp: Date.now()
    };

    const deadlines = calculateAEATDeadlines(sampleNotice.modelo, sampleNotice.periodo, sampleNotice.ejercicio);
    sampleNotice.fechaCargo = deadlines.fechaCargo.toISOString();
    sampleNotice.fechaLimiteDomiciliacion = deadlines.fechaLimiteDomiciliacion.toISOString();

    const updated = [sampleNotice, ...rawNotices];
    saveNoticesToLocal(updated);
  };

  // Process the uploaded or pasted image file
  const processImageFile = async (file: File, persistedFileId?: string) => {
    setLoading(true);
    setLoadingStep(0);
    setTakingLong(false);

    const stepInterval = setInterval(() => {
      setLoadingStep((prev) => Math.min(prev + 1, 5));
    }, 1200);

    // Si Gemini se cuelga y hay que reintentar, avisamos para que no parezca colgado
    const longTimer = setTimeout(() => setTakingLong(true), 14000);

    try {
      // 1. Convert file to base64
      const base64Image = await fileToDataUrl(file);

      // 2. Call backend server API
      const response = await fetch('/api/gemini/analyze-tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64Image })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const message = errData.error || `Error en el servidor: ${response.status}`;
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          throw new TemporaryCaptureError(message);
        }
        throw new Error(message);
      }

      const data = await response.json();

      // 3. En paralelo: segunda lectura de verificación con la IA, guardado de la
      // captura original en disco y miniatura comprimida para la interfaz.
      const [verifyRes, screenshotId, thumbnail] = await Promise.all([
        fetch('/api/gemini/verify-tax', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64Image, extracted: data }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        persistedFileId ? Promise.resolve(persistedFileId) : saveCaptureToDisk(base64Image),
        compressToThumbnail(base64Image),
      ]);

      // 4. Calculate AEAT deadline dates
      const deadlines = calculateAEATDeadlines(data.modelo, data.periodo, data.ejercicio);

      // 5. Construct final Notice object
      const newNotice: TaxNotice = {
        id: Math.random().toString(36).substring(2, 9),
        modelo: data.modelo || '303',
        modelo_nombre: data.modelo_nombre || 'Declaración Tributaria',
        periodo: data.periodo || '2T',
        ejercicio: data.ejercicio || new Date().getFullYear().toString(),
        cliente_nif: data.cliente_nif || 'Pendiente',
        cliente_nombre: data.cliente_nombre || 'Cliente Desconocido',
        importe: typeof data.importe === 'number' ? data.importe : parseFloat(data.importe) || 0,
        tipo_resultado: normalizarResultado(data.modelo, data.tipo_resultado),
        iban: data.iban || '',
        screenshotUrl: thumbnail,
        screenshotId,
        fechaCargo: deadlines.fechaCargo.toISOString(),
        fechaLimiteDomiciliacion: deadlines.fechaLimiteDomiciliacion.toISOString(),
        fechaPresentacion: parseFechaEspanola(data.fecha_presentacion),
        timestamp: Date.now()
      };

      // 6. Veredicto de verificación: checksums (IBAN/NIF/periodo...) + comparación
      // de las dos lecturas independientes de la IA.
      newNotice.verificacion = buildVerification(
        newNotice,
        verifyRes?.discrepancias || [],
        !!verifyRes
      );

      // Add to our list
      const updated = [newNotice, ...rawNoticesRef.current];
      saveNoticesToLocal(updated);
      return { jointId: normalizeNifKey(newNotice.cliente_nif, newNotice.cliente_nombre) };

    } catch (err: any) {
      console.error(err);
      if (err instanceof TemporaryCaptureError) throw err;
      if (err instanceof TypeError) throw new TemporaryCaptureError(err.message || 'Error de red');
      throw err;
    } finally {
      clearInterval(stepInterval);
      clearTimeout(longTimer);
      setTakingLong(false);
      setLoading(false);
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

  const captureQueue = useCaptureQueue({ ready: storageReady, process: processQueuedCapture, persist: persistQueue });

  const enqueueFiles = useCallback(async (files: File[]) => {
    if (!storageReady) {
      alert('El almacenamiento local todavía no está disponible. Espere un momento y vuelva a intentarlo.');
      return;
    }
    const accepted = files.filter((file) => file.type.startsWith('image/'));
    if (accepted.length === 0) return;
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
    } catch (error) {
      console.error(error);
      alert('No se ha podido guardar la bandeja en disco. No se aceptarán más capturas hasta que vuelva a intentarlo.');
    }
  }, [captureQueue.enqueue, storageReady]);

  // Listening for paste events globally
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) void enqueueFiles(files);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [enqueueFiles]);

  // Click handler to trigger browser clipboard read API (Chrome/Edge/Opera supported)
  const handleReadClipboard = async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            files.push(new File([blob], `captura-${files.length + 1}.png`, { type }));
          }
        }
      }
      if (files.length > 0) {
        await enqueueFiles(files);
        return;
      }
      alert("No se encontró ninguna imagen en el portapapeles. Haz una captura primero (Impr Pant) y pulsa Ctrl+V directamente en la ventana.");
    } catch (err) {
      console.error("Read clipboard failed", err);
      alert("Para usar el portapapeles directo, pulsa Ctrl+V directamente en esta ventana, o arrastra un archivo de imagen.");
    }
  };

  const groupedNotices = groupNotices(rawNotices, groupingOverrides);
  const selectedJoint = groupedNotices.find((joint) => joint.id === selectedJointId)
    || groupedNotices[0]
    || null;
  const selectedJointIndex = selectedJoint ? groupedNotices.findIndex((joint) => joint.id === selectedJoint.id) : -1;
  const mergeCandidate = groupedNotices.length > 1 && selectedJointIndex >= 0
    ? groupedNotices[(selectedJointIndex + 1) % groupedNotices.length]
    : null;
  const selectedTab: 'text' | 'image' = selectedJoint
    ? (activeTab[selectedJoint.id] || 'image')
    : 'image';
  const selectedVerificationState = (() => {
    if (!selectedJoint) return 'empty';
    let review = false;
    let unverified = false;
    selectedJoint.notices.forEach((notice) => {
      if (!notice.verificacion || notice.verificacion.estado === 'sin-verificar') unverified = true;
      if (notice.verificacion?.estado === 'revisar') review = true;
    });
    return review ? 'review' : unverified ? 'unverified' : 'ok';
  })();
  const selectedVerificationIssues = selectedJoint
    ? selectedJoint.notices.flatMap((notice) => {
        const verification = notice.verificacion;
        if (!verification) return [];
        const prefix = selectedJoint.notices.length > 1 ? `Modelo ${notice.modelo}: ` : '';
        const checks = verification.checks
          .filter((check) => check.status !== 'ok')
          .map((check) => ({ level: check.status, text: prefix + check.message }));
        const discrepancies = (verification.discrepanciasIA || []).map((difference) => ({
          level: 'error' as const,
          text: `${prefix}${FIELD_LABELS[difference.campo] || difference.campo}: las dos lecturas no coinciden («${difference.primera}» / «${difference.segunda}»).`,
        }));
        return [...checks, ...discrepancies];
      })
    : [];

  const selectedChargeDate = selectedJoint?.notices.length
    ? selectedJoint.notices
        .map((notice) => new Date(notice.fechaCargo))
        .filter((date) => !isNaN(date.getTime()))
        .sort((a, b) => a.getTime() - b.getTime())[0]
    : null;



  const activeAdvisoryPresetId = selectedJoint
    ? ADVISORY_NOTE_PRESETS.find((preset) => preset.text === (selectedJoint.notaAsesoria || '').trim())?.id
    : undefined;

  const handleAdvisoryNoteChange = (jointId: string, enabled: boolean, text: string) => {
    const cleanText = text.slice(0, 240);
    const noticeIds = new Set(groupNotices(rawNotices, groupingOverrides).find((joint) => joint.id === jointId)?.notices.map((notice) => notice.id) || []);
    const updated = rawNotices.map((notice) =>
      noticeIds.has(notice.id)
        ? { ...notice, mostrarNotaAsesoria: enabled, notaAsesoria: cleanText }
        : notice
    );
    saveNoticesToLocal(updated);
  };
  const generateWhatsAppText = (joint: JointNotice): string => buildWhatsAppText(joint, { agencyName, signatureText });

  const copyWhatsAppText = async (joint: JointNotice) => {
    const text = generateWhatsAppText(joint);
    await navigator.clipboard.writeText(text);
    setCopiedTextId(joint.id);
    setTimeout(() => setCopiedTextId(null), 2000);
  };

  const handleEditSave = (updatedJoint: JointNotice) => {
    // Tras una edición manual: recalcular fechas y re-verificar con los checksums.
    // Las discrepancias de la doble lectura de la IA se descartan (el usuario acaba
    // de revisar los datos a mano, y eso es la verificación definitiva).
    const applyEdit = (edit: TaxNotice): TaxNotice => {
      const dl = calculateAEATDeadlines(edit.modelo, edit.periodo, edit.ejercicio);
      const result: TaxNotice = {
        ...edit,
        fechaCargo: dl.fechaCargo.toISOString(),
        fechaLimiteDomiciliacion: dl.fechaLimiteDomiciliacion.toISOString(),
      };
      result.verificacion = buildVerification(result, [], edit.verificacion?.segundaLecturaHecha ?? false);
      return result;
    };

    // Los impuestos quitados en el editor se eliminan de verdad (antes se
    // quedaban en la lista al guardar) y se borra su captura del disco.
    const editedIds = new Set(updatedJoint.notices.map((n) => n.id));
    const originalIds = new Set(groupNotices(rawNotices, groupingOverrides).find((joint) => joint.id === updatedJoint.id)?.notices.map((notice) => notice.id) || []);
    const belongsToGroup = (n: TaxNotice) => originalIds.has(n.id);
    rawNotices
      .filter((n) => belongsToGroup(n) && !editedIds.has(n.id))
      .forEach((n) => deleteCaptureFromDisk(n.screenshotId));

    const kept = rawNotices.filter((n) => !belongsToGroup(n) || editedIds.has(n.id));

    const updatedNotices = kept.map((raw) => {
      const matchingEdit = updatedJoint.notices.find(n => n.id === raw.id);
      return matchingEdit ? applyEdit(matchingEdit) : raw;
    });

    // Also add any new manual taxes that might be added inside NoticeEditor
    const existingIds = rawNotices.map(r => r.id);
    const addedTaxes = updatedJoint.notices.filter(n => !existingIds.includes(n.id)).map(applyEdit);

    const finalNotices = [...updatedNotices, ...addedTaxes];
    saveNoticesToLocal(finalNotices);
    setEditingJointId(null);
  };

  const handleDeleteClientGroup = (jointId: string) => {
    if (confirm("¿Está seguro de que desea eliminar todas las declaraciones de este cliente?")) {
      const noticeIds = new Set(groupNotices(rawNotices, groupingOverrides).find((joint) => joint.id === jointId)?.notices.map((notice) => notice.id) || []);
      const removed = rawNotices.filter((notice) => noticeIds.has(notice.id));
      removed.forEach((n) => deleteCaptureFromDisk(n.screenshotId));
      const updated = rawNotices.filter((notice) => !noticeIds.has(notice.id));
      saveNoticesToLocal(updated);
    }
  };

  const handleClearAll = () => {
    if (confirm("¿Seguro que desea limpiar todas las declaraciones cargadas?")) {
      rawNotices.forEach((n) => deleteCaptureFromDisk(n.screenshotId));
      saveNoticesToLocal([]);
    }
  };

  const copyNoticeImage = async (joint: JointNotice) => {
    const surface = document.querySelector(`[data-export-surface="${CSS.escape(joint.id)}"]`);
    const card = surface?.firstElementChild?.firstElementChild as HTMLElement | null;
    if (!card) throw new Error('No se encuentra la ficha para exportar.');
    const options = { pixelRatio: 2, backgroundColor: '#FBF9F5', cacheBust: true, skipFonts: true };
    await toBlob(card, options);
    const blob = await toBlob(card, options);
    if (!blob) throw new Error('No se pudo generar la imagen.');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
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
      snapshot: joint,
    };
    const response = await fetch('/api/notices/archive', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(archive),
    });
    if (!response.ok) throw new Error('No se pudo archivar el aviso.');
    if (!archivedNoticesRef.current.some((item) => item.id === archive.id)) {
      archivedNoticesRef.current = [archive, ...archivedNoticesRef.current];
      setArchivedNotices(archivedNoticesRef.current);
    }
    const removedIds = new Set(joint.notices.map((notice) => notice.id));
    const active = rawNoticesRef.current.filter((notice) => !removedIds.has(notice.id));
    rawNoticesRef.current = active;
    setRawNotices(active);
    const remainingQueue = queueItemsRef.current.filter((item) => item.jointId !== joint.id);
    queueItemsRef.current = remainingQueue;
    captureQueue.hydrate(remainingQueue);
    await persistWorkspace(remainingQueue, active);
  };

  const handleCompleteAndContinue = async (joint: JointNotice, mode: 'text' | 'image') => {
    try {
      const next = await completeAndContinue({
        joint,
        mode,
        exportText: copyWhatsAppText,
        exportImage: copyNoticeImage,
        archive: archiveJoint,
        pendingJointIds: groupedNotices.map((item) => item.id),
      });
      setSelectedJointId(next);
    } catch (error) {
      console.error(error);
      alert(`No se pudo completar el aviso: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const applyGrouping = (override: GroupingOverride) => {
    const next = [...groupingOverridesRef.current, override];
    groupingOverridesRef.current = next;
    setGroupingOverrides(next);
    void persistWorkspace();
  };

  const handleUndoGrouping = () => {
    const next = undoGroupingOverride(groupingOverridesRef.current);
    groupingOverridesRef.current = next;
    setGroupingOverrides(next);
    void persistWorkspace();
  };

  const handleReopen = (archive: ArchivedNotice) => {
    const snapshot = archive.snapshot as JointNotice;
    const existing = new Set(rawNoticesRef.current.map((notice) => notice.id));
    const active = [...snapshot.notices.filter((notice) => !existing.has(notice.id)), ...rawNoticesRef.current];
    const history = archivedNoticesRef.current.filter((item) => item.id !== archive.id);
    rawNoticesRef.current = active;
    archivedNoticesRef.current = history;
    setRawNotices(active);
    setArchivedNotices(history);
    selectedJointIdRef.current = snapshot.id;
    setSelectedJointId(snapshot.id);
    void persistWorkspace(queueItemsRef.current, active);
  };

  // Handle manual file drag & drop events
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => {
    setIsDragOver(false);
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
  };

  const workspaceRedesignEnabled = true;

  if (workspaceRedesignEnabled) {
    return (
      <div className="workspace-shell h-screen min-h-[720px] overflow-hidden bg-[#f7f6f3] text-slate-800 flex flex-col">
        <AnimatePresence>
          {loading && <LoaderOverlay step={loadingStep} takingLong={takingLong} />}
        </AnimatePresence>

        <div
          className="h-11 flex-none bg-[#0B3159] text-white flex items-center gap-2 px-4 pr-40 select-none"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <img src={appIcon} alt="" className="w-7 h-7 object-contain" />
          <span className="text-sm font-semibold">Generador de Avisos Fiscales</span>
        </div>

        <div className="h-10 flex-none bg-white border-b border-stone-200 flex items-center justify-between px-3 relative z-40">
          <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="relative h-full flex items-center">
              <button data-open={openMenu === 'file'} onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')} className="workspace-menu-trigger h-full px-3 text-sm flex items-center gap-1.5">
                <span>Archivo</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {openMenu === 'file' && (
                <div className="absolute top-full left-0 w-56 bg-white border border-stone-200 rounded-b-lg shadow-xl p-1.5 z-50">
                  <button onClick={() => { setOpenMenu(null); handleReadClipboard(); }} className="workspace-menu-item w-full px-3 py-2 text-xs rounded flex items-center gap-2">
                    <Clipboard className="w-4 h-4" /><span className="flex-1 text-left">Pegar captura</span><kbd className="text-[10px] text-stone-400">Ctrl+V</kbd>
                  </button>
                  <button onClick={() => { setOpenMenu(null); document.getElementById('workspace-file-input')?.click(); }} className="workspace-menu-item w-full px-3 py-2 text-xs rounded flex items-center gap-2">
                    <Upload className="w-4 h-4" /><span>Abrir imagen...</span>
                  </button>
                  <div className="h-px bg-stone-100 my-1" />
                  <button onClick={() => { setOpenMenu(null); loadExampleData(); }} className="workspace-menu-item w-full px-3 py-2 text-xs rounded flex items-center gap-2">
                    <Sparkles className="w-4 h-4" /><span>Cargar ejemplo</span>
                  </button>
                </div>
              )}
            </div>

            <div className="relative h-full flex items-center">
              <button data-open={openMenu === 'edit'} onClick={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')} className="workspace-menu-trigger h-full px-3 text-sm flex items-center gap-1.5">
                <span>Editar</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {openMenu === 'edit' && (
                <div className="absolute top-full left-0 w-64 bg-white border border-stone-200 rounded-b-lg shadow-xl p-1.5 z-50">
                  <button disabled={!selectedJoint} onClick={() => { if (selectedJoint) setEditingJointId(selectedJoint.id); setOpenMenu(null); }} className="workspace-menu-item w-full px-3 py-2 text-xs rounded flex items-center gap-2 disabled:opacity-40"><Edit2 className="w-4 h-4" /><span>Editar datos del aviso</span></button>
                  <button onClick={() => { setShowPreferences(true); setOpenMenu(null); }} className="workspace-menu-item w-full px-3 py-2 text-xs rounded flex items-center gap-2"><Settings2 className="w-4 h-4" /><span>Preferencias de la asesor&iacute;a</span></button>
                  <div className="h-px bg-stone-100 my-1" />
                  <button disabled={!selectedJoint} onClick={() => { if (selectedJoint) handleDeleteClientGroup(selectedJoint.id); setOpenMenu(null); }} className="workspace-menu-item w-full px-3 py-2 text-xs rounded text-rose-600 flex items-center gap-2 disabled:opacity-40"><Trash2 className="w-4 h-4" /><span>Descartar aviso activo</span></button>
                  <button disabled={!rawNotices.length} onClick={() => { handleClearAll(); setOpenMenu(null); }} className="workspace-menu-item w-full px-3 py-2 text-xs rounded text-rose-600 flex items-center gap-2 disabled:opacity-40"><X className="w-4 h-4" /><span>Limpiar todos</span></button>
                </div>
              )}
            </div>

            <div className="relative h-full flex items-center">
              <button data-open={openMenu === 'view'} onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')} className="workspace-menu-trigger h-full px-3 text-sm flex items-center gap-1.5">
                <span>Ver</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {openMenu === 'view' && (
                <div className="absolute top-full left-0 w-56 bg-white border border-stone-200 rounded-b-lg shadow-xl p-1.5 z-50">
                  <button disabled={!selectedJoint} onClick={() => { if (selectedJoint) setActiveTab((prev) => ({ ...prev, [selectedJoint.id]: 'text' })); setOpenMenu(null); }} className="workspace-menu-item w-full px-3 py-2 text-xs rounded flex items-center gap-2 disabled:opacity-40"><MessageSquareText className="w-4 h-4" /><span>Texto WhatsApp</span></button>
                  <button disabled={!selectedJoint} onClick={() => { if (selectedJoint) setActiveTab((prev) => ({ ...prev, [selectedJoint.id]: 'image' })); setOpenMenu(null); }} className="workspace-menu-item w-full px-3 py-2 text-xs rounded flex items-center gap-2 disabled:opacity-40"><ImageIcon className="w-4 h-4" /><span>Imagen del aviso</span></button>
                  <div className="h-px bg-stone-100 my-1" />
                  {(['A', 'B', 'C'] as CardFormat[]).map((format) => (
                    <button key={format} data-selected={cardFormat === format} onClick={() => { handleCardFormatChange(format); setOpenMenu(null); }} className="workspace-menu-item w-full px-3 py-2 text-xs rounded flex items-center gap-2">
                      <PanelTop className="w-4 h-4" />
                      <span className="flex-1 text-left">Formato {format}</span>
                      {cardFormat === format && <Check className="w-4 h-4 text-emerald-600" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative h-full flex items-center">
              <button data-open={historyExpanded} onClick={() => { setHistoryExpanded(!historyExpanded); setOpenMenu(null); }} className="workspace-menu-trigger h-full px-3 text-sm flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /><span>Historial</span>
              </button>
            </div>

            <div className="relative h-full flex items-center">
              <button data-open={openMenu === 'help'} onClick={() => setOpenMenu(openMenu === 'help' ? null : 'help')} className="workspace-menu-trigger h-full px-3 text-sm flex items-center gap-1.5">
                <span>Ayuda</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {openMenu === 'help' && (
                <div className="absolute top-full left-0 w-64 bg-white border border-stone-200 rounded-b-lg shadow-xl p-3 z-50">
                  <ApiKeySettings />
                  <div className="mt-3 pt-2 border-t border-stone-100 text-[11px] text-stone-500">
                    Generador de Avisos Fiscales<br />
                    Versi&oacute;n {appVersion || '...'}
                  </div>
                </div>
              )}
            </div>
          </div>

          <span className="text-xs text-stone-500 pr-2">Versi&oacute;n {appVersion || '...'}</span>
        </div>

        <input id="workspace-file-input" type="file" accept="image/*" multiple className="hidden" onChange={handleFileInputChange} />

        <div className="flex-none bg-white border-b border-stone-200 px-5 py-2">
          <div className="mx-auto flex max-w-[1760px] items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-[#102A4C]">
                {selectedJoint ? selectedJoint.cliente_nombre : 'Nuevo aviso fiscal'}
              </div>
              <div className="text-[10px] text-stone-400">
                {selectedJoint
                  ? `${selectedJoint.notices.length} ${selectedJoint.notices.length === 1 ? 'impuesto' : 'impuestos'} · ${selectedVerificationState === 'ok' ? 'datos verificados' : 'pendiente de revisión'}`
                  : 'Pegue una captura para comenzar'}
              </div>
            </div>
            {selectedJoint && (
              <>
                <button
                  onClick={() => copyWhatsAppText(selectedJoint)}
                  className="flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-stone-50"
                >
                  {copiedTextId === selectedJoint.id ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  {copiedTextId === selectedJoint.id ? 'Texto copiado' : 'Copiar texto'}
                </button>
                <button
                  onClick={() => setActiveTab((prev) => ({ ...prev, [selectedJoint.id]: 'image' }))}
                  className="flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-stone-50"
                >
                  <ImageIcon className="h-4 w-4" /> Ver imagen
                </button>
              </>
            )}
            <button onClick={handleReadClipboard} className="flex items-center gap-2 rounded-lg bg-[#0B3159] px-4 py-2 text-xs font-bold text-white hover:bg-[#082745]">
              <Clipboard className="w-4 h-4" />
              Pegar captura
              <kbd className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-normal">Ctrl+V</kbd>
            </button>
          </div>
        </div>

        <main className="flex-1 min-h-0 p-3 lg:p-4 flex flex-col">
          <div className="flex-none max-w-[1760px] w-full mx-auto mb-3">
            <CaptureQueue
              items={captureQueue.items}
              selectedJointId={selectedJoint?.id}
              onRetry={captureQueue.retry}
              onSelect={(jointId) => setSelectedJointId(jointId)}
            />
          </div>
          <div className="flex-1 min-h-0 grid grid-cols-[minmax(390px,0.88fr)_minmax(520px,1.12fr)] gap-3 max-w-[1760px] w-full mx-auto">
            <section
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={'h-full min-h-0 rounded-xl border bg-white shadow-sm overflow-y-auto ' + (isDragOver ? 'border-[#0B3159] ring-2 ring-[#0B3159]/15' : 'border-stone-200')}
            >
              <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-bold text-[#102A4C]"><FileText className="h-5 w-5" />Datos extra&iacute;dos</h2>
                  <p className="text-[11px] text-stone-400 mt-0.5">Revise la informaci&oacute;n antes de enviarla</p>
                </div>
                {selectedJoint && (
                  <span className={'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ' + (
                    selectedVerificationState === 'ok'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : selectedVerificationState === 'review'
                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                        : 'bg-amber-50 border-amber-200 text-amber-700'
                  )}>
                    {selectedVerificationState === 'ok' ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                    {selectedVerificationState === 'ok' ? 'Datos verificados' : selectedVerificationState === 'review' ? 'Revisar datos' : 'Sin verificar'}
                  </span>
                )}
              </div>

              {!selectedJoint ? (
                <div className="p-6 h-[555px] flex items-center justify-center">
                  <div className="max-w-sm w-full rounded-xl border-2 border-dashed border-stone-300 bg-stone-50/50 p-8 text-center">
                    <Upload className="w-9 h-9 text-[#0B3159] mx-auto mb-3" />
                    <h3 className="font-bold text-slate-800 mb-1">Pegue una captura para empezar</h3>
                    <p className="text-xs text-stone-500 mb-5">Use Ctrl+V, arrastre una imagen o seleccione un archivo.</p>
                    <button onClick={handleReadClipboard} className="w-full rounded-lg bg-[#0B3159] px-4 py-2.5 text-sm font-bold text-white">Pegar captura</button>
                    <button onClick={() => document.getElementById('workspace-file-input')?.click()} className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700">Seleccionar imagen</button>
                  </div>
                </div>
              ) : editingJointId === selectedJoint.id ? (
                <div className="p-4">
                  <NoticeEditor
                    key={selectedJoint.id}
                    notice={selectedJoint}
                    onSave={handleEditSave}
                    onCancel={() => setEditingJointId(null)}
                  />
                </div>
              ) : (
                <div className="p-5">
                  {selectedVerificationState === 'review' && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                      <div className="flex items-start gap-2.5">
                        <ShieldAlert className="mt-0.5 h-4 w-4 flex-none text-amber-700" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="text-xs font-bold text-amber-900">Revise estos datos antes de copiar el aviso</h3>
                            <button onClick={() => setEditingJointId(selectedJoint.id)} className="flex-none rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-100">Corregir datos</button>
                          </div>
                          <ul className="mt-1.5 space-y-1 text-[10px] leading-relaxed text-amber-900">
                            {selectedVerificationIssues.length > 0
                              ? selectedVerificationIssues.map((issue, index) => <li key={index}>&bull; {issue.text}</li>)
                              : <li>&bull; Hay datos que requieren una comprobaci&oacute;n manual.</li>}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                  {selectedVerificationState === 'unverified' && (
                    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-3 text-[10px] text-stone-600">
                      <ShieldQuestion className="mt-0.5 h-4 w-4 flex-none text-stone-500" />
                      <span>No se pudo completar la segunda lectura. Compruebe los datos con la captura antes de enviarlos.</span>
                    </div>
                  )}
                  <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5 items-center text-sm">
                    <span className="text-stone-500">Cliente</span>
                    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 font-semibold">{selectedJoint.cliente_nombre}</div>
                    <span className="text-stone-500">NIF</span>
                    <div className="w-fit min-w-40 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 font-mono">{selectedJoint.cliente_nif}</div>
                    <span className="text-stone-500">Per&iacute;odo</span>
                    <div className="w-fit min-w-40 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                      {selectedJoint.notices[0]?.periodo} / {selectedJoint.notices[0]?.ejercicio}
                    </div>
                  </div>

                  <div className="mt-5 border-t border-stone-200 pt-4">
                    <div className="flex items-center justify-between mb-3 gap-3">
                      <h3 className="font-bold text-slate-800">Impuestos incluidos &middot; {selectedJoint.notices.length}</h3>
                      <div className="flex items-center gap-2">
                        <button disabled={selectedJoint.notices.length < 2} onClick={() => applyGrouping(createSplitOverride(selectedJoint))} className="text-xs font-semibold text-[#0B3159] hover:underline disabled:opacity-40">Separar</button>
                        <button disabled={!mergeCandidate} onClick={() => mergeCandidate && applyGrouping(createMergeOverride(selectedJoint, mergeCandidate))} className="text-xs font-semibold text-[#0B3159] hover:underline disabled:opacity-40">Unir con siguiente</button>
                        <button disabled={groupingOverrides.length === 0} onClick={handleUndoGrouping} className="text-xs font-semibold text-[#0B3159] hover:underline disabled:opacity-40">Deshacer</button>
                        <button onClick={() => setEditingJointId(selectedJoint.id)} className="text-xs font-semibold text-[#0B3159] hover:underline">Editar</button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {selectedJoint.notices.map((tax, index) => (
                        <div key={tax.id} className="workspace-data-row grid grid-cols-[34px_62px_minmax(0,1fr)_105px_32px] gap-2.5 items-center rounded-lg border border-stone-200 px-3 py-2.5">
                          <span className="w-8 h-8 rounded-md bg-stone-100 flex items-center justify-center text-xs font-bold">{index + 1}</span>
                          <div><span className="block text-[9px] uppercase text-stone-400">Modelo</span><span className="font-bold">{tax.modelo}</span></div>
                          <div className="min-w-0"><span className="block truncate font-semibold">{tax.modelo_nombre || 'Modelo ' + tax.modelo}</span><span className="mt-0.5 inline-flex rounded bg-stone-100 px-1.5 py-0.5 text-[9px] font-semibold text-stone-500">{tax.tipo_resultado}</span></div>
                          <div className="text-right"><span className="block text-[9px] uppercase text-stone-400">Importe</span><span className="font-bold">{tax.importe.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} &euro;</span></div>
                          <button
                            onClick={() => tax.screenshotId ? window.open('/api/capturas/' + tax.screenshotId, '_blank') : tax.screenshotUrl && window.open(tax.screenshotUrl, '_blank')}
                            disabled={!tax.screenshotId && !tax.screenshotUrl}
                            title="Ver captura original"
                            aria-label={'Ver captura original del modelo ' + tax.modelo}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-500 hover:border-[#9DB3CF] hover:bg-[#EDF4FA] hover:text-[#0B3159] disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button onClick={() => document.getElementById('workspace-file-input')?.click()} className="mt-3 w-full rounded-lg border border-dashed border-stone-300 py-2.5 text-xs font-bold text-[#0B3159] hover:bg-stone-50">
                      <Plus className="inline w-4 h-4 mr-1" /> A&ntilde;adir otra captura
                    </button>
                  </div>

                  <div className="mt-4 border-t border-stone-200 pt-4 grid grid-cols-[145px_minmax(0,1fr)] gap-x-3 gap-y-2.5 items-center text-sm">
                    <span className="text-stone-500">Cuenta de cargo (IBAN)</span>
                    <div className="min-w-0 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 font-mono">
                      {selectedJoint.iban
                        ? selectedJoint.iban.replace(/\s+/g, '').replace(/^(.{4}).*(.{4})$/, '$1 **** **** $2')
                        : 'No disponible'}
                    </div>
                    <span className="text-stone-500">Fecha de cargo</span>
                    <div className="min-w-0 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                      {selectedChargeDate ? formatDateSpanish(selectedChargeDate) : 'No disponible'}
                    </div>
                  </div>

                  <div className="mt-6 flex items-center justify-between">
                    <button onClick={() => handleDeleteClientGroup(selectedJoint.id)} className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-4 py-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" />Descartar</button>
                    <button onClick={() => setEditingJointId(selectedJoint.id)} className="rounded-lg bg-[#0B3159] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#082745]">
                      <Edit2 className="inline w-4 h-4 mr-1.5" /> Editar datos
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="h-full min-h-0 rounded-xl border border-stone-200 bg-white shadow-sm overflow-y-auto">
              <div className="px-5 py-4 border-b border-stone-200">
                <h2 className="flex items-center gap-2 text-lg font-bold text-[#102A4C]"><ImageIcon className="h-5 w-5" />Resultado para el cliente</h2>
                <p className="text-[11px] text-stone-400 mt-0.5">Copie el texto o la imagen lista para WhatsApp</p>
              </div>

              {!selectedJoint ? (
                <div className="h-[555px] flex flex-col items-center justify-center text-center p-8">
                  <ImageIcon className="w-12 h-12 text-stone-300 mb-3" />
                  <h3 className="font-semibold text-slate-700">Todav&iacute;a no hay un aviso</h3>
                  <p className="text-xs text-stone-400 mt-1">La vista previa aparecer&aacute; cuando procese una captura.</p>
                </div>
              ) : (
                <>
                  <div className="px-5 pt-3 border-b border-stone-200 flex gap-7">
                    <button aria-selected={selectedTab === 'text'} onClick={() => setActiveTab((prev) => ({ ...prev, [selectedJoint.id]: 'text' }))} className={'flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 pb-2.5 pt-1 text-sm font-semibold ' + (selectedTab === 'text' ? 'border-[#0B3159] bg-[#EDF4FA] text-[#0B3159]' : 'border-transparent text-stone-500 hover:bg-stone-50 hover:text-slate-700')}><MessageSquareText className="h-4 w-4" />Texto WhatsApp</button>
                    <button aria-selected={selectedTab === 'image'} onClick={() => setActiveTab((prev) => ({ ...prev, [selectedJoint.id]: 'image' }))} className={'flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 pb-2.5 pt-1 text-sm font-semibold ' + (selectedTab === 'image' ? 'border-[#0B3159] bg-[#EDF4FA] text-[#0B3159]' : 'border-transparent text-stone-500 hover:bg-stone-50 hover:text-slate-700')}><ImageIcon className="h-4 w-4" />Imagen</button>
                  </div>

                  {selectedTab === 'text' ? (
                    <div className="p-5">
                      <div className="relative rounded-xl border border-stone-200 bg-stone-50 p-4 pt-14 min-h-[430px]">
                        <button onClick={() => copyWhatsAppText(selectedJoint)} className="absolute top-3 right-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-stone-50">
                          {copiedTextId === selectedJoint.id ? <Check className="inline w-4 h-4 mr-1 text-emerald-600" /> : <Copy className="inline w-4 h-4 mr-1" />}
                          {copiedTextId === selectedJoint.id ? 'Copiado' : 'Copiar texto'}
                        </button>
                        <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-slate-700">{generateWhatsAppText(selectedJoint)}</pre>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCompleteAndContinue(selectedJoint, 'text')}
                        className="mt-3 w-full rounded-lg bg-[#19724E] px-4 py-2.5 text-sm font-bold text-white"
                      >
                        Copiar, archivar y continuar
                      </button>
                    </div>
                  ) : (
                    <div className="p-4">
                      <div className={'mb-3 rounded-xl border px-4 py-3 ' + (selectedJoint.mostrarNotaAsesoria ? 'border-[#9DB3CF] bg-[#F7FAFD]' : 'border-stone-200 bg-stone-50')}>
                        <label className="flex items-center gap-3 cursor-pointer rounded-lg">
                          <input
                            type="checkbox"
                            checked={!!selectedJoint.mostrarNotaAsesoria}
                            onChange={(event) => handleAdvisoryNoteChange(selectedJoint.id, event.target.checked, selectedJoint.notaAsesoria || '')}
                            className="w-4 h-4 accent-[#0B3159] cursor-pointer"
                          />
                          <MessageSquareText className="w-4 h-4 text-[#0B3159]" />
                          <span className="text-xs font-bold text-slate-700">A&ntilde;adir nota al pie del aviso</span>
                          {!selectedJoint.mostrarNotaAsesoria && <span className="ml-auto text-[10px] text-stone-400">Desactivada por defecto</span>}
                        </label>
                        {selectedJoint.mostrarNotaAsesoria && (
                          <div className="mt-3 border-t border-[#DCE5EF] pt-3">
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase tracking-wide text-stone-500">Frases r&aacute;pidas</span>
                              <span className="text-[10px] text-stone-400">Elija una y ed&iacute;tela si lo necesita</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              {ADVISORY_NOTE_PRESETS.map((preset) => {
                                const PresetIcon = preset.icon;
                                const isSelected = activeAdvisoryPresetId === preset.id;
                                return (
                                  <button
                                    key={preset.id}
                                    type="button"
                                    aria-pressed={isSelected}
                                    onClick={() => handleAdvisoryNoteChange(selectedJoint.id, true, preset.text)}
                                    className={'workspace-selectable relative min-h-20 rounded-lg border p-2.5 text-left ' + (isSelected ? 'border-[#0B3159] bg-[#EBF3FA] text-[#0B3159] ring-1 ring-[#0B3159]/20' : 'border-stone-200 bg-white text-slate-600')}
                                  >
                                    <PresetIcon className="mb-2 h-4 w-4" />
                                    <span className="block pr-4 text-[10px] font-bold">{preset.label}</span>
                                    <span className="mt-1 block text-[9px] leading-snug opacity-75">{preset.text}</span>
                                    {isSelected && <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-emerald-600" />}
                                  </button>
                                );
                              })}
                            </div>
                            <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-stone-500">Texto editable</label>
                            <div className="relative mt-1.5">
                              <textarea
                                value={selectedJoint.notaAsesoria || ''}
                                onChange={(event) => handleAdvisoryNoteChange(selectedJoint.id, true, event.target.value)}
                                maxLength={240}
                                rows={2}
                                placeholder="Escriba la nota que aparecer&aacute; en el pie del aviso."
                                className="w-full resize-y rounded-lg border border-stone-200 bg-white px-3 py-2 pr-14 text-xs focus:border-[#0B3159] focus:outline-none focus:ring-2 focus:ring-[#0B3159]/10"
                              />
                              <span className="absolute bottom-2 right-2 text-[9px] text-stone-400">{(selectedJoint.notaAsesoria || '').length}/240</span>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border border-stone-100 bg-[#fbfaf8] px-3 py-4 overflow-x-auto flex justify-center">
                        <div data-export-surface={selectedJoint.id}>
                          <NoticeCard notice={selectedJoint} format={cardFormat} />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCompleteAndContinue(selectedJoint, 'image')}
                        className="mt-3 w-full rounded-lg bg-[#19724E] px-4 py-2.5 text-sm font-bold text-white"
                      >
                        Copiar, archivar y continuar
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>

          <section className="flex-none max-w-[1760px] w-full mx-auto mt-3 rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
            <button onClick={() => setHistoryExpanded(!historyExpanded)} className="w-full flex items-center justify-between px-4 py-3 text-left">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <History className="w-4 h-4 text-[#0B3159]" />
                Registro de hoy &middot; {groupedNotices.length} avisos
              </span>
              <span className="flex items-center gap-1 text-xs font-semibold text-stone-500">{historyExpanded ? 'Ocultar' : 'Mostrar'}{historyExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
            </button>
            {historyExpanded && groupedNotices.length > 0 && (
              <div className="border-t border-stone-200 px-3 py-3 flex gap-2 overflow-x-auto">
                {groupedNotices.map((joint) => {
                  const timestamp = joint.notices[0]?.timestamp;
                  const isReady = joint.notices.every((notice) => notice.verificacion?.estado === 'ok');
                  const isActive = selectedJoint?.id === joint.id;
                  return (
                    <button
                      key={joint.id} data-selected={isActive}
                      onClick={() => { setSelectedJointId(joint.id); setEditingJointId(null); }}
                      className={'workspace-selectable min-w-[245px] rounded-lg border px-3 py-2 text-left ' + (isActive ? 'border-[#0B3159] bg-[#EDF4FA] ring-1 ring-[#0B3159]/20 shadow-sm' : 'border-stone-200 bg-white')}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-stone-400">{timestamp ? new Date(timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
                        <span className={'w-2 h-2 rounded-full ' + (isReady ? 'bg-emerald-500' : 'bg-amber-400')} />
                        <span className="truncate text-xs font-bold text-slate-700">{joint.cliente_nombre}</span>
                      </div>
                      <div className="mt-1 pl-14 text-[10px] text-stone-500">
                        {joint.notices.length} {joint.notices.length === 1 ? 'impuesto' : 'impuestos'} &middot; {isReady ? 'Listo' : 'Pendiente'}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {historyExpanded && (
            <div className="flex-none max-w-[1760px] w-full mx-auto mt-3">
              <NoticeHistory
                items={archivedNotices}
                onReopen={handleReopen}
                onViewCapture={(captureId) => window.open(`/api/capturas/${captureId}`, '_blank')}
              />
            </div>
          )}
        </main>

        {showPreferences && (
          <div className="fixed inset-0 z-[70] bg-slate-950/45 flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-stone-200 p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg font-bold text-[#102A4C]">Preferencias de la asesor&iacute;a</h2>
                  <p className="text-xs text-stone-400">Datos generales y formato favorito</p>
                </div>
                <button onClick={() => setShowPreferences(false)} className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold hover:bg-stone-50"><X className="h-3.5 w-3.5" />Cerrar</button>
              </div>

              <label className="block text-xs font-bold text-stone-600 mb-1">Nombre de la asesor&iacute;a</label>
              <input value={agencyName} onChange={(event) => handleAgencyNameChange(event.target.value)} className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm mb-4" />

              <label className="block text-xs font-bold text-stone-600 mb-2">Formato de la ficha</label>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {([
                  { id: 'A' as CardFormat, label: 'Equilibrado' },
                  { id: 'B' as CardFormat, label: 'Recibo' },
                  { id: 'C' as CardFormat, label: 'Una ojeada' },
                ]).map((option) => (
                  <button
                    key={option.id}
                    onClick={() => handleCardFormatChange(option.id)}
                    className={'rounded-lg border px-3 py-3 text-xs font-bold ' + (cardFormat === option.id ? 'bg-[#0B3159] border-[#0B3159] text-white' : 'border-stone-200 bg-stone-50 text-slate-600')}
                  >
                    {option.id}<span className="block mt-1 text-[10px] font-normal">{option.label}</span>
                  </button>
                ))}
              </div>

              <label className="block text-xs font-bold text-stone-600 mb-1">Firma de WhatsApp</label>
              <textarea value={signatureText} onChange={(event) => handleSignatureChange(event.target.value)} rows={4} className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm font-mono" />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50 pb-20">
      <AnimatePresence>
        {loading && <LoaderOverlay step={loadingStep} takingLong={takingLong} />}
      </AnimatePresence>

      {/* Header Bar */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40 shadow-xs">
        <div className="max-w-5xl mx-auto px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white shadow-md shadow-slate-900/10">
              <Clipboard className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900 tracking-tight leading-tight flex items-center gap-2">
                Generador de Avisos Fiscales
                {appVersion && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-mono font-semibold text-slate-500">
                    v{appVersion}
                  </span>
                )}
              </h1>
              <p className="text-slate-500 text-[11px] font-medium">
                Confección de mensajes y recibos oficiales de impuestos
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ApiKeySettings />
            <button
              onClick={loadExampleData}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-100 transition-all"
              id="btn-load-demo"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Ver Ejemplo de Prueba</span>
            </button>
            {rawNotices.length > 0 && (
              <button
                onClick={handleClearAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors"
                id="btn-clear-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Limpiar</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left column: Setup, copy/paste active drop zone, AEAT rules card */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Drag, Drop, and Paste Interactive Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative overflow-hidden rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
              isDragOver 
                ? 'border-slate-800 bg-slate-100/50 scale-[1.01]' 
                : 'border-slate-200 bg-white hover:border-slate-400'
            }`}
          >
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center text-slate-700 mb-4 border border-slate-100">
                <Upload className="w-6 h-6 animate-pulse text-slate-600" />
              </div>
              <h3 className="font-display font-bold text-sm text-slate-800 mb-1">
                Portapapeles Activo
              </h3>
              <p className="text-xs text-slate-400 max-w-[240px] mb-4 leading-relaxed">
                Usa <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-[10px] text-slate-600 shadow-xs">Impr Pant</kbd> en Windows para capturar, haz clic aquí y pulsa <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-[10px] text-slate-600 shadow-xs">Ctrl+V</kbd>.
              </p>

              <button
                onClick={handleReadClipboard}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-slate-800 hover:bg-slate-900 rounded-lg transition-all shadow-xs"
                id="btn-paste-clipboard"
              >
                <Clipboard className="w-4 h-4" />
                <span>Pegar automáticamente</span>
              </button>

              <div className="relative mt-3.5 flex items-center w-full justify-center">
                <span className="text-[10px] text-slate-400 bg-white px-2 z-10 font-bold uppercase tracking-wider">o también</span>
                <div className="absolute w-full h-[1px] bg-slate-100"></div>
              </div>

              <label className="mt-3 cursor-pointer text-xs text-slate-700 hover:text-slate-900 font-semibold underline">
                selecciona un archivo de imagen
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileInputChange}
                />
              </label>
            </div>
          </div>

          {/* Config: Advisory agency parameters */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-3.5 pb-2.5 border-b border-slate-50">
              <Sliders className="w-4.5 h-4.5 text-slate-800" />
              <h2 className="font-display font-bold text-sm text-slate-800">
                Datos de tu Asesoría
              </h2>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1 uppercase tracking-wider">
                  Nombre de tu Asesoría
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-slate-800 bg-slate-50/50"
                  value={agencyName}
                  onChange={(e) => handleAgencyNameChange(e.target.value)}
                  placeholder="Ej. Asesoría E. Marín"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                  Formato de la ficha (imagen)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { id: 'A' as CardFormat, name: 'Equilibrado' },
                    { id: 'B' as CardFormat, name: 'Recibo' },
                    { id: 'C' as CardFormat, name: 'Una ojeada' },
                  ]).map((f) => {
                    const isFav = cardFormat === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => handleCardFormatChange(f.id)}
                        className={`relative px-2 py-2 rounded-lg border text-center transition-all ${
                          isFav
                            ? 'border-slate-800 bg-slate-800 text-white'
                            : 'border-slate-200 bg-slate-50/50 text-slate-600 hover:border-slate-400'
                        }`}
                        id={`btn-format-${f.id}`}
                        title={isFav ? 'Formato favorito (se usa siempre)' : 'Marcar como favorito'}
                      >
                        <Star
                          className={`absolute top-1.5 right-1.5 w-3 h-3 ${isFav ? 'text-amber-400' : 'text-slate-300'}`}
                          fill={isFav ? 'currentColor' : 'none'}
                        />
                        <span className="block text-sm font-bold">{f.id}</span>
                        <span className="block text-[10px] font-medium mt-0.5 leading-tight">{f.name}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1">
                  <Star className="w-2.5 h-2.5 text-amber-400" fill="currentColor" />
                  <span>El formato con estrella se usa siempre en todas las fichas hasta que elijas otro.</span>
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1 uppercase tracking-wider">
                  Firma de WhatsApp
                </label>
                <textarea
                  className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-slate-800 bg-slate-50/50 h-16 font-mono"
                  value={signatureText}
                  onChange={(e) => handleSignatureChange(e.target.value)}
                  placeholder="Atentamente,\nMaldonado Consultores"
                />
              </div>
            </div>
          </div>

          {/* AEAT Deadline regulations informational card */}
          <div className="bg-slate-900 text-slate-200 rounded-2xl p-5 shadow-sm relative overflow-hidden">
            <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-slate-800 rounded-full opacity-20"></div>
            <div className="flex items-start gap-2.5 mb-3">
              <Calendar className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <h3 className="font-display font-bold text-xs text-white uppercase tracking-wider">
                  Plazos Oficiales AEAT
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Calendario de domiciliaciones fiscales
                </p>
              </div>
            </div>

            <div className="space-y-2.5 text-[11px] border-t border-slate-800 pt-3">
              <div className="flex justify-between">
                <span className="text-slate-400 font-medium">1T (Ene - Mar):</span>
                <span className="font-semibold text-emerald-400">Cargo el 20 de Abril</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-medium">2T (Abr - Jun):</span>
                <span className="font-semibold text-emerald-400">Cargo el 20 de Julio</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-medium">3T (Jul - Sep):</span>
                <span className="font-semibold text-emerald-400">Cargo el 20 de Octubre</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-medium">4T (Oct - Dic):</span>
                <span className="font-semibold text-emerald-400">Cargo el 30 de Enero</span>
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-2.5 mt-3.5 flex gap-2 border border-slate-800">
              <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-slate-300 leading-relaxed">
                Si el día de cargo o límite cae en sábado, domingo o festivo nacional, el sistema de esta app lo desplaza automáticamente al siguiente día hábil.
              </p>
            </div>
          </div>

        </div>

        {/* Right column: Main active notice queue and unified groups */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-base text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-slate-800" />
              <span>Avisos Activos ({groupedNotices.length} Clientes)</span>
            </h2>
            <span className="text-xs font-mono text-slate-400">
              LocalStorage activo
            </span>
          </div>

          {groupedNotices.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center shadow-xs">
              <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 mx-auto mb-4 border border-slate-100">
                <Clipboard className="w-6 h-6" />
              </div>
              <h3 className="font-display font-bold text-sm text-slate-800 mb-1">
                Ninguna captura o aviso cargado
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mb-6 leading-relaxed">
                Carga una captura del programa tributario o pulsa el botón "Ver Ejemplo de Prueba" para visualizar cómo se confecciona y calcula un aviso completo.
              </p>
              <button
                onClick={loadExampleData}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 rounded-lg transition-all"
                id="btn-load-demo-empty"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Cargar Ejemplo de Prueba</span>
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {groupedNotices.map((joint) => {
                const currentTab = activeTab[joint.id] || 'text';
                const isEditing = editingJointId === joint.id;

                // Estado de verificación del grupo: el peor de sus avisos.
                const verifState = (() => {
                  let revisar = false, sinVerificar = false;
                  joint.notices.forEach((n) => {
                    const v = n.verificacion;
                    if (!v || v.estado === 'sin-verificar') sinVerificar = true;
                    else if (v.estado === 'revisar') revisar = true;
                  });
                  return revisar ? 'revisar' : sinVerificar ? 'sin-verificar' : 'ok';
                })();

                const verifIssues = joint.notices.flatMap((n) => {
                  const v = n.verificacion;
                  if (!v) return [];
                  const prefix = joint.notices.length > 1 ? `Modelo ${n.modelo}: ` : '';
                  const checks = v.checks
                    .filter((c) => c.status !== 'ok')
                    .map((c) => ({ level: c.status, text: `${prefix}${c.message}` }));
                  const discrepancies = (v.discrepanciasIA || []).map((d) => ({
                    level: 'error' as const,
                    text: `${prefix}${FIELD_LABELS[d.campo] || d.campo}: las dos lecturas de la IA no coinciden («${d.primera}» frente a «${d.segunda}»). Compare con la captura.`,
                  }));
                  return [...checks, ...discrepancies];
                });

                return (
                  <motion.div
                    key={joint.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
                  >
                    
                    {/* Header of the client block */}
                    <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-slate-50/20">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-display font-bold text-slate-950 text-sm leading-tight">
                            {joint.cliente_nombre}
                          </h3>
                          <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-600 uppercase font-mono">
                            {joint.cliente_nif}
                          </span>
                          {verifState === 'ok' && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700" title="Checksums de IBAN/NIF correctos y doble lectura de la IA coincidente">
                              <ShieldCheck className="w-3 h-3" />
                              Datos verificados
                            </span>
                          )}
                          {verifState === 'revisar' && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-[10px] font-bold text-rose-700" title="Hay datos que no superan la comprobación. Revise antes de enviar.">
                              <ShieldAlert className="w-3 h-3" />
                              Revisar datos
                            </span>
                          )}
                          {verifState === 'sin-verificar' && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-[10px] font-bold text-slate-500" title="No se pudo hacer la verificación automática (aviso antiguo, manual o fallo de red)">
                              <ShieldQuestion className="w-3 h-3" />
                              Sin verificar
                            </span>
                          )}
                        </div>
                        
                        <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                          <span>{joint.notices.length} {joint.notices.length === 1 ? 'declaración cargada' : 'declaraciones unificadas'}</span>
                          <span className="text-slate-300">•</span>
                          <span className="text-[11px] font-mono text-stone-600 bg-stone-100/50 px-1.5 rounded">
                            Total: {joint.total_importe.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                          </span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <button
                          onClick={() => setEditingJointId(isEditing ? null : joint.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                          id={`btn-edit-toggle-${joint.id}`}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>{isEditing ? 'Cancelar' : 'Editar Datos'}</span>
                        </button>
                        
                        <button
                          onClick={() => handleDeleteClientGroup(joint.id)}
                          className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Eliminar este cliente"
                          id={`btn-delete-group-${joint.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Detalle de la verificación cuando hay algo que revisar */}
                    {verifIssues.length > 0 && (
                      <div className="px-5 py-3 bg-rose-50/40 border-b border-rose-100">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <ShieldAlert className="w-4 h-4 text-rose-600" />
                          <span className="text-xs font-bold text-rose-700">Comprobaciones sobre los datos capturados</span>
                        </div>
                        <ul className="space-y-1 pl-1">
                          {verifIssues.map((issue, i) => (
                            <li key={i} className={`text-[11px] leading-relaxed flex gap-1.5 ${issue.level === 'error' ? 'text-rose-700' : 'text-amber-700'}`}>
                              <span className="shrink-0">{issue.level === 'error' ? '✖' : '⚠'}</span>
                              <span>{issue.text}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="text-[10px] text-slate-500 mt-1.5">
                          Compare con la captura asociada (abajo) y corrija con «Editar Datos». Al guardar, las comprobaciones se recalculan.
                        </p>
                      </div>
                    )}

                    {/* Editor view if active */}
                    {isEditing ? (
                      <div className="p-5 border-b border-slate-50 bg-slate-50/10">
                        <NoticeEditor
                          notice={joint}
                          onSave={handleEditSave}
                          onCancel={() => setEditingJointId(null)}
                        />
                      </div>
                    ) : null}

                    {/* Interactive presentation zone */}
                    <div className="p-5">
                      
                      {/* Tabs to toggle format */}
                      <div className="flex border-b border-slate-100 mb-5 gap-4">
                        <button
                          onClick={() => setActiveTab(prev => ({ ...prev, [joint.id]: 'text' }))}
                          className={`pb-2 text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all ${
                            currentTab === 'text'
                              ? 'border-slate-800 text-slate-900'
                              : 'border-transparent text-slate-400 hover:text-slate-600'
                          }`}
                          id={`tab-text-${joint.id}`}
                        >
                          <FileText className="w-4 h-4" />
                          <span>Vista WhatsApp (Texto)</span>
                        </button>
                        
                        <button
                          onClick={() => setActiveTab(prev => ({ ...prev, [joint.id]: 'image' }))}
                          className={`pb-2 text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all ${
                            currentTab === 'image'
                              ? 'border-slate-800 text-slate-900'
                              : 'border-transparent text-slate-400 hover:text-slate-600'
                          }`}
                          id={`tab-img-${joint.id}`}
                        >
                          <ImageIcon className="w-4 h-4" />
                          <span>Vista Tarjeta (Imagen)</span>
                        </button>
                      </div>

                      {currentTab === 'text' ? (
                        <div className="space-y-4">
                          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 relative">
                            <pre className="text-[13px] text-slate-800 font-mono whitespace-pre-wrap leading-relaxed max-w-full overflow-x-auto">
                              {generateWhatsAppText(joint)}
                            </pre>
                            
                            <button
                              onClick={() => copyWhatsAppText(joint)}
                              className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md shadow-xs transition-all bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                              id={`btn-copy-wa-${joint.id}`}
                            >
                              {copiedTextId === joint.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-500" />
                                  <span>¡Copiado!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copiar Texto</span>
                                </>
                              )}
                            </button>
                          </div>
                          
                          <p className="text-[10px] text-slate-400 italic flex items-center gap-1">
                            <span>💡 Tip:</span>
                            <span>Este texto está optimizado con negritas (*) para que luzca perfecto y sea legible al enviarlo por WhatsApp.</span>
                          </p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <div className="w-full max-w-xl mb-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!joint.mostrarNotaAsesoria}
                                onChange={(e) => handleAdvisoryNoteChange(joint.id, e.target.checked, joint.notaAsesoria || '')}
                                className="w-4 h-4 accent-slate-800"
                              />
                              <span>{'A\u00f1adir nota manual al pie de la imagen'}</span>
                            </label>
                            {joint.mostrarNotaAsesoria && (
                              <div className="mt-2">
                                <textarea
                                  value={joint.notaAsesoria || ''}
                                  onChange={(e) => handleAdvisoryNoteChange(joint.id, true, e.target.value)}
                                  maxLength={240}
                                  rows={3}
                                  placeholder={'Ej.: Av\u00edsenos si quiere solicitar un aplazamiento.'}
                                  className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                                />
                                <div className="mt-1 text-right text-[10px] text-slate-400">
                                  {(joint.notaAsesoria || '').length}/240
                                </div>
                              </div>
                            )}
                          </div>
                          <NoticeCard
                            notice={joint}
                            format={cardFormat}
                          />
                        </div>
                      )}
                    </div>

                    {/* Screenshot thumbnails footer if images are available */}
                    {joint.notices.some(n => n.screenshotUrl) && (
                      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center gap-3 overflow-x-auto">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
                          Capturas asociadas:
                        </span>
                        <div className="flex gap-2">
                          {joint.notices.map((tax) => {
                            if (!tax.screenshotUrl) return null;
                            return (
                              <div 
                                key={tax.id} 
                                className="relative w-12 h-10 rounded border border-slate-200 overflow-hidden bg-white shrink-0 group cursor-pointer"
                                title={`Modelo ${tax.modelo} (${tax.ejercicio})`}
                                onClick={() => {
                                  // La original en disco si existe; si no (aviso antiguo), la miniatura.
                                  if (tax.screenshotId) {
                                    window.open('/api/capturas/' + tax.screenshotId, '_blank');
                                  } else {
                                    const win = window.open();
                                    if (win) win.document.write(`<img src="${tax.screenshotUrl}" style="max-width:100%"/>`);
                                  }
                                }}
                              >
                                <img 
                                  src={tax.screenshotUrl} 
                                  alt="Captura" 
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                />
                                <div className="absolute inset-0 bg-slate-900/10 group-hover:bg-transparent"></div>
                                <div className="absolute bottom-0 right-0 bg-slate-900 text-white text-[7px] font-bold px-0.5 rounded-tl">
                                  {tax.modelo}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  </motion.div>
                );
              })}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
