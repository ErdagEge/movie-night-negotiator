import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getOrSetClientUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;            // ⬅️ await params
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('candidates')
    .select('id,title,created_at,added_by')
    .eq('lobby_id', id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ candidates: data ?? [] });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;            // ⬅️ await params
  const supabase = await createServerClient();
  const userId = await getOrSetClientUserId();

  const { title } = await req.json();
  if (!title || typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
    }

  const { error } = await supabase.from('candidates').insert({
    lobby_id: id,
    title: title.trim(),
    added_by: userId,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
