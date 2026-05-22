/**
 * Light-weight standard 5-card poker evaluation engine for Poker Pool.
 * Supports Ace-high ranking, Ace-low wheel straights (5-4-3-2-A),
 * detailed custom labels, and kicker-based tiebreaker comparisons.
 */

/**
 * Evaluates a 5-card hand and returns its rank, label, and kicker values for tiebreaker.
 * @param {Array<Object>} cards Array of 5 card objects: { suit: 'S'|'H'|'D'|'C', rank: number }
 * @returns {Object} { rank: number, label: string, kickers: Array<number> }
 */
export function evaluatePokerHand(cards) {
  if (!cards || cards.length !== 5) {
    return { rank: 0, label: "Invalid Hand", kickers: [] };
  }

  // Normalize Ace to rank 14, other faces Jack=11, Queen=12, King=13
  const normalizedVals = cards.map(c => c.rank === 1 ? 14 : c.rank);
  
  // Sort descending
  normalizedVals.sort((a, b) => b - a);

  // Group counts of ranks
  const counts = {};
  normalizedVals.forEach(v => {
    counts[v] = (counts[v] || 0) + 1;
  });

  const countEntries = Object.entries(counts).map(([val, count]) => ({
    val: parseInt(val),
    count
  }));

  // Sort by count descending, then by val descending
  countEntries.sort((a, b) => b.count - a.count || b.val - a.val);

  // Check features
  const isFlush = cards.every(c => c.suit === cards[0].suit);
  
  // Straight detection (accounting for standard straights and Ace-low wheel)
  let isStraight = false;
  let straightHigh = 0;

  // Check if we have 5 unique values
  const uniqueVals = [...new Set(normalizedVals)];
  if (uniqueVals.length === 5) {
    // Normal straight check
    if (uniqueVals[0] - uniqueVals[4] === 4) {
      isStraight = true;
      straightHigh = uniqueVals[0];
    }
    // Ace-low wheel straight check: [14, 5, 4, 3, 2]
    else if (
      uniqueVals[0] === 14 &&
      uniqueVals[1] === 5 &&
      uniqueVals[2] === 4 &&
      uniqueVals[3] === 3 &&
      uniqueVals[4] === 2
    ) {
      isStraight = true;
      straightHigh = 5; // 5 is the high card of a 5-4-3-2-A straight
    }
  }

  // Helper to map values to readable rank labels
  const getRankName = (v) => {
    if (v === 14) return "Aces";
    if (v === 13) return "Kings";
    if (v === 12) return "Queens";
    if (v === 11) return "Jacks";
    if (v === 10) return "10s";
    if (v === 9) return "9s";
    if (v === 8) return "8s";
    if (v === 7) return "7s";
    if (v === 6) return "6s";
    if (v === 5) return "5s";
    if (v === 4) return "4s";
    if (v === 3) return "3s";
    if (v === 2) return "2s";
    return v.toString();
  };

  const getSingleRankName = (v) => {
    if (v === 14) return "Ace";
    if (v === 13) return "King";
    if (v === 12) return "Queen";
    if (v === 11) return "Jack";
    return v.toString();
  };

  // 1. Royal Flush
  if (isFlush && isStraight && straightHigh === 14) {
    return { rank: 10, label: "Royal Flush", kickers: [14] };
  }

  // 2. Straight Flush
  if (isFlush && isStraight) {
    return { rank: 9, label: `Straight Flush (${getSingleRankName(straightHigh)} High)`, kickers: [straightHigh] };
  }

  // 3. Four of a Kind
  if (countEntries[0].count === 4) {
    const quadVal = countEntries[0].val;
    const kickerVal = countEntries[1].val;
    return { 
      rank: 8, 
      label: `Four of a Kind (${getRankName(quadVal)})`, 
      kickers: [quadVal, kickerVal] 
    };
  }

  // 4. Full House
  if (countEntries[0].count === 3 && countEntries[1].count === 2) {
    const tripsVal = countEntries[0].val;
    const pairVal = countEntries[1].val;
    return { 
      rank: 7, 
      label: `Full House (${getRankName(tripsVal)} full of ${getRankName(pairVal)})`, 
      kickers: [tripsVal, pairVal] 
    };
  }

  // 5. Flush
  if (isFlush) {
    return { 
      rank: 6, 
      label: `Flush (${getSingleRankName(normalizedVals[0])} High)`, 
      kickers: [...normalizedVals] 
    };
  }

  // 6. Straight
  if (isStraight) {
    return { 
      rank: 5, 
      label: `Straight (${getSingleRankName(straightHigh)} High)`, 
      kickers: [straightHigh] 
    };
  }

  // 7. Three of a Kind
  if (countEntries[0].count === 3) {
    const tripsVal = countEntries[0].val;
    const kicker1 = countEntries[1].val;
    const kicker2 = countEntries[2].val;
    return { 
      rank: 4, 
      label: `Three of a Kind (${getRankName(tripsVal)})`, 
      kickers: [tripsVal, kicker1, kicker2] 
    };
  }

  // 8. Two Pair
  if (countEntries[0].count === 2 && countEntries[1].count === 2) {
    const pair1 = countEntries[0].val;
    const pair2 = countEntries[1].val;
    const kickerVal = countEntries[2].val;
    return { 
      rank: 3, 
      label: `Two Pair (${getRankName(pair1)} & ${getRankName(pair2)})`, 
      kickers: [pair1, pair2, kickerVal] 
    };
  }

  // 9. One Pair
  if (countEntries[0].count === 2) {
    const pairVal = countEntries[0].val;
    const kicker1 = countEntries[1].val;
    const kicker2 = countEntries[2].val;
    const kicker3 = countEntries[3].val;
    return { 
      rank: 2, 
      label: `Pair of ${getRankName(pairVal)}`, 
      kickers: [pairVal, kicker1, kicker2, kicker3] 
    };
  }

  // 10. High Card
  return { 
    rank: 1, 
    label: `High Card (${getSingleRankName(normalizedVals[0])})`, 
    kickers: [...normalizedVals] 
  };
}

/**
 * Compares two 5-card hands and determines the winner based on poker rank, kickers, and standing tiebreakers.
 * Uses dynamic player names rather than hardcoded strings so config name changes are respected everywhere.
 * @param {Array<Object>} handA Player A's hand
 * @param {Array<Object>} handB Player B's hand
 * @param {string|null} standingPlayer Name of the player who stood (voluntary stand), if any
 * @param {string|null} firstToStand Name of the player who stood first (voluntary stand), if any
 * @param {string|null} firstToCompleteHand Name of the player who reached 5 cards first naturally, if any
 * @param {string} player1Name Canonical name for Player A (from CONFIG)
 * @param {string} player2Name Canonical name for Player B (from CONFIG)
 * @returns {Object} { winner: 'A'|'B', labelA: string, labelB: string, reason: string }
 */
export function compareHands(handA, handB, standingPlayer, firstToStand, firstToCompleteHand, player1Name = 'Alice', player2Name = 'Bob') {
  const evalA = evaluatePokerHand(handA);
  const evalB = evaluatePokerHand(handB);

  // Compare main poker rank
  if (evalA.rank > evalB.rank) {
    return { winner: 'A', labelA: evalA.label, labelB: evalB.label, reason: `Higher hand rank: ${evalA.label}` };
  }
  if (evalB.rank > evalA.rank) {
    return { winner: 'B', labelA: evalA.label, labelB: evalB.label, reason: `Higher hand rank: ${evalB.label}` };
  }

  // Compare kickers lexicographically
  const len = Math.max(evalA.kickers.length, evalB.kickers.length);
  for (let i = 0; i < len; i++) {
    const valA = evalA.kickers[i] || 0;
    const valB = evalB.kickers[i] || 0;
    if (valA > valB) {
      return { winner: 'A', labelA: evalA.label, labelB: evalB.label, reason: `Better kicker value (${valA} vs ${valB})` };
    }
    if (valB > valA) {
      return { winner: 'B', labelA: evalA.label, labelB: evalB.label, reason: `Better kicker value (${valB} vs ${valA})` };
    }
  }

  // Absolute tie in poker value. Resolve via standing player / first-to priority.
  // Comparisons use dynamic player name strings so CONFIG.rules.player1Name / player2Name changes
  // are automatically honoured — no hardcoded 'Alice' / 'Bob' anywhere in this function.

  // 1. Check who stood first (rewarded for strategic pacing per GDD Section 5)
  if (firstToStand) {
    if (firstToStand === player1Name) {
      return { winner: 'A', labelA: evalA.label, labelB: evalB.label, reason: `Tiebreaker: ${player1Name} stood first` };
    } else if (firstToStand === player2Name) {
      return { winner: 'B', labelA: evalA.label, labelB: evalB.label, reason: `Tiebreaker: ${player2Name} stood first` };
    }
  }

  // 2. Check if a single standing player exists (only one player stood)
  if (standingPlayer) {
    if (standingPlayer === player1Name) {
      return { winner: 'A', labelA: evalA.label, labelB: evalB.label, reason: `Tiebreaker: ${player1Name} stood first` };
    } else if (standingPlayer === player2Name) {
      return { winner: 'B', labelA: evalA.label, labelB: evalB.label, reason: `Tiebreaker: ${player2Name} stood first` };
    }
  }

  // 3. Fallback: First player to complete their 5-card hand naturally (Forced Showdown path)
  if (firstToCompleteHand) {
    if (firstToCompleteHand === player1Name) {
      return { winner: 'A', labelA: evalA.label, labelB: evalB.label, reason: `Tiebreaker: ${player1Name} completed hand first` };
    } else if (firstToCompleteHand === player2Name) {
      return { winner: 'B', labelA: evalA.label, labelB: evalB.label, reason: `Tiebreaker: ${player2Name} completed hand first` };
    }
  }

  // 4. Ultimate default: Player A wins (they broke the coin toss tie at game start)
  return { winner: 'A', labelA: evalA.label, labelB: evalB.label, reason: `Tiebreaker: ${player1Name} wins by default (Player 1 advantage)` };
}
