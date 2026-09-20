import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppError, type InvitationPreview, api } from '../api.js';
import { useAuth } from '../auth.js';
import { ErrorBanner } from '../components/ErrorBanner.js';

export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const { user, loading: authLoading, logout } = useAuth();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { invitation } = await api.previewInvitation(token);
      setPreview(invitation);
    } catch (err) {
      if (err instanceof AppError && err.status === 404) setGone(true);
      else setError(err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async () => {
    setError(null);
    setBusy(true);
    try {
      const { workspaceId } = await api.acceptInvitation(token);
      navigate(`/workspaces/${workspaceId}`, { replace: true });
    } catch (err) {
      if (err instanceof AppError && err.status === 404) {
        setError(
          new AppError(
            404,
            'NOT_FOUND',
            'This invitation is not for this account, or it is no longer valid.',
          ),
        );
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading || authLoading) return <div className="centered">Loading…</div>;

  if (gone || !preview) {
    return (
      <div className="centered">
        <h1>Invitation unavailable</h1>
        <p className="muted">It may have been revoked, already used, or expired.</p>
      </div>
    );
  }

  const next = `/invite/${token}`;

  return (
    <div className="centered">
      <h1>Join “{preview.workspaceName}”</h1>
      <p className="muted">
        Invited as <span className="badge">{preview.role}</span> for {preview.email}
      </p>
      <ErrorBanner error={error} />

      {user ? (
        <>
          <p>
            You are signed in as <strong>{user.email}</strong>.
          </p>
          <div className="row">
            <button className="primary" type="button" disabled={busy} onClick={() => void accept()}>
              {busy ? 'Accepting…' : 'Accept invitation'}
            </button>
            <button type="button" onClick={() => void logout()}>
              Use a different account
            </button>
          </div>
        </>
      ) : (
        <>
          <p>Sign in with that address to accept.</p>
          <div className="row">
            {/* Email prefilled, and we come straight back here afterwards. */}
            <Link
              to={`/signup?email=${encodeURIComponent(preview.email)}&next=${encodeURIComponent(next)}`}
            >
              <button className="primary" type="button">
                Sign up
              </button>
            </Link>
            <Link to={`/login?next=${encodeURIComponent(next)}`}>
              <button type="button">Log in</button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
