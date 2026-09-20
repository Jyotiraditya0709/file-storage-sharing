import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { safeNext } from '../format.js';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user } = await api.login({ email, password });
      setUser(user);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centered">
      <h1>Log in</h1>
      <ErrorBanner error={error} />
      <form className="stack" onSubmit={submit}>
        <label>
          <span>Email</span>
          <input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
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
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="muted" style={{ marginTop: 16 }}>
        No account?{' '}
        <Link to={`/signup?next=${encodeURIComponent(next)}`}>Sign up</Link>
      </p>
    </div>
  );
}
