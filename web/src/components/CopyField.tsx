import { useState } from 'react';

/**
 * Shown-once URLs (share links, invitations). The value is always visible in a
 * read-only input, because navigator.clipboard needs a secure context and would
 * fail silently on a plain-HTTP origin; the reader can still select and copy.
 */
export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div>
      {label ? <span className="muted">{label}</span> : null}
      <div className="copyfield">
        <input readOnly value={value} aria-label={label ?? 'URL'} onFocus={(e) => e.target.select()} />
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
