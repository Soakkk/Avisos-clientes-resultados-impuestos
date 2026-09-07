import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAEATDeadlines, normalizeTaxResult } from '../src/types';

const ymd = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');

test('reconoce una domiciliación aunque llegue con codificación antigua', () => {
  assert.equal(normalizeTaxResult('303', 'Domiciliaci?n'), 'Domiciliación');
  assert.equal(normalizeTaxResult('303', 'Domiciliación'), 'Domiciliación');
});

test('calcula los plazos oficiales del modelo 303 3T 2026', () => {
  const result = calculateAEATDeadlines('303', '3T', '2026');
  assert.equal(ymd(result.fechaLimiteDomiciliacion), '2026-10-15');
  assert.equal(ymd(result.fechaCargo), '2026-10-20');
});

test('el cuarto trimestre vence en el año siguiente y aplica el calendario oficial', () => {
  const result = calculateAEATDeadlines('303', '4T', '2026');
  assert.equal(ymd(result.fechaLimiteDomiciliacion), '2027-1-27');
  assert.equal(ymd(result.fechaCargo), '2027-2-1');
});

test('para otros ejercicios conserva el cálculo automático y mueve fines de semana', () => {
  const result = calculateAEATDeadlines('303', '3T', '2028');
  assert.equal(ymd(result.fechaLimiteDomiciliacion), '2028-10-16');
  assert.equal(ymd(result.fechaCargo), '2028-10-20');
});
