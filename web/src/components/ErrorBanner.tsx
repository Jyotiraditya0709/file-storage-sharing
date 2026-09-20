import { AppError } from '../api.js';

/** Shows the server's own message. The UI never invents detail it wasn't told. */
export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;

  const message =
    error instanceof AppError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Something went wrong';

  return (
    <p className="banner" role="alert">
      {message}
    </p>
  );
}
