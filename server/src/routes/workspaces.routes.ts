import express from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseUuidParam } from '../lib/validation.js';
import { requireUser } from '../middleware/auth.js';
import * as workspaceService from '../services/workspace.service.js';

export const workspacesRouter = express.Router();

workspacesRouter.use(requireUser);

const nameSchema = z.object({ name: z.string().trim().min(1).max(100) });
const transferSchema = z.object({ userId: z.string().uuid() });

workspacesRouter.get('/', async (req: Request, res: Response) => {
  res.json({ workspaces: await workspaceService.listForUser(req.user!) });
});

workspacesRouter.post('/', async (req: Request, res: Response) => {
  const { name } = nameSchema.parse(req.body);
  res.status(201).json({ workspace: await workspaceService.create(req.user!, name) });
});

workspacesRouter.get('/:wid', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  res.json({ workspace: await workspaceService.get(req.user!, wid) });
});

workspacesRouter.patch('/:wid', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const { name } = nameSchema.parse(req.body);
  res.json({ workspace: await workspaceService.rename(req.user!, wid, name) });
});

workspacesRouter.delete('/:wid', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  await workspaceService.softDelete(req.user!, wid);
  res.status(204).end();
});

workspacesRouter.post('/:wid/transfer', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const { userId } = transferSchema.parse(req.body);
  await workspaceService.transferOwnership(req.user!, wid, userId);
  res.status(204).end();
});
