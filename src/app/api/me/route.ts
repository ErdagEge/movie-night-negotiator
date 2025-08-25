import { NextResponse } from "next/server";
import { getOrSetClientUserId } from "@/lib/user";

export async function GET() {
    const userId = await getOrSetClientUserId();
    return NextResponse.json({ userId });
}