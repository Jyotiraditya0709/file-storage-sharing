import path from 'node:path';
import express from 'express';
import type { Express, Request, Response } from 'express';
import { config } from './config.js';
import { healthRouter } from './routes/health.routes.js';

const notFound = { error: { code: 'NOT_FOUND', message: 'Not found' } } as const;

/**
 * Builds the Express app without binding a port, so tests can drive it with
 * supertest. server.ts is the only place that calls listen().
 */
export function buildApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(express.json());

  app.use('/api/health', healthRouter);

  // Any other /api/* path is a real 404 with the uniform error body. This is
  // registered before the SPA fallback so an unknown API route can never be
  // answered with index.html.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json(notFound);
  });

  const webDist = path.resolve(config.webDistPath);
  app.use(express.static(webDist));

  // SPA fallback. Everything reaching here is a non-/api request, because /api
  // was fully handled above.
  app.use((req: Request, res: Response) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(404).json(notFound);
      return;
    }
    res.sendFile(path.join(webDist, 'index.html'), (err) => {
      if (err) {
        res.status(404).json(notFound);
      }
    });
  });

  return app;
}
