export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getOrSetClientUserId } from '@/lib/user';

type ScoreMap = Record<string, number>;
type Histogram = number[]; // 1..n (index 0 unused)

function computeBorda(
  rankings: Array<{ user_id: string; candidate_id: string; position: number }>,
  candidateIds: string[],
) {
  const n = candidateIds.length;
  const scores: ScoreMap = Object.fromEntries(candidateIds.map(id => [id, 0]));
  const hist: Record<string, Histogram> = Object.fromEntries(
    candidateIds.map(id => [id, Array(n + 1).fill(0)])
  );

  const weight = (pos: number) => n - pos + 1; // pos==1 -> n points

  for (const r of rankings) {
    scores[r.candidate_id] = (scores[r.candidate_id] ?? 0) + weight(r.position);
    hist[r.candidate_id][r.position] += 1;
  }

  return { scores, hist };
}

function cmpWithTiebreak(
  a: { id: string; score: number; hist: Histogram },
  b: { id: string; score: number; hist: Histogram },
) {
  if (a.score !== b.score) return b.score - a.score; // higher score first
  // Lexicographic by counts of 1st, then 2nd, ... (more is better)
  const n = Math.max(a.hist.length, b.hist.length) - 1;
  for (let pos = 1; pos <= n; pos++) {
    const da = a.hist[pos] ?? 0;
    const db = b.hist[pos] ?? 0;
    if (da !== db) return db - da;
  }
  // Stable by id (deterministic)
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const supabase = await createServerClient();
  const userId = await getOrSetClientUserId();

  // Host guard
  const { data: lobby, error: lErr } = await supabase
    .from('lobbies')
    .select('id, creator')
    .eq('id', id)
    .single();

  if (lErr || !lobby) return NextResponse.json({ error: 'lobby not found' }, { status: 404 });
  if (lobby.creator !== userId) return NextResponse.json({ error: 'host only' }, { status: 403 });

  // Load candidates & rankings & member nicknames
  const [{ data: cands, error: cErr }, { data: ranks, error: rErr }, { data: members, error: mErr }] = await Promise.all([
    supabase.from('candidates').select('id,title').eq('lobby_id', id),
    supabase.from('rankings').select('user_id,candidate_id,position').eq('lobby_id', id),
    supabase.from('lobby_members').select('user_id,nickname').eq('lobby_id', id),
  ]);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const candidates = (cands ?? []) as { id: string; title: string }[];
  const candidateIds = candidates.map(c => c.id);
  if (candidateIds.length === 0) return NextResponse.json({ error: 'no candidates' }, { status: 400 });

  const rankings = (ranks ?? []) as Array<{ user_id: string; candidate_id: string; position: number }>;
  const { scores, hist } = computeBorda(rankings, candidateIds);

  // Sort with deterministic tie-break
  const ranked = candidateIds
    .map((cid) => ({ id: cid, score: scores[cid] ?? 0, hist: hist[cid] }))
    .sort(cmpWithTiebreak);

  const winner = ranked[0]?.id ?? candidateIds[0];

  // Persist minimal result (winner + scores). Method/tie_breaker are informational.
  const { error: uErr, data: upserted } = await supabase
    .from('results')
    .upsert(
      { lobby_id: id, method: 'borda', tie_breaker: 'lexicographic_positions_then_id', scores, winner_candidate_id: winner },
      { onConflict: 'lobby_id' }
    )
    .select('lobby_id,winner_candidate_id,scores')
    .single();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  // Build details payload (leaderboard + per-voter)
  const byId = new Map(candidates.map(c => [c.id, c.title]));
  const detailsCandidates = ranked.map(r => {
    // compress histogram: only positions 1..n
    const h = r.hist.slice(1);
    const firsts = r.hist[1] ?? 0;
    return { id: r.id, title: byId.get(r.id) ?? r.id, score: r.score, firsts, histogram: h };
  });

  // Per-voter: ranking arrays in order of position asc
  const grouped: Record<string, Array<{ candidate_id: string; position: number }>> = {};
  for (const row of rankings) {
    (grouped[row.user_id] ||= []).push({ candidate_id: row.candidate_id, position: row.position });
  }
  const nickByUser = new Map((members ?? []).map(m => [m.user_id, m.nickname as string | null]));
  const detailsVoters = Object.entries(grouped).map(([uid, arr]) => {
    arr.sort((a, b) => a.position - b.position);
    return {
      user_id: uid,
      nickname: nickByUser.get(uid) ?? null,
      ranking: arr.map(x => x.candidate_id),
    };
  });

  return NextResponse.json({
    result: upserted,
    details: {
      method: 'borda',
      tie_breaker: 'lexicographic_positions_then_id',
      ranked_ids: ranked.map(r => r.id),
      candidates: detailsCandidates,
      voters: detailsVoters,
    },
  });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const supabase = await createServerClient();

  // Has a result been stored?
  const { data: resRow, error: resErr } = await supabase
    .from('results')
    .select('lobby_id, winner_candidate_id, scores')
    .eq('lobby_id', id)
    .maybeSingle();

  if (resErr) return NextResponse.json({ error: resErr.message }, { status: 500 });
  if (!resRow) return NextResponse.json({ error: 'no result' }, { status: 404 });

  // For details, we recompute histograms + voter listings from current data
  const [{ data: cands, error: cErr }, { data: ranks, error: rErr }, { data: members, error: mErr }] = await Promise.all([
    supabase.from('candidates').select('id,title').eq('lobby_id', id),
    supabase.from('rankings').select('user_id,candidate_id,position').eq('lobby_id', id),
    supabase.from('lobby_members').select('user_id,nickname').eq('lobby_id', id),
  ]);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const candidates = (cands ?? []) as { id: string; title: string }[];
  const candidateIds = candidates.map(c => c.id);
  const rankings = (ranks ?? []) as Array<{ user_id: string; candidate_id: string; position: number }>;

  // reuse helpers from file
  const { scores: computedScores, hist } = computeBorda(rankings, candidateIds);

  // Build details payload to mirror POST
  const byId = new Map(candidates.map(c => [c.id, c.title]));
  const ranked = candidateIds
    .map((cid) => ({ id: cid, score: (resRow.scores ?? computedScores)[cid] ?? 0, hist: hist[cid] }))
    .sort(cmpWithTiebreak);

  const detailsCandidates = ranked.map(r => ({
    id: r.id,
    title: byId.get(r.id) ?? r.id,
    score: r.score,
    firsts: r.hist[1] ?? 0,
    histogram: r.hist.slice(1),
  }));

  const grouped: Record<string, Array<{ candidate_id: string; position: number }>> = {};
  for (const row of rankings) {
    (grouped[row.user_id] ||= []).push({ candidate_id: row.candidate_id, position: row.position });
  }
  const nickByUser = new Map((members ?? []).map(m => [m.user_id, m.nickname as string | null]));
  const detailsVoters = Object.entries(grouped).map(([uid, arr]) => {
    arr.sort((a, b) => a.position - b.position);
    return { user_id: uid, nickname: nickByUser.get(uid) ?? null, ranking: arr.map(x => x.candidate_id) };
  });

  return NextResponse.json({
    result: resRow,
    details: {
      method: 'borda',
      tie_breaker: 'lexicographic_positions_then_id',
      ranked_ids: ranked.map(r => r.id),
      candidates: detailsCandidates,
      voters: detailsVoters,
    },
  });
}
