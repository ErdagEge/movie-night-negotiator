export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getOrSetClientUserId } from '@/lib/user';

// Ensure caller becomes a member of the lobby.
// If nickname is provided, store it.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;                   // Next 15: await params
  const supabase = await createServerClient();
  const userId = await getOrSetClientUserId();

  const { nickname } = await req.json().catch(() => ({} as any));
  const nick = (typeof nickname === 'string' && nickname.trim()) ? nickname.trim() : null;

  // Validate lobby exists
  const { data: lobby, error: lerr } = await supabase
    .from('lobbies').select('id, creator').eq('id', id).single();
  if (lerr || !lobby) return NextResponse.json({ error: 'lobby not found' }, { status: 404 });

  // Upsert membership
  // Try to fetch existing membership
  const { data: existing, error: qerr } = await supabase
    .from('lobby_members').select('lobby_id,user_id,role,nickname').eq('lobby_id', id).eq('user_id', userId).maybeSingle();
  if (qerr) return NextResponse.json({ error: qerr.message }, { status: 500 });

  const role = (userId === lobby.creator) ? 'host' : 'guest';

  if (!existing) {
    const { error: ierr } = await supabase.from('lobby_members').insert({
      lobby_id: id, user_id: userId, role, nickname: nick ?? null
    });
    if (ierr) return NextResponse.json({ error: ierr.message }, { status: 500 });
  } else if (nick && !existing.nickname) {
    // set nickname if not set yet
    const { error: uerr } = await supabase
      .from('lobby_members')
      .update({ nickname: nick })
      .eq('lobby_id', id).eq('user_id', userId);
    if (uerr) return NextResponse.json({ error: uerr.message }, { status: 500 });
  }

  // Return membership + lobby title for convenience
  const { data: lobbyTitle } = await supabase.from('lobbies').select('title').eq('id', id).single();
  return NextResponse.json({
    ok: true,
    lobbyId: id,
    title: lobbyTitle?.title ?? '',
    role,
    nickname: nick ?? existing?.nickname ?? null
  });
}
