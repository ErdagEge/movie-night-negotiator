export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getOrSetClientUserId } from '@/lib/user';

type JoinBody = { nickname?: string };

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const supabase = await createServerClient();
  const userId = await getOrSetClientUserId();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const nickname = (body as JoinBody).nickname;
  const nick = typeof nickname === 'string' && nickname.trim() ? nickname.trim() : null;

  // Ensure lobby exists
  const { data: lobby, error: lerr } = await supabase
    .from('lobbies')
    .select('id, creator')
    .eq('id', id)
    .single();
  if (lerr || !lobby) return NextResponse.json({ error: 'lobby not found' }, { status: 404 });

  // Membership fetch
  const { data: existing, error: qerr } = await supabase
    .from('lobby_members')
    .select('lobby_id,user_id,role,nickname')
    .eq('lobby_id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (qerr) return NextResponse.json({ error: qerr.message }, { status: 500 });

  const role = userId === lobby.creator ? 'host' : 'guest';

  if (!existing) {
    const { error: ierr } = await supabase.from('lobby_members').insert({
      lobby_id: id, user_id: userId, role, nickname: nick,
    });
    if (ierr) return NextResponse.json({ error: ierr.message }, { status: 500 });
  } else if (nick !== existing.nickname) {
    const { error: uerr } = await supabase
      .from('lobby_members')
      .update({ nickname: nick })
      .eq('lobby_id', id)
      .eq('user_id', userId);
    if (uerr) return NextResponse.json({ error: uerr.message }, { status: 500 });
  }

  const { data: lobbyInfo } = await supabase
    .from('lobbies').select('title, code').eq('id', id).single();

  return NextResponse.json({
    ok: true,
    lobbyId: id,
    title: lobbyInfo?.title ?? '',
    role,
    nickname: nick,
    code: lobbyInfo?.code ?? null,
  });
}
