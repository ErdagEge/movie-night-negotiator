export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getOrSetClientUserId } from '@/lib/user';

type ScoreMap = Record<string, number>;

function computeBordaScores(
  rankings: Array<{ user_id: string; candidate_id: string; position: number }>,
  candidateIds: string[]
): ScoreMap {
  const n = candidateIds.length;
  const scores: ScoreMap = Object.fromEntries(candidateIds.map(id => [id, 0]));
  const weight = (pos: number) => n - pos + 1; // position 1 => n points

  for (const r of rankings) {
    // trust positions as 1..n as stored by your POST /rankings
    scores[r.candidate_id] = (scores[r.candidate_id] ?? 0) + weight(r.position);
  }
  return scores;
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

  // Load candidates & rankings
  const [{ data: cands, error: cErr }, { data: ranks, error: rErr }] = await Promise.all([
    supabase.from('candidates').select('id').eq('lobby_id', id),
    supabase.from('rankings').select('user_id,candidate_id,position').eq('lobby_id', id),
  ]);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const candidateIds = (cands ?? []).map(c => c.id);
  if (candidateIds.length === 0) {
    return NextResponse.json({ error: 'no candidates' }, { status: 400 });
  }

  const scores = computeBordaScores((ranks ?? []) as Array<{ user_id: string; candidate_id: string; position: number }>, candidateIds);

  // Pick winner (max score; stable by id as tiebreak)
  let winner: string = candidateIds[0];
  let best = -Infinity;
  for (const idd of candidateIds) {
    const sc = scores[idd] ?? 0;
    if (sc > best || (sc === best && idd < winner)) {
      best = sc; winner = idd;
    }
  }

  // Upsert results
  const { error: uErr, data: upserted } = await supabase
    .from('results')
    .upsert(
      { lobby_id: id, method: 'borda', scores, winner_candidate_id: winner },
      { onConflict: 'lobby_id' }
    )
    .select('lobby_id,winner_candidate_id,scores')
    .single();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  return NextResponse.json({ result: upserted });
}
