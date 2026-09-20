import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { type Invitation, type Role, type Workspace, api } from '../api.js';
import { formatDate } from '../format.js';
import { CopyField } from './CopyField.js';
import { ErrorBanner } from './ErrorBanner.js';

const INVITABLE: Role[] = ['admin', 'member', 'viewer'];

export function InvitationsPanel({ workspace }: { workspace: Workspace }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { invitations: list } = await api.listInvitations(workspace.id);
      setInvitations(list);
    } catch (err) {
      setError(err);
    }
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { inviteUrl } = await api.createInvitation(workspace.id, { email, role });
      setFreshUrl(inviteUrl);
      setEmail('');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (invitation: Invitation) => {
    setError(null);
    try {
      await api.revokeInvitation(workspace.id, invitation.id);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <section className="panel">
      <h2>Pending invitations</h2>
      <ErrorBanner error={error} />

      {freshUrl ? (
        <div className="notice">
          <p style={{ marginTop: 0 }}>
            <strong>No email is sent.</strong> Copy this URL and send it yourself; it is shown
            once.
          </p>
          <CopyField value={freshUrl} label="Invite URL" />
        </div>
      ) : null}

      <form className="row" onSubmit={invite}>
        <input
          type="email"
          name="inviteEmail"
          placeholder="person@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <select
          aria-label="Invite role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          {INVITABLE.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button className="primary" type="submit" disabled={busy}>
          Invite
        </button>
      </form>

      {invitations.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>
          None pending.
        </p>
      ) : (
        <ul className="plain" style={{ marginTop: 12 }}>
          {invitations.map((invitation) => (
            <li key={invitation.id} className="row">
              <span>{invitation.email}</span>
              <span className="badge">{invitation.role}</span>
              <span className="muted">expires {formatDate(invitation.expiresAt)}</span>
              <div className="spacer" style={{ flex: 1 }} />
              <button className="link danger" type="button" onClick={() => void revoke(invitation)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
