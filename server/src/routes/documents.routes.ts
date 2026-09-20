import express from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { decodeCursor } from '../lib/cursor.js';
import { attachmentDisposition } from '../lib/files.js';
import { readSingleFile } from '../lib/multipart.js';
import { parseUuidParam } from '../lib/validation.js';
import { requireUser } from '../middleware/auth.js';
import * as documentService from '../services/document.service.js';

export const documentsRouter = express.Router({ mergeParams: true });

documentsRouter.use(requireUser);

const nameSchema = z.object({ name: z.string().trim().min(1).max(255) });
const cursorSchema = z.string().min(1).max(512).optional();

documentsRouter.get('/', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const raw = cursorSchema.parse(req.query.cursor);
  const cursor = raw ? decodeCursor(raw) : null;

  res.json(await documentService.list(req.user!, wid, cursor));
});

documentsRouter.post('/', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);

  // The route never touches the bytes: it hands the stream to the service.
  const file = await readSingleFile(req, config.maxUploadBytes);
  try {
    const document = await documentService.upload(req.user!, wid, file);
    res.status(201).json({ document });
  } catch (err) {
    file.discard();
    throw err;
  }
});

documentsRouter.get('/:did', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const did = parseUuidParam(req.params.did);

  res.json({ document: await documentService.get(req.user!, wid, did) });
});

documentsRouter.get('/:did/download', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const did = parseUuidParam(req.params.did);

  const { document, stream } = await documentService.download(req.user!, wid, did);

  // Always an attachment, always nosniff: an uploaded HTML or SVG file must
  // never execute in our origin.
  res.setHeader('Content-Type', document.mimeType);
  res.setHeader('Content-Disposition', attachmentDisposition(document.name));
  res.setHeader('Content-Length', String(document.sizeBytes));
  res.setHeader('X-Content-Type-Options', 'nosniff');

  stream.on('error', () => res.destroy());
  stream.pipe(res);
});

documentsRouter.patch('/:did', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const did = parseUuidParam(req.params.did);
  const { name } = nameSchema.parse(req.body);

  res.json({ document: await documentService.rename(req.user!, wid, did, name) });
});

documentsRouter.delete('/:did', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const did = parseUuidParam(req.params.did);

  await documentService.softDelete(req.user!, wid, did);
  res.status(204).end();
});

/** Mounted separately at /api/workspaces/:wid/trash. */
export const trashRouter = express.Router({ mergeParams: true });

trashRouter.use(requireUser);

trashRouter.get('/', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  res.json({ documents: await documentService.listTrash(req.user!, wid) });
});

trashRouter.post('/:did/restore', async (req: Request, res: Response) => {
  const wid = parseUuidParam(req.params.wid);
  const did = parseUuidParam(req.params.did);

  res.json({ document: await documentService.restore(req.user!, wid, did) });
});
