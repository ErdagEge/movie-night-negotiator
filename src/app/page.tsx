'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

/* ---------- tiny UI primitives ---------- */
function Card({
  title,
  subtitle,
  children,
  footer,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={
        'rounded-2xl border border-white/10 bg-white/5 shadow-lg backdrop-blur-sm ' +
        'dark:border-white/10 dark:bg-white/5 ' + className
      }
    >
      {(title || subtitle) && (
        <header className="px-5 pt-5">
          {typeof title === 'string' ? (
            <h2 className="text-lg font-semibold">{title}</h2>
          ) : (
            title
          )}
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
      {footer && <div className="px-5 pb-5">{footer}</div>}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-sm font-medium text-gray-300">{children}</label>;
}

function Button({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={
        'rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50 ' +
        (props.className ?? '')
      }
    >
      {children}
    </button>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        'w-full rounded-lg border border-white/15 bg-black/10 px-3 py-2 outline-none ' +
        'placeholder:text-gray-500 focus:border-white/30 ' +
        (props.className ?? '')
      }
    />
  );
}

/* ---------- join-by-code box (accepts code or full short link) ---------- */
function extractInviteCode(input: string): string | null {
  if (!input) return null;
  const s = input.trim();
  const m = s.match(/(?:\/j\/)?([a-fA-F0-9]{8})(?:\b|$)/);
  return m ? m[1].toLowerCase() : null;
}

function JoinByCodeBox() {
  const router = useRouter();
  const [raw, setRaw] = useState('');
  const code = extractInviteCode(raw);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!code) {
      setErr('Enter an 8-character invite code');
      return;
    }
    router.push(`/j/${code}`);
  }

  async function pasteFromClipboard() {
    try {
      const txt = await navigator.clipboard.readText();
      setRaw(txt);
    } catch {
      setErr('Clipboard unavailable — paste manually.');
    }
  }

  return (
    <Card title="Join a lobby by code">
      <div className="flex gap-2">
        <Input
          placeholder="e.g. a1b2c3d4 or https://…/j/a1b2c3d4"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-label="Invite code"
        />
        <Button type="button" onClick={pasteFromClipboard} title="Paste from clipboard">
          Paste
        </Button>
        <Button type="button" onClick={submit} disabled={!code}>
          Join
        </Button>
      </div>
      {err ? (
        <div className="mt-2 text-sm text-red-500">{err}</div>
      ) : (
        raw && !code && <div className="mt-2 text-sm text-gray-500">Expecting an 8-char code.</div>
      )}
    </Card>
  );
}

/* ---------- page ---------- */
export default function HomePage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function createLobby() {
    setErr(null);
    const name = title.trim() || 'Movie night';
    setBusy(true);
    try {
      const res = await fetch('/api/lobbies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: name }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? 'Failed to create lobby');
        return;
        }
      setTitle('');
      router.push(`/l/${json.lobbyId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      {/* Hero / branding */}
      <div className="mb-8">
        <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 shadow-lg backdrop-blur-sm">
          <div className="text-2xl">🎬</div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Movie Night Negotiator</h1>
            <p className="mt-1 text-sm text-gray-400">Create a lobby, invite friends, rank titles, and pick a fair winner.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Create lobby */}
        <Card title="Create a lobby" subtitle="Step 1">
          <div className="space-y-2">
            <Label>Lobby title</Label>
            <Input
              placeholder="e.g., Friday Movie Night"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createLobby()}
            />
            <div className="pt-2">
              <Button onClick={createLobby} disabled={busy}>
                {busy ? 'Creating…' : 'Create Lobby'}
              </Button>
            </div>
            {err && <div className="text-sm text-red-500">{err}</div>}
          </div>
        </Card>

        {/* Join by code */}
        <JoinByCodeBox />
      </div>
    </main>
  );
}
