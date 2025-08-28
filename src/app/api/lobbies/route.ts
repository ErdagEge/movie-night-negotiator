export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getOrSetClientUserId } from '@/lib/user';
import { randomBytes } from 'crypto';

type CreateBody = { title?: string };

function genCode(): string {
  // 8-char lowercase hex, matches backfill
  return randomBytes(4).toString('hex');
}

export async function POST(req: Request) {
  const supabase = await createServerClient();
  const userId = await getOrSetClientUserId();

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const title = (body as CreateBody).title?.trim() || 'Movie night';

  // Retry a few times in the rare case of a collision
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();

    const { data, error } = await supabase
      .from('lobbies')
      .insert({ title, creator: userId, status: 'open', code })
      .select('id, code')
      .single();

    if (!error && data) {
      return NextResponse.json({ lobbyId: data.id, code: data.code });
    }

    // Only retry on unique violation
    const pgCode = (error as { code?: string } | null)?.code;
    if (pgCode !== '23505') {
      return NextResponse.json({ error: error?.message ?? 'create failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Could not allocate invite code' }, { status: 500 });
}
