'use client';

import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
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

  // Role + short link
  const [isHost, setIsHost] = useState(false);
  const [shortCode, setShortCode] = useState<string | null>(null);

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
  const [note, setNote] = useState<string | null>(null);

  // Derived: merge DB members with presence-only users
  const displayMembers = useMemo(() => {
    const byId = new Map(members.map(m => [m.user_id, { ...m }]));
    for (const [uid, info] of Object.entries(presenceMap)) {
      if (!byId.has(uid)) {
        byId.set(uid, { user_id: uid, role: 'guest', nickname: info.nickname ?? null });
      } else {
        const m = byId.get(uid)!;
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
      const joinRes = await fetch(`/api/lobbies/${lobbyId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: myName || undefined }),
      });
      const joinJson = await joinRes.json();
      if (joinRes.ok) {
        if (typeof joinJson?.code === 'string') setShortCode(joinJson.code);
        setIsHost(joinJson?.role === 'host');
      }

      await loadCandidates();
      await loadMyRanking();
      await loadMembersOnce();
      await loadProgress();

      // who am I
      const me = await fetch('/api/me').then(r => r.json());
      if (mounted) setUserId(me.userId);

      // realtime: members
      membersChannel = supabase
        .channel(`lobby:${lobbyId}:members`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'lobby_members', filter: `lobby_id=eq.${lobbyId}` },
          async () => { if (!mounted) return; await loadMembersOnce(); await loadProgress(); }
        )
        .subscribe();

      // presence
      presenceChannel = supabase.channel(`presence:lobby:${lobbyId}`, { config: { presence: { key: me.userId } } });
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
      await presenceChannel.subscribe(async (status: ChannelState) => {
        if (status === 'SUBSCRIBED' && presenceChannel) {
          await presenceChannel.track({ userId: me.userId, nickname: myName || 'Guest' });
        }
      });
      presenceChannelRef.current = presenceChannel;

      // fallback poll
      pollTimer = setInterval(async () => { await loadMembersOnce(); await loadProgress(); }, 7000);
    })();

    return () => {
      mounted = false;
      if (membersChannel) supabase.removeChannel(membersChannel);
      if (presenceChannel) supabase.removeChannel(presenceChannel);
      if (pollTimer) clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyId]);

  // If no saved order yet, follow candidates list order
  useEffect(() => {
    if (cands.length && order.length === 0) {
      setOrder(cands.map(c => c.id));
    }
  }, [cands, order.length]);

  // realtime: candidates
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`lobby:${lobbyId}:candidates`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'candidates', filter: `lobby_id=eq.${lobbyId}`,
      }, async () => {
        const updated = await loadCandidates();
        await loadProgress();
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

  // realtime: rankings -> progress
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`lobby:${lobbyId}:rankings`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'rankings', filter: `lobby_id=eq.${lobbyId}`,
      }, () => { loadProgress(); })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyId]);

  // --- Actions ---
  function onDragEnd(result: DropResult) {
    const { source, destination } = result;
    if (!destination) return;
    if (source.index === destination.index) return;

    setOrder(prev => {
      const next = prev.slice();
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      return next;
    });
  }

  async function addCandidate() {
    setErr(null);
    if (!newTitle.trim()) { setErr('Enter a title'); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/lobbies/${lobbyId}/candidates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error ?? 'add failed'); return; }
      setNewTitle('');
      const updated = await loadCandidates(); await loadProgress();
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
    setErr(null); setSaveMsg(null);
    if (!order.length) { setErr('No ranking to save'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/lobbies/${lobbyId}/rankings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ranking: order }),
      });
      const json = await res.json();
      if (!res.ok) setErr(json.error ?? 'save failed'); else setSaveMsg('Ranking saved ✅');
      await loadProgress();
    } finally { setSaving(false); }
  }

  async function deleteCandidate(cid: string) {
    if (!isHost) { setNote('Host only'); return; }
    const ok = window.confirm('Delete this title for everyone?');
    if (!ok) return;
    const res = await fetch(`/api/lobbies/${lobbyId}/candidates/${cid}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setErr((json as { error?: string }).error ?? 'delete failed');
  }

  async function regenerateCode() {
    if (!isHost) { setNote('Host only'); return; }
    const ok = window.confirm('Regenerate invite code? Old link will stop working.');
    if (!ok) return;
    const res = await fetch(`/api/lobbies/${lobbyId}/code`, { method: 'POST' });
    const json = await res.json();
    if (res.ok) { setShortCode(json.code); alert('New short link copied to clipboard? Click copy again if needed.'); }
    else setErr(json.error ?? 'could not regenerate code');
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

            <button
              disabled={!shortCode}
              onClick={async () => {
                if (!shortCode) return;
                const shortUrl = `${window.location.origin}/j/${shortCode}`;
                try { await navigator.clipboard.writeText(shortUrl); alert('Short link copied!'); }
                catch { alert(shortUrl); }
              }}
              className="rounded border px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Copy short link
            </button>

            {isHost && (
              <button
                onClick={regenerateCode}
                className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
                title="Host only"
              >
                Regenerate code
              </button>
            )}
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
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ nickname: myName || undefined }),
                    });
                    const chan = presenceChannelRef.current;
                    if (chan) { try { await chan.track({ userId, nickname: myName || 'Guest' }); } catch {} }
                  }
                }}
              />
              <button
                className="rounded border px-3 py-2 hover:bg-gray-50"
                onClick={async () => {
                  saveName(myName);
                  await fetch(`/api/lobbies/${lobbyId}/join`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nickname: myName || undefined }),
                  });
                  const chan = presenceChannelRef.current;
                  if (chan) { try { await chan.track({ userId, nickname: myName || 'Guest' }); } catch {} }
                }}
              >
                Save
              </button>
            </div>
          </section>

          {/* Your ranking (host can delete titles) */}
          <section className="space-y-2">
            <h2 className="font-semibold">Your ranking</h2>
            {!order.length && <div className="text-gray-500">No items to rank yet</div>}
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="rankingList" direction="vertical">
                {(dropProvided) => (
                  <ul
                    ref={dropProvided.innerRef}
                    {...dropProvided.droppableProps}
                    className="space-y-1"
                  >
                    {order.map((cid, idx) => {
                      const c = byId.get(cid);
                      if (!c) return null;

                      return (
                        <Draggable key={cid} draggableId={cid} index={idx}>
                          {(dragProvided, snapshot) => (
                            <li
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              style={dragProvided.draggableProps.style}
                              className={`flex items-center gap-2 rounded border px-3 py-2 transition
                                ${snapshot.isDragging ? 'shadow-md ring-1 ring-black/10 bg-white/70 dark:bg-zinc-900/70' : ''}`}
                            >
                              {/* optional grip icon for affordance */}
                              <span className="px-1 text-gray-500 select-none" aria-hidden>≡</span>

                              <span className="text-sm text-gray-600 w-8">#{idx + 1}</span>
                              <span className="flex-1">{c.title}</span>

                              {/* keep keyboard fallback */}
                              <div className="flex gap-1">
                                <button type="button" onClick={() => move(idx, -1)} className="rounded border px-2 py-1 hover:bg-gray-50">↑</button>
                                <button type="button" onClick={() => move(idx, +1)} className="rounded border px-2 py-1 hover:bg-gray-50">↓</button>
                                {/* host delete button stays if you have it */}
                              </div>
                            </li>
                          )}
                        </Draggable>
                      );
                    })}

                    {dropProvided.placeholder}
                  </ul>
                )}
              </Droppable>
            </DragDropContext>


            <button
              onClick={saveRanking}
              disabled={saving || !order.length}
              className="rounded border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save ranking'}
            </button>

            {saveMsg && <div className="text-green-700">{saveMsg}</div>}
            {note && <div className="text-xs text-gray-500">{note}</div>}
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
            <FinalizePanel
              lobbyId={lobbyId}
              cands={cands}
              canFinalize={progress.candidateCount > 0 && progress.fullBallots > 0}
              isHost={isHost}
            />
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
  isHost,
}: {
  lobbyId: string;
  cands?: { id: string; title: string }[];
  canFinalize: boolean;
  isHost: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number> | null>(null);

  // AI rationale
  const [rationale, setRationale] = useState<string | null>(null);
  const [rBusy, setRBusy] = useState(false);
  const [rErr, setRErr] = useState<string | null>(null);

  async function finalize() {
    setBusy(true); setErr(null); setWinner(null); setScores(null); setRationale(null);
    try {
      const res = await fetch(`/api/lobbies/${lobbyId}/finalize`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) { setErr(json.error ?? 'finalize failed'); return; }
      const r = json.result;
      setWinner(r?.winner_candidate_id ?? null);
      setScores(r?.scores ?? null);

      // Try to fetch any existing rationale
      try {
        const rres = await fetch(`/api/lobbies/${lobbyId}/rationale`, { method: 'GET', cache: 'no-store' });
        const rjson = await rres.json();
        if (rres.ok) setRationale(rjson?.rationale ?? null);
      } catch { /* ignore */ }
    } finally { setBusy(false); }
  }

  const winnerTitle = winner && cands?.find(c => c.id === winner)?.title;

  async function generateRationale() {
    setRBusy(true); setRErr(null);
    try {
      const res = await fetch(`/api/lobbies/${lobbyId}/rationale`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) { setRErr(json.error ?? 'failed to generate'); return; }
      setRationale(json.rationale ?? '');
    } finally { setRBusy(false); }
  }

  const disabled = busy || !canFinalize || !isHost;

  return (
    <div className="space-y-2">
      <button
        onClick={finalize}
        disabled={disabled}
        className="rounded border px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
        title={isHost ? undefined : 'Host only'}
      >
        {busy ? 'Finalizing…' : 'Finalize & Compute Winner'}
      </button>
      {!canFinalize && <div className="text-xs text-gray-500">Need at least one complete ballot.</div>}
      {!isHost && <div className="text-xs text-gray-500">Host only.</div>}

      {err && <div className="p-2 rounded border bg-red-50 text-red-700">{err}</div>}

      {winner && (
        <div className="
          p-3 rounded border
          border-emerald-600/30
          bg-emerald-100 text-emerald-900
          dark:bg-emerald-900/30 dark:text-emerald-100
          space-y-3
        ">
          <div>
            <div className="font-semibold text-emerald-800 dark:text-emerald-200">Winner:</div>
            <div className="mt-1">
              {winnerTitle && <div className="font-medium">{winnerTitle}</div>}
              <div className="text-xs opacity-75 font-mono break-all">{winner}</div>
            </div>
          </div>

          {scores && (
            <div>
              <div className="font-semibold text-emerald-800 dark:text-emerald-200">Scores</div>
              <pre className="text-xs rounded border bg-black/5 dark:bg-white/10 p-2 overflow-auto">
                {JSON.stringify(scores, null, 2)}
              </pre>
            </div>
          )}

          <div className="pt-2 border-t border-emerald-600/20 dark:border-emerald-300/10">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-emerald-800 dark:text-emerald-200">AI Rationale</div>
              <button
                onClick={generateRationale}
                disabled={rBusy || !isHost}
                className="rounded border px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
                title={isHost ? undefined : 'Host only'}
              >
                {rBusy ? 'Generating…' : (rationale ? 'Regenerate' : 'Generate')}
              </button>
            </div>
            {rErr && <div className="mt-2 p-2 rounded border bg-red-50 text-red-700">{rErr}</div>}
            {rationale ? (
              <p className="mt-2 text-sm leading-relaxed">{rationale}</p>
            ) : (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                {isHost ? 'Click “Generate” to produce a short, friendly blurb (cached).' : 'Host can generate a short blurb after finalizing.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
