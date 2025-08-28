export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getOrSetClientUserId } from '@/lib/user';

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; cid: string }> }
) {
  const { id, cid } = await ctx.params;
  const supabase = await createServerClient();
  const userId = await getOrSetClientUserId();

  const { data: lobby, error: lErr } = await supabase
    .from('lobbies')
    .select('id, creator')
    .eq('id', id)
    .single();

  if (lErr || !lobby) return NextResponse.json({ error: 'lobby not found' }, { status: 404 });
  if (lobby.creator !== userId) return NextResponse.json({ error: 'host only' }, { status: 403 });

  const { error: dErr } = await supabase
    .from('candidates')
    .delete()
    .eq('id', cid)
    .eq('lobby_id', id);

  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
