import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type Workspace, api } from '../api.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { formatDate } from '../format.js';

export function WorkspaceListPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { workspaces: list } = await api.listWorkspaces();
      setWorkspaces(list);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createWorkspace(name);
      setName('');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Workspaces</h1>
      <p className="muted">You only see workspaces you are a member of.</p>
      <ErrorBanner error={error} />

      <section className="panel">
        <h2>Create a workspace</h2>
        <form className="row" onSubmit={create}>
          <input
            name="name"
            placeholder="Workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button className="primary" type="submit" disabled={busy}>
            Create
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Your workspaces</h2>
        {workspaces.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Your role</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((workspace) => (
                <tr key={workspace.id}>
                  <td>
                    <Link to={`/workspaces/${workspace.id}`}>{workspace.name}</Link>
                  </td>
                  <td>
                    <span className="badge">{workspace.role}</span>
                  </td>
                  <td className="muted">{formatDate(workspace.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
