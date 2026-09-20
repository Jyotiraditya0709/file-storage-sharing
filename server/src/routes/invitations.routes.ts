import express from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseUuidParam } from '../lib/validation.js';
import { requireUser } from '../middleware/auth.js';
import * as invitationService from '../services/invitation.service.js';

/** Nested under /api/workspaces/:wid/invitations. */
export const workspaceInvitationsRouter = express.Router({ mergeParams: true });

workspaceInvitationsRouter.use(requireUser);

const createSchema = z.object({
  email: z.string().trim().min(3).max(320).email(),
  // 'owner' is absent on purpose: ownership moves only by transfer, and the
  // database CHECK refuses it too.
  role: z.enum(['admin', 'member', 'viewer']),
});

workspaceInvitationsRouter.get('/', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  res.json({ invitations: await invitationService.listPending(req.user!, wid) });
});

workspaceInvitationsRouter.post('/', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const input = createSchema.parse(req.body);
  const created = await invitationService.create(req.user!, wid, input);
  res.status(201).json(created);
});

workspaceInvitationsRouter.delete('/:iid', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const iid = parseUuidParam(req.params.iid);
  await invitationService.revoke(req.user!, wid, iid);
  res.status(204).end();
});

/** Token-addressed, mounted at /api/invitations. */
export const invitationsRouter = express.Router();

const tokenSchema = z.string().min(1).max(512);

invitationsRouter.get('/:token', async (req: Request, res: Response) => {
  const token = tokenSchema.parse(req.params.token);
  res.json({ invitation: await invitationService.preview(token) });
});

invitationsRouter.post('/:token/accept', requireUser, async (req: Request, res: Response) => {
  const token = tokenSchema.parse(req.params.token);
  res.json(await invitationService.accept(req.user!, token));
});
