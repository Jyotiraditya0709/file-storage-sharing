import express from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  clearedSessionCookieOptions,
  sessionCookieOptions,
} from '../lib/cookies.js';
import { requireUser } from '../middleware/auth.js';
import type { Limiters } from '../middleware/rateLimit.js';
import * as authService from '../services/auth.service.js';

const email = z.string().trim().min(3).max(320).email();
const password = z.string().min(10).max(200);
const displayName = z.string().trim().min(1).max(100);

const signupSchema = z.object({ email, displayName, password });
const loginSchema = z.object({ email, password });

export function createAuthRouter(limiters: Limiters): express.Router {
  const authRouter = express.Router();

  authRouter.post('/signup', limiters.signup, async (req: Request, res: Response) => {
    const input = signupSchema.parse(req.body);
    const issued = await authService.signup(input);

    res.cookie(SESSION_COOKIE, issued.cookieValue, sessionCookieOptions(issued.maxAgeMs));
    res.status(201).json({ user: issued.user });
  });

  authRouter.post('/login', limiters.login, async (req: Request, res: Response) => {
    const input = loginSchema.parse(req.body);
    const issued = await authService.login(input);

    res.cookie(SESSION_COOKIE, issued.cookieValue, sessionCookieOptions(issued.maxAgeMs));
    res.json({ user: issued.user });
  });

  authRouter.post('/logout', async (req: Request, res: Response) => {
    if (req.sessionId) await authService.logout(req.sessionId);

    res.clearCookie(SESSION_COOKIE, clearedSessionCookieOptions());
    res.status(204).end();
  });

  authRouter.get('/me', requireUser, (req: Request, res: Response) => {
    res.json({ user: req.user });
  });

  return authRouter;
}
