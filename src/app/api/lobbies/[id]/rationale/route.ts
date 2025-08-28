export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { createServerClient } from '@/lib/supabase/server';

type ScoreMap = Record<string, number>;

interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }
interface ChatChoice { index: number; finish_reason: string; message: ChatMsg }
interface ChatResp { id: string; object: string; created: number; model: string; choices: ChatChoice[] }

async function getLobbyContext(supabase: Awaited<ReturnType<typeof createServerClient>>, lobbyId: string) {
    const [{ data: res }, { data: cands }, { data: ranks }] = await Promise.all([
        supabase.from('results')
            .select('lobby_id, winner_candidate_id, scores, rationale')
            .eq('lobby_id', lobbyId).maybeSingle(),
        supabase.from('candidates')
            .select('id, title')
            .eq('lobby_id', lobbyId),
        supabase.from('rankings')
            .select('user_id')
            .eq('lobby_id', lobbyId)
    ]);

    return {
        result: res as (null | { lobby_id: string; winner_candidate_id: string | null; scores: ScoreMap | null; rationale: string | null }),
        candidates: (cands ?? []) as { id: string; title: string }[],
        voterCount: new Set((ranks ?? []).map(r => r.user_id)).size,
    };
}

function buildPrompt(
    winnerTitle: string,
    candidates: { id: string; title: string }[],
    scores: ScoreMap | null,
    voterCount: number
) {
    const lines: string[] = [];
    lines.push(
        `We used a simple ranked voting (Borda) to pick a movie for tonight.`,
        `There were ${voterCount} voter${voterCount === 1 ? '' : 's'}.`,
        `Winner: ${winnerTitle}`
    );

    const titledScores = 
        scores 
            ? Object.entries(scores)
                .map(([cid, sc]) => {
                    const t = candidates.find(c => c.id === cid)?.title ?? cid;
                    return `- ${t}: ${sc}`;
                })
                .join('\n')
            : null;

    if (titledScores) {
        lines.push(`Scores:\n${titledScores}`);
    } else {
        lines.push(`(No per-candidate scores available.)`);
    }

    const system: ChatMsg = {
        role: 'system',
        content: 'You are a concise, friendly assistant. Write a 2-4 sentence rationale that explains why the winning movie should work for the whole group. Keep it positive, speific to titles, and avoid hedging.',
    };

    const user: ChatMsg = {
        role: 'user',
        content: lines.join('\n'),
    };

    return { system, user };
}

async function callOpenAI(system: ChatMsg, user: ChatMsg): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY not configured');
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            // cheap model for now...
            model: 'gpt-4o-mini',
            temperature: 0.6,
            max_tokens: 180,
            messages: [system, user],
        }),
    });

    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`OpenAI error: ${resp.status} ${txt}`);
    }

    const json = (await resp.json()) as ChatResp;
    const content = json.choices?.[0]?.message?.content ?? '';
    return content.trim();
}

// GET ---> return existing rationale 
export async function GET(
    _req: Request,
    ctx: { params: Promise<{ id: string }> }
) {
    const { id } = await ctx.params;
    const supabase = await createServerClient();
    const { result } = await getLobbyContext(supabase, id);

    if (!result) return NextResponse.json({ error: 'result not found' }, { status: 404 });

    return NextResponse.json({ rationale: result.rationale ?? null });
}

// POST ---> generate rationale if missing, store in results, return text
export async function POST(
    _req: Request,
    ctx: { params: Promise<{ id: string }> }
) {
    const { id } = await ctx.params;

    // fail fast if no key
    if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json(
            { error: 'AI disabled (no OPENAI_API_KEY' },
            { status: 501 }
        );
    }

    const supabase = await createServerClient();
    const { result, candidates, voterCount } = await getLobbyContext(supabase, id);

    if (!result) return NextResponse.json({ error: 'result not found' }, { status: 404 });
    if (!result.winner_candidate_id) {
        return NextResponse.json({ error: 'winner not computed yet' }, { status: 400 });
    }

    // If already present, return (idempotent)
    if (result.rationale && result.rationale.trim()) {
        return NextResponse.json({ rationale: result.rationale, created: false });
    }

    const winnerTitle = candidates.find(c => c.id === result.winner_candidate_id)?.title ?? 'the winner';
    const { system, user } = buildPrompt(winnerTitle, candidates, result.scores ?? null, voterCount);

    let rationale = '';
    try {
        rationale = await callOpenAI(system, user);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }

    // store
    const { error: uerr } = await supabase
        .from('results')
        .update({ rationale })
        .eq('lobby_id', id);

    if (uerr) return NextResponse.json({ error: uerr.message }, { status: 500 });

    return NextResponse.json({ rationale, created: true });
}