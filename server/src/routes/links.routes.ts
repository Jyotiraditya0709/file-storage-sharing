import express from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseUuidParam } from '../lib/validation.js';
import { requireUser } from '../middleware/auth.js';
import * as linkService from '../services/link.service.js';

/** Nested at /api/workspaces/:wid/documents/:did/links. */
export const documentLinksRouter = express.Router({ mergeParams: true });

documentLinksRouter.use(requireUser);

const createSchema = z.object({
  expiresAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), {
    message: 'expiresAt must be in the future',
  }).optional(),
  maxDownloads: z.number().int().positive().max(1_000_000).optional(),
  password: z.string().min(8).max(200).optional(),
});

documentLinksRouter.get('/', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const did = parseUuidParam(req.params.did);

  res.json({ links: await linkService.listForDocument(req.user!, wid, did) });
});

documentLinksRouter.post('/', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const did = parseUuidParam(req.params.did);
  const input = createSchema.parse(req.body);

  const created = await linkService.create(req.user!, wid, did, input);
  res.status(201).json(created);
});

/** Revoke is addressed per workspace, not per document: /links/:lid. */
export const workspaceLinksRouter = express.Router({ mergeParams: true });

workspaceLinksRouter.use(requireUser);

workspaceLinksRouter.delete('/:lid', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const lid = parseUuidParam(req.params.lid);

  await linkService.revoke(req.user!, wid, lid);
  res.status(204).end();
});
