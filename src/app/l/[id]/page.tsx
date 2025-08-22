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

  const [order, setOrder] = useState<string[]>([]);        // my ranking order
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  async function loadCandidates() {
    setErr(null);
    const res = await fetch(`/api/lobbies/${lobbyId}/candidates`, { cache: 'no-store' });
    const json = await res.json();
    if (!res.ok) setErr(json.error ?? 'failed to load candidates');
    else setCands(json.candidates);
  }

  async function loadMyRanking() {
    const res = await fetch(`/api/lobbies/${lobbyId}/rankings`, { cache: 'no-store' });
    const json = await res.json();
    if (res.ok && Array.isArray(json.ranking) && json.ranking.length) {
      setOrder(json.ranking);
    }
  }

  useEffect(() => {
    (async () => {
      await loadCandidates();
      await loadMyRanking();
    })();
  }, []);

  useEffect(() => {
    // If no saved order yet, default to candidate list order
    if (cands.length && order.length === 0) {
      setOrder(cands.map(c => c.id));
    }
  }, [cands]);

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
      else {
        setNewTitle('');
        await loadCandidates();
        // If user hasn't customized order, sync order to list
        setOrder(prev => prev.length ? prev : (json.candidates?.map?.((c: Candidate) => c.id) ?? []));
      }
    } finally { setLoading(false); }
  }

  function move(idx: number, dir: -1 | 1) {
    setOrder(prev => {
      const next = prev.slice();
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  async function saveRanking() {
    setErr(null);
    setSaveMsg(null);
    if (!order.length) { setErr('No ranking to save'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/lobbies/${lobbyId}/rankings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ranking: order }),
      });
      const json = await res.json();
      if (!res.ok) setErr(json.error ?? 'save failed');
      else setSaveMsg('Ranking saved ✅');
    } finally { setSaving(false); }
  }

  const byId = useMemo(() => new Map(cands.map(c => [c.id, c])), [cands]);

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-3xl p-6 space-y-6">
        <h1 className="text-2xl font-bold">Lobby: {lobbyId.slice(0, 8)}…</h1>

        {/* Add */}
        <section className="space-y-2">
          <h2 className="font-semibold">Add candidate</h2>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded border px-3 py-2"
              placeholder="Movie title, e.g., Dune (2021)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
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

        {/* Rank */}
        <section className="space-y-2">
          <h2 className="font-semibold">Your ranking</h2>
          {!order.length && <div className="text-gray-500">No items to rank yet</div>}
          <ul className="space-y-1">
            {order.map((cid, idx) => {
              const c = byId.get(cid);
              if (!c) return null;
              return (
                <li key={cid} className="flex items-center gap-2 rounded border px-3 py-2">
                  <span className="text-sm text-gray-600 w-8">#{idx + 1}</span>
                  <span className="flex-1">{c.title}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => move(idx, -1)}
                      className="rounded border px-2 py-1 hover:bg-gray-50"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(idx, +1)}
                      className="rounded border px-2 py-1 hover:bg-gray-50"
                    >
                      ↓
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <button
            onClick={saveRanking}
            disabled={saving || !order.length}
            className="rounded border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save ranking'}
          </button>

          {saveMsg && <div className="text-green-700">{saveMsg}</div>}
        </section>

        {err && <div className="p-3 rounded border bg-red-50 text-red-700">{err}</div>}
      </div>
    </main>
  );
}
