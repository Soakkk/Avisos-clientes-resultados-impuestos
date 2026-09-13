import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sharedClientDirectoryPath } from './clientDirectory';
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
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, filePath);
}

export class NoticeRepository {
  private readonly stateFile: string;
  private readonly capturesDirectory: string;

  constructor(
    private readonly root = defaultNoticeStoragePath(),
    private readonly clientsFile = sharedClientDirectoryPath(),
  ) {
    this.stateFile = path.join(root, 'notices.json');
    this.capturesDirectory = path.join(root, 'capturas');
  }

  async loadQueue(): Promise<NoticeState> {
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
    await atomicWriteJson(this.stateFile, state);
  }

  async archive(notice: ArchivedNotice): Promise<NoticeState> {
    const state = await this.loadQueue();
    if (!state.archivedNotices.some((item) => item.id === notice.id)) {
      state.archivedNotices.push(notice);
      await this.saveQueue(state);
    }
    return state;
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
    await mkdir(this.capturesDirectory, { recursive: true });
    await writeFile(path.join(this.capturesDirectory, `${id}.png`), contents);
  }

  async cleanupOrphanedCaptures(maxAgeMs: number, now = Date.now()): Promise<string[]> {
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
    await this.saveQueue(backup.state);
    if (backup.clients) await atomicWriteJson(this.clientsFile, backup.clients);
    for (const [id, contents] of Object.entries(backup.captures || {})) {
      await this.writeCapture(id, Buffer.from(contents, 'base64'));
    }
  }
}
