import express from 'express';
import type { Request, Response } from 'express';

export const healthRouter = express.Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});
