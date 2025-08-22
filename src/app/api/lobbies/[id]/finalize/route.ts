import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getOrSetClientUserId } from '@/lib/user';
import { borda, type RankingsByUser } from '@/lib/vote/borda';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;            // ⬅️
  const supabase = await createServerClient();
  const userId = await getOrSetClientUserId();

  const { data: lobby, error: lerr } = await supabase
    .from('lobbies')
    .select('id,creator,status')
    .eq('id', id)
    .single();
  if (lerr || !lobby) return NextResponse.json({ error: lerr?.message ?? 'not found' }, { status: 404 });
  if (lobby.creator !== userId) return NextResponse.json({ error: 'forbidden (host only)' }, { status: 403 });

  if (lobby.status === 'closed') {
    const { data: existing } = await supabase.from('results').select('*').eq('lobby_id', id).single();
    return NextResponse.json({ result: existing, alreadyClosed: true });
  }

  const { data: cands, error: cerr } = await supabase
    .from('candidates').select('id,title').eq('lobby_id', id);
  if (cerr) return NextResponse.json({ error: cerr.message }, { status: 500 });
  const candidateIds = (cands ?? []).map(c => c.id);
  if (!candidateIds.length) return NextResponse.json({ error: 'no candidates' }, { status: 400 });

  const { data: rows, error: rerr } = await supabase
    .from('rankings').select('user_id,candidate_id,position').eq('lobby_id', id);
  if (rerr) return NextResponse.json({ error: rerr.message }, { status: 500 });

  const temp: Record<string, Record<string, number>> = {};
  for (const row of rows ?? []) {
    temp[row.user_id] ??= {};
    temp[row.user_id][row.candidate_id] = row.position;
  }
  const rb: RankingsByUser = {};
  for (const [uid, posMap] of Object.entries(temp)) {
    if (Object.keys(posMap).length !== candidateIds.length) continue;
    const ordered = candidateIds.slice().sort((a, b) => posMap[a] - posMap[b]);
    rb[uid] = ordered;
  }
  if (!Object.keys(rb).length) return NextResponse.json({ error: 'no complete ballots' }, { status: 400 });

  const { scores, winner } = borda(rb);

  const { data: result, error: iErr } = await supabase.from('results').upsert({
    lobby_id: id, method: 'borda', scores, winner_candidate_id: winner,
  }).select('*').single();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  await supabase.from('lobbies').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', id);
  return NextResponse.json({ result });
}
