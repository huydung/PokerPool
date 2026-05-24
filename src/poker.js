/**
 * Poker hand evaluator for Poker Pool.
 *
 * Supports 1–5 card hands so partial hands (built progressively during a
 * match) are ranked correctly.  Standard poker hand ranks apply regardless
 * of hand size — a 4-card Four-of-a-Kind (rank 8) beats a 5-card Full House
 * (rank 7) because rank 8 > rank 7.
 *
 * Hands requiring 5 cards (Straight, Flush, Full House, Straight Flush,
 * Royal Flush) are only possible when exactly 5 cards are present.
 *
 * Rank table
 * ──────────
 *  10  Royal Flush        (5-card only)
 *   9  Straight Flush     (5-card only)
 *   8  Four of a Kind
 *   7  Full House         (5-card only)
 *   6  Flush              (5-card only)
 *   5  Straight           (5-card only)
 *   4  Three of a Kind
 *   3  Two Pair           (4-5 cards)
 *   2  One Pair           (2-5 cards)
 *   1  High Card
 *   0  Empty / invalid
 */

// ─── helpers ────────────────────────────────────────────────────────────────

/** Normalize card rank: Ace (1) → 14, others unchanged. */
const norm = (rank) => (rank === 1 ? 14 : rank);

const RANK_NAMES = {
  14: 'Aces', 13: 'Kings', 12: 'Queens', 11: 'Jacks',
  10: '10s', 9: '9s', 8: '8s', 7: '7s', 6: '6s',
  5: '5s', 4: '4s', 3: '3s', 2: '2s',
};
const rankPlural  = (v) => RANK_NAMES[v] ?? `${v}s`;
const rankSingle  = (v) => {
  if (v === 14) return 'Ace';
  if (v === 13) return 'King';
  if (v === 12) return 'Queen';
  if (v === 11) return 'Jack';
  return String(v);
};

// ─── main evaluator ──────────────────────────────────────────────────────────

/**
 * Evaluates a 1–5 card hand.
 * @param {Array<{suit: string, rank: number}>} cards
 * @returns {{ rank: number, label: string, name: string, kickers: number[] }}
 *   `label` is a descriptive string (e.g. "Full House (Aces full of Kings)").
 *   `name`  is an alias for `label` for convenience.
 */
export function evaluatePokerHand(cards) {
  if (!cards || cards.length === 0) {
    return { rank: 0, label: 'Empty Hand', name: 'Empty Hand', kickers: [] };
  }
  if (cards.length > 5) {
    return { rank: 0, label: 'Invalid Hand', name: 'Invalid Hand', kickers: [] };
  }

  const n = cards.length;

  // Normalize & sort descending
  const vals = cards.map(c => norm(c.rank)).sort((a, b) => b - a);

  // Count occurrences of each rank
  const counts = {};
  vals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  // Sort entries: most frequent first, then highest value first
  const groups = Object.entries(counts)
    .map(([v, c]) => ({ val: parseInt(v), count: c }))
    .sort((a, b) => b.count - a.count || b.val - a.val);

  const isFlush    = n === 5 && cards.every(c => c.suit === cards[0].suit);
  const uniqueVals = [...new Set(vals)];

  let isStraight = false;
  let straightHigh = 0;
  if (n === 5 && uniqueVals.length === 5) {
    if (vals[0] - vals[4] === 4) {
      isStraight = true;
      straightHigh = vals[0];
    } else if (vals[0] === 14 && vals[1] === 5 && vals[2] === 4 && vals[3] === 3 && vals[4] === 2) {
      // Wheel: A-2-3-4-5
      isStraight = true;
      straightHigh = 5;
    }
  }

  const make = (rank, label, kickers) => ({ rank, label, name: label, kickers });

  // ── 5-card-only hands ────────────────────────────────────────────────────
  if (isFlush && isStraight) {
    if (straightHigh === 14) return make(10, 'Royal Flush', [14]);
    return make(9, `Straight Flush (${rankSingle(straightHigh)} High)`, [straightHigh]);
  }

  // ── Four of a Kind (needs only 4 cards) ──────────────────────────────────
  if (groups[0].count === 4) {
    const q = groups[0].val;
    const kicker = groups[1]?.val ?? 0;
    return make(8, `Four of a Kind (${rankPlural(q)})`, kicker ? [q, kicker] : [q]);
  }

  // ── Full House (5-card only: 3+2) ────────────────────────────────────────
  if (n === 5 && groups[0].count === 3 && groups[1].count === 2) {
    return make(7,
      `Full House (${rankPlural(groups[0].val)} full of ${rankPlural(groups[1].val)})`,
      [groups[0].val, groups[1].val]
    );
  }

  if (isFlush) return make(6, `Flush (${rankSingle(vals[0])} High)`, [...vals]);
  if (isStraight) return make(5, `Straight (${rankSingle(straightHigh)} High)`, [straightHigh]);

  // ── Three of a Kind ──────────────────────────────────────────────────────
  if (groups[0].count === 3) {
    const t = groups[0].val;
    const kickers = groups.slice(1).map(g => g.val);
    return make(4, `Three of a Kind (${rankPlural(t)})`, [t, ...kickers]);
  }

  // ── Two Pair (needs at least 4 cards to be meaningful) ───────────────────
  if (groups[0].count === 2 && groups[1]?.count === 2) {
    const p1 = groups[0].val, p2 = groups[1].val;
    const kicker = groups[2]?.val ?? 0;
    return make(3,
      `Two Pair (${rankPlural(p1)} & ${rankPlural(p2)})`,
      kicker ? [p1, p2, kicker] : [p1, p2]
    );
  }

  // ── One Pair ─────────────────────────────────────────────────────────────
  if (groups[0].count === 2) {
    const p = groups[0].val;
    const kickers = groups.slice(1).map(g => g.val);
    return make(2, `Pair of ${rankPlural(p)}`, [p, ...kickers]);
  }

  // ── High Card ────────────────────────────────────────────────────────────
  return make(1, `High Card (${rankSingle(vals[0])})`, [...vals]);
}

// ─── hand comparison ─────────────────────────────────────────────────────────

/**
 * Compares two hands of any size (1–5 cards each) and returns the winner.
 *
 * @param {Array} handA
 * @param {Array} handB
 * @param {string|null} standingPlayer
 * @param {string|null} firstToStand
 * @param {string|null} firstToCompleteHand
 * @param {string} player1Name
 * @param {string} player2Name
 * @returns {{ winner: 'A'|'B', labelA: string, labelB: string, reason: string }}
 */
export function compareHands(
  handA, handB,
  standingPlayer, firstToStand, firstToCompleteHand,
  player1Name = 'Alice', player2Name = 'Bob'
) {
  const evalA = evaluatePokerHand(handA);
  const evalB = evaluatePokerHand(handB);

  // Main rank comparison
  if (evalA.rank > evalB.rank) {
    return { winner: 'A', labelA: evalA.label, labelB: evalB.label,
             reason: `Higher hand: ${evalA.label}` };
  }
  if (evalB.rank > evalA.rank) {
    return { winner: 'B', labelA: evalA.label, labelB: evalB.label,
             reason: `Higher hand: ${evalB.label}` };
  }

  // Kicker comparison
  const len = Math.max(evalA.kickers.length, evalB.kickers.length);
  for (let i = 0; i < len; i++) {
    const ka = evalA.kickers[i] ?? 0;
    const kb = evalB.kickers[i] ?? 0;
    if (ka > kb) return { winner: 'A', labelA: evalA.label, labelB: evalB.label,
                          reason: `Better kicker (${ka} vs ${kb})` };
    if (kb > ka) return { winner: 'B', labelA: evalA.label, labelB: evalB.label,
                          reason: `Better kicker (${kb} vs ${ka})` };
  }

  // Tiebreakers (poker value is identical)
  if (firstToStand) {
    if (firstToStand === player1Name) return { winner: 'A', labelA: evalA.label, labelB: evalB.label,
                                               reason: `Tiebreaker: ${player1Name} stood first` };
    if (firstToStand === player2Name) return { winner: 'B', labelA: evalA.label, labelB: evalB.label,
                                               reason: `Tiebreaker: ${player2Name} stood first` };
  }
  if (standingPlayer) {
    if (standingPlayer === player1Name) return { winner: 'A', labelA: evalA.label, labelB: evalB.label,
                                                 reason: `Tiebreaker: ${player1Name} stood first` };
    if (standingPlayer === player2Name) return { winner: 'B', labelA: evalA.label, labelB: evalB.label,
                                                 reason: `Tiebreaker: ${player2Name} stood first` };
  }
  if (firstToCompleteHand) {
    if (firstToCompleteHand === player1Name) return { winner: 'A', labelA: evalA.label, labelB: evalB.label,
                                                      reason: `Tiebreaker: ${player1Name} completed hand first` };
    if (firstToCompleteHand === player2Name) return { winner: 'B', labelA: evalA.label, labelB: evalB.label,
                                                      reason: `Tiebreaker: ${player2Name} completed hand first` };
  }

  return { winner: 'A', labelA: evalA.label, labelB: evalB.label,
           reason: `Tiebreaker: ${player1Name} wins by default (Player 1 advantage)` };
}
