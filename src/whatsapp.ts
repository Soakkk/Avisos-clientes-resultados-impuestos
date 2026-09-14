import type { JointNotice } from './types';
import { formatDateSpanish } from './types';

const SIN_PAGO = ['A compensar', 'Resultado negativo', 'Resultado cero / Sin actividad'];

const RESULTADO_CLIENTE: Record<string, string> = {
  'Resultado negativo': 'Negativa',
  'Resultado cero / Sin actividad': 'Sin actividad',
};

const nombreResultado = (tipo: string) => RESULTADO_CLIENTE[tipo] || tipo;

export interface WhatsAppTextOptions {
  agencyName?: string;
  signatureText?: string;
}

export function buildWhatsAppText(
  joint: JointNotice,
  {
    agencyName = 'Asesoría E. Marín',
    signatureText = 'Atentamente,\nAsesoría E. Marín',
  }: WhatsAppTextOptions = {},
): string {
  const isIndividual = joint.notices.length === 1;
  const firstNotice = joint.notices[0];
  const periodText = `${firstNotice?.periodo} / ${firstNotice?.ejercicio}`;
  const nadaQuePagar = joint.notices.length > 0 && joint.notices.every((t) => SIN_PAGO.includes(t.tipo_resultado));

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
    text += `• *Resultado*: *${nombreResultado(tax.tipo_resultado)}*\n`;
    
    if (isDomiciliacion) {
      if (joint.iban) {
        const maskedIban = joint.iban.replace(/\s+/g, '').replace(/^([A-Z]{2}\d{2})\d+(\d{4})$/, '$1 **** **** $2') || joint.iban;
        text += `• *Cuenta de cargo*: ${maskedIban}\n`;
      }
      text += `• *Fecha de cargo en cuenta (AEAT)*: *${chargeDateText}*\n\n`;
      text += `⚠️ *Importe Domiciliado*: Rogamos se asegure de disponer de saldo suficiente en su cuenta para el día del cargo para evitar recargos por parte de la Agencia Tributaria.\n\n`;
    } else if (tax.tipo_resultado === 'Resultado negativo') {
      const esPagoFraccionado = tax.modelo === '130' || tax.modelo === '131';
      text += `\n✅ *No tiene que pagar nada*: la declaración sale *negativa*, así que este ${esPagoFraccionado ? 'trimestre' : 'periodo'} no hay ningún ingreso que hacer.\n\n`;
      text += `Ese importe no se pierde: ${esPagoFraccionado
        ? 'se descontará en sus próximos pagos fraccionados de este mismo año.'
        : 'se descontará en sus próximas declaraciones.'}\n\n`;
    } else if (SIN_PAGO.includes(tax.tipo_resultado)) {
      text += `\n✅ *No tiene que pagar nada* este periodo.${tax.tipo_resultado === 'A compensar' ? ' El saldo a su favor se descontará automáticamente en sus próximas declaraciones.' : ''}\n\n`;
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
      text += `• *Modelo ${tax.modelo}* (${tax.modelo_nombre || 'Declaración'}): *${amtFormatted} €* (${nombreResultado(tax.tipo_resultado)})\n`;
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
    } else if (nadaQuePagar) {
      text += `\n✅ *No tiene que pagar nada* este periodo: ninguna de las declaraciones sale a ingresar.\n\n`;
      text += `Los importes a su favor se descontarán en sus próximas declaraciones.\n\n`;
    } else {
      text += `• *Fecha límite de ingreso*: *${chargeDateText}*\n\n`;
      text += `⚠️ *Aviso*: Rogamos que revise los métodos de pago de cada modelo indicados en el desglose anterior para realizar los ingresos antes del *${chargeDateText}*.\n\n`;
    }
  }

  text += `Si tiene cualquier consulta, no dude en ponerse en contacto con nosotros.\n\n`;
  text += `${signatureText}`;
  return text;
}
