import { useEffect, useState } from 'react';

export function App() {
  const [status, setStatus] = useState('…');

  useEffect(() => {
    let cancelled = false;

    fetch('/api/health')
      .then((res) => res.json() as Promise<{ status: string }>)
      .then((body) => {
        if (!cancelled) setStatus(body.status);
      })
      .catch(() => {
        if (!cancelled) setStatus('unreachable');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>File Storage &amp; Sharing</h1>
      <p>status: {status}</p>
    </main>
  );
}
