import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { type Doc, type ShareLink, api } from '../api.js';
import { formatDate } from '../format.js';
import { CopyField } from './CopyField.js';
import { ErrorBanner } from './ErrorBanner.js';

interface Props {
  workspaceId: string;
  document: Doc;
  onClose: () => void;
}

/** Everything about one document's links lives here: create, show once, revoke. */
export function ShareDialog({ workspaceId, document: doc, onClose }: Props) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [maxDownloads, setMaxDownloads] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { links: list } = await api.listLinks(workspaceId, doc.id);
      setLinks(list);
    } catch (err) {
      setError(err);
    }
  }, [workspaceId, doc.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { url } = await api.createLink(workspaceId, doc.id, {
        // datetime-local has no timezone; send an absolute instant.
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        ...(maxDownloads ? { maxDownloads: Number(maxDownloads) } : {}),
        ...(password ? { password } : {}),
      });
      setFreshUrl(url);
      setExpiresAt('');
      setMaxDownloads('');
      setPassword('');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (linkId: string) => {
    setError(null);
    try {
      await api.revokeLink(workspaceId, linkId);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const describe = (link: ShareLink): string => {
    if (link.revokedAt) return 'revoked';
    if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) return 'expired';
    if (link.maxDownloads !== null && link.downloadCount >= link.maxDownloads) return 'exhausted';
    return 'active';
  };

  return (
    <dialog className="share" open aria-label={`Share ${doc.name}`}>
      <h2>Share “{doc.name}”</h2>
      <ErrorBanner error={error} />

      {freshUrl ? (
        <div className="notice">
          <p style={{ marginTop: 0 }}>
            <strong>This URL is shown once.</strong> Only its hash is stored, so it cannot be
            shown again.
          </p>
          <CopyField value={freshUrl} label="Share URL" />
        </div>
      ) : null}

      <form onSubmit={create}>
        <div className="row">
          <label>
            <span>Expires (optional)</span>
            <input
              type="datetime-local"
              name="expiresAt"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </label>
          <label>
            <span>Max downloads (optional)</span>
            <input
              type="number"
              name="maxDownloads"
              min={1}
              value={maxDownloads}
              onChange={(e) => setMaxDownloads(e.target.value)}
            />
          </label>
          <label>
            <span>Password (optional, min 8)</span>
            <input
              type="password"
              name="linkPassword"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create link'}
        </button>
      </form>

      <h2 style={{ marginTop: 20 }}>Existing links</h2>
      {links.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Link</th>
              <th>Status</th>
              <th>Downloads</th>
              <th>Expires</th>
              <th>Created by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.id}>
                <td>
                  …{link.tokenTail}
                  {link.hasPassword ? <span className="badge">password</span> : null}
                </td>
                <td>{describe(link)}</td>
                <td>
                  {link.downloadCount}
                  {link.maxDownloads !== null ? ` / ${link.maxDownloads}` : ''}
                </td>
                <td className="muted">
                  {link.expiresAt ? formatDate(link.expiresAt) : 'never'}
                </td>
                <td className="muted">{link.createdBy.displayName ?? '—'}</td>
                <td className="actions">
                  {link.canRevoke && !link.revokedAt ? (
                    <button className="link danger" type="button" onClick={() => void revoke(link.id)}>
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted" style={{ marginTop: 14 }}>
        Expiry shown in your local time. Links never grant workspace access.
      </p>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </dialog>
  );
}
