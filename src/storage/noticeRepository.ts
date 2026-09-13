import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decodeClientDirectory, encodeClientDirectory, sharedClientDirectoryPath } from './clientDirectory';
import { serializeStorage } from './transactions';
import type {
  ArchivedNotice,
  ClientDirectoryFile,
  NoticeBackup,
  NoticeSearchFilters,
  NoticeState,
} from './types';

const normalizeSearch = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, ' ')
  .trim()
  .toUpperCase();

const defaultState = (): NoticeState => ({
  schemaVersion: 1,
  queue: [],
  activeNotices: [],
  archivedNotices: [],
  groupingOverrides: [],
  updatedAt: new Date().toISOString(),
});

export function defaultNoticeStoragePath(): string {
  return path.join(os.homedir(), '.generador-avisos-fiscales', 'workspace');
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  return atomicWrite(filePath, Buffer.from(JSON.stringify(value, null, 2)));
}

async function atomicWrite(filePath: string, contents: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx');
    try { await file.writeFile(contents); await file.sync(); } finally { await file.close(); }
    await rename(temporary, filePath);
  } finally { await unlink(temporary).catch(() => {}); }
}

export class NoticeRepository {
  private readonly stateFile: string;
  private readonly capturesDirectory: string;
  private readonly importJournal: string;

  constructor(
    private readonly root = defaultNoticeStoragePath(),
    private readonly clientsFile = sharedClientDirectoryPath(),
  ) {
    this.stateFile = path.join(root, 'notices.json');
    this.capturesDirectory = path.join(root, 'capturas');
    this.importJournal = path.join(root, 'pending-import.json');
  }

  async loadQueue(): Promise<NoticeState> {
    return serializeStorage(this.stateFile, async () => { await this.recoverImport(); return this.readState(); });
  }

  private async readClients(): Promise<unknown | null> {
    try { return JSON.parse(await readFile(this.clientsFile, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }

  private async restoreImport(before: { state: NoticeState; clients: unknown | null }): Promise<void> {
    if (before.state?.schemaVersion !== 1) throw new Error('Recuperación de importación incompatible.');
    if (before.clients !== null) await atomicWriteJson(this.clientsFile, before.clients);
    else await unlink(this.clientsFile).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await atomicWriteJson(this.stateFile, before.state);
    await unlink(this.importJournal);
  }

  private async recoverImport(): Promise<void> {
    let before;
    try { before = JSON.parse(await readFile(this.importJournal, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    await serializeStorage(this.clientsFile, () => this.restoreImport(before));
  }

  private async readState(): Promise<NoticeState> {
    try {
      const parsed = JSON.parse(await readFile(this.stateFile, 'utf8')) as NoticeState;
      if (parsed.schemaVersion !== 1) throw new Error('Estado de avisos incompatible.');
      return parsed;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultState();
      throw error;
    }
  }

  async saveQueue(state: NoticeState): Promise<void> {
    if (state.schemaVersion !== 1) throw new Error('Estado de avisos incompatible.');
    const snapshot = structuredClone(state);
    await serializeStorage(this.stateFile, async () => { await this.recoverImport(); await atomicWriteJson(this.stateFile, snapshot); });
  }

  async archive(notice: ArchivedNotice): Promise<NoticeState> {
    return serializeStorage(this.stateFile, async () => {
      await this.recoverImport();
      const state = await this.readState();
      if (!state.archivedNotices.some((item) => item.id === notice.id)) {
        state.archivedNotices.push(notice);
        await atomicWriteJson(this.stateFile, state);
      }
      return state;
    });
  }

  async search(filters: NoticeSearchFilters): Promise<ArchivedNotice[]> {
    const state = await this.loadQueue();
    const query = normalizeSearch(filters.query || '');
    const model = normalizeSearch(filters.model || '');
    const period = normalizeSearch(filters.period || '');
    const from = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
    const to = filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;

    return state.archivedNotices.filter((notice) => {
      const haystack = normalizeSearch(`${notice.cliente_nombre} ${notice.cliente_nif} ${notice.models.join(' ')} ${notice.periods.join(' ')}`);
      const timestamp = new Date(notice.archivedAt).getTime();
      return (!query || haystack.includes(query))
        && (!model || notice.models.some((value) => normalizeSearch(value) === model))
        && (!period || notice.periods.some((value) => normalizeSearch(value) === period))
        && timestamp >= from
        && timestamp <= to;
    });
  }

  async writeCapture(id: string, contents: Buffer): Promise<void> {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Identificador de captura incompatible.');
    await atomicWrite(path.join(this.capturesDirectory, `${id}.png`), contents);
  }

  async completeLegacyMigration(): Promise<void> {
    await serializeStorage(this.stateFile, async () => {
      await this.recoverImport();
      await atomicWriteJson(path.join(this.root, 'migration-complete.json'), { schemaVersion: 1 });
    });
  }

  async cleanupOrphanedCaptures(maxAgeMs: number, now = Date.now()): Promise<string[]> {
    try {
      const marker = JSON.parse(await readFile(path.join(this.root, 'migration-complete.json'), 'utf8'));
      if (marker.schemaVersion !== 1) return [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const state = await this.loadQueue();
    const referenced = new Set<string>();
    const collect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(collect);
        return;
      }
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if ((key === 'fileId' || key === 'screenshotId') && typeof child === 'string') referenced.add(child);
        else if (key === 'captureIds' && Array.isArray(child)) child.forEach((id) => typeof id === 'string' && referenced.add(id));
        else collect(child);
      }
    };
    collect(state);

    const deleted: string[] = [];
    try {
      for (const fileName of await readdir(this.capturesDirectory)) {
        if (!fileName.endsWith('.png')) continue;
        const id = fileName.slice(0, -4);
        const filePath = path.join(this.capturesDirectory, fileName);
        if (!referenced.has(id) && now - (await stat(filePath)).mtimeMs > maxAgeMs) {
          await unlink(filePath);
          deleted.push(id);
        }
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return deleted;
  }

  async exportBackup(): Promise<NoticeBackup> {
    const state = await this.loadQueue();
    let clients: ClientDirectoryFile | null = null;
    try {
      clients = JSON.parse(await readFile(this.clientsFile, 'utf8')) as ClientDirectoryFile;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const captures: Record<string, string> = {};
    try {
      for (const fileName of await readdir(this.capturesDirectory)) {
        if (!fileName.endsWith('.png')) continue;
        captures[fileName.slice(0, -4)] = (await readFile(path.join(this.capturesDirectory, fileName))).toString('base64');
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    return {
      manifest: { product: 'avisos-fiscales', schemaVersion: 1, exportedAt: new Date().toISOString() },
      state,
      clients,
      captures,
    };
  }

  async importBackup(backup: NoticeBackup): Promise<void> {
    if (backup.manifest?.product !== 'avisos-fiscales' || backup.manifest.schemaVersion !== 1 || backup.state?.schemaVersion !== 1) {
      throw new Error('Copia de seguridad incompatible.');
    }
    const input = structuredClone(backup);
    await serializeStorage(this.stateFile, async () => {
      await this.recoverImport();
      const mapping = new Map<string, string>();
      // Prepare originals under fresh identities; an older workspace never sees overwritten pixels.
      for (const [id, contents] of Object.entries(input.captures || {})) {
        if (!/^[a-z0-9-]+$/.test(id) || typeof contents !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contents)) throw new Error('Captura de la copia incompatible.');
        let destination = id;
        try { await stat(path.join(this.capturesDirectory, `${id}.png`)); destination = `import-${randomUUID()}`; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await this.writeCapture(destination, Buffer.from(contents, 'base64'));
        mapping.set(id, destination);
      }
      const remap = (value: any): void => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(remap); return; }
        for (const [key, child] of Object.entries(value)) {
          if ((key === 'fileId' || key === 'screenshotId') && typeof child === 'string') {
            if (!mapping.has(child)) throw new Error('La copia no contiene una captura referenciada.');
            value[key] = mapping.get(child);
          } else if (key === 'captureIds' && Array.isArray(child)) {
            value[key] = child.map((id) => { if (!mapping.has(id)) throw new Error('La copia no contiene una captura referenciada.'); return mapping.get(id); });
          } else remap(child);
        }
      };
      remap(input.state);
      const clients = input.clients ? encodeClientDirectory(decodeClientDirectory(input.clients)) : null;
      await serializeStorage(this.clientsFile, async () => {
        const before = { state: await this.readState(), clients: await this.readClients() };
        await atomicWriteJson(this.importJournal, before);
        try {
          if (clients) await atomicWriteJson(this.clientsFile, clients);
          await atomicWriteJson(this.stateFile, input.state);
          await unlink(this.importJournal);
        } catch (error) {
          // A failed rollback leaves the durable journal for the next startup.
          await this.restoreImport(before);
          throw error;
        }
      });
    });
  }
}
