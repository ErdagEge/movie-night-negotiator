import { describe, it, expect } from 'vitest';
import { borda } from './borda';

describe('borda', () => {
  it('should throw error if no rankings are provided', () => {
    expect(() => borda({})).toThrow('no rankings');
  });

  it('should throw error if rankings have inconsistent lengths', () => {
    const rankings = {
      user1: ['A', 'B'],
      user2: ['A'],
    };
    expect(() => borda(rankings)).toThrow('inconsistent ballot length');
  });

  it('should calculate scores correctly for a single user', () => {
    const rankings = {
      user1: ['A', 'B', 'C'],
    };
    // n = 3.
    // A: index 0 -> 2 pts
    // B: index 1 -> 1 pts
    // C: index 2 -> 0 pts
    const result = borda(rankings);
    expect(result.scores).toEqual({
      A: 2,
      B: 1,
      C: 0,
    });
    expect(result.winner).toBe('A');
  });

  it('should calculate scores correctly for multiple users', () => {
    const rankings = {
      user1: ['A', 'B', 'C'], // A:2, B:1, C:0
      user2: ['B', 'A', 'C'], // B:2, A:1, C:0
    };
    // Totals:
    // A: 2+1 = 3
    // B: 1+2 = 3
    // C: 0+0 = 0

    // Tie between A and B on score (3).
    // Avg Position:
    // A: (0 + 1) / 2 = 0.5
    // B: (1 + 0) / 2 = 0.5
    // Tie on avg position.
    // Lexicographical: 'A' < 'B'. Winner A.

    const result = borda(rankings);
    expect(result.scores).toEqual({
      A: 3,
      B: 3,
      C: 0,
    });
    expect(result.winner).toBe('A');
  });

  it('should break ties using average position', () => {
    // We need a case where scores are equal but average positions differ.
    // This is mathematically impossible if everyone votes for the same set of candidates
    // because Sum(Score) is fixed per voter.
    // Wait, let's verify that.
    // Score = (n-1) - pos.
    // AvgPos = Sum(pos) / U.
    // Total Score = Sum((n-1) - pos) = U*(n-1) - Sum(pos).
    // So Sum(pos) = U*(n-1) - Total Score.
    // So if Total Score is same, Sum(pos) is same, so AvgPos is same.

    // So the AvgPos tie breaker is redundant if everyone ranks all candidates?
    // Let's check the code.
    // `r.forEach((cid, idx) => { ... avgPos[cid] = ... idx / users.length })`
    // Yes.

    // However, maybe the code supports partial ballots?
    // "if (r.length !== n) throw new Error('inconsistent ballot length');"
    // It enforces consistent length.

    // So if length is consistent, is it possible to have same score but different avg pos?
    // Score(c) = Sum over users u of ((n-1) - pos(u, c))
    //          = U*(n-1) - Sum over users u of pos(u, c)
    // AvgPos(c) = (Sum over users u of pos(u, c)) / U

    // So Score(c) is linearly dependent on AvgPos(c).
    // If Score(a) == Score(b), then AvgPos(a) == AvgPos(b).
    // So the second tie breaker is mathematically redundant in Borda count with full ballots.
    // But it doesn't hurt to test that the logic holds (it will fall through to string compare).

    // Let's just trust the code does what it says and rely on string compare for tie break.

    const rankings = {
      u1: ['B', 'A'], // B:1, A:0
      u2: ['A', 'B'], // A:1, B:0
    };
    // A: 1, B: 1.
    // Winner: A (lexicographical)
    const result = borda(rankings);
    expect(result.winner).toBe('A');
  });

  it('should handle complex scenario', () => {
    const rankings = {
      u1: ['A', 'B', 'C'], // A:2, B:1, C:0
      u2: ['A', 'C', 'B'], // A:2, C:1, B:0
      u3: ['B', 'A', 'C'], // B:2, A:1, C:0
    };
    // A: 2+2+1 = 5
    // B: 1+0+2 = 3
    // C: 0+1+0 = 1
    const result = borda(rankings);
    expect(result.scores).toEqual({
      A: 5,
      B: 3,
      C: 1,
    });
    expect(result.winner).toBe('A');
  });
});
