import React, { useState, useEffect } from 'react';
import { TaxNotice, JointNotice, calculateAEATDeadlines, formatDateSpanish } from './types';
import { LoaderOverlay } from './components/LoaderOverlay';
import { NoticeEditor } from './components/NoticeEditor';
import { NoticeCardCanvas } from './components/NoticeCardCanvas';
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
  Edit2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [rawNotices, setRawNotices] = useState<TaxNotice[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [editingJointId, setEditingJointId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Record<string, 'text' | 'image'>>({});
  const [copiedTextId, setCopiedTextId] = useState<string | null>(null);
  
  // Custom settings saved in LocalStorage
  const [agencyName, setAgencyName] = useState('Su Asesoría Fiscal');
  const [signatureText, setSignatureText] = useState('Atentamente,\nSu Asesoría Fiscal');

  // Loading settings and initial state from localStorage
  useEffect(() => {
    const savedAgency = localStorage.getItem('aeat_agency_name');
    if (savedAgency) setAgencyName(savedAgency);
    
    const savedSignature = localStorage.getItem('aeat_signature_text');
    if (savedSignature) setSignatureText(savedSignature);

    const savedNotices = localStorage.getItem('aeat_raw_notices');
    if (savedNotices) {
      try {
        setRawNotices(JSON.parse(savedNotices));
      } catch (e) {
        console.error("Failed to load saved notices", e);
      }
    }
  }, []);

  // Save changes to localStorage
  const saveNoticesToLocal = (newNotices: TaxNotice[]) => {
    setRawNotices(newNotices);
    localStorage.setItem('aeat_raw_notices', JSON.stringify(newNotices));
  };

  const handleAgencyNameChange = (val: string) => {
    setAgencyName(val);
    localStorage.setItem('aeat_agency_name', val);
  };

  const handleSignatureChange = (val: string) => {
    setSignatureText(val);
    localStorage.setItem('aeat_signature_text', val);
  };

  // Helper to load sample data from the user request
  const loadExampleData = () => {
    const sampleNotice: TaxNotice = {
      id: 'sample-303',
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
  const processImageFile = async (file: File) => {
    setLoading(true);
    setLoadingStep(0);

    const stepInterval = setInterval(() => {
      setLoadingStep((prev) => Math.min(prev + 1, 5));
    }, 1200);

    try {
      // 1. Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (e) => reject(e);
      });
      reader.readAsDataURL(file);
      const base64Image = await base64Promise;

      // 2. Call backend server API
      const response = await fetch('/api/gemini/analyze-tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64Image })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Error en el servidor: ${response.status}`);
      }

      const data = await response.json();
      
      // 3. Calculate AEAT deadline dates
      const deadlines = calculateAEATDeadlines(data.modelo, data.periodo, data.ejercicio);

      // 4. Construct final Notice object
      const newNotice: TaxNotice = {
        id: Math.random().toString(36).substring(2, 9),
        modelo: data.modelo || '303',
        modelo_nombre: data.modelo_nombre || 'Declaración Tributaria',
        periodo: data.periodo || '2T',
        ejercicio: data.ejercicio || new Date().getFullYear().toString(),
        cliente_nif: data.cliente_nif || 'Pendiente',
        cliente_nombre: data.cliente_nombre || 'Cliente Desconocido',
        importe: typeof data.importe === 'number' ? data.importe : parseFloat(data.importe) || 0,
        tipo_resultado: data.tipo_resultado || 'Domiciliación',
        iban: data.iban || '',
        screenshotUrl: base64Image, // save base64 string to render thumbnail!
        fechaCargo: deadlines.fechaCargo.toISOString(),
        fechaLimiteDomiciliacion: deadlines.fechaLimiteDomiciliacion.toISOString(),
        timestamp: Date.now()
      };

      // Add to our list
      const updated = [newNotice, ...rawNotices];
      saveNoticesToLocal(updated);

    } catch (err: any) {
      console.error(err);
      alert(`Error al analizar la imagen: ${err.message || err}`);
    } finally {
      clearInterval(stepInterval);
      setLoading(false);
    }
  };

  // Listening for paste events globally
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            processImageFile(file);
          }
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [rawNotices]);

  // Click handler to trigger browser clipboard read API (Chrome/Edge/Opera supported)
  const handleReadClipboard = async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            const file = new File([blob], "screenshot.png", { type });
            await processImageFile(file);
            return;
          }
        }
      }
      alert("No se encontró ninguna imagen en el portapapeles. Haz una captura primero (Impr Pant) y pulsa Ctrl+V directamente en la ventana.");
    } catch (err) {
      console.error("Read clipboard failed", err);
      alert("Para usar el portapapeles directo, pulsa Ctrl+V directamente en esta ventana, o arrastra un archivo de imagen.");
    }
  };

  // Group notice list by Client
  const getGroupedNotices = (notices: TaxNotice[]): JointNotice[] => {
    const map = new Map<string, TaxNotice[]>();
    notices.forEach((n) => {
      const key = (n.cliente_nif || n.cliente_nombre || 'NIF-PENDIENTE').replace(/\s+/g, '').toUpperCase();
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(n);
    });

    const jointNotices: JointNotice[] = [];
    map.forEach((taxes, key) => {
      // Sort oldest to newest timestamp
      taxes.sort((a, b) => b.timestamp - a.timestamp);
      
      const first = taxes[0];
      const total_importe = taxes.reduce((sum, tax) => sum + tax.importe, 0);
      const iban = taxes.find((tax) => tax.iban)?.iban || '';
      const todosDomiciliados = taxes.every((tax) => tax.tipo_resultado === 'Domiciliación');

      jointNotices.push({
        id: key,
        cliente_nombre: first.cliente_nombre,
        cliente_nif: first.cliente_nif,
        notices: taxes,
        total_importe,
        iban,
        todosDomiciliados
      });
    });

    return jointNotices;
  };

  const groupedNotices = getGroupedNotices(rawNotices);

  // Generate WhatsApp message string
  const generateWhatsAppText = (joint: JointNotice): string => {
    const isIndividual = joint.notices.length === 1;
    const firstNotice = joint.notices[0];
    const periodText = `${firstNotice?.periodo} / ${firstNotice?.ejercicio}`;

    let chargeDateText = "la establecida por la AEAT";
    if (joint.notices.length > 0) {
      const dates = joint.notices.map(n => new Date(n.fechaCargo));
      dates.sort((a,b) => a.getTime() - b.getTime());
      chargeDateText = formatDateSpanish(dates[0]);
    }

    let text = `*${agencyName.toUpperCase()} - AVISO DE LIQUIDACIÓN FISCAL*\n\n`;
    text += `Estimado/a *${joint.cliente_nombre}*,\n\n`;

    if (isIndividual) {
      const tax = joint.notices[0];
      const isDomiciliacion = tax.tipo_resultado === 'Domiciliación';
      const amountFormatted = tax.importe.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      text += `Le informamos de que hemos procesado la declaración correspondiente al *Modelo ${tax.modelo}* (${tax.modelo_nombre || 'Liquidación'}) del periodo *${periodText}*.\n\n`;
      text += `*Detalle de la liquidación*:\n`;
      text += `• *Impuesto*: Modelo ${tax.modelo}\n`;
      text += `• *Importe*: *${amountFormatted} €*\n`;
      text += `• *Resultado*: *${tax.tipo_resultado}*\n`;
      
      if (isDomiciliacion) {
        if (joint.iban) {
          const maskedIban = joint.iban.replace(/\s+/g, '').replace(/^([A-Z]{2}\d{2})\d+(\d{4})$/, '$1 **** **** $2') || joint.iban;
          text += `• *Cuenta de cargo*: ${maskedIban}\n`;
        }
        text += `• *Fecha de cargo en cuenta (AEAT)*: *${chargeDateText}*\n\n`;
        text += `⚠️ *Importe Domiciliado*: Rogamos se asegure de disponer de saldo suficiente en su cuenta para el día del cargo para evitar recargos por parte de la Agencia Tributaria.\n\n`;
      } else {
        text += `• *Fecha límite de presentación*: *${chargeDateText}*\n\n`;
        text += `⚠️ *Atención*: Al no estar domiciliado, recuerde realizar el pago correspondiente antes de la fecha límite señalada para evitar incidencias con la AEAT.\n\n`;
      }
    } else {
      const totalFormatted = joint.total_importe.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      
      text += `Le informamos de que hemos finalizado la confección y presentación de las declaraciones de su actividad correspondientes al periodo *${periodText}*.\n\n`;
      text += `*Desglose de Impuestos Presentados*:\n`;
      
      joint.notices.forEach((tax) => {
        const amtFormatted = tax.importe.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        text += `• *Modelo ${tax.modelo}* (${tax.modelo_nombre || 'Declaración'}): *${amtFormatted} €* (${tax.tipo_resultado})\n`;
      });

      text += `\n*RESUMEN TOTAL*:\n`;
      text += `• *TOTAL LIQUIDACIÓN*: *${totalFormatted} €*\n`;
      
      if (joint.todosDomiciliados) {
        text += `• *Forma de pago*: *Domiciliación Bancaria*\n`;
        if (joint.iban) {
          const maskedIban = joint.iban.replace(/\s+/g, '').replace(/^([A-Z]{2}\d{2})\d+(\d{4})$/, '$1 **** **** $2') || joint.iban;
          text += `• *Cuenta de cargo*: ${maskedIban}\n`;
        }
        text += `• *Fecha de cargo en cuenta (AEAT)*: *${chargeDateText}*\n\n`;
        text += `⚠️ *Aviso de Domiciliación*: Por favor, compruebe que dispone de saldo de *${totalFormatted} €* en la cuenta bancaria para el día del cobro. La Agencia Tributaria realizará el cargo automáticamente.\n\n`;
      } else {
        text += `• *Fecha límite de ingreso*: *${chargeDateText}*\n\n`;
        text += `⚠️ *Aviso*: Rogamos que revise los métodos de pago de cada modelo indicados en el desglose anterior para realizar los ingresos antes del *${chargeDateText}*.\n\n`;
      }
    }

    text += `Si tiene cualquier consulta, no dude en ponerse en contacto con nosotros.\n\n`;
    text += `${signatureText}`;
    return text;
  };

  const copyWhatsAppText = (joint: JointNotice) => {
    const text = generateWhatsAppText(joint);
    navigator.clipboard.writeText(text);
    setCopiedTextId(joint.id);
    setTimeout(() => setCopiedTextId(null), 2000);
  };

  const handleEditSave = (updatedJoint: JointNotice) => {
    // Re-calculate dates for edited taxes and update
    const updatedNotices = rawNotices.map((raw) => {
      const isEdited = raw.cliente_nif.replace(/\s+/g, '').toUpperCase() === updatedJoint.cliente_nif.replace(/\s+/g, '').toUpperCase() || 
                       raw.id === updatedJoint.id;

      const matchingEdit = updatedJoint.notices.find(n => n.id === raw.id);
      
      if (matchingEdit) {
        // Re-calculate deadlines based on edit
        const dl = calculateAEATDeadlines(matchingEdit.modelo, matchingEdit.periodo, matchingEdit.ejercicio);
        return {
          ...matchingEdit,
          fechaCargo: dl.fechaCargo.toISOString(),
          fechaLimiteDomiciliacion: dl.fechaLimiteDomiciliacion.toISOString(),
        };
      }
      return raw;
    });

    // Also add any new manual taxes that might be added inside NoticeEditor
    const existingIds = rawNotices.map(r => r.id);
    const addedTaxes = updatedJoint.notices.filter(n => !existingIds.includes(n.id)).map(matchingEdit => {
      const dl = calculateAEATDeadlines(matchingEdit.modelo, matchingEdit.periodo, matchingEdit.ejercicio);
      return {
        ...matchingEdit,
        fechaCargo: dl.fechaCargo.toISOString(),
        fechaLimiteDomiciliacion: dl.fechaLimiteDomiciliacion.toISOString(),
      };
    });

    const finalNotices = [...updatedNotices, ...addedTaxes];
    saveNoticesToLocal(finalNotices);
    setEditingJointId(null);
  };

  const handleDeleteClientGroup = (jointId: string) => {
    if (confirm("¿Está seguro de que desea eliminar todas las declaraciones de este cliente?")) {
      const updated = rawNotices.filter((n) => {
        const key = (n.cliente_nif || n.cliente_nombre || 'NIF-PENDIENTE').replace(/\s+/g, '').toUpperCase();
        return key !== jointId;
      });
      saveNoticesToLocal(updated);
    }
  };

  const handleClearAll = () => {
    if (confirm("¿Seguro que desea limpiar todas las declaraciones cargadas?")) {
      saveNoticesToLocal([]);
    }
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
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processImageFile(files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processImageFile(files[0]);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 pb-20">
      <AnimatePresence>
        {loading && <LoaderOverlay step={loadingStep} />}
      </AnimatePresence>

      {/* Header Bar */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40 shadow-xs">
        <div className="max-w-5xl mx-auto px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white shadow-md shadow-slate-900/10">
              <Clipboard className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900 tracking-tight leading-tight">
                Generador de Avisos Fiscales
              </h1>
              <p className="text-slate-500 text-[11px] font-medium">
                Confección de mensajes y recibos oficiales de impuestos
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 rounded-lg transition-all shadow-xs"
                id="btn-paste-clipboard"
              >
                <Clipboard className="w-3.5 h-3.5" />
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
                  placeholder="Ej. Maldonado Consultores"
                />
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
                            <pre className="text-xs text-slate-800 font-mono whitespace-pre-wrap leading-relaxed max-w-full overflow-x-auto">
                              {generateWhatsAppText(joint)}
                            </pre>
                            
                            <button
                              onClick={() => copyWhatsAppText(joint)}
                              className="absolute top-4 right-4 flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md shadow-xs transition-all bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
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
                          <NoticeCardCanvas 
                            notice={joint} 
                            agencyName={agencyName} 
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
                                  // Open raw image in new tab securely
                                  const win = window.open();
                                  if (win) win.document.write(`<img src="${tax.screenshotUrl}" style="max-width:100%"/>`);
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
