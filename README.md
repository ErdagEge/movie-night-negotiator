# 🎬 Movie Night Negotiator

Pick a movie together. Create a lobby, everyone adds titles and ranks them, and the app computes a fair winner (Borda). It’s multiplayer, live, and free-tier friendly. Optional AI provides a short “why this fits everyone” rationale when you finalize.

> Demo: https://movie-night-negotiator.vercel.app/

---

## Features

- **Instant collaboration:** See new titles, members, and ranking progress live.
- **Fair outcome:** Uses **Borda count** so everyone’s preferences count, not just the loudest voice.
- **Frictionless joining:** Share a **short invite link**; guests pick a nickname and jump in.
- **One-click finale:** Host computes the winner; (optional) AI explains why it suits the group.
- **Zero-cost stack:** Next.js on Vercel + Supabase (DB, Realtime). One optional AI call per lobby.

---

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Database & Realtime:** Supabase (PostgreSQL + Realtime Channels)
- **Drag & Drop:** `@hello-pangea/dnd`
- **AI:** OpenAI (Optional, for rationale generation)

---

## Prerequisites

To run this project locally, you will need:

- Node.js (v18 or later)
- A [Supabase](https://supabase.com/) project (Free tier works great)
- An [OpenAI](https://openai.com/) API Key (Optional, but required for the "Rationale" feature)

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/movie-night-negotiator.git
cd movie-night-negotiator
```

### 2. Environment Setup

Create a `.env.local` file in the root directory:

```bash
cp .env.example .env.local
```

Populate it with your keys:

```ini
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# OpenAI (Mandatory for AI Rationale feature)
OPENAI_API_KEY=sk-...
```

### 3. Database Setup

Run the following SQL in your Supabase SQL Editor to create the necessary tables:

```sql
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Lobbies
create table lobbies (
  id uuid default uuid_generate_v4() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  code text unique not null,
  title text not null,
  creator text not null, -- Stores the host's user_id cookie
  status text default 'open' check (status in ('open', 'closed'))
);

-- Members (Guests & Host)
create table lobby_members (
  lobby_id uuid references lobbies(id) on delete cascade not null,
  user_id text not null,
  nickname text not null,
  joined_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (lobby_id, user_id)
);

-- Movie Candidates
create table candidates (
  id uuid default uuid_generate_v4() primary key,
  lobby_id uuid references lobbies(id) on delete cascade not null,
  title text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Rankings
create table rankings (
  lobby_id uuid references lobbies(id) on delete cascade not null,
  user_id text not null,
  candidate_id uuid references candidates(id) on delete cascade not null,
  position integer not null, -- 0-based index
  primary key (lobby_id, user_id, candidate_id)
);

-- Results (Final computation)
create table results (
  lobby_id uuid references lobbies(id) on delete cascade primary key,
  winner_candidate_id uuid references candidates(id),
  scores jsonb, -- Stores the full score breakdown
  rationale text, -- AI generated text
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  method text,
  tie_breaker text
);

-- Realtime Setup
-- Enable realtime for all tables (simplest for this demo)
alter publication supabase_realtime add table lobbies, lobby_members, candidates, rankings, results;
```

### 4. Run the development server

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## License

MIT
