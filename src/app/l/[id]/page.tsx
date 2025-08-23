'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

type Candidate = { id: string; title: string; created_at: string; added_by: string | null };

function getSavedName() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('mn_name') || '';
}
function saveName(n: string) {
  try { localStorage.setItem('mn_name', n); } catch {}
}

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

  const [myName, setMyName] = useState('');
  const [members, setMembers] = useState<Array<{user_id:string; role:string; nickname:string|null}>>([]);

  async function loadCandidates(): Promise<Candidate[]> {
    setErr(null);
    const res = await fetch(`/api/lobbies/${lobbyId}/candidates`, { cache: 'no-store' });
    const json = await res.json();
    if (!res.ok) {
      setErr(json.error ?? 'failed to load candidates');
      return [];
    }
    setCands(json.candidates);
    return json.candidates as Candidate[];
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
      // 1) ensure membership
      const initialName = getSavedName();
      setMyName(initialName);
      await fetch(`/api/lobbies/${lobbyId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: initialName || undefined }),
      });

      // 2) load candidates & my ranking
      await loadCandidates();
      await loadMyRanking();

      // 3) start members polling (simple for now; Realtime later)
      const loadMembers = async () => {
        const res = await fetch(`/api/lobbies/${lobbyId}/members`, { cache: 'no-store' });
        const json = await res.json();
        if (res.ok) setMembers(json.members);
      };
      await loadMembers();
      const iv = setInterval(loadMembers, 5000);
      return () => clearInterval(iv);
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
      if (!res.ok) { setErr(json.error ?? 'add failed'); return; }

      setNewTitle('');
      // refetch candidates and merge any new IDs into order
      const updated = await loadCandidates();
      setOrder(prev => {
        const updatedIds = updated.map(c => c.id);
        if (prev.length === 0) return updatedIds;      // initial auto-fill
        const setPrev = new Set(prev);
        const toAppend = updatedIds.filter(id => !setPrev.has(id));
        return toAppend.length ? [...prev, ...toAppend] : prev;
      });
    } finally {
      setLoading(false);
    }
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

        <section className="space-y-2">
          <h2 className="font-semibold">You</h2>
          <div className="flex gap-2">
            <input
              className="rounded border px-3 py-2"
              placeholder="Your name (optional)"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  saveName(myName);
                  await fetch(`/api/lobbies/${lobbyId}/join`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nickname: myName || undefined }),
                  });
                }
              }}
            />
            <button
              className="rounded border px-3 py-2 hover:bg-gray-50"
              onClick={async () => {
                saveName(myName);
                await fetch(`/api/lobbies/${lobbyId}/join`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ nickname: myName || undefined }),
                });
              }}
            >
              Save
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Members</h2>
          {!members.length && <div className="text-gray-500">Nobody here yet</div>}
          <ul className="space-y-1">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between rounded border px-3 py-2">
                <span>{m.nickname || 'Guest'}</span>
                <span className="text-xs uppercase tracking-wide opacity-60">{m.role}</span>
              </li>
            ))}
          </ul>
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
      {/* Finalize (host only; server enforces) */}
      <section className="space-y-2 border-t pt-4">
        <h2 className="font-semibold">Finalize</h2>
        <FinalizePanel lobbyId={lobbyId} cands={cands} />
      </section>      
    </main>
  );
}

function FinalizePanel({
  lobbyId,
  cands,
}: { lobbyId: string; cands?: { id: string; title: string }[] }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number> | null>(null);

  async function finalize() {
    setBusy(true); setErr(null); setWinner(null); setScores(null);
    try {
      const res = await fetch(`/api/lobbies/${lobbyId}/finalize`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) { setErr(json.error ?? 'finalize failed'); return; }
      const r = json.result;
      setWinner(r?.winner_candidate_id ?? null);
      setScores(r?.scores ?? null);
    } finally { setBusy(false); }
  }

  const winnerTitle =
    winner && cands?.find(c => c.id === winner)?.title;

  return (
    <div className="space-y-2">
      <button
        onClick={finalize}
        disabled={busy}
        className="rounded border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? 'Finalizing…' : 'Finalize & Compute Winner'}
      </button>

      {err && <div className="p-2 rounded border bg-red-50 text-red-700">{err}</div>}

      {winner && (
        <div className="
          p-3 rounded border
          border-emerald-600/30
          bg-emerald-100 text-emerald-900
          dark:bg-emerald-900/30 dark:text-emerald-100
        ">
          <div className="font-semibold text-emerald-800 dark:text-emerald-200">
            Winner:
          </div>
          <div className="mt-1">
            {winnerTitle && <div className="font-medium">{winnerTitle}</div>}
            <div className="text-xs opacity-75 font-mono break-all">{winner}</div>
          </div>

          {scores && (
            <div className="mt-3">
              <div className="font-semibold text-emerald-800 dark:text-emerald-200">Scores</div>
              <pre className="text-xs rounded border bg-black/5 dark:bg-white/10 p-2 overflow-auto">
                {JSON.stringify(scores, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

