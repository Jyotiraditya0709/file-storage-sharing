import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { documents, workspaces } from '../src/db/schema.js';
import * as purgeService from '../src/services/purge.service.js';
import { storage } from '../src/storage/index.js';
import type { StorageProvider } from '../src/storage/StorageProvider.js';
import { SAME_ORIGIN, createWorkspace, signUp, uploadDocument } from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function backdateDocument(documentId: string, days: number): Promise<void> {
  await db
    .update(documents)
    .set({ deletedAt: new Date(Date.now() - days * DAY_MS) })
    .where(eq(documents.id, documentId));
}

async function storageKeyOf(documentId: string): Promise<string> {
  const [row] = await db
    .select({ key: documents.storageKey })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!row) throw new Error('document row missing');
  return row.key;
}

async function documentExists(documentId: string): Promise<boolean> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, documentId));
  return rows.length === 1;
}

/**
 * SPEC §4. The purge is the only thing that deletes bytes, and it is reachable
 * only from a CLI, so nothing else in the suite exercises it.
 */
describe('purge (SPEC §4)', () => {
  it('leaves documents inside the 30-day window completely alone', async () => {
    const owner = await signUp('Purge Recent');
    const wid = await createWorkspace(owner, 'Recent');
    const doc = await uploadDocument(owner, wid, 'still recoverable', 'recent.txt');
    const key = await storageKeyOf(doc.id);

    await owner.agent.delete(`/api/workspaces/${wid}/documents/${doc.id}`).set(SAME_ORIGIN).expect(204);
    await backdateDocument(doc.id, 29);

    await purgeService.run();

    expect(await documentExists(doc.id)).toBe(true);
    expect(await storage.exists(key)).toBe(true);
  });

  it('hard-deletes the object and then the row once past the window', async () => {
    const owner = await signUp('Purge Old');
    const wid = await createWorkspace(owner, 'Old');
    const doc = await uploadDocument(owner, wid, 'long gone', 'old.txt');
    const key = await storageKeyOf(doc.id);

    await owner.agent.delete(`/api/workspaces/${wid}/documents/${doc.id}`).set(SAME_ORIGIN).expect(204);
    await backdateDocument(doc.id, 31);

    const report = await purgeService.run();

    expect(report.documentsPurged).toBeGreaterThanOrEqual(1);
    expect(await storage.exists(key)).toBe(false);
    expect(await documentExists(doc.id)).toBe(false);
  });

  it('keeps the row when the object cannot be removed, so nothing is orphaned', async () => {
    const owner = await signUp('Purge Failing');
    const wid = await createWorkspace(owner, 'Failing');
    const doc = await uploadDocument(owner, wid, 'stuck', 'stuck.txt');
    const key = await storageKeyOf(doc.id);

    await owner.agent.delete(`/api/workspaces/${wid}/documents/${doc.id}`).set(SAME_ORIGIN).expect(204);
    await backdateDocument(doc.id, 31);

    // SPEC §4: "Object removal happens before the row delete; if removal fails
    // the row stays so nothing is orphaned silently."
    const original = storage.delete.bind(storage);
    (storage as StorageProvider).delete = async (target: string) => {
      if (target === key) throw new Error('storage unavailable');
      return original(target);
    };

    try {
      const report = await purgeService.run();
      expect(report.documentsFailed).toBeGreaterThanOrEqual(1);
    } finally {
      (storage as StorageProvider).delete = original;
    }

    // The row survived, so the object is still findable and retryable.
    expect(await documentExists(doc.id)).toBe(true);
    expect(await storage.exists(key)).toBe(true);

    // And a later run, with storage healthy again, finishes the job.
    await purgeService.run();
    expect(await documentExists(doc.id)).toBe(false);
    expect(await storage.exists(key)).toBe(false);
  });

  it('removes a long-deleted workspace only after its documents are gone', async () => {
    const owner = await signUp('Purge Workspace');
    const wid = await createWorkspace(owner, 'Doomed');
    const doc = await uploadDocument(owner, wid, 'inside', 'inside.txt');
    const key = await storageKeyOf(doc.id);

    await owner.agent.delete(`/api/workspaces/${wid}`).set(SAME_ORIGIN).expect(204);
    await db
      .update(workspaces)
      .set({ deletedAt: new Date(Date.now() - 31 * DAY_MS) })
      .where(eq(workspaces.id, wid));

    await purgeService.run();

    expect(await storage.exists(key)).toBe(false);
    expect(await documentExists(doc.id)).toBe(false);

    const remaining = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, wid));
    expect(remaining).toHaveLength(0);
  });

  it('is a no-op that reports zero when there is nothing old enough', async () => {
    const report = await purgeService.run(new Date(Date.now() - 365 * DAY_MS));
    expect(report.documentsFailed).toBe(0);
    expect(report.documentsPurged).toBe(0);
    expect(report.workspacesPurged).toBe(0);
  });
});
