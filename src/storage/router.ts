import { Router, type ErrorRequestHandler } from 'express';
import type { ClientDirectory } from './clientDirectory';
import type { NoticeRepository } from './noticeRepository';
import type { NoticeSearchFilters } from './types';

/** Motivo legible de un fallo al guardar, para enseñarlo en el aviso de la app. */
export function describeStorageError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if ((error as { type?: string })?.type === 'entity.too.large') {
    return 'Los datos de la bandeja superan el tamaño máximo que se puede guardar.';
  }
  if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') {
    return `Otro programa (antivirus, copia de seguridad o sincronización) tiene bloqueado el archivo de la bandeja (${code}).`;
  }
  if (code === 'ENOSPC') return 'El disco está lleno.';
  return error instanceof Error ? error.message : String(error);
}

export const storageErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) return next(error);
  console.error('Error de almacenamiento:', error);
  const status = Number((error as { status?: number })?.status) || 500;
  response.status(status >= 400 && status < 600 ? status : 500).json({ error: describeStorageError(error) });
};

export function createStorageRouter(repository: NoticeRepository, clientDirectory?: ClientDirectory): Router {
  const router = Router();

  router.get('/api/notices/state', async (_request, response, next) => {
    try {
      response.json(await repository.loadQueue());
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/notices/state', async (request, response, next) => {
    try {
      await repository.saveQueue(request.body);
      // El directorio de clientes es un archivo compartido con el Escáner: si
      // está bloqueado o en otro formato, la bandeja ya está guardada y no debe
      // darse por fallida (antes eso detenía la bandeja con un aviso verificado).
      if (clientDirectory && Array.isArray(request.body.activeNotices)) {
        for (const candidate of request.body.activeNotices) {
          if (candidate?.verificacion?.estado !== 'ok') continue;
          try {
            await clientDirectory.mergeVerified({
              nif: String(candidate.cliente_nif || ''),
              fields: {
                nombre: { value: String(candidate.cliente_nombre || ''), verified: true },
                iban: candidate.iban ? { value: String(candidate.iban), verified: true } : undefined,
              },
            }, 'avisos-fiscales');
          } catch (error) {
            console.warn('No se pudo actualizar el directorio de clientes:', error);
          }
        }
      }
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/notices/archive', async (request, response, next) => {
    try {
      response.json(await repository.archive(request.body));
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/notices/migration-complete', async (_request, response, next) => {
    try {
      await repository.completeLegacyMigration();
      response.status(204).end();
    } catch (error) { next(error); }
  });

  router.get('/api/notices/search', async (request, response, next) => {
    try {
      const filters: NoticeSearchFilters = {
        query: typeof request.query.query === 'string' ? request.query.query : undefined,
        model: typeof request.query.model === 'string' ? request.query.model : undefined,
        period: typeof request.query.period === 'string' ? request.query.period : undefined,
        from: typeof request.query.from === 'string' ? request.query.from : undefined,
        to: typeof request.query.to === 'string' ? request.query.to : undefined,
      };
      response.json(await repository.search(filters));
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/clients/:nif', async (request, response, next) => {
    try {
      if (!clientDirectory) return response.status(404).end();
      const found = await clientDirectory.lookup(String(request.params.nif || ''));
      if (!found) return response.status(404).end();
      response.json({ nombre: found.nombre || '', iban: found.iban || '' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
