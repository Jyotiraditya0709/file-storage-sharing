import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { attachUser } from './middleware/auth.js';
import { csrf } from './middleware/csrf.js';
import { apiNotFound, errorHandler } from './middleware/errors.js';
import { createLimiters } from './middleware/rateLimit.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { documentsRouter, trashRouter } from './routes/documents.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { invitationsRouter, workspaceInvitationsRouter } from './routes/invitations.routes.js';
import { documentLinksRouter, workspaceLinksRouter } from './routes/links.routes.js';
import { createPublicRouter } from './routes/public.routes.js';
import { membersRouter } from './routes/members.routes.js';
import { workspacesRouter } from './routes/workspaces.routes.js';

export interface AppOverrides {
  /**
   * Attempts per window per IP on login, signup and unlock. Defaults to
   * config.rateLimitMax; a test lowers it to drive the limiter to 429.
   */
  rateLimitMax?: number;
}

/**
 * Builds the Express app without binding a port, so tests can drive it with
 * supertest. server.ts is the only place that calls listen().
 */
export function buildApp(overrides: AppOverrides = {}): Express {
  const limiters = createLimiters(overrides.rateLimitMax ?? config.rateLimitMax);

  const app = express();
  app.disable('x-powered-by');

  app.use((_req: Request, res: Response, next: NextFunction) => {
    // Nothing this API serves should ever be content-sniffed by a browser.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The public share page is /s/:token, so the secret is in the URL path.
    // Nothing on that page loads a third-party resource today; this makes sure
    // that if something ever does, it cannot carry the token in a Referer.
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use(csrf);
  app.use(attachUser);

  app.use('/api/health', healthRouter);
  app.use('/api/auth', createAuthRouter(limiters));
  app.use('/api/invitations', invitationsRouter);
  app.use('/api/workspaces/:wid/members', membersRouter);
  app.use('/api/workspaces/:wid/invitations', workspaceInvitationsRouter);
  app.use('/api/workspaces/:wid/documents', documentsRouter);
  app.use('/api/workspaces/:wid/trash', trashRouter);
  app.use('/api/workspaces/:wid/documents/:did/links', documentLinksRouter);
  app.use('/api/workspaces/:wid/links', workspaceLinksRouter);
  app.use('/api/s', createPublicRouter(limiters));
  app.use('/api/workspaces', workspacesRouter);

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
