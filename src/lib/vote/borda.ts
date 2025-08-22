export type CandidateID = string;
export type Ranking = CandidateID[];                 // index 0 = top choice
export type RankingsByUser = Record<string, Ranking>;

export function borda(rankings: RankingsByUser): {
  scores: Record<CandidateID, number>, winner: CandidateID
} {
  const users = Object.keys(rankings);
  if (!users.length) throw new Error('no rankings');

  const n = rankings[users[0]].length;
  const scores: Record<CandidateID, number> = {};
  const avgPos: Record<CandidateID, number> = {};

  for (const u of users) {
    const r = rankings[u];
    if (r.length !== n) throw new Error('inconsistent ballot length');
    r.forEach((cid, idx) => {
      const pts = (n - 1) - idx;
      scores[cid] = (scores[cid] ?? 0) + pts;
      avgPos[cid] = (avgPos[cid] ?? 0) + idx / users.length;
    });
  }

  const winner = Object.keys(scores).sort((a, b) => {
    const d = scores[b] - scores[a]; if (d) return d;
    const ap = avgPos[a] - avgPos[b]; if (ap) return ap;
    return a.localeCompare(b);
  })[0];

  return { scores, winner };
}
