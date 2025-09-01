'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

function extractInviteCode(input: string): string | null {
  if (!input) return null;
  const s = input.trim();
  // match plain code or “…/j/<code>”
  const m = s.match(/(?:\/j\/)?([a-fA-F0-9]{8})(?:\b|$)/);
  return m ? m[1].toLowerCase() : null;
}

export function JoinByCodeBox() {
  const router = useRouter();
  const [raw, setRaw] = useState('');
  const code = extractInviteCode(raw);
  const [err, setErr] = useState<string | null>(null);
  const disabled = !code;

  async function submit() {
    setErr(null);
    if (!code) { setErr('Enter an 8-character invite code'); return; }
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
    <section className="w-full max-w-xl rounded-lg border p-4 space-y-3">
      <h2 className="text-lg font-semibold">Join a lobby by code</h2>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border px-3 py-2"
          placeholder="e.g. a1b2c3d4 or https://…/j/a1b2c3d4"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-label="Invite code"
        />
        <button
          type="button"
          onClick={pasteFromClipboard}
          className="rounded border px-3 py-2 hover:bg-gray-50"
          title="Paste from clipboard"
        >
          Paste
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={disabled}
          className="rounded border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
        >
          Join
        </button>
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      {!err && raw && !code && (
        <div className="text-sm text-gray-500">Expecting an 8-char code.</div>
      )}
    </section>
  );
}


export default function Home() {
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ lobbyId: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function createLobby() {
    setError(null);
    setResult(null);
    if (!title.trim()) {
      setError('Please enter a lobby title.');
      return;
    }
    try {
      setCreating(true);
      const res = await fetch('/api/lobbies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to create lobby');
      } else {
        setResult(json);
        setTitle('');
        router.push(`/l/${json.lobbyId}`); // ← navigate to the lobby
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full p-6 space-y-4">
        <h1 className="text-3xl font-bold">🎬 Movie Night Negotiator</h1>
        <p className="text-gray-700">Step 1: Create a lobby.</p>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Lobby title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Friday Movie Night"
            className="w-full rounded border px-3 py-2"
          />
          <button
            onClick={createLobby}
            disabled={creating}
            className="rounded border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Lobby'}
          </button>
        </div>

        {error && (
          <div className="p-3 rounded border bg-red-50 text-red-700">
            {error}
          </div>
        )}

        {result && (
          <div className="p-3 rounded border bg-green-50">
            <div className="font-semibold">Lobby created!</div>
            <div>Title: {result.title}</div>
            <div className="break-all">ID: {result.lobbyId}</div>
          </div>
        )}
        <JoinByCodeBox />
      </div>
    </main>
  );
}
