import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoticeCard, type CardFormat } from '../src/components/NoticeCard';
import type { JointNotice, TaxNotice } from '../src/types';
import { buildWhatsAppText } from '../src/whatsapp';

const makeTax = (overrides: Partial<TaxNotice> = {}): TaxNotice => ({
  id: 'tax-303',
  modelo: '303',
  modelo_nombre: 'Impuesto sobre el Valor Añadido',
  periodo: '2T',
  ejercicio: '2026',
  cliente_nif: 'B12345678',
  cliente_nombre: 'CLIENTE DE PRUEBA SL',
  importe: 818.55,
  tipo_resultado: 'Domiciliación',
  iban: 'ES2900811016100006298239',
  fechaCargo: '2026-07-20T12:00:00.000Z',
  fechaLimiteDomiciliacion: '2026-07-15T12:00:00.000Z',
  fechaPresentacion: '2026-07-14T12:00:00.000Z',
  timestamp: 1,
  ...overrides,
});

const makeJoint = (notices: TaxNotice[], overrides: Partial<JointNotice> = {}): JointNotice => ({
  id: 'B12345678',
  cliente_nombre: 'CLIENTE DE PRUEBA SL',
  cliente_nif: 'B12345678',
  notices,
  total_importe: notices.reduce((total, notice) => total + notice.importe, 0),
  iban: notices.find((notice) => notice.iban)?.iban,
  todosDomiciliados: notices.every((notice) => notice.tipo_resultado === 'Domiciliación'),
  ...overrides,
});

const DOMICILIACION = makeJoint([makeTax()]);
const COMPENSACION = makeJoint([
  makeTax({ importe: -120, tipo_resultado: 'A compensar', iban: undefined }),
]);
const MULTI_IMPUESTO = makeJoint([
  makeTax({ id: 'tax-303', importe: 800 }),
  makeTax({
    id: 'tax-130',
    modelo: '130',
    modelo_nombre: 'Pago fraccionado IRPF',
    importe: 100,
  }),
]);

test('domiciliación conserva el texto exacto', () => {
  assert.equal(buildWhatsAppText(DOMICILIACION), `*ASESORÍA E. MARÍN - AVISO DE LIQUIDACIÓN FISCAL*

Estimado/a *CLIENTE DE PRUEBA SL*,

Le informamos de que hemos procesado la declaración correspondiente al *Modelo 303* (Impuesto sobre el Valor Añadido) del periodo *2T / 2026*.

*Detalle de la liquidación*:
• *Impuesto*: Modelo 303
• *Importe*: *818,55 €*
• *Resultado*: *Domiciliación*
• *Cuenta de cargo*: ES29 **** **** 8239
• *Fecha de cargo en cuenta (AEAT)*: *Lunes, 20 de Julio de 2026*

⚠️ *Importe Domiciliado*: Rogamos se asegure de disponer de saldo suficiente en su cuenta para el día del cargo para evitar recargos por parte de la Agencia Tributaria.

Si tiene cualquier consulta, no dude en ponerse en contacto con nosotros.

Atentamente,
Asesoría E. Marín`);
});

test('compensación conserva el texto exacto', () => {
  assert.equal(buildWhatsAppText(COMPENSACION), `*ASESORÍA E. MARÍN - AVISO DE LIQUIDACIÓN FISCAL*

Estimado/a *CLIENTE DE PRUEBA SL*,

Le informamos de que hemos procesado la declaración correspondiente al *Modelo 303* (Impuesto sobre el Valor Añadido) del periodo *2T / 2026*.

*Detalle de la liquidación*:
• *Impuesto*: Modelo 303
• *Importe*: *-120,00 €*
• *Resultado*: *A compensar*

✅ *No tiene que pagar nada* este periodo. El saldo a su favor se descontará automáticamente en sus próximas declaraciones.

Si tiene cualquier consulta, no dude en ponerse en contacto con nosotros.

Atentamente,
Asesoría E. Marín`);
});

test('multi-impuesto conserva el texto exacto', () => {
  assert.equal(buildWhatsAppText(MULTI_IMPUESTO), `*ASESORÍA E. MARÍN - AVISO DE LIQUIDACIÓN FISCAL*

Estimado/a *CLIENTE DE PRUEBA SL*,

Le informamos de que hemos finalizado la confección y presentación de las declaraciones de su actividad correspondientes al periodo *2T / 2026*.

*Desglose de Impuestos Presentados*:
• *Modelo 303* (Impuesto sobre el Valor Añadido): *800,00 €* (Domiciliación)
• *Modelo 130* (Pago fraccionado IRPF): *100,00 €* (Domiciliación)

*RESUMEN TOTAL*:
• *TOTAL LIQUIDACIÓN*: *900,00 €*
• *Forma de pago*: *Domiciliación Bancaria*
• *Cuenta de cargo*: ES29 **** **** 8239
• *Fecha de cargo en cuenta (AEAT)*: *Lunes, 20 de Julio de 2026*

⚠️ *Aviso de Domiciliación*: Por favor, compruebe que dispone de saldo de *900,00 €* en la cuenta bancaria para el día del cobro. La Agencia Tributaria realizará el cargo automáticamente.

Si tiene cualquier consulta, no dude en ponerse en contacto con nosotros.

Atentamente,
Asesoría E. Marín`);
});

const CARD_HASHES: Record<CardFormat, string> = {
  A: '97736516a4d262666f5959ffc78a249760c72ffdfab57fff9fbb058ac0adb1d1',
  B: 'a1d49962a3b63040a43570b8ae9be65fe7274bcd44c75062b511db472e1ceb6b',
  C: '6e35d2ccad7f19f6bb3262087378d5f1e06ae9e4b47a4c9f925c57464019398b',
};

for (const format of ['A', 'B', 'C'] as CardFormat[]) {
  test(`la ficha ${format} conserva su DOM y estilos en línea`, () => {
    const markup = renderToStaticMarkup(createElement(NoticeCard, { notice: DOMICILIACION, format }));
    assert.match(markup, /width:440px/);
    assert.match(markup, /background:#FBF9F5/);
    assert.equal(createHash('sha256').update(markup).digest('hex'), CARD_HASHES[format]);
  });
}
