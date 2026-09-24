import assert from 'node:assert/strict';
import test from 'node:test';
import { applyManualEdit, buildNoticeFromReading } from '../src/noticeFactory';
import { summarizeNotices } from '../src/summary';
import type { TaxNotice } from '../src/types';
import { validateJustificante, validateTitular } from '../src/validation';

const TODAY = new Date(2026, 9, 10, 12);
const reading = (data: Record<string, unknown>, verificacion: any = { coincide: true, discrepancias: [], modelo: 'gemini-3.7-flash' }) => ({ data, verificacion });
const complete = {
  modelo: '303', modelo_nombre: 'IVA', periodo: '3T', ejercicio: '2026', cliente_nif: '12345678Z',
  cliente_nombre: 'JOSE PEREZ GARCIA', importe: 818.55, tipo_resultado: 'Domiciliación', iban: 'ES2900811016100006298239',
};

test('lo que la IA no lee se queda vacío y el aviso pide revisión', () => {
  const notice = buildNoticeFromReading(reading({ cliente_nombre: 'JOSE PEREZ GARCIA', importe: 100 }), { today: TODAY });
  assert.equal(notice.modelo, '');
  assert.equal(notice.periodo, '');
  assert.equal(notice.ejercicio, '');
  assert.equal(notice.cliente_nif, '');
  assert.equal(notice.fechaCargo, '');
  assert.equal(notice.verificacion?.estado, 'revisar');
  const failing = notice.verificacion!.checks.filter((check) => check.status === 'error').map((check) => check.field);
  for (const field of ['modelo', 'periodo', 'ejercicio', 'plazo']) assert.ok(failing.includes(field as any), field);
});

test('una lectura completa y coincidente queda verificada con sus plazos', () => {
  const notice = buildNoticeFromReading(reading(complete), { today: TODAY });
  assert.equal(notice.verificacion?.estado, 'ok', JSON.stringify(notice.verificacion?.checks.filter((c) => c.status !== 'ok')));
  assert.equal(notice.fechaCargo.slice(0, 10), '2026-10-20');
  assert.equal(notice.fechaLimiteDomiciliacion.slice(0, 10), '2026-10-15');
});

test('un periodo que venció hace meses se marca para revisar', () => {
  const notice = buildNoticeFromReading(reading({ ...complete, periodo: '1T', ejercicio: '2025' }), { today: TODAY });
  assert.equal(notice.verificacion?.estado, 'revisar');
  assert.ok(notice.verificacion!.checks.some((check) => check.field === 'plazo' && check.status === 'warn'));
});

test('el justificante debe empezar por el número de modelo', () => {
  assert.equal(validateJustificante('3036123456789', '303')?.status, 'ok');
  assert.equal(validateJustificante('1116123456789', '115')?.status, 'error');
  assert.equal(validateJustificante('30361234', '303')?.status, 'warn');
  assert.equal(validateJustificante('', '303'), null);
});

test('un 130 con CIF o un 200 con DNI se avisan', () => {
  assert.equal(validateTitular('B12345674', '130')?.status, 'warn');
  assert.equal(validateTitular('12345678Z', '200')?.status, 'warn');
  assert.equal(validateTitular('12345678Z', '130'), null);
});

test('un IBAN distinto al de la vez anterior pide confirmación hasta revisarlo a mano', () => {
  const notice = buildNoticeFromReading(reading(complete), { today: TODAY, clienteConocido: { iban: 'ES7100302053091234567895' } });
  assert.equal(notice.verificacion?.estado, 'revisar');
  assert.match(notice.verificacion!.checks.find((check) => check.field === 'iban' && check.status === 'warn')!.message, /7895/);
  const edited = applyManualEdit(notice, TODAY);
  assert.equal(edited.verificacion?.estado, 'ok');
});

const tax = (overrides: Partial<TaxNotice>): TaxNotice => ({
  id: Math.random().toString(36), modelo: '303', modelo_nombre: 'IVA', periodo: '3T', ejercicio: '2026',
  cliente_nif: '12345678Z', cliente_nombre: 'JOSE', importe: 500, tipo_resultado: 'Domiciliación',
  fechaCargo: '2026-10-20T10:00:00.000Z', fechaLimiteDomiciliacion: '2026-10-15T10:00:00.000Z', timestamp: 1, ...overrides,
});

test('el total solo suma lo que se paga: un 130 negativo no resta del 303 domiciliado', () => {
  const summary = summarizeNotices([tax({}), tax({ modelo: '130', importe: -200, tipo_resultado: 'Resultado negativo' })]);
  assert.equal(summary.mode, 'domiciliado');
  assert.equal(summary.displayTotal, 500);
  assert.equal(summary.allPayableDomiciled, true);
});

test('una devolución junto a un pago no convierte el aviso en devolución', () => {
  const summary = summarizeNotices([tax({ tipo_resultado: 'A ingresar' }), tax({ modelo: '130', importe: -80, tipo_resultado: 'Devolución' })]);
  assert.equal(summary.mode, 'a-ingresar');
  assert.equal(summary.displayTotal, 500);
  const refund = summarizeNotices([tax({ importe: -80, tipo_resultado: 'Devolución' })]);
  assert.equal(refund.mode, 'devolucion');
  assert.equal(refund.displayTotal, 80);
});
