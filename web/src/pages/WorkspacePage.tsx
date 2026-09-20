import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { type Workspace, api } from '../api.js';
import { DocumentsTable } from '../components/DocumentsTable.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { InvitationsPanel } from '../components/InvitationsPanel.js';
import { MembersPanel } from '../components/MembersPanel.js';
import { TrashPanel } from '../components/TrashPanel.js';

export function WorkspacePage() {
  const { wid = '' } = useParams();
  const navigate = useNavigate();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // Bumped after an upload/delete/restore so the trash panel refetches.
  const [revision, setRevision] = useState(0);

  const load = useCallback(async () => {
    try {
      const { workspace: found } = await api.getWorkspace(wid);
      setWorkspace(found);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [wid]);

  useEffect(() => {
    void load();
  }, [load]);

  const rename = async () => {
    if (!workspace) return;
    const name = window.prompt('New workspace name', workspace.name);
    if (!name) return;
    try {
      const { workspace: updated } = await api.renameWorkspace(workspace.id, name);
      setWorkspace(updated);
    } catch (err) {
      setError(err);
    }
  };

  const remove = async () => {
    if (!workspace) return;
    if (
      !window.confirm(
        `Delete “${workspace.name}”? Members lose access immediately and its share links stop working. It is recoverable for 30 days.`,
      )
    ) {
      return;
    }
    try {
      await api.deleteWorkspace(workspace.id);
      navigate('/workspaces', { replace: true });
    } catch (err) {
      setError(err);
    }
  };

  if (loading) return <p>Loading…</p>;

  if (!workspace) {
    return (
      <>
        <ErrorBanner error={error} />
        <p>
          <Link to="/workspaces">Back to workspaces</Link>
        </p>
      </>
    );
  }

  const { capabilities } = workspace;

  return (
    <>
      <div className="row">
        <h1 style={{ marginBottom: 0 }}>{workspace.name}</h1>
        <span className="badge">{workspace.role}</span>
        <div style={{ flex: 1 }} />
        {capabilities.canRename ? (
          <button type="button" onClick={() => void rename()}>
            Rename
          </button>
        ) : null}
        {capabilities.canDelete ? (
          <button className="danger" type="button" onClick={() => void remove()}>
            Delete workspace
          </button>
        ) : null}
      </div>
      <p className="muted">
        <Link to="/workspaces">All workspaces</Link>
      </p>

      <ErrorBanner error={error} />

      <DocumentsTable workspace={workspace} onChanged={() => setRevision((n) => n + 1)} />

      <MembersPanel workspace={workspace} />

      {capabilities.canInvite ? <InvitationsPanel workspace={workspace} /> : null}

      {capabilities.canSeeTrash ? (
        <TrashPanel
          key={revision}
          workspace={workspace}
          onChanged={() => setRevision((n) => n + 1)}
        />
      ) : null}
    </>
  );
}
