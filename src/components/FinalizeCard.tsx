'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button, Card } from './ui';

type DetailsCandidate = { id: string; title: string; score: number; firsts: number; histogram: number[] };
type DetailsVoter = { user_id: string; nickname: string | null; ranking: string[] };

export function FinalizeCard({
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
