'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Button, Card, Input } from '@/components/ui';
import { FinalizeCard } from '@/components/FinalizeCard';
import { RankingList } from '@/components/RankingList';
import { LobbyMembers, type Member } from '@/components/LobbyMembers';

type ChannelState = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

type Candidate = { id: string; title: string; created_at: string; added_by: string | null };
type Progress = { candidateCount: number; memberCount: number; fullBallots: number; myIsFull: boolean };

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

          {/* Ranking with DnD */}
          <RankingList
            order={order}
            setOrder={setOrder}
            cands={cands}
            isHost={isHost}
            saveRanking={saveRanking}
            saving={saving}
            saveMsg={saveMsg}
            note={note}
            onDeleteCandidate={deleteCandidate}
          />
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

          <LobbyMembers members={displayMembers} onlineIds={onlineIds} />
        </div>
      </div>
    </main>
  );
}
