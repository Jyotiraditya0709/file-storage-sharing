import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { attachUser } from './middleware/auth.js';
import { csrf } from './middleware/csrf.js';
import { apiNotFound, errorHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.routes.js';
import { healthRouter } from './routes/health.routes.js';

/**
 * Builds the Express app without binding a port, so tests can drive it with
 * supertest. server.ts is the only place that calls listen().
 */
export function buildApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  // Nothing this API serves should ever be content-sniffed by a browser.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use(csrf);
  app.use(attachUser);

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);

  // Any other /api/* path is a real 404 with the uniform error body, before
  // the SPA fallback, so an unknown API route is never answered with HTML.
  app.use('/api', apiNotFound);

  const webDist = path.resolve(config.webDistPath);
  app.use(express.static(webDist));

  // SPA fallback. Everything reaching here is a non-/api request.
  app.use((req: Request, res: Response) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    res.sendFile(path.join(webDist, 'index.html'), (err) => {
      if (err) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      }
    });
  });

  app.use(errorHandler);

  return app;
}
