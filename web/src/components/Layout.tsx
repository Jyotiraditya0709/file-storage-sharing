import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.js';

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <>
      <header className="app">
        <div className="inner">
          <Link className="brand" to="/workspaces">
            File Storage &amp; Sharing
          </Link>
          <div className="spacer" />
          {user ? (
            <>
              <span className="muted">{user.email}</span>
              <button type="button" onClick={() => void logout()}>
                Log out
              </button>
            </>
          ) : null}
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
