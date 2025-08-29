export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getOrSetClientUserId } from '@/lib/user';
import { randomBytes } from 'crypto';

function genCode(): string {
    return randomBytes(4).toString('hex'); // 8-char lowercase hex
}

export async function POST(
    _req: Request,
    ctx: { params: Promise<{ id: string }> }
) {
    const { id } = await ctx.params;
    const supabase = await createServerClient();
    const userId = await getOrSetClientUserId();

    const { data: lobby, error: lErr } = await supabase
        .from('lobbies')
        .select('id, creator')
        .eq('id', id)
        .single();

    if (lErr || !lobby) return NextResponse.json({ error: 'lobby not found' }, { status: 404 });
    if (lobby.creator !== userId) return NextResponse.json({ error: 'host only' }, { status: 403 });

    for (let i = 0; i < 5; i++) {
        const code = genCode();
        const { data, error } = await supabase
            .from('lobbies')
            .update({ code })
            .eq('id', id)
            .select('code')
            .single();

        if (!error && data) return NextResponse.json({ code: data.code });

        const pgCode = (error as { code?: string } | null)?.code;
        if (pgCode !== '23505') return NextResponse.json({ error: error?.message ?? 'update failed' }, { status: 500});
    }

    return NextResponse.json({ error: 'could not allocate new code' }, { status: 500 });
}