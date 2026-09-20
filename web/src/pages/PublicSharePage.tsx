import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AppError, type PublicLinkView, api, shareDownloadUrl } from '../api.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { formatBytes } from '../format.js';

/**
 * Anonymous by design: a share link grants this one document and nothing else,
 * and never workspace access.
 */
export function PublicSharePage() {
  const { token = '' } = useParams();

  const [view, setView] = useState<PublicLinkView | null>(null);
  const [gone, setGone] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setView(await api.publicLink(token));
      setGone(false);
    } catch (err) {
      // Unknown, revoked, expired, exhausted and deleted are one 404 by design.
      if (err instanceof AppError && err.status === 404) setGone(true);
      else setError(err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.unlockLink(token, password);
      setPassword('');
      await load();
    } catch (err) {
      // A wrong password is the same 404 as an unknown token; say the one true
      // thing rather than guessing which it was.
      if (err instanceof AppError && err.status === 404) {
        setError(new AppError(404, 'NOT_FOUND', 'That password did not work, or the link is no longer available.'));
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="centered">Loading…</div>;

  if (gone) {
    return (
      <div className="centered">
        <h1>Link unavailable</h1>
        <p className="muted">
          This link does not exist, or it has been revoked, expired, or used up.
        </p>
      </div>
    );
  }

  if (view?.requiresPassword && !view.document) {
    return (
      <div className="centered">
        <h1>Password required</h1>
        <p className="muted">This file is protected. Enter the password to continue.</p>
        <ErrorBanner error={error} />
        <form className="stack" onSubmit={unlock}>
          <label>
            <span>Password</span>
            <input
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>
      </div>
    );
  }

  const doc = view?.document;
  if (!doc) return <div className="centered">Loading…</div>;

  return (
    <div className="centered">
      <h1>{doc.name}</h1>
      <p className="muted">
        {formatBytes(doc.sizeBytes)} · {doc.mimeType}
        {doc.uploadedBy ? ` · shared by ${doc.uploadedBy}` : ''}
      </p>
      <ErrorBanner error={error} />
      <p>
        {/* A normal link: the server replies with Content-Disposition: attachment. */}
        <a className="button" href={shareDownloadUrl(token)} download>
          <button className="primary" type="button">
            Download
          </button>
        </a>
      </p>
      <p className="muted">This link grants this file only — not access to the workspace.</p>
    </div>
  );
}
