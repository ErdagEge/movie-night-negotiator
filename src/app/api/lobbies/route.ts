import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getOrSetClientUserId } from '@/lib/user';

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient();
    const userId = await getOrSetClientUserId();

    const { title } = await req.json();
    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'title required' }, { status: 400 });
    }

    // 1) create lobby
    const { data: lobby, error: lerr } = await supabase
      .from('lobbies')
      .insert({ title: title.trim(), creator: userId })
      .select('*')
      .single();
    if (lerr || !lobby) {
      return NextResponse.json({ error: lerr?.message ?? 'insert lobby failed' }, { status: 500 });
    }

    // 2) add host membership
    const { error: merr } = await supabase
      .from('lobby_members')
      .insert({ lobby_id: lobby.id, user_id: userId, role: 'host' });
    if (merr) {
      return NextResponse.json({ error: merr.message }, { status: 500 });
    }

    return NextResponse.json({ lobbyId: lobby.id, title: lobby.title });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
