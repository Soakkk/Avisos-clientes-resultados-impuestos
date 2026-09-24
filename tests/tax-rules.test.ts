import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTaxResult, withDeadlines, formatDateSpanish } from '../src/types';
import { OFFICIAL_DEADLINES, easterSunday, getAeatDeadlines, nationalHolidays } from '../src/aeatCalendar';

const ymd = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');

test('reconoce una domiciliación aunque llegue con codificación antigua', () => {
  assert.equal(normalizeTaxResult('303', 'Domiciliaci?n'), 'Domiciliación');
  assert.equal(normalizeTaxResult('303', 'Domiciliación'), 'Domiciliación');
});


const iso = (date: Date | null | undefined) => date
  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  : null;
const plazo = (modelo: string, periodo: string, ejercicio: string) => {
  const result = getAeatDeadlines(modelo, periodo, ejercicio);
  return result ? [iso(result.finPlazo), iso(result.finDomiciliacion)] : null;
};

/** Aplica solo la regla general, sin la tabla oficial, para comprobar que la reproduce. */
const byRule = (modelo: string, periodo: string, ejercicio: string) => {
  const saved = { ...OFFICIAL_DEADLINES };
  for (const key of Object.keys(OFFICIAL_DEADLINES)) delete OFFICIAL_DEADLINES[key];
  try { return plazo(modelo, periodo, ejercicio); } finally { Object.assign(OFFICIAL_DEADLINES, saved); }
};

test('el 4T del 303 y 130 se carga el 30 de enero; el de 111 y 115 el 20', () => {
  assert.deepEqual(plazo('303', '4T', '2025'), ['2026-01-30', '2026-01-27']);
  assert.deepEqual(plazo('130', '4T', '2025'), ['2026-01-30', '2026-01-27']);
  assert.deepEqual(plazo('111', '4T', '2025'), ['2026-01-20', '2026-01-15']);
  assert.deepEqual(plazo('115', '4T', '2025'), ['2026-01-20', '2026-01-15']);
});

test('el 30 de enero de 2027 cae en sábado y el plazo pasa al lunes 1 de febrero', () => {
  const result = getAeatDeadlines('303', '4T', '2026')!;
  assert.equal(iso(result.finPlazo), '2027-02-01');
  assert.equal(iso(result.finDomiciliacion), '2027-01-27');
  assert.match(result.traslado || '', /sábado/);
});

test('la regla general reproduce el calendario oficial de 2025 y 2026', () => {
  const cases: [string, string, string, string, string | null][] = [
    ['303', '4T', '2025', '2026-01-30', '2026-01-27'],
    ['111', '4T', '2025', '2026-01-20', '2026-01-15'],
    ['303', '1T', '2026', '2026-04-20', '2026-04-15'],
    ['303', '2T', '2026', '2026-07-20', '2026-07-15'],
    ['130', '3T', '2026', '2026-10-20', '2026-10-15'],
    ['202', '3P', '2026', '2026-12-21', '2026-12-15'],
    ['202', '3P', '2025', '2025-12-22', '2025-12-15'],
    ['303', '2T', '2025', '2025-07-21', '2025-07-15'],
    ['190', '0A', '2025', '2026-02-02', null],
    ['347', '0A', '2025', '2026-03-02', null],
    ['200', '0A', '2025', '2026-07-27', '2026-07-22'],
    ['100', '0A', '2025', '2026-06-30', '2026-06-25'],
  ];
  for (const [modelo, periodo, ejercicio, fin, dom] of cases) {
    const result = byRule(modelo, periodo, ejercicio)!;
    assert.equal(result[0], fin, `${modelo} ${periodo} ${ejercicio}: fin del plazo`);
    // Criterio prudente: la domiciliación calculada nunca es posterior a la oficial.
    assert.ok(dom === null ? result[1] === null : result[1]! <= dom, `${modelo} ${periodo} ${ejercicio}: domiciliación ${result[1]} > ${dom}`);
  }
});

test('las fechas publicadas por la AEAT prevalecen sobre la regla', () => {
  assert.deepEqual(plazo('303', '1T', '2025'), ['2025-04-21', '2025-04-15']);
  assert.deepEqual(plazo('130', '2T', '2025'), ['2025-07-21', '2025-07-16']);
  assert.deepEqual(plazo('202', '3P', '2025'), ['2025-12-22', '2025-12-17']);
  assert.equal(getAeatDeadlines('303', '1T', '2025')!.origen, 'oficial');
});

test('el 202 y los modelos anuales ya no caen en el 20 de abril', () => {
  assert.deepEqual(plazo('202', '1P', '2027'), ['2027-04-20', '2027-04-15']);
  assert.deepEqual(plazo('202', '2P', '2027'), ['2027-10-20', '2027-10-15']);
  assert.deepEqual(plazo('390', '0A', '2026'), ['2027-02-01', null]);
  // 25 de julio de 2027 es domingo: el plazo pasa al 26 y la domiciliación se adelanta
  // al 21 para respetar el margen mínimo de la Orden HAC/241/2025.
  assert.deepEqual(plazo('200', '0A', '2026'), ['2027-07-26', '2027-07-21']);
});

test('los modelos mensuales usan el día 20, o el 30 en el IVA mensual', () => {
  assert.deepEqual(plazo('111', '07', '2027'), ['2027-08-20', '2027-08-13']);
  assert.deepEqual(plazo('111', '12', '2027'), ['2028-01-20', '2028-01-14']);
  assert.equal(plazo('303', '01', '2027')![0], '2027-03-01');
  assert.equal(plazo('303', '12', '2027')![0], '2028-01-31');
});

test('un festivo nacional desplaza el plazo y la domiciliación nunca se retrasa', () => {
  assert.equal(iso(easterSunday(2026)), '2026-04-05');
  assert.ok(nationalHolidays(2026).has('2026-04-03'));
  // 20 de abril de 2029 no es festivo; 15 de octubre de 2028 es domingo: se adelanta al viernes 13.
  assert.deepEqual(plazo('303', '3T', '2028'), ['2028-10-20', '2028-10-13']);
});

test('sin periodo o ejercicio legibles no se inventa ninguna fecha', () => {
  assert.equal(getAeatDeadlines('303', '', '2026'), null);
  assert.equal(getAeatDeadlines('303', '3T', ''), null);
  assert.equal(getAeatDeadlines('', '3T', '2026'), null);
  assert.equal(getAeatDeadlines('999', '0A', '2026'), null);
  const notice = withDeadlines({ modelo: '303', periodo: '', ejercicio: '2026' });
  assert.equal(notice.fechaCargo, '');
});

test('las fechas se escriben con el mes en minúscula', () => {
  assert.equal(formatDateSpanish(new Date(2026, 3, 20, 12)), 'Lunes, 20 de abril de 2026');
});
