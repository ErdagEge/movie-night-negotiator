# 🎬 Movie Night Negotiator

Group movie picker with ranked voting (Borda). Create a lobby, add movies, let everyone rank them, then compute a winner.  
Free to host on **Vercel (Hobby)** + **Supabase (Free)**. Optional single OpenAI call for a short “why this fits everyone” blurb.

---

## Features

- ⚡ **Zero-cost stack:** Next.js (App Router) on Vercel + Supabase Postgres/Auth/Realtime (free tiers).
- 🧑‍🤝‍🧑 **Multi-user lobbies:** Share a link; guests join with a nickname (no auth required).
- 🗳️ **Ranked voting:** Borda count with sensible tie-breaker.
- 🧠 **Optional AI rationale:** One cached LLM call per finalized lobby.
- 🔒 **RLS-ready:** Schema and RLS policies planned (can keep guest mode).
- 🌗 Dark-mode friendly UI.

---

## Stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS
- **Backend:** Next.js Route Handlers, Supabase JS SDK
- **DB:** Supabase Postgres
- **Realtime (later step):** Supabase Realtime channels
- **AI (optional):** OpenAI (single call on finalize)

---

## Quick start

### Prereqs
- Node.js LTS (v20+ recommended)
- A free **Supabase** project (Project URL + anon key)
- (Optional) OpenAI API key

### 1) Create the app
```bash
npx create-next-app@latest movie-night-negotiator --typescript --eslint --tailwind --app --src-dir --import-alias "@/*"
cd movie-night-negotiator
npm i @supabase/supabase-js @supabase/ssr zod
```

### 2) Environment variables
Create **.env.local**:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-public-key>
# Optional for AI rationale later:
# OPENAI_API_KEY=sk-...
```
> Note: use the exact Project URL from Supabase Settings → API (must end with **.supabase.co**, no **/dashboard**).

### 3) Database schema (no auth/RLS yet)
In Supabase SQL Editor run:
```sql
create extension if not exists "pgcrypto";

create table if not exists lobbies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  creator uuid,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists lobby_members (
  lobby_id uuid not null references lobbies(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'guest' check (role in ('host','guest')),
  nickname text,
  joined_at timestamptz not null default now(),
  primary key (lobby_id, user_id)
);

create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references lobbies(id) on delete cascade,
  title text not null,
  metadata jsonb not null default '{}'::jsonb,
  added_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists rankings (
  lobby_id uuid not null references lobbies(id) on delete cascade,
  user_id uuid not null,
  candidate_id uuid not null references candidates(id) on delete cascade,
  position int not null check (position >= 1),
  primary key (lobby_id, user_id, candidate_id)
);
create index if not exists rankings_lobby_user_pos on rankings (lobby_id, user_id, position);

create table if not exists results (
  lobby_id uuid primary key references lobbies(id) on delete cascade,
  method text not null,
  scores jsonb not null,
  winner_candidate_id uuid references candidates(id),
  rationale text,
  created_at timestamptz not null default now()
);
```

### 4) Run locally
```bash
npm run dev
# open http://localhost:3000
```
---

### How it works (current thin slice)
- Guest identity: cookie **mn_uid** (UUID) assigned on first API call.
- Create lobby: POST **/api/lobbies** → inserts lobby + adds host membership.
- Join lobby: POST **/api/lobbies/[id]/join** → upserts (guest or host) + optional nickname.
- Candidates: GET/POST **/api/lobbies/[id]/candidates**
- Ranking (per user): GET/POST **/api/lobbies/[id]/rankings** with ordered candidate IDs.
- Finalize: POST **/api/lobbies/[id]/finalize** → computes Borda winner and stores **results**.
> Next.js 15 notes:
> - "In route handlers, **params** is async → **const { id } = await ctx.params**."
> - "**cookies()** can be async → **const cookieStore = await cookies()**."
---

Project structure (relevant bits)
```bash
src/
  app/
    page.tsx                     # create-lobby form (redirects to /l/[id])
    l/
      [id]/
        page.tsx                 # lobby page (add candidates, rank, finalize)
    api/
      lobbies/
        route.ts                 # POST create lobby
        [id]/
          join/route.ts          # POST join lobby (nickname)
          members/route.ts       # GET list members (poll)
          candidates/route.ts    # GET/POST candidates
          rankings/route.ts      # GET/POST my ranking
          finalize/route.ts      # POST finalize (host only)
  lib/
    supabase/
      client.ts
      server.ts                  # createServerClient() with async cookies
    user.ts                      # getOrSetClientUserId() cookie helper
    vote/
      borda.ts                   # Borda count implementation
```
---

### Usage (local demo)
1. Go to **/**, create a lobby. You’ll be redirected to **/l/<id>**.
2. In another browser/incognito, open the same link to join as a guest.
3. Everyone adds movies and saves their own ranking.
4. Host clicks Finalize & Compute Winner to see the winner + scores.
---

### Roadmap
- Supabase Realtime presence & live updates (replace polling).
- Auth + RLS (keep guest mode; host can promote/log in).
- AI rationale on finalize (single cached call; optional env).
- Drag-and-drop ranking UI.
- Share link UI + invite code.
- Streaming availability integrations (optional, non-free).
- Tests (unit: Borda; e2e: basic flows).
---

### Configuration & deployment
- Vercel: set **NEXT_PUBLIC_SUPABASE_URL** and **NEXT_PUBLIC_SUPABASE_ANON_KEY** in project env.
- Supabase: create tables via SQL above. (RLS policies can be added later.)
- OpenAI (optional): set **OPENAI_API_KEY**. Keep calls to one per lobby.
---

### License
MIT — feel free to use, modify, and deploy.
