import express from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { attachmentDisposition } from '../lib/files.js';
import { UNLOCK_TTL_MS, unlockCookieName, verifyUnlockToken } from '../lib/unlock.js';
import type { Limiters } from '../middleware/rateLimit.js';
import { parseTokenParam } from '../lib/validation.js';
import * as linkService from '../services/link.service.js';

const unlockSchema = z.object({ password: z.string().min(1).max(200) });

function unlockChecker(req: Request): (linkId: string) => boolean {
  return (linkId) => verifyUnlockToken(linkId, req.cookies?.[unlockCookieName(linkId)]);
}

/** Public, unauthenticated: /api/s/:token. Grants this one document, nothing else. */
export function createPublicRouter(limiters: Limiters): express.Router {
  const publicRouter = express.Router();

  publicRouter.get('/:token', async (req: Request, res: Response) => {
    const token = parseTokenParam(req.params.token);

    // One lookup, not two: the service resolves the link and asks this
    // callback whether the caller holds a valid unlock cookie for it.
    res.json(await linkService.publicGet(token, unlockChecker(req)));
  });

  publicRouter.post('/:token/unlock', limiters.unlock, async (req: Request, res: Response) => {
    const token = parseTokenParam(req.params.token);
    const { password } = unlockSchema.parse(req.body);

    const { linkId, unlockToken } = await linkService.unlock(token, password);

    // Scoped to this link and to the public share path, short-lived, HttpOnly.
    res.cookie(unlockCookieName(linkId), unlockToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/api/s',
      maxAge: UNLOCK_TTL_MS,
    });

    res.status(204).end();
  });

  publicRouter.get('/:token/download', async (req: Request, res: Response) => {
    const token = parseTokenParam(req.params.token);

    const file = await linkService.publicDownload(token, unlockChecker(req));

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', attachmentDisposition(file.name));
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader('X-Content-Type-Options', 'nosniff');

    file.stream.on('error', () => res.destroy());
    file.stream.pipe(res);
  });

  return publicRouter;
}
