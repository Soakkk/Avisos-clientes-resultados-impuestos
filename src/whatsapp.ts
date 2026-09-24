import type { JointNotice } from './types';
import { formatDateSpanish } from './types';
import { clientResultLabel, summarizeJoint } from './summary';

/**
 * Texto de WhatsApp a partir de plantillas editables. Cada situación tiene su
 * plantilla; las variables van entre llaves ({cliente}, {importe}...). Si una
 * línea lleva {cuenta} o {fecha_domiciliacion} y no hay dato, la línea entera
 * desaparece, para no dejar "Cuenta de cargo: " a medias.
 */

export type TemplateId =
  | 'uno-domiciliado'
  | 'uno-a-ingresar'
  | 'uno-devolucion'
  | 'uno-negativo'
  | 'uno-sin-pago'
  | 'varios-domiciliado'
  | 'varios-a-ingresar'
  | 'varios-devolucion'
  | 'varios-sin-pago';

export type MessageTemplates = Record<TemplateId, string>;

const HEADER = '*{ASESORIA} - AVISO DE LIQUIDACIÓN FISCAL*\n\nEstimado/a *{cliente}*,\n\n';
const FOOTER = 'Si tiene cualquier consulta, no dude en ponerse en contacto con nosotros.\n\n{firma}';
const INTRO_UNO = 'Le informamos de que hemos procesado la declaración correspondiente al *Modelo {modelo}* ({impuesto}) del periodo *{periodo}*.\n\n';
const DETALLE_UNO = '*Detalle de la liquidación*:\n• *Impuesto*: Modelo {modelo}\n• *Importe*: *{importe}*\n• *Resultado*: *{resultado}*\n';
const INTRO_VARIOS = 'Le informamos de que hemos finalizado la confección y presentación de las declaraciones de su actividad correspondientes al periodo *{periodo}*.\n\n*Desglose de Impuestos Presentados*:\n{desglose}\n';

export const DEFAULT_TEMPLATES: MessageTemplates = {
  'uno-domiciliado': HEADER + INTRO_UNO + DETALLE_UNO +
    '• *Cuenta de cargo*: {cuenta}\n• *Fecha de cargo en cuenta (AEAT)*: *{fecha_cargo}*\n\n' +
    '⚠️ *Importe Domiciliado*: Rogamos se asegure de disponer de saldo suficiente en su cuenta para el día del cargo para evitar recargos por parte de la Agencia Tributaria.\n\n' + FOOTER,
  'uno-a-ingresar': HEADER + INTRO_UNO + DETALLE_UNO +
    '• *Fecha límite de ingreso*: *{fecha_cargo}*\n\n' +
    '⚠️ *Atención*: Al no estar domiciliado, recuerde realizar el pago correspondiente antes de la fecha límite señalada para evitar incidencias con la AEAT.\n\n' + FOOTER,
  'uno-devolucion': HEADER + INTRO_UNO + DETALLE_UNO +
    '• *Cuenta de abono*: {cuenta}\n\n' +
    '✅ *No tiene que pagar nada*: la Agencia Tributaria le ingresará *{total}* en la cuenta indicada cuando resuelva la devolución.\n\n' + FOOTER,
  'uno-negativo': HEADER + INTRO_UNO + DETALLE_UNO +
    '\n✅ *No tiene que pagar nada*: la declaración sale *negativa*, así que este {unidad} no hay ningún ingreso que hacer.\n\n' +
    'Ese importe no se pierde: {se_descontara}\n\n' + FOOTER,
  'uno-sin-pago': HEADER + INTRO_UNO + DETALLE_UNO +
    '\n✅ *No tiene que pagar nada* este periodo.{nota_compensar}\n\n' + FOOTER,
  'varios-domiciliado': HEADER + INTRO_VARIOS + '\n*RESUMEN TOTAL*:\n' +
    '• *TOTAL LIQUIDACIÓN*: *{total}*\n• *Forma de pago*: *Domiciliación Bancaria*\n• *Cuenta de cargo*: {cuenta}\n• *Fecha de cargo en cuenta (AEAT)*: *{fecha_cargo}*\n\n' +
    '⚠️ *Aviso de Domiciliación*: Por favor, compruebe que dispone de saldo de *{total}* en la cuenta bancaria para el día del cobro. La Agencia Tributaria realizará el cargo automáticamente.\n\n' + FOOTER,
  'varios-a-ingresar': HEADER + INTRO_VARIOS + '\n*RESUMEN TOTAL*:\n' +
    '• *TOTAL A PAGAR*: *{total}*\n• *Fecha límite de ingreso*: *{fecha_cargo}*\n\n' +
    '⚠️ *Aviso*: Rogamos que revise los métodos de pago de cada modelo indicados en el desglose anterior para realizar los ingresos antes del *{fecha_cargo}*.\n\n' + FOOTER,
  'varios-devolucion': HEADER + INTRO_VARIOS + '\n*RESUMEN TOTAL*:\n' +
    '• *TOTAL A DEVOLVER*: *{total}*\n• *Cuenta de abono*: {cuenta}\n\n' +
    '✅ *No tiene que pagar nada*: la Agencia Tributaria le ingresará la devolución en la cuenta indicada.\n\n' + FOOTER,
  'varios-sin-pago': HEADER + INTRO_VARIOS +
    '\n✅ *No tiene que pagar nada* este periodo: ninguna de las declaraciones sale a ingresar.\n\n' +
    'Los importes a su favor se descontarán en sus próximas declaraciones.\n\n' + FOOTER,
};

export const TEMPLATE_IDS = Object.keys(DEFAULT_TEMPLATES) as TemplateId[];

export const TEMPLATE_LABELS: Record<TemplateId, string> = {
  'uno-domiciliado': 'Un impuesto · domiciliado',
  'uno-a-ingresar': 'Un impuesto · a ingresar',
  'uno-devolucion': 'Un impuesto · devolución',
  'uno-negativo': 'Un impuesto · resultado negativo (130/131)',
  'uno-sin-pago': 'Un impuesto · a compensar o sin actividad',
  'varios-domiciliado': 'Varios impuestos · domiciliados',
  'varios-a-ingresar': 'Varios impuestos · a ingresar',
  'varios-devolucion': 'Varios impuestos · devolución',
  'varios-sin-pago': 'Varios impuestos · nada que pagar',
};

export const TEMPLATE_VARIABLES: { name: string; description: string }[] = [
  { name: 'cliente', description: 'Nombre del cliente' },
  { name: 'nif', description: 'NIF del cliente' },
  { name: 'periodo', description: 'Periodo y ejercicio (2T / 2026)' },
  { name: 'modelo', description: 'Número de modelo' },
  { name: 'impuesto', description: 'Nombre del impuesto' },
  { name: 'importe', description: 'Importe del impuesto' },
  { name: 'resultado', description: 'Resultado (Domiciliación, Negativa…)' },
  { name: 'desglose', description: 'Lista de impuestos (varios)' },
  { name: 'total', description: 'Total a pagar o a devolver' },
  { name: 'cuenta', description: 'IBAN enmascarado' },
  { name: 'fecha_cargo', description: 'Fin del plazo = día del cargo' },
  { name: 'fecha_domiciliacion', description: 'Último día para domiciliar' },
  { name: 'asesoria', description: 'Nombre de la asesoría' },
  { name: 'ASESORIA', description: 'Asesoría en mayúsculas' },
  { name: 'firma', description: 'Firma configurada' },
];

/** Variables que, si están vacías, hacen desaparecer su línea entera. */
const LINE_VARIABLES = new Set(['cuenta', 'fecha_domiciliacion', 'nif']);

export interface WhatsAppTextOptions {
  agencyName?: string;
  signatureText?: string;
  templates?: Partial<MessageTemplates>;
}

const money = (value: number) => `${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export const maskIban = (iban?: string) => {
  if (!iban) return '';
  const clean = iban.replace(/\s+/g, '');
  return clean.replace(/^([A-Z]{2}\d{2})\d+(\d{4})$/, '$1 **** **** $2') || iban;
};

export function selectTemplate(joint: Pick<JointNotice, 'notices'>): TemplateId {
  if (joint.notices.length === 1) {
    const tipo = joint.notices[0].tipo_resultado;
    if (tipo === 'Domiciliación') return 'uno-domiciliado';
    if (tipo === 'Devolución') return 'uno-devolucion';
    if (tipo === 'Resultado negativo') return 'uno-negativo';
    if (tipo === 'A compensar' || tipo === 'Resultado cero / Sin actividad') return 'uno-sin-pago';
    return 'uno-a-ingresar';
  }
  const { mode } = summarizeJoint(joint);
  if (mode === 'domiciliado') return 'varios-domiciliado';
  if (mode === 'a-ingresar') return 'varios-a-ingresar';
  if (mode === 'devolucion') return 'varios-devolucion';
  return 'varios-sin-pago';
}

/** Sustituye las variables y elimina las líneas que se han quedado sin dato. */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  const lines = template.split('\n').flatMap((line) => {
    const names = Array.from(line.matchAll(/\{([A-Za-z_]+)\}/g), (match) => match[1]);
    if (names.some((name) => LINE_VARIABLES.has(name) && !variables[name])) return [];
    return [line.replace(/\{([A-Za-z_]+)\}/g, (whole, name: string) => (name in variables ? variables[name] : whole))];
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function buildWhatsAppText(
  joint: JointNotice,
  {
    agencyName = 'Asesoría E. Marín',
    signatureText = 'Atentamente,\nAsesoría E. Marín',
    templates = {},
  }: WhatsAppTextOptions = {},
): string {
  const summary = summarizeJoint(joint);
  const first = joint.notices[0];
  const templateId = selectTemplate(joint);
  const custom = templates[templateId];
  const template = custom && custom.trim() ? custom : DEFAULT_TEMPLATES[templateId];
  const pagoFraccionado = first?.modelo === '130' || first?.modelo === '131';
  const refundAccount = templateId === 'uno-devolucion' || templateId === 'varios-devolucion';
  const account = (refundAccount ? summary.refunds : summary.payable).find((notice) => notice.iban)?.iban || joint.iban;

  const variables: Record<string, string> = {
    asesoria: agencyName,
    ASESORIA: agencyName.toUpperCase(),
    cliente: joint.cliente_nombre,
    nif: joint.cliente_nif,
    periodo: summary.periods.map((item) => `${item.periodo} / ${item.ejercicio}`).join(', '),
    modelo: first?.modelo || '',
    impuesto: first?.modelo_nombre || 'Liquidación',
    importe: first ? money(first.importe) : '',
    resultado: first ? clientResultLabel(first.tipo_resultado) : '',
    desglose: joint.notices
      .map((tax) => `• *Modelo ${tax.modelo}* (${tax.modelo_nombre || 'Declaración'}): *${money(tax.importe)}* (${clientResultLabel(tax.tipo_resultado)})`)
      .join('\n'),
    total: money(summary.displayTotal),
    cuenta: maskIban(account),
    fecha_cargo: summary.dueDate ? formatDateSpanish(summary.dueDate) : 'la establecida por la AEAT',
    fecha_domiciliacion: summary.domiciliationDeadline ? formatDateSpanish(summary.domiciliationDeadline) : '',
    firma: signatureText,
    unidad: pagoFraccionado ? 'trimestre' : 'periodo',
    se_descontara: pagoFraccionado
      ? 'se descontará en sus próximos pagos fraccionados de este mismo año.'
      : 'se descontará en sus próximas declaraciones.',
    nota_compensar: first?.tipo_resultado === 'A compensar'
      ? ' El saldo a su favor se descontará automáticamente en sus próximas declaraciones.'
      : '',
  };
  return renderTemplate(template, variables);
}
