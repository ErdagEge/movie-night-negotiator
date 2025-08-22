import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getOrSetClientUserId } from '@/lib/user';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;            // ⬅️
  const supabase = await createServerClient();
  const userId = await getOrSetClientUserId();

  const { data, error } = await supabase
    .from('rankings')
    .select('candidate_id, position')
    .eq('lobby_id', id)
    .eq('user_id', userId)
    .order('position', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ranking: (data ?? []).map(r => r.candidate_id) });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;            // ⬅️
  const supabase = await createServerClient();
  const userId = await getOrSetClientUserId();
  const body = await req.json();
  const ranking: string[] = body?.ranking;

  if (!Array.isArray(ranking) || ranking.length === 0) {
    return NextResponse.json({ error: 'ranking array required' }, { status: 400 });
  }

  const del = await supabase.from('rankings').delete()
    .eq('lobby_id', id).eq('user_id', userId);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });

  const rows = ranking.map((cid, idx) => ({
    lobby_id: id, user_id: userId, candidate_id: cid, position: idx + 1,
  }));
  const ins = await supabase.from('rankings').insert(rows);
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
