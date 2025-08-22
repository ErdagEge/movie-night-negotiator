'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
    } catch (e: any) {
      setError(String(e?.message ?? e));
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
      </div>
    </main>
  );
}
