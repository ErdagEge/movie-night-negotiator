# 🎬 Movie Night Negotiator

Pick a movie together. Create a lobby, everyone adds titles and ranks them, and the app computes a fair winner (Borda). It’s multiplayer, live, and free-tier friendly. Optional AI provides a short “why this fits everyone” rationale when you finalize.

> Demo: https://movie-night-negotiator.vercel.app/

---

## Why it’s nice

- **Instant collaboration:** See new titles, members, and ranking progress live.
- **Fair outcome:** Uses **Borda count** so everyone’s preferences count, not just the loudest voice.
- **Frictionless joining:** Share a **short invite link**; guests pick a nickname and jump in.
- **One-click finale:** Host computes the winner; (optional) AI explains why it suits the group.
- **Zero-cost stack:** Next.js on Vercel + Supabase (DB, Realtime). One optional AI call per lobby.

---

## Key features

- 🧑‍🤝‍🧑 **Multi-user lobbies** with presence (who’s online)
- 📝 **Add titles** quickly; live updates for all participants
- 🗳️ **Ranked voting (Borda)** with score breakdown
- ✅ **Finalize gate**: shows “full ballots” count and enables finalize at the right time
- 🔗 **Short invites**: `/j/<code>` redirects to the lobby
- 🧠 **AI rationale** (optional): cached, regenerable, and cheap
- 🌗 **Clean, minimal UI** with dark-mode friendly colors

---

## How it works (30-second tour)

1. **Create** a lobby → share the short link.
2. **Add** movie candidates (anyone).
3. **Rank** your list locally; save when ready.
4. **Watch progress**: “Full ballots: X / Y · Candidates: Z.”
5. **Finalize** (host): computes winner and shows scores.
6. *(Optional)* **Generate AI rationale**: a short, friendly justification.

---

## Tech stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind
- **Realtime:** Supabase Channels (Postgres Changes + Presence)
- **Data:** Supabase Postgres (lobbies, members, candidates, rankings, results)
- **Auth model:** Cookie-based guest identity by default; host role inferred from creator
- **AI (optional):** OpenAI for a single, cached rationale per lobby

---

## Privacy & cost

- Guests are identified by a **random cookie ID** + nickname (no PII required).
- Runs comfortably on **free tiers** (Vercel + Supabase). AI is **opt-in** and called **once** per finalize (regenerable).

---

## Roadmap

- Drag-and-drop ranking
- Host-only controls (finalize, regenerate code)
- Auth + RLS (keep guest flow)
- QR invites
- Tests (Borda & API smoke)

---

## License

MIT
