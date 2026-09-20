import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth.js';
import { Layout } from './components/Layout.js';
import { RequireAuth } from './components/RequireAuth.js';
import { AcceptInvitePage } from './pages/AcceptInvitePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { PublicSharePage } from './pages/PublicSharePage.js';
import { SignupPage } from './pages/SignupPage.js';
import { WorkspaceListPage } from './pages/WorkspaceListPage.js';
import { WorkspacePage } from './pages/WorkspacePage.js';

export function App() {
  return (
    <AuthProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/workspaces" replace />} />

          {/* Public: a share link and an invitation must work logged out. */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/s/:token" element={<PublicSharePage />} />
          <Route path="/invite/:token" element={<AcceptInvitePage />} />

          <Route
            path="/workspaces"
            element={
              <RequireAuth>
                <WorkspaceListPage />
              </RequireAuth>
            }
          />
          <Route
            path="/workspaces/:wid"
            element={
              <RequireAuth>
                <WorkspacePage />
              </RequireAuth>
            }
          />

          <Route path="*" element={<p>Not found.</p>} />
        </Routes>
      </Layout>
    </AuthProvider>
  );
}
