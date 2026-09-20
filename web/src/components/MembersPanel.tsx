import { useCallback, useEffect, useState } from 'react';
import { type Member, type Role, type Workspace, api } from '../api.js';
import { ErrorBanner } from './ErrorBanner.js';

const ASSIGNABLE: Role[] = ['admin', 'member', 'viewer'];

export function MembersPanel({ workspace }: { workspace: Workspace }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const { members: list } = await api.listMembers(workspace.id);
      setMembers(list);
    } catch (err) {
      setError(err);
    }
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = async (member: Member, role: Role) => {
    setError(null);
    try {
      await api.updateMemberRole(workspace.id, member.userId, role);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const remove = async (member: Member) => {
    if (!window.confirm(`Remove ${member.email} from this workspace?`)) return;
    setError(null);
    try {
      await api.removeMember(workspace.id, member.userId);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  // The owner is never editable here; ownership moves only by transfer, which
  // this build does not ship.
  const editable = (member: Member) =>
    workspace.capabilities.canManageMembers && member.role !== 'owner';

  return (
    <section className="panel">
      <h2>Members</h2>
      <ErrorBanner error={error} />
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.userId}>
              <td>{member.displayName}</td>
              <td className="muted">{member.email}</td>
              <td>
                {editable(member) ? (
                  <select
                    aria-label={`Role for ${member.email}`}
                    value={member.role}
                    onChange={(e) => void changeRole(member, e.target.value as Role)}
                  >
                    {ASSIGNABLE.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="badge">{member.role}</span>
                )}
              </td>
              <td className="actions">
                {editable(member) ? (
                  <button className="link danger" type="button" onClick={() => void remove(member)}>
                    Remove
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
