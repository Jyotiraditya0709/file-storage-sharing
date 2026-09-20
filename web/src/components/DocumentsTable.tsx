import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { type Doc, type Workspace, api, documentDownloadUrl } from '../api.js';
import { formatBytes, formatDate, shortType } from '../format.js';
import { ErrorBanner } from './ErrorBanner.js';
import { ShareDialog } from './ShareDialog.js';

export function DocumentsTable({
  workspace,
  onChanged,
}: {
  workspace: Workspace;
  onChanged: () => void;
}) {
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [uploading, setUploading] = useState(false);
  const [sharing, setSharing] = useState<Doc | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await api.listDocuments(workspace.id);
      setDocuments(page.documents);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err);
    }
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!nextCursor) return;
    try {
      const page = await api.listDocuments(workspace.id, nextCursor);
      setDocuments((current) => [...current, ...page.documents]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err);
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      await api.uploadDocument(workspace.id, file);
      await load();
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const rename = async (doc: Doc) => {
    const name = window.prompt('New name', doc.name);
    if (!name) return;
    try {
      await api.renameDocument(workspace.id, doc.id, name);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const remove = async (doc: Doc) => {
    if (!window.confirm(`Delete “${doc.name}”? It goes to the trash for 30 days.`)) return;
    try {
      await api.deleteDocument(workspace.id, doc.id);
      await load();
      onChanged();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <section className="panel">
      <h2>Documents</h2>
      <ErrorBanner error={error} />

      {/* Rendered from the server's capability flag, not from a role check here. */}
      {workspace.capabilities.canUpload ? (
        <p className="row">
          <label style={{ marginBottom: 0 }}>
            <span>Upload a file (max 50 MB)</span>
            <input type="file" name="file" onChange={(e) => void upload(e)} disabled={uploading} />
          </label>
          {uploading ? <span className="muted">Uploading…</span> : null}
        </p>
      ) : (
        <p className="muted">Your role does not allow uploading here.</p>
      )}

      {documents.length === 0 ? (
        <p className="muted">No documents yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Type</th>
              <th>Uploaded by</th>
              <th>Date</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>
                  <a href={documentDownloadUrl(workspace.id, doc.id)}>{doc.name}</a>
                </td>
                <td>{formatBytes(doc.sizeBytes)}</td>
                <td className="muted">{shortType(doc.mimeType)}</td>
                <td className="muted">{doc.uploadedBy.displayName ?? 'unknown'}</td>
                <td className="muted">{formatDate(doc.createdAt)}</td>
                <td className="actions">
                  {doc.canShare ? (
                    <button className="link" type="button" onClick={() => setSharing(doc)}>
                      Share
                    </button>
                  ) : null}
                  {doc.canEdit ? (
                    <>
                      <button className="link" type="button" onClick={() => void rename(doc)}>
                        Rename
                      </button>
                      <button className="link danger" type="button" onClick={() => void remove(doc)}>
                        Delete
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {nextCursor ? (
        <p style={{ marginTop: 12 }}>
          <button type="button" onClick={() => void loadMore()}>
            Load more
          </button>
        </p>
      ) : null}

      {sharing ? (
        <ShareDialog
          workspaceId={workspace.id}
          document={sharing}
          onClose={() => setSharing(null)}
        />
      ) : null}
    </section>
  );
}
