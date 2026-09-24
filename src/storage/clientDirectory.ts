import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { serializeStorage } from './transactions';
import type {
  ClientDirectoryFile,
  ClientRecord,
  StoredField,
  VerifiedClientInput,
} from './types';

const normalizeNif = (value: string) => value.replace(/[\s.-]+/g, '').toUpperCase();

export function sharedClientDirectoryPath(environment = process.env): string {
  const localAppData = environment.LOCALAPPDATA
    || (process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Local')
      : path.join(os.homedir(), '.local', 'share'));
  return path.join(localAppData, 'AsesoriaEMarin', 'Suite', 'clientes.json');
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, filePath);
}

/** The on-disk contract is shared with Escáner; the React API remains normalized. */
export function decodeClientDirectory(parsed: any): ClientDirectoryFile {
  if (parsed?.schemaVersion === 1 && parsed.clients) return parsed;
  if (parsed?.schema_version !== 1 || !parsed.clientes) throw new Error('Directorio de clientes incompatible.');
  const clients: Record<string, ClientRecord> = {};
  for (const [key, value] of Object.entries(parsed.clientes)) {
    const client = value as any;
    const fields: Record<string, StoredField> = {};
    const conflicts: Record<string, StoredField[]> = {};
    for (const [field, data] of Object.entries(client)) {
      if (field === 'nif' || typeof data !== 'string') continue;
      fields[field] = { value: data, source: client.metadatos?.[field]?.origen || '', updatedAt: client.metadatos?.[field]?.fecha || '' };
    }
    for (const [field, alternatives] of Object.entries(client.conflictos || {})) {
      conflicts[field] = (alternatives as string[]).map((data) => ({
        value: data,
        source: client.conflictos_metadatos?.[field]?.[data]?.origen || fields[field]?.source || '',
        updatedAt: client.conflictos_metadatos?.[field]?.[data]?.fecha || fields[field]?.updatedAt || '',
      }));
    }
    const nif = normalizeNif(client.nif || key);
    clients[nif] = { nif, fields, conflicts, shared: client };
  }
  return { schemaVersion: 1, clients, updatedAt: parsed.actualizado_en || '', shared: parsed };
}

export function encodeClientDirectory(document: ClientDirectoryFile) {
  const clientes = Object.fromEntries(Object.entries(document.clients).map(([nif, record]) => {
    const client: any = { ...record.shared, nif, metadatos: { ...(record.shared?.metadatos as object) }, conflictos: {}, conflictos_metadatos: {} };
    for (const [field, stored] of Object.entries(record.fields)) {
      client[field] = stored.value;
      client.metadatos[field] = { ...client.metadatos[field], origen: stored.source, fecha: stored.updatedAt };
    }
    for (const [field, alternatives] of Object.entries(record.conflicts)) {
      client.conflictos[field] = alternatives.map((item) => item.value);
      client.conflictos_metadatos[field] = Object.fromEntries(alternatives.map((item) => [item.value, { origen: item.source, fecha: item.updatedAt }]));
    }
    return [nif, client];
  }));
  return { ...document.shared, schema_version: 1, clientes, actualizado_en: document.updatedAt };
}

export class ClientDirectory {
  constructor(
    private readonly filePath = sharedClientDirectoryPath(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<ClientDirectoryFile> {
    try {
      return decodeClientDirectory(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { schemaVersion: 1, clients: {}, updatedAt: this.now().toISOString() };
      }
      throw error;
    }
  }

  async mergeVerified(client: VerifiedClientInput, source: string): Promise<{
    written: boolean;
    rejectedFields: string[];
    record?: ClientRecord;
  }> {
    const nif = normalizeNif(client.nif);
    const rejectedFields: string[] = [];
    const accepted = Object.entries(client.fields).filter(([field, input]) => {
      const valid = Boolean(input?.verified && input.value.trim());
      if (!valid) rejectedFields.push(field);
      return valid;
    }) as [string, { value: string; verified: boolean }][];

    if (!nif || accepted.length === 0) return { written: false, rejectedFields };

    return serializeStorage(this.filePath, async () => {
    const document = await this.load();
    const record = document.clients[nif] || { nif, fields: {}, conflicts: {} };
    const updatedAt = this.now().toISOString();
    // La bandeja se guarda muy a menudo: solo se reescribe el directorio común
    // cuando de verdad aporta algo nuevo.
    let changed = false;
    for (const [field, input] of accepted) {
      const incoming: StoredField = { value: input.value.trim(), source, updatedAt };
      const existing = record.fields[field];
      if (existing && existing.value === incoming.value) continue;
      if (existing) {
        const conflicts = record.conflicts[field] || [];
        if (!conflicts.some((candidate) => candidate.value === existing.value)) { conflicts.push(existing); changed = true; }
        if (!conflicts.some((candidate) => candidate.value === incoming.value)) { conflicts.push(incoming); changed = true; }
        record.conflicts[field] = conflicts;
        continue;
      }
      record.fields[field] = incoming;
      changed = true;
    }
    if (!changed) return { written: false, rejectedFields, record };
    document.clients[nif] = record;
    document.updatedAt = updatedAt;
    await atomicWriteJson(this.filePath, encodeClientDirectory(document));
    return { written: true, rejectedFields, record };
    });
  }
}
