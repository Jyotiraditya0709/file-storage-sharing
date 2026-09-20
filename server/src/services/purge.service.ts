import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as documentsRepo from '../db/repositories/documents.repo.js';
import { workspaces } from '../db/schema.js';
import { storage } from '../storage/index.js';
import { TRASH_RETENTION_MS } from './document.service.js';

export interface PurgeReport {
  documentsPurged: number;
  documentsFailed: number;
  workspacesPurged: number;
}

/**
 * Hard-deletes what has been in the bin longer than the retention window.
 *
 * Per SPEC §4 the storage object goes first and the row second: if removal
 * fails the row stays, so a failure leaves something to retry rather than an
 * orphaned object nobody knows about.
 *
 * Not authorization-checked because it is not reachable from the API — it is
 * a CLI entry point run by an operator or a scheduler.
 */
export async function run(now: Date = new Date()): Promise<PurgeReport> {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_MS);
  const report: PurgeReport = { documentsPurged: 0, documentsFailed: 0, workspacesPurged: 0 };

  for (const document of await documentsRepo.listPurgeable(cutoff)) {
    try {
      await storage.delete(document.storageKey);
    } catch {
      report.documentsFailed += 1;
      continue;
    }
    await documentsRepo.hardDelete(document.id);
    report.documentsPurged += 1;
  }

  // Only now can the workspace row go: documents reference it with RESTRICT,
  // so a surviving document blocks the delete instead of cascading silently.
  const purgeable = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(isNotNull(workspaces.deletedAt), lt(workspaces.deletedAt, cutoff)));

  for (const workspace of purgeable) {
    try {
      await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
      report.workspacesPurged += 1;
    } catch {
      // A document that failed to purge still references it (RESTRICT).
      // Leave the workspace for the next run rather than forcing it.
    }
  }

  return report;
}
