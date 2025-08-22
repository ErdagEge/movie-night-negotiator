import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createServerClient(); // ⬅️ await

  const { data, error } = await supabase
    .from('hello_messages')
    .select('*')
    .order('id', { ascending: false })
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ message: data?.[0]?.content ?? 'No rows yet' });
}
