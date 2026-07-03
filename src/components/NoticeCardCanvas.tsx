import React, { useEffect, useRef } from 'react';
import { TaxNotice, JointNotice, formatDateSpanish } from '../types';
import { Download, Copy, Check } from 'lucide-react';

interface NoticeCardCanvasProps {
  notice: JointNotice;
  agencyName: string;
}

export const NoticeCardCanvas: React.FC<NoticeCardCanvasProps> = ({ notice, agencyName }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = React.useState(false);

  useEffect(() => {
    drawCanvas();
  }, [notice, agencyName]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use high DPI rendering (2x scale)
    const scale = 2;
    const baseWidth = 500;
    
    // Dynamic height based on number of taxes
    const taxCount = notice.notices.length;
    const baseHeight = 350 + (taxCount * 45) + (notice.iban ? 45 : 0);
    
    canvas.width = baseWidth * scale;
    canvas.height = baseHeight * scale;
    
    ctx.scale(scale, scale);
    ctx.textBaseline = 'top';

    // 1. Draw Background (Clean Soft Grey/White Card)
    ctx.fillStyle = '#FAFAF9'; // stone-50
    ctx.fillRect(0, 0, baseWidth, baseHeight);

    // Decorative clean side accent bar
    ctx.fillStyle = '#0F172A'; // slate-900
    ctx.fillRect(0, 0, baseWidth, 6);

    // Inner container shadow effect (optional clean styling)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(16, 22, baseWidth - 32, baseHeight - 44);
    
    // Draw card border
    ctx.strokeStyle = '#E7E5E4'; // stone-200
    ctx.lineWidth = 1;
    ctx.strokeRect(16, 22, baseWidth - 32, baseHeight - 44);

    // 2. Header (Advisory Name & Title)
    // Logo / Brand Marker
    ctx.fillStyle = '#0F172A'; // slate-900
    ctx.font = '600 13px system-ui, -apple-system, sans-serif';
    ctx.fillText(agencyName.toUpperCase(), 32, 40);

    ctx.fillStyle = '#78716C'; // stone-500
    ctx.font = '400 10px system-ui, -apple-system, sans-serif';
    ctx.fillText('COMUNICACIÓN OFICIAL DE LIQUIDACIÓN', 32, 58);

    // Period Badge (Right Aligned)
    const exerciseText = `${notice.notices[0]?.periodo} / ${notice.notices[0]?.ejercicio}`;
    ctx.font = '600 11px system-ui, -apple-system, sans-serif';
    const badgeWidth = ctx.measureText(exerciseText).width + 16;
    const badgeX = baseWidth - 32 - badgeWidth;
    
    ctx.fillStyle = '#F1F5F9'; // slate-100
    ctx.beginPath();
    ctx.roundRect?.(badgeX, 40, badgeWidth, 22, 4);
    ctx.fill();

    ctx.fillStyle = '#0F172A'; // slate-900
    ctx.fillText(exerciseText, badgeX + 8, 45);

    // Divider
    ctx.strokeStyle = '#E7E5E4'; // stone-200
    ctx.beginPath();
    ctx.moveTo(32, 80);
    ctx.lineTo(baseWidth - 32, 80);
    ctx.stroke();

    // 3. Client Info
    ctx.fillStyle = '#78716C'; // stone-500
    ctx.font = '500 10px system-ui, -apple-system, sans-serif';
    ctx.fillText('CLIENTE', 32, 92);

    ctx.fillStyle = '#1C1917'; // stone-900
    ctx.font = '600 13px system-ui, -apple-system, sans-serif';
    ctx.fillText(notice.cliente_nombre, 32, 106);

    ctx.fillStyle = '#78716C'; // stone-500
    ctx.font = '500 11px system-ui, -apple-system, sans-serif';
    ctx.fillText(`NIF: ${notice.cliente_nif}`, 32, 124);

    // 4. Taxes List
    ctx.fillStyle = '#F8F6F4'; // stone-100
    ctx.fillRect(32, 146, baseWidth - 64, 24);
    
    ctx.fillStyle = '#57534E'; // stone-600
    ctx.font = '600 10px system-ui, -apple-system, sans-serif';
    ctx.fillText('LIQUIDACIÓN / IMPUESTO', 40, 153);
    ctx.fillText('RESULTADO', baseWidth - 140, 153);

    let currentY = 175;
    notice.notices.forEach((tax) => {
      // Draw tax row
      ctx.fillStyle = '#1C1917'; // stone-900
      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      ctx.fillText(`Modelo ${tax.modelo}`, 40, currentY);

      ctx.fillStyle = '#78716C'; // stone-500
      ctx.font = '400 10px system-ui, -apple-system, sans-serif';
      // Truncate name if too long
      let displayName = tax.modelo_nombre || 'Declaración Tributaria';
      if (displayName.length > 30) displayName = displayName.substring(0, 27) + '...';
      ctx.fillText(displayName, 40, currentY + 14);

      // Amount & payment type
      ctx.fillStyle = '#1C1917'; // stone-900
      ctx.font = '700 12px system-ui, -apple-system, sans-serif';
      const amtText = `${tax.importe.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
      ctx.fillText(amtText, baseWidth - 140, currentY);

      ctx.fillStyle = tax.tipo_resultado === 'Domiciliación' ? '#059669' : '#D97706'; // green or amber
      ctx.font = '500 9px system-ui, -apple-system, sans-serif';
      ctx.fillText(tax.tipo_resultado.toUpperCase(), baseWidth - 140, currentY + 14);

      // Simple light separator
      ctx.strokeStyle = '#F5F5F4'; // stone-100
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(32, currentY + 32);
      ctx.lineTo(baseWidth - 32, currentY + 32);
      ctx.stroke();

      currentY += 40;
    });

    currentY += 10;

    // 5. Total Highlight Box
    ctx.fillStyle = '#1E293B'; // slate-800
    ctx.beginPath();
    ctx.roundRect?.(32, currentY, baseWidth - 64, 48, 6);
    ctx.fill();

    ctx.fillStyle = '#94A3B8'; // slate-400
    ctx.font = '600 10px system-ui, -apple-system, sans-serif';
    ctx.fillText('TOTAL A LIQUIDAR', 44, currentY + 12);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 17px system-ui, -apple-system, sans-serif';
    const totalFormatted = `${notice.total_importe.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    const formattedWidth = ctx.measureText(totalFormatted).width;
    ctx.fillText(totalFormatted, 44, currentY + 24);

    // Notice info block (Domiciliación or manual)
    const labelResult = notice.todosDomiciliados ? 'DOMICILIADO' : 'A PAGAR';
    ctx.fillStyle = notice.todosDomiciliados ? '#34D399' : '#FBBF24'; // light green or amber
    ctx.font = '700 10px system-ui, -apple-system, sans-serif';
    ctx.fillText(labelResult, baseWidth - 32 - 12 - ctx.measureText(labelResult).width, currentY + 18);

    currentY += 64;

    // 6. Direct Debit details if applicable
    if (notice.iban) {
      ctx.fillStyle = '#78716C'; // stone-500
      ctx.font = '500 10px system-ui, -apple-system, sans-serif';
      ctx.fillText('CUENTA CARGO (IBAN)', 32, currentY);

      ctx.fillStyle = '#44403C'; // stone-700
      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      // Mask IBAN for security while keeping start/end
      const maskedIban = notice.iban.replace(/\s+/g, '').replace(/^([A-Z]{2}\d{2})\d+(\d{4})$/, '$1 **** **** $2') || notice.iban;
      ctx.fillText(maskedIban, 32, currentY + 14);

      currentY += 40;
    }

    // 7. AEAT Charge Date Warning
    ctx.fillStyle = '#FFFBEB'; // amber-50 background for alert box
    ctx.beginPath();
    ctx.roundRect?.(32, currentY, baseWidth - 64, 45, 4);
    ctx.fill();
    ctx.strokeStyle = '#FDE68A'; // amber-200
    ctx.strokeRect(32, currentY, baseWidth - 64, 45);

    ctx.fillStyle = '#D97706'; // amber-600
    ctx.font = '700 9px system-ui, -apple-system, sans-serif';
    ctx.fillText('📅 FECHA DE CARGO EN CUENTA (AEAT)', 42, currentY + 8);

    ctx.fillStyle = '#1C1917'; // stone-900
    ctx.font = '500 10px system-ui, -apple-system, sans-serif';
    // Get the earliest charge date from notices
    let chargeDateText = 'Confirmada por la AEAT';
    if (notice.notices.length > 0) {
      const dates = notice.notices.map(n => new Date(n.fechaCargo));
      // Sort dates
      dates.sort((a,b) => a.getTime() - b.getTime());
      chargeDateText = formatDateSpanish(dates[0]);
    }
    
    ctx.fillText(chargeDateText, 42, currentY + 22);
  };

  const downloadPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `Aviso_Impuestos_${notice.cliente_nombre.replace(/\s+/g, '_')}.png`;
    link.href = url;
    link.click();
  };

  const copyToClipboard = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'image/png': blob
            })
          ]);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (err) {
          console.error('Error copying to clipboard', err);
          // Fallback
          downloadPNG();
        }
      }, 'image/png');
    } catch (err) {
      console.error('Blob generation or clipboard API failed', err);
    }
  };

  return (
    <div className="flex flex-col items-center p-4 bg-stone-100 rounded-xl border border-stone-200 max-w-full">
      <div className="overflow-auto max-w-full shadow-lg rounded-lg border border-stone-300">
        <canvas 
          ref={canvasRef} 
          style={{ width: '100%', maxWidth: '500px', display: 'block' }}
          className="bg-white"
        />
      </div>
      
      <div className="flex gap-3 mt-4 w-full justify-center">
        <button
          onClick={copyToClipboard}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
          id={`btn-copy-img-${notice.cliente_nif}`}
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-500" />
              <span>¡Copiada!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copiar Imagen</span>
            </>
          )}
        </button>

        <button
          onClick={downloadPNG}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-white bg-slate-800 hover:bg-slate-900 transition-colors"
          id={`btn-dl-img-${notice.cliente_nif}`}
        >
          <Download className="w-3.5 h-3.5" />
          <span>Descargar PNG</span>
        </button>
      </div>
    </div>
  );
};
