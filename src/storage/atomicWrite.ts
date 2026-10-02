import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * En Windows el antivirus, el indexador o una copia de seguridad abren durante
 * un instante el archivo recién escrito y el `rename` que lo sustituye falla
 * con EPERM/EACCES/EBUSY. No es un fallo del disco: unos milisegundos después
 * funciona. Antes ese tropiezo detenía la bandeja entera.
 */
const TRANSIENT_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
export const RENAME_RETRY_DELAYS = [50, 100, 200, 400, 800, 1500];

type RenameFn = (from: string, to: string) => Promise<void>;

export async function renameWithRetry(
  from: string,
  to: string,
  { renameFile = rename as RenameFn, delays = RENAME_RETRY_DELAYS } = {},
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await renameFile(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code || '';
      if (!TRANSIENT_CODES.has(code) || attempt >= delays.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

export async function atomicWrite(filePath: string, contents: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx');
    try { await file.writeFile(contents); await file.sync(); } finally { await file.close(); }
    await renameWithRetry(temporary, filePath);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  return atomicWrite(filePath, Buffer.from(JSON.stringify(value, null, 2)));
}
