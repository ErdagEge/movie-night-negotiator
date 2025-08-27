'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
type ChannelState = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

type Candidate = { id: string; title: string; created_at: string; added_by: string | null };
type Member = { user_id: string; role: string; nickname: string | null; joined_at?: string };
type Progress = { candidateCount: number; memberCount: number; fullBallots: number; myIsFull: boolean };

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

  // Candidates + ranking
  const [cands, setCands] = useState<Candidate[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [order, setOrder] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Members + presence
  const [myName, setMyName] = useState(getSavedName());
  const [members, setMembers] = useState<Member[]>([]);
  const [userId, setUserId] = useState<string>('');
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [presenceMap, setPresenceMap] =
    useState<Record<string, { nickname?: string }>>({});
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);

  // Progress
  const [progress, setProgress] = useState<Progress>({
    candidateCount: 0,
    memberCount: 0,
    fullBallots: 0,
    myIsFull: false,
  });

  // UX/errors
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Derived: merge DB members with presence-only users
  const displayMembers = useMemo(() => {
    const byId = new Map(members.map(m => [m.user_id, { ...m }]));
    for (const [uid, info] of Object.entries(presenceMap)) {
      if (!byId.has(uid)) {
        byId.set(uid, { user_id: uid, role: 'guest', nickname: info.nickname ?? null });
      } else {
        const m = byId.get(uid)!;
        // Prefer presence nickname for instant updates
        if (info.nickname) m.nickname = info.nickname;
      }
    }
    return Array.from(byId.values()).sort((a, b) => {
      if (a.role !== b.role) return a.role === 'host' ? -1 : 1;
      const na = (a.nickname ?? '').toLowerCase();
      const nb = (b.nickname ?? '').toLowerCase();
      if (na !== nb) return na < nb ? -1 : 1;
      return a.user_id.localeCompare(b.user_id);
    });
  }, [members, presenceMap]);

  // --- Data loaders ---
  async function loadCandidates(): Promise<Candidate[]> {
    setErr(null);
    const res = await fetch(`/api/lobbies/${lobbyId}/candidates`, { cache: 'no-store' });
    const json = await res.json();
    if (!res.ok) { setErr(json.error ?? 'failed to load candidates'); return []; }
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

  async function loadMembersOnce() {
    const res = await fetch(`/api/lobbies/${lobbyId}/members`, { cache: 'no-store' });
    const json = await res.json();
    if (res.ok) setMembers(json.members);
  }

  async function loadProgress() {
    const res = await fetch(`/api/lobbies/${lobbyId}/progress`, { cache: 'no-store' });
    const json = await res.json();
    if (res.ok) setProgress(json);
  }

  // --- Init: join lobby, prime data, wire realtime (members + presence) ---
  useEffect(() => {
    let mounted = true;

    const supabase = createClient();
    let membersChannel: RealtimeChannel | null = null;
    let presenceChannel: RealtimeChannel | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      // ensure membership with current nickname
      await fetch(`/api/lobbies/${lobbyId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: myName || undefined }),
      });

      await loadCandidates();
      await loadMyRanking();
      await loadMembersOnce();
      await loadProgress();

      // who am I (cookie uuid)?
      const me = await fetch('/api/me').then(r => r.json());
      if (mounted) setUserId(me.userId);

      // Realtime DB changes for members
      membersChannel = supabase
        .channel(`lobby:${lobbyId}:members`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'lobby_members',
            filter: `lobby_id=eq.${lobbyId}`,
          },
          async () => {
            if (!mounted) return;
            await loadMembersOnce();
            await loadProgress();
          }
        )
        .subscribe();

      // Presence: who's online in this lobby
      presenceChannel = supabase.channel(
        `presence:lobby:${lobbyId}`,
        { config: { presence: { key: me.userId } } }
      );

      presenceChannel
        .on('presence', { event: 'sync' }, () => {
          if (!mounted) return;
          const state = presenceChannel!.presenceState() as Record<string, Array<{ userId: string; nickname?: string }>>;
          const map: Record<string, { nickname?: string }> = {};
          for (const [uid, arr] of Object.entries(state)) {
            const last = arr[arr.length - 1] || {};
            map[uid] = { nickname: last?.nickname };
          }
          setPresenceMap(map);
          setOnlineIds(new Set(Object.keys(map)));
        });

      await presenceChannel.subscribe(
        async (status: ChannelState) => {
          if (status === 'SUBSCRIBED' && presenceChannel) {
            await presenceChannel.track({ userId: me.userId, nickname: myName || 'Guest' });
          }
        }
      );


      presenceChannelRef.current = presenceChannel;

      // Fallback: poll members every 7s (covers any missed realtime)
      pollTimer = setInterval(async () => {
        await loadMembersOnce();
        await loadProgress();
      }, 7000);
    })();

    return () => {
      mounted = false;
      if (membersChannel) supabase.removeChannel(membersChannel);
      if (presenceChannel) supabase.removeChannel(presenceChannel);
      if (pollTimer) clearInterval(pollTimer);
    };
    // deliberately not depending on myName; Save will re-track presence
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyId]);

  // If no saved order yet, follow candidates list order
  useEffect(() => {
    if (cands.length && order.length === 0) {
      setOrder(cands.map(c => c.id));
    }
  }, [cands, order.length]);

  // Realtime for candidates list
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`lobby:${lobbyId}:candidates`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'candidates',
        filter: `lobby_id=eq.${lobbyId}`,
      }, async () => {
        const updated = await loadCandidates();
        await loadProgress();
        // sync ranking: append new, drop deleted, keep order for existing
        setOrder(prev => {
          const ids = updated.map(c => c.id);
          if (prev.length === 0) return ids;
          const prevSet = new Set(prev);
          const appended = ids.filter(id => !prevSet.has(id));
          const kept = prev.filter(id => ids.includes(id));
          return appended.length ? [...kept, ...appended] : kept;
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyId]);

  // Realtime for rankings → update progress
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`lobby:${lobbyId}:rankings`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'rankings',
        filter: `lobby_id=eq.${lobbyId}`,
      }, () => { loadProgress(); })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyId]);

  // --- Actions ---
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
      // local optimistic refresh (realtime will also fire)
      const updated = await loadCandidates();
      await loadProgress();
      setOrder(prev => {
        const updatedIds = updated.map(c => c.id);
        if (prev.length === 0) return updatedIds;
        const setPrev = new Set(prev);
        const toAppend = updatedIds.filter(id => !setPrev.has(id));
        return toAppend.length ? [...prev, ...toAppend] : prev;
      });
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
      // progress will also update via realtime; this is a quick nudge
      await loadProgress();
    } finally { setSaving(false); }
  }

  const byId = useMemo(() => new Map(cands.map(c => [c.id, c])), [cands]);
  const canFinalize = progress.candidateCount > 0 && progress.fullBallots > 0;

  return (
    <main className="min-h-screen flex items-start justify-center">
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-8 p-6">
        {/* Left: inputs & lists */}
        <div className="md:col-span-2 space-y-6">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Lobby: {lobbyId.slice(0, 8)}…</h1>
            <button
              onClick={async () => {
                try { await navigator.clipboard.writeText(window.location.href); alert('Link copied!'); }
                catch { alert('Copy failed—copy from the address bar.'); }
              }}
              className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
            >
              Copy invite link
            </button>
          </div>

          {/* Add candidate */}
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

          {/* You / nickname */}
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
                    const chan = presenceChannelRef.current;
                    if (chan) {
                      try { await chan.track({ userId, nickname: myName || 'Guest' }); } catch {}
                    }
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
                  const chan = presenceChannelRef.current;
                  if (chan) {
                    try { await chan.track({ userId, nickname: myName || 'Guest' }); } catch {}
                  }
                }}
              >
                Save
              </button>
            </div>
          </section>

          {/* Your ranking */}
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
                      <button onClick={() => move(idx, -1)} className="rounded border px-2 py-1 hover:bg-gray-50">↑</button>
                      <button onClick={() => move(idx, +1)} className="rounded border px-2 py-1 hover:bg-gray-50">↓</button>
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

        {/* Right: finalize + members */}
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="font-semibold">Finalize</h2>
            <div className="text-sm text-gray-500">
              Full ballots: <span className="font-semibold">{progress.fullBallots}</span> / {progress.memberCount} · Candidates: {progress.candidateCount}
            </div>
            <FinalizePanel lobbyId={lobbyId} cands={cands} canFinalize={canFinalize} />
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold">Members</h2>
            {!displayMembers.length && <div className="text-gray-500">Nobody here yet</div>}
            <ul className="space-y-1">
              {displayMembers.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between rounded border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={onlineIds.has(m.user_id) ? 'text-green-500' : 'text-gray-400'}>●</span>
                    <span>{m.nickname || 'Guest'}</span>
                  </div>
                  <span className="text-xs uppercase tracking-wide opacity-60">{m.role}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}

function FinalizePanel({
  lobbyId,
  cands,
  canFinalize,
}: { lobbyId: string; cands?: { id: string; title: string }[]; canFinalize: boolean }) {
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

  const winnerTitle = winner && cands?.find(c => c.id === winner)?.title;

  return (
    <div className="space-y-2">
      <button
        onClick={finalize}
        disabled={busy || !canFinalize}
        className="rounded border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? 'Finalizing…' : 'Finalize & Compute Winner'}
      </button>
      {!canFinalize && (
        <div className="text-xs text-gray-500">Need at least one complete ballot.</div>
      )}

      {err && <div className="p-2 rounded border bg-red-50 text-red-700">{err}</div>}

      {winner && (
        <div className="
          p-3 rounded border
          border-emerald-600/30
          bg-emerald-100 text-emerald-900
          dark:bg-emerald-900/30 dark:text-emerald-100
        ">
          <div className="font-semibold text-emerald-800 dark:text-emerald-200">Winner:</div>
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
