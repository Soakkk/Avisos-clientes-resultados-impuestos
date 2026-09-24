import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serializeStorage } from './transactions';
import type {
  ArchivedNotice,
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

/** Avisos archivados que se conservan: el historial es solo una red de seguridad. */
export const MAX_ARCHIVED_NOTICES = 300;

/**
 * El historial guardaba el aviso completo, miniaturas en base64 incluidas
 * (decenas de KB cada una), y el archivo entero se reescribía en cada guardado.
 * Con unos cientos de avisos superaba el límite de 20 MB de la petición y la
 * bandeja dejaba de guardarse. Se quitan las miniaturas (la captura original
 * sigue en disco) y se conservan solo los avisos más recientes.
 */
export function compactState(state: NoticeState): NoticeState {
  const archived = [...(state.archivedNotices || [])]
    .sort((a, b) => String(b.archivedAt).localeCompare(String(a.archivedAt)))
    .slice(0, MAX_ARCHIVED_NOTICES)
    .map((item) => {
      const snapshot = item.snapshot as { notices?: Record<string, unknown>[] } | null;
      if (!snapshot || !Array.isArray(snapshot.notices)) return item;
      return {
        ...item,
        snapshot: {
          ...snapshot,
          notices: snapshot.notices.map(({ screenshotUrl: _thumbnail, ...rest }) => rest),
        },
      };
    });
  return { ...state, archivedNotices: archived };
}

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

  constructor(private readonly root = defaultNoticeStoragePath()) {
    this.stateFile = path.join(root, 'notices.json');
    this.capturesDirectory = path.join(root, 'capturas');
  }

  async loadQueue(): Promise<NoticeState> {
    return serializeStorage(this.stateFile, () => this.readState());
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
    const snapshot = compactState(structuredClone(state));
    await serializeStorage(this.stateFile, () => atomicWriteJson(this.stateFile, snapshot));
  }

  async archive(notice: ArchivedNotice): Promise<NoticeState> {
    return serializeStorage(this.stateFile, async () => {
      const state = await this.readState();
      if (!state.archivedNotices.some((item) => item.id === notice.id)) {
        state.archivedNotices.push(notice);
        await atomicWriteJson(this.stateFile, compactState(state));
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
    await serializeStorage(this.stateFile, () =>
      atomicWriteJson(path.join(this.root, 'migration-complete.json'), { schemaVersion: 1 }));
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
}
