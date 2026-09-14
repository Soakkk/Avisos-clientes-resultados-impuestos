/** Validate the entire import without normalizing fiscal values or touching disk. */
type RecordValue = Record<string, unknown>;
type Validator = (value: unknown, location: string) => void;

function requireValid(valid: boolean, location: string): asserts valid {
  if (!valid) throw new Error(`Copia de seguridad incompatible: ${location}.`);
}

function record(value: unknown, location: string): RecordValue {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), location);
  return value as RecordValue;
}

const string: Validator = (v, p) => requireValid(typeof v === 'string', p);
const number: Validator = (v, p) => requireValid(typeof v === 'number' && Number.isFinite(v), p);
const boolean: Validator = (v, p) => requireValid(typeof v === 'boolean', p);
const enumeration = (...values: string[]): Validator => (v, p) => requireValid(typeof v === 'string' && values.includes(v), p);
const array = (check: Validator): Validator => (value, location) => {
  requireValid(Array.isArray(value), location);
  value.forEach((item, i) => check(item, `${location}[${i}]`));
};
const dictionary = (check: Validator): Validator => (v, p) => {
  for (const [key, value] of Object.entries(record(v, p))) check(value, `${p}.${key}`);
};
function fields(value: RecordValue, location: string, required: Record<string, Validator>, optional: Record<string, Validator> = {}) {
  for (const [key, check] of Object.entries(required)) check(value[key], `${location}.${key}`);
  for (const [key, check] of Object.entries(optional)) if (value[key] !== undefined) check(value[key], `${location}.${key}`);
}

const verification: Validator = (v, p) => fields(record(v, p), p, {
  estado: enumeration('ok', 'revisar', 'sin-verificar'),
  checks: array((item, at) => fields(record(item, at), at, {
    field: enumeration('iban', 'cliente_nif', 'importe', 'periodo', 'modelo', 'cliente_nombre', 'ejercicio', 'tipo_resultado'),
    status: enumeration('ok', 'warn', 'error'), message: string,
  })),
  discrepanciasIA: array((item, at) => fields(record(item, at), at, { campo: string, primera: string, segunda: string })),
  segundaLecturaHecha: boolean,
});

const taxNotice: Validator = (v, p) => fields(record(v, p), p, {
  id: string, modelo: string, modelo_nombre: string, periodo: string, ejercicio: string,
  cliente_nif: string, cliente_nombre: string, importe: number,
  // Old result labels are accepted verbatim; the existing renderer owns their normalization.
  tipo_resultado: string, fechaCargo: string, fechaLimiteDomiciliacion: string, timestamp: number,
}, {
  iban: string, screenshotUrl: string, screenshotId: string, fechaPresentacion: string,
  notaAsesoria: string, mostrarNotaAsesoria: boolean, verificacion: verification,
});

const jointNotice: Validator = (v, p) => fields(record(v, p), p, {
  id: string, cliente_nombre: string, cliente_nif: string, notices: array(taxNotice),
  total_importe: number, todosDomiciliados: boolean,
}, { iban: string, notaAsesoria: string, mostrarNotaAsesoria: boolean });

const state: Validator = (v, p) => {
  const value = record(v, p);
  requireValid(value.schemaVersion === 1, `${p}.schemaVersion`);
  fields(value, p, {
    queue: array((item, at) => fields(record(item, at), at, {
      id: string, fileId: string, status: enumeration('pending', 'processing', 'review', 'failed'),
      attempts: (n, location) => requireValid(typeof n === 'number' && Number.isSafeInteger(n) && n >= 0, location),
    }, { error: string, createdAt: string, jointId: string })),
    activeNotices: array(taxNotice),
    archivedNotices: array((item, at) => fields(record(item, at), at, {
      id: string, archivedAt: string, cliente_nombre: string, cliente_nif: string,
      models: array(string), periods: array(string), noticeIds: array(string), snapshot: jointNotice,
    }, { captureIds: array(string) })),
    groupingOverrides: array((item, at) => fields(record(item, at), at, {
      id: string, kind: enumeration('merge', 'split'), noticeIds: array(string), groupId: string, createdAt: string,
    }, { assignments: dictionary(string) })),
    updatedAt: string,
  }, {
    selectedJointId: (id, at) => { if (id !== null) string(id, at); },
    draft: (draft, at) => { if (draft !== null) fields(record(draft, at), at, { jointId: string, clientName: string, clientNif: string, taxes: array(taxNotice) }); },
  });
};

const storedField: Validator = (v, p) => fields(record(v, p), p, { value: string, source: string, updatedAt: string });
const metadata: Validator = (v, p) => fields(record(v, p), p, {}, { origen: string, fecha: string });
const object: Validator = (v, p) => { record(v, p); };

function clients(v: unknown, p: string) {
  if (v === null) return;
  const value = record(v, p);
  const internal = value.schemaVersion === 1;
  requireValid(internal || value.schema_version === 1, `${p}.schemaVersion`);
  const entries = record(internal ? value.clients : value.clientes, `${p}.clientes`);
  fields(value, p, {}, internal ? { updatedAt: string, shared: object } : { actualizado_en: string });
  const identities = new Set<string>();
  for (const [key, raw] of Object.entries(entries)) {
    const at = `${p}.clientes.${key}`;
    const client = record(raw, at);
    if (internal) fields(client, at, { nif: string, fields: dictionary(storedField), conflicts: dictionary(array(storedField)) }, { shared: object });
    else fields(client, at, {}, {
      nif: string, nombre: string, iban: string, carpeta: string,
      metadatos: dictionary(metadata), conflictos: dictionary(array(string)), conflictos_metadatos: dictionary(dictionary(metadata)),
    });
    const nif = ((client.nif || key) as string).replace(/[\s.-]+/g, '').toUpperCase();
    requireValid(nif.length > 0 && !identities.has(nif), `${at}.nif duplicado o vacío`);
    requireValid(!internal || key.replace(/[\s.-]+/g, '').toUpperCase() === nif, `${at}.nif`);
    identities.add(nif);
  }
}

// Unknown shared metadata must remain JSON, not cyclic objects or prototype setters.
function json(value: unknown, location: string, ancestors = new Set<object>()): void {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { number(value, location); return; }
  requireValid(typeof value === 'object' && !ancestors.has(value) && ancestors.size < 100, location);
  ancestors.add(value);
  if (Array.isArray(value)) value.forEach((item, i) => json(item, `${location}[${i}]`, ancestors));
  else for (const [key, item] of Object.entries(record(value, location))) {
    requireValid(!['__proto__', 'prototype', 'constructor'].includes(key), `${location}.${key}`);
    json(item, `${location}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

export function validateBackup(value: unknown): void {
  json(value, 'copia');
  const backup = record(value, 'copia');
  const manifest = record(backup.manifest, 'manifest');
  requireValid(manifest.product === 'avisos-fiscales' && manifest.schemaVersion === 1, 'manifest');
  string(manifest.exportedAt, 'manifest.exportedAt');
  state(backup.state, 'state');
  clients(backup.clients, 'clients');
  const captures = record(backup.captures, 'captures');
  for (const [id, contents] of Object.entries(captures)) {
    requireValid(/^[a-z0-9-]+$/.test(id) && typeof contents === 'string' && contents.length > 0
      && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contents)
      && Buffer.from(contents, 'base64').toString('base64') === contents, `captures.${id}`);
  }
  const reference: Validator = (id, at) => requireValid(typeof id === 'string' && Object.hasOwn(captures, id), `${at}: captura ausente`);
  const references = (v: unknown, at: string): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((item, i) => references(item, `${at}[${i}]`)); return; }
    for (const [key, child] of Object.entries(v)) {
      if (child === undefined) continue;
      if (key === 'fileId' || key === 'screenshotId') reference(child, `${at}.${key}`);
      else if (key === 'captureIds') array(reference)(child, `${at}.${key}`);
      else references(child, `${at}.${key}`);
    }
  };
  references(backup.state, 'state');
}
