'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

type Candidate = { id: string; title: string; created_at: string; added_by: string | null };

export default function LobbyPage() {
  const { id } = useParams<{ id: string }>();
  const lobbyId = String(id);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    const res = await fetch(`/api/lobbies/${lobbyId}/candidates`, { cache: 'no-store' });
    const json = await res.json();
    if (!res.ok) setErr(json.error ?? 'failed to load');
    else setCands(json.candidates);
  }

  async function addCandidate() {
    setErr(null);
    if (!newTitle.trim()) { setErr('Enter a title'); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/lobbies/${lobbyId}/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      const json = await res.json();
      if (!res.ok) setErr(json.error ?? 'add failed');
      else { setNewTitle(''); await load(); }
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // Ranking state will come in Phase 11
  const orderedIds = useMemo(() => cands.map(c => c.id), [cands]);

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-2xl p-6 space-y-6">
        <h1 className="text-2xl font-bold">Lobby: {lobbyId.slice(0, 8)}…</h1>

        <section className="space-y-2">
          <h2 className="font-semibold">Add candidate</h2>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded border px-3 py-2"
              placeholder="Movie title, e.g., Dune (2021)"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCandidate()}
            />
            <button
              onClick={addCandidate}
              disabled={loading}
              className="rounded border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? 'Adding…' : 'Add'}
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Candidates</h2>
          {!cands.length && <div className="text-gray-500">No candidates yet</div>}
          <ul className="space-y-1">
            {cands.map((c, idx) => (
              <li key={c.id} className="flex items-center justify-between rounded border px-3 py-2">
                <span className="text-sm text-gray-600 w-10">#{idx + 1}</span>
                <span className="flex-1">{c.title}</span>
                <span className="text-xs text-gray-400">{c.id.slice(0, 6)}</span>
              </li>
            ))}
          </ul>
        </section>

        {err && <div className="p-3 rounded border bg-red-50 text-red-700">{err}</div>}
      </div>
    </main>
  );
}
