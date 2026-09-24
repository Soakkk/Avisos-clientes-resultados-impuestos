import { Router } from 'express';
import type { ClientDirectory } from './clientDirectory';
import type { NoticeRepository } from './noticeRepository';
import type { NoticeSearchFilters } from './types';

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
      if (clientDirectory && Array.isArray(request.body.activeNotices)) {
        for (const candidate of request.body.activeNotices) {
          if (candidate?.verificacion?.estado !== 'ok') continue;
          await clientDirectory.mergeVerified({
            nif: String(candidate.cliente_nif || ''),
            fields: {
              nombre: { value: String(candidate.cliente_nombre || ''), verified: true },
              iban: candidate.iban ? { value: String(candidate.iban), verified: true } : undefined,
            },
          }, 'avisos-fiscales');
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

  return router;
}
