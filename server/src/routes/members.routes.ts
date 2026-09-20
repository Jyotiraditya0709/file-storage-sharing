import express from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseUuidParam } from '../lib/validation.js';
import { requireUser } from '../middleware/auth.js';
import * as membershipService from '../services/membership.service.js';

// mergeParams so :wid from the parent mount is visible here.
export const membersRouter = express.Router({ mergeParams: true });

membersRouter.use(requireUser);

const roleSchema = z.object({ role: z.enum(['owner', 'admin', 'member', 'viewer']) });

membersRouter.get('/', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  res.json({ members: await membershipService.list(req.user!, wid) });
});

membersRouter.patch('/:uid', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const uid = parseUuidParam(req.params.uid);
  const { role } = roleSchema.parse(req.body);
  await membershipService.updateRole(req.user!, wid, uid, role);
  res.status(204).end();
});

membersRouter.delete('/:uid', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const uid = parseUuidParam(req.params.uid);
  await membershipService.remove(req.user!, wid, uid);
  res.status(204).end();
});
