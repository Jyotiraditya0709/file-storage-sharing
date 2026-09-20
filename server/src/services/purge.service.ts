import * as documentsRepo from '../db/repositories/documents.repo.js';
import * as sessionsRepo from '../db/repositories/sessions.repo.js';
import * as workspacesRepo from '../db/repositories/workspaces.repo.js';
import { storage } from '../storage/index.js';
import { TRASH_RETENTION_MS } from './document.service.js';

export interface PurgeReport {
  documentsPurged: number;
  documentsFailed: number;
  workspacesPurged: number;
  sessionsPurged: number;
}

/**
 * Hard-deletes what has been in the bin longer than the retention window.
 *
 * Per SPEC §4 the storage object goes first and the row second: if removal
 * fails the row stays, so a failure leaves something to retry rather than an
 * orphaned object nobody knows about.
 *
 * Not authorization-checked because it is not reachable from the API — it is a
 * CLI entry point run by an operator or a scheduler. Every query still goes
 * through a repository.
 */
export async function run(now: Date = new Date()): Promise<PurgeReport> {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_MS);
  const report: PurgeReport = {
    documentsPurged: 0,
    documentsFailed: 0,
    workspacesPurged: 0,
    sessionsPurged: 0,
  };

  for (const document of await documentsRepo.listPurgeable(cutoff)) {
    try {
      await storage.delete(document.storageKey);
    } catch {
      report.documentsFailed += 1;
      continue;
    }
    await documentsRepo.hardDelete(document.workspaceId, document.id);
    report.documentsPurged += 1;
  }

  // Only now can a workspace row go: documents reference it with RESTRICT, so
  // a document that failed to purge blocks the delete instead of cascading.
  for (const workspace of await workspacesRepo.listPurgeable(cutoff)) {
    try {
      await workspacesRepo.hardDelete(workspace.id);
      report.workspacesPurged += 1;
    } catch {
      // Something still references it. Leave it for the next run.
    }
  }

  // Expired sessions are already rejected on use, but the rows would otherwise
  // accumulate forever.
  report.sessionsPurged = await sessionsRepo.deleteExpired(now);

  return report;
}
