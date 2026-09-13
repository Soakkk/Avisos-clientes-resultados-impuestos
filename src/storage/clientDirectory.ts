import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, filePath);
}

export class ClientDirectory {
  constructor(
    private readonly filePath = sharedClientDirectoryPath(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<ClientDirectoryFile> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as ClientDirectoryFile;
      if (parsed.schemaVersion !== 1 || !parsed.clients) throw new Error('Directorio de clientes incompatible.');
      return parsed;
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

    const document = await this.load();
    const record = document.clients[nif] || { nif, fields: {}, conflicts: {} };
    const updatedAt = this.now().toISOString();
    for (const [field, input] of accepted) {
      const incoming: StoredField = { value: input.value.trim(), source, updatedAt };
      const existing = record.fields[field];
      if (existing && existing.value !== incoming.value) {
        const conflicts = record.conflicts[field] || [];
        if (!conflicts.some((candidate) => candidate.value === existing.value)) conflicts.push(existing);
        record.conflicts[field] = conflicts;
      }
      record.fields[field] = incoming;
    }
    document.clients[nif] = record;
    document.updatedAt = updatedAt;
    await atomicWriteJson(this.filePath, document);
    return { written: true, rejectedFields, record };
  }
}
