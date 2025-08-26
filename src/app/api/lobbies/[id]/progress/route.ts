export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getOrSetClientUserId } from '@/lib/user';

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ id: string }> }
) {
    const { id } = await ctx.params;
    const supabase = await createServerClient();
    const me = await getOrSetClientUserId();

    const [
        { data: candRows, error: cErr },
        { data: memberRows, error: mErr },
        { data: rankRows, error: rErr },
    ] = await Promise.all([
        supabase.from('candidates').select('id').eq('lobby_id', id),
        supabase.from('lobby_members').select('user_id').eq('lobby_id', id),
        supabase.from('rankings').select('user_id,candidate_id').eq('lobby_id', id),
    ]);

    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

    const candidateCount = candRows?.length ?? 0;
    const memberCount = memberRows?.length ?? 0;

    const byUser: Record<string, Set<string>> = {};
    for (const r of rankRows ?? []) {
        (byUser[r.user_id] ??= new Set()).add(r.candidate_id);
    }

    const fullBallots =
        Object.values(byUser).filter(
            (s) => candidateCount > 0 && s.size === candidateCount
        ).length;

    const myIsFull =
        !!byUser[me] && candidateCount > 0 && byUser[me].size === candidateCount;

    return NextResponse.json({ candidateCount, memberCount, fullBallots, myIsFull });

}