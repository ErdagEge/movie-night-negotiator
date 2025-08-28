export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const { code } = await ctx.params;
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('lobbies')
    .select('id')
    .eq('code', code)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  }

  // Absolute redirect based on incoming request
  const url = new URL(`/l/${data.id}`, new URL(req.url).origin);
  return NextResponse.redirect(url, { status: 302 });
}
