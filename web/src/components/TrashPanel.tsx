import { useCallback, useEffect, useState } from 'react';
import { type Doc, type Workspace, api } from '../api.js';
import { formatBytes, formatDate } from '../format.js';
import { ErrorBanner } from './ErrorBanner.js';

export function TrashPanel({
  workspace,
  onChanged,
}: {
  workspace: Workspace;
  onChanged: () => void;
}) {
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const { documents: list } = await api.listTrash(workspace.id);
      setDocuments(list);
    } catch (err) {
      setError(err);
    }
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (doc: Doc) => {
    setError(null);
    try {
      await api.restoreDocument(workspace.id, doc.id);
      await load();
      onChanged();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <section className="panel">
      <h2>Trash</h2>
      <p className="muted">Deleted in the last 30 days. After that a purge removes them.</p>
      <ErrorBanner error={error} />

      {documents.length === 0 ? (
        <p className="muted">Empty.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Deleted</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.name}</td>
                <td>{formatBytes(doc.sizeBytes)}</td>
                <td className="muted">{doc.deletedAt ? formatDate(doc.deletedAt) : '—'}</td>
                <td className="actions">
                  <button className="link" type="button" onClick={() => void restore(doc)}>
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
