'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';

type ChannelState = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

type Candidate = { id: string; title: string; created_at: string; added_by: string | null };
type Member = { user_id: string; role: string; nickname: string | null; joined_at?: string };
type Progress = { candidateCount: number; memberCount: number; fullBallots: number; myIsFull: boolean };

/* ---------- tiny UI primitives ---------- */
function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  frost = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  frost?: boolean;
}) {
  const base =
    'rounded-2xl border shadow-lg border-white/10 ' +
    (frost ? 'bg-white/5 backdrop-blur-sm ' : 'bg-white/5 ');
  return (
    <section className={base + className}>
      {(title || subtitle || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            {typeof title === 'string' ? <h2 className="text-lg font-semibold">{title}</h2> : title}
            {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={
        'rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50 ' +
        (props.className ?? '')
      }
    />
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

/* ---------- helpers ---------- */
function getSavedName() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('mn_name') || '';
}
function saveName(n: string) {
  try {
    localStorage.setItem('mn_name', n);
  } catch {}
}

export default function LobbyPage() {
  const { id } = useParams<{ id: string }>();
  const lobbyId = String(id);

  // candidates + ranking
  const [cands, setCands] = useState<Candidate[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [order, setOrder] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // members + presence
  const [myName, setMyName] = useState(getSavedName());
  const [members, setMembers] = useState<Member[]>([]);
  const [userId, setUserId] = useState<string>('');
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [presenceMap, setPresenceMap] = useState<Record<string, { nickname?: string }>>({});
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);

  // broadcast fallback
  const broadcastChannelRef = useRef<RealtimeChannel | null>(null);

  // role + short link
  const [isHost, setIsHost] = useState(false);
  const [shortCode, setShortCode] = useState<string | null>(null);

  // progress
  const [progress, setProgress] = useState<Progress>({
    candidateCount: 0,
    memberCount: 0,
    fullBallots: 0,
    myIsFull: false,
  });

  // results: tick to trigger reloads for everyone when results change
  const [resultTick, setResultTick] = useState(0);

  // UX
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // derived members list
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

  /* ---------- data loaders ---------- */
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
    if (res.ok && Array.isArray(json.ranking) && json.ranking.length) setOrder(json.ranking);
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

  /* ---------- init: join + realtime ---------- */
  useEffect(() => {
    let mounted = true;

    const supabase = createClient();
    let membersChannel: RealtimeChannel | null = null;
    let presenceChannel: RealtimeChannel | null = null;
    let candidatesChannel: RealtimeChannel | null = null;
    let rankingsChannel: RealtimeChannel | null = null;
    let resultsChannel: RealtimeChannel | null = null;
    let broadcastChannel: RealtimeChannel | null = null;
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

      const me = await fetch('/api/me').then(r => r.json());
      if (mounted) setUserId(me.userId);

      membersChannel = supabase
        .channel(`lobby:${lobbyId}:members`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'lobby_members', filter: `lobby_id=eq.${lobbyId}` },
          async () => {
            if (!mounted) return;
            await loadMembersOnce();
            await loadProgress();
          }
        )
        .subscribe();

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

      // realtime: candidates
      candidatesChannel = supabase
        .channel(`lobby:${lobbyId}:candidates`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'candidates', filter: `lobby_id=eq.${lobbyId}` },
          async () => {
            const updated = await loadCandidates();
            await loadProgress();
            setOrder(prev => {
              const ids = updated.map(c => c.id);
              if (prev.length === 0) return ids;
              const prevSet = new Set(prev);
              const appended = ids.filter(id2 => !prevSet.has(id2));
              const kept = prev.filter(id2 => ids.includes(id2));
              return appended.length ? [...kept, ...appended] : kept;
            });
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'candidates', filter: `lobby_id=eq.${lobbyId}` },
          async () => {
            await loadCandidates();
            await loadProgress();
          }
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'candidates', filter: `lobby_id=eq.${lobbyId}` },
          async () => {
            const updated = await loadCandidates();
            await loadProgress();
            setOrder(prev => prev.filter(id2 => updated.some(c => c.id === id2)));
          }
        )
        .subscribe();

      // realtime: rankings -> progress
      rankingsChannel = supabase
        .channel(`lobby:${lobbyId}:rankings`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'rankings', filter: `lobby_id=eq.${lobbyId}` },
          () => {
            loadProgress();
          }
        )
        .subscribe();

      // realtime: results — notify everyone to reload results
      resultsChannel = supabase
        .channel(`lobby:${lobbyId}:results`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'results', filter: `lobby_id=eq.${lobbyId}` },
          () => setResultTick(t => t + 1)
        )
        .subscribe();

      // broadcast fallback: instantly refresh candidates for all peers
      broadcastChannel = supabase
        .channel(`broadcast:lobby:${lobbyId}`, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'candidates_changed' }, async () => {
          const updated = await loadCandidates();
          await loadProgress();
          setOrder(prev => {
            const ids = updated.map(c => c.id);
            if (prev.length === 0) return ids;
            const prevSet = new Set(prev);
            const appended = ids.filter(id2 => !prevSet.has(id2));
            const kept = prev.filter(id2 => ids.includes(id2));
            return appended.length ? [...kept, ...appended] : kept;
          });
        })
        .subscribe();
      broadcastChannelRef.current = broadcastChannel;

      // fallback poll (gentle)
      pollTimer = setInterval(async () => {
        await Promise.all([loadMembersOnce(), loadProgress(), loadCandidates()]);
      }, 7000);
    })();

    return () => {
      mounted = false;
      if (membersChannel) supabase.removeChannel(membersChannel);
      if (presenceChannel) supabase.removeChannel(presenceChannel);
      if (candidatesChannel) supabase.removeChannel(candidatesChannel);
      if (rankingsChannel) supabase.removeChannel(rankingsChannel);
      if (resultsChannel) supabase.removeChannel(resultsChannel);
      if (broadcastChannel) supabase.removeChannel(broadcastChannel);
      if (pollTimer) clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyId]);

  // refresh on focus (multi-tab resilience)
  useEffect(() => {
    function onFocus() {
      Promise.all([loadCandidates(), loadProgress()]).catch(() => {});
    }
    window.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyId]);

  // first-time order from candidates
  useEffect(() => {
    if (cands.length && order.length === 0) setOrder(cands.map(c => c.id));
  }, [cands, order.length]);

  /* ---------- actions ---------- */
  async function addCandidate() {
    setErr(null);
    if (!newTitle.trim()) {
      setErr('Enter a title');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/lobbies/${lobbyId}/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? 'add failed');
        return;
      }
      setNewTitle('');
      const updated = await loadCandidates();
      await loadProgress();
      setOrder(prev => {
        const updatedIds = updated.map(c => c.id);
        if (prev.length === 0) return updatedIds;
        const setPrev = new Set(prev);
        const toAppend = updatedIds.filter(id2 => !setPrev.has(id2));
        return toAppend.length ? [...prev, ...toAppend] : prev;
      });

      // broadcast to peers so host/guests refresh instantly
      try {
        await broadcastChannelRef.current?.send({
          type: 'broadcast',
          event: 'candidates_changed',
          payload: { lobbyId },
        });
      } catch {}
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
    if (!order.length) {
      setErr('No ranking to save');
      return;
    }
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
      await loadProgress();
    } finally {
      setSaving(false);
    }
  }

  async function deleteCandidate(cid: string) {
    if (!isHost) {
      setNote('Host only');
      return;
    }
    const ok = window.confirm('Delete this title for everyone?');
    if (!ok) return;

    const res = await fetch(`/api/lobbies/${lobbyId}/candidates/${cid}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr((json as { error?: string }).error ?? 'delete failed');
      return;
    }

    const updated = await loadCandidates();
    await loadProgress();
    setOrder(prev => prev.filter(id2 => updated.some(c => c.id === id2)));

    // broadcast deletion
    try {
      await broadcastChannelRef.current?.send({
        type: 'broadcast',
        event: 'candidates_changed',
        payload: { lobbyId },
      });
    } catch {}
  }

  async function regenerateCode() {
    if (!isHost) {
      setNote('Host only');
      return;
    }
    const ok = window.confirm('Regenerate invite code? Old link will stop working.');
    if (!ok) return;
    const res = await fetch(`/api/lobbies/${lobbyId}/code`, { method: 'POST' });
    const json = await res.json();
    if (res.ok) {
      setShortCode(json.code);
      alert('New short code generated. Use “Copy short link”.');
    } else setErr(json.error ?? 'could not regenerate code');
  }

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

  const byId = useMemo(() => new Map(cands.map(c => [c.id, c])), [cands]);
  const canFinalize = progress.candidateCount > 0 && progress.fullBallots > 0;

  /* ---------- UI ---------- */
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      {/* header card: lobby + links */}
      <Card
        title={<div className="text-xl font-semibold">Lobby: {lobbyId.slice(0, 8)}…</div>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  alert('Link copied!');
                } catch {
                  alert('Copy failed—copy from the address bar.');
                }
              }}
            >
              Copy invite link
            </Button>
            <Button
              disabled={!shortCode}
              onClick={async () => {
                if (!shortCode) return;
                const shortUrl = `${window.location.origin}/j/${shortCode}`;
                try {
                  await navigator.clipboard.writeText(shortUrl);
                  alert('Short link copied!');
                } catch {
                  alert(shortUrl);
                }
              }}
            >
              Copy short link
            </Button>
            {isHost && (
              <Button onClick={regenerateCode} title="Host only">
                Regenerate code
              </Button>
            )}
          </div>
        }
      >
        <div className="text-sm text-gray-400">
          Full ballots: <span className="font-semibold text-gray-200">{progress.fullBallots}</span> / {progress.memberCount} · Candidates: {progress.candidateCount}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* left column: add + ranking */}
        <div className="md:col-span-2 space-y-6">
          {/* Add Candidate + You */}
          <Card title="Add candidate" subtitle="Suggest a movie">
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Movie title, e.g., Dune (2021)"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCandidate()}
                />
                <Button onClick={addCandidate} disabled={loading}>
                  {loading ? 'Adding…' : 'Add'}
                </Button>
              </div>

              <div className="h-px w-full bg-white/10 my-1" />

              <div>
                <div className="mb-2 text-sm font-medium">You</div>
                <div className="flex gap-2">
                  <Input
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
                          try {
                            await chan.track({ userId, nickname: myName || 'Guest' });
                          } catch {}
                        }
                      }
                    }}
                  />
                  <Button
                    onClick={async () => {
                      saveName(myName);
                      await fetch(`/api/lobbies/${lobbyId}/join`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ nickname: myName || undefined }),
                      });
                      const chan = presenceChannelRef.current;
                      if (chan) {
                        try {
                          await chan.track({ userId, nickname: myName || 'Guest' });
                        } catch {}
                      }
                    }}
                  >
                    Save
                  </Button>
                </div>
              </div>

              {err && <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-sm text-red-300">{err}</div>}
            </div>
          </Card>

          {/* Ranking with DnD (flat card: no blur → smooth drag) */}
          <Card title="Your ranking" subtitle="Drag to reorder; keyboard ↑/↓ works too" frost={false}>
            {!order.length && <div className="text-gray-500">No items to rank yet</div>}

            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="rankingList" direction="vertical">
                {(dropProvided) => (
                  <ul ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="space-y-1">
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
                              <span className="px-1 text-gray-500 select-none" aria-hidden>
                                ≡
                              </span>
                              <span className="text-sm text-gray-600 w-8">#{idx + 1}</span>
                              <span className="flex-1">{c.title}</span>
                              <div className="flex gap-1">
                                <Button onClick={() => move(idx, -1)}>↑</Button>
                                <Button onClick={() => move(idx, +1)}>↓</Button>
                                {isHost && (
                                  <Button onClick={() => deleteCandidate(cid)} title="Delete for everyone (host)">
                                    🗑
                                  </Button>
                                )}
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

            <div className="mt-3">
              <Button onClick={saveRanking} disabled={saving || !order.length}>
                {saving ? 'Saving…' : 'Save ranking'}
              </Button>
              {saveMsg && <span className="ml-3 text-green-400">{saveMsg}</span>}
              {note && <span className="ml-3 text-gray-400">{note}</span>}
            </div>
          </Card>
        </div>

        {/* right column: finalize + members */}
        <div className="space-y-6">
          <FinalizeCard
            lobbyId={lobbyId}
            cands={cands}
            canFinalize={canFinalize}
            isHost={isHost}
            resultTick={resultTick}
          />

          <Card title="Members" subtitle="Who’s here">
            {!displayMembers.length && <div className="text-gray-500">Nobody here yet</div>}
            <ul className="space-y-1">
              {displayMembers.map(m => (
                <li key={m.user_id} className="flex items-center justify-between rounded border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={onlineIds.has(m.user_id) ? 'text-green-500' : 'text-gray-400'}>●</span>
                    <span>{m.nickname || 'Guest'}</span>
                  </div>
                  <span className="text-xs uppercase tracking-wide opacity-60">{m.role}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </main>
  );
}

/* ---------- Finalize + AI rationale card (visible to all after host finalizes) ---------- */
function FinalizeCard({
  lobbyId,
  cands,
  canFinalize,
  isHost,
  resultTick,
}: {
  lobbyId: string;
  cands?: { id: string; title: string }[];
  canFinalize: boolean;
  isHost: boolean;
  resultTick: number;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number> | null>(null);

  // AI rationale
  const [rationale, setRationale] = useState<string | null>(null);
  const [rBusy, setRBusy] = useState(false);
  const [rErr, setRErr] = useState<string | null>(null);

  // details
  type DetailsCandidate = { id: string; title: string; score: number; firsts: number; histogram: number[] };
  type DetailsVoter = { user_id: string; nickname: string | null; ranking: string[] };
  const [details, setDetails] = useState<{
    method: 'borda';
    tie_breaker: 'lexicographic_positions_then_id';
    ranked_ids: string[];
    candidates: DetailsCandidate[];
    voters: DetailsVoter[];
  } | null>(null);

  // Load existing result for everyone (on mount and when result changes)
  async function loadResult() {
    const res = await fetch(`/api/lobbies/${lobbyId}/finalize`, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return; // no result yet
    const json = await res.json();
    const r = json.result;
    setWinner(r?.winner_candidate_id ?? null);
    setScores(r?.scores ?? null);
    if (json.details) setDetails(json.details);

    try {
      const rres = await fetch(`/api/lobbies/${lobbyId}/rationale`, { method: 'GET', cache: 'no-store' });
      const rjson = await rres.json();
      if (rres.ok) setRationale(rjson?.rationale ?? null);
    } catch {}
  }
  useEffect(() => {
    loadResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyId, resultTick]);

  async function finalize() {
    setBusy(true);
    setErr(null);
    setWinner(null);
    setScores(null);
    setRationale(null);
    setDetails(null);
    try {
      const res = await fetch(`/api/lobbies/${lobbyId}/finalize`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? 'finalize failed');
        return;
      }
      const r = json.result;
      setWinner(r?.winner_candidate_id ?? null);
      setScores(r?.scores ?? null);
      if (json.details) setDetails(json.details);

      try {
        const rres = await fetch(`/api/lobbies/${lobbyId}/rationale`, { method: 'GET', cache: 'no-store' });
        const rjson = await rres.json();
        if (rres.ok) setRationale(rjson?.rationale ?? null);
      } catch {}
    } finally {
      setBusy(false);
    }
  }

  const winnerTitle = winner && cands?.find(c => c.id === winner)?.title;

  async function generateRationale() {
    setRBusy(true);
    setRErr(null);
    try {
      const res = await fetch(`/api/lobbies/${lobbyId}/rationale`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setRErr(json.error ?? 'failed to generate');
        return;
      }
      setRationale(json.rationale ?? '');
    } finally {
      setRBusy(false);
    }
  }

  const disabled = busy || !canFinalize || !isHost;

  // helpers
  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    (cands ?? []).forEach(c => m.set(c.id, c.title));
    return m;
  }, [cands]);

  return (
    <Card
      title="Finalize"
      subtitle="Compute the winner"
      actions={
        <Button onClick={finalize} disabled={disabled} title={isHost ? undefined : 'Host only'}>
          {busy ? 'Finalizing…' : 'Finalize & Compute'}
        </Button>
      }
    >
      {!canFinalize && <div className="text-sm text-gray-500">Need at least one complete ballot.</div>}
      {!isHost && <div className="text-sm text-gray-500">Host only.</div>}
      {err && <div className="mt-2 rounded border border-red-400/30 bg-red-500/10 p-2 text-red-300">{err}</div>}

      {winner && (
        <div className="mt-3 space-y-3 rounded-lg border border-emerald-600/30 bg-emerald-500/10 p-3">
          <div>
            <div className="font-semibold">Winner</div>
            <div className="mt-1">
              {winnerTitle && <div className="font-medium">{winnerTitle}</div>}
              <div className="text-xs opacity-75 font-mono break-all">{winner}</div>
            </div>
          </div>

          {scores && (
            <div>
              <div className="font-semibold">Scores</div>
              <pre className="text-xs rounded border bg-black/5 dark:bg-white/10 p-2 overflow-auto">
                {JSON.stringify(scores, null, 2)}
              </pre>
            </div>
          )}

          {/* AI rationale */}
          <div className="pt-2 border-t border-emerald-600/20">
            <div className="mb-1 flex items-center justify-between">
              <div className="font-semibold">AI Rationale</div>
              <Button onClick={generateRationale} disabled={rBusy || !isHost} title={isHost ? undefined : 'Host only'}>
                {rBusy ? 'Generating…' : rationale ? 'Regenerate' : 'Generate'}
              </Button>
            </div>
            {rErr && <div className="mt-1 rounded border border-red-400/30 bg-red-500/10 p-2 text-red-300">{rErr}</div>}
            {rationale ? (
              <p className="mt-2 text-sm leading-relaxed">{rationale}</p>
            ) : (
              <p className="mt-2 text-sm text-gray-500">Host can generate a short, friendly blurb (cached).</p>
            )}
          </div>

          {/* Scoring details (leaderboard + per-voter) */}
          {details && (
            <div className="pt-3 border-t border-emerald-600/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Scoring Details</div>
                <div className="text-xs text-gray-500">
                  Method: {details.method} · Tie-break: firsts → seconds → … → id
                </div>
              </div>

              {/* Leaderboard */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left opacity-70">
                    <tr>
                      <th className="py-1 pr-3">#</th>
                      <th className="py-1 pr-3">Title</th>
                      <th className="py-1 pr-3">Score</th>
                      <th className="py-1 pr-3">1st</th>
                      <th className="py-1 pr-3">2nd</th>
                      <th className="py-1 pr-3">3rd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.candidates.map((c, i) => (
                      <tr key={c.id} className="border-t border-white/10">
                        <td className="py-1 pr-3">{i + 1}</td>
                        <td className="py-1 pr-3">{c.title}</td>
                        <td className="py-1 pr-3 font-mono">{c.score}</td>
                        <td className="py-1 pr-3 font-mono">{c.histogram[0] ?? 0}</td>
                        <td className="py-1 pr-3 font-mono">{c.histogram[1] ?? 0}</td>
                        <td className="py-1 pr-3 font-mono">{c.histogram[2] ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Per-voter breakdown */}
              <div className="space-y-2">
                <div className="font-semibold">Per-voter rankings</div>
                {!details.voters.length && <div className="text-sm text-gray-500">No saved ballots.</div>}
                <ul className="space-y-1">
                  {details.voters.map(v => (
                    <li key={v.user_id} className="rounded border border-white/10 p-2">
                      <div className="text-xs opacity-70">
                        {v.nickname || 'Guest'} <span className="font-mono">({v.user_id.slice(0, 6)}…)</span>
                      </div>
                      <div className="mt-1 text-sm">
                        {v.ranking
                          .map(cid => titleById.get(cid) ?? cid)
                          .map((t, idx) => `${idx + 1}. ${t}`)
                          .join(' · ')}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
