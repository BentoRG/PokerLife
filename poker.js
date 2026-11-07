(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.Poker = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this, function () {
  var RANK = {
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    T: 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14,
  };

  var HANDS = [
    "high-card",
    "pair",
    "two-pair",
    "trips",
    "straight",
    "flush",
    "full-house",
    "quads",
    "straight-flush",
  ];

  function rankValue(card) {
    return RANK[card.charAt(0)];
  }

  function freshDeck(rng) {
    var random = rng || Math.random;
    var ranks = "23456789TJQKA";
    var suits = "shdc";
    var deck = [];
    var r;
    var s;
    var i;
    var j;
    var tmp;
    for (r = 0; r < ranks.length; r += 1) {
      for (s = 0; s < suits.length; s += 1) deck.push(ranks.charAt(r) + suits.charAt(s));
    }
    for (i = deck.length - 1; i > 0; i -= 1) {
      j = Math.floor(random() * (i + 1));
      tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }

  function cardParts(card) {
    var suit = { s: "♠", h: "♥", d: "♦", c: "♣" }[card.charAt(1)];
    return {
      rank: card.charAt(0) === "T" ? "10" : card.charAt(0),
      suit: suit,
      red: card.charAt(1) === "h" || card.charAt(1) === "d",
      text: (card.charAt(0) === "T" ? "10" : card.charAt(0)) + suit,
    };
  }

  function combinations(cards, count) {
    var out = [];
    function walk(start, chosen) {
      if (chosen.length === count) {
        out.push(chosen.slice());
        return;
      }
      var i;
      for (i = start; i < cards.length; i += 1) {
        chosen.push(cards[i]);
        walk(i + 1, chosen);
        chosen.pop();
      }
    }
    walk(0, []);
    return out;
  }

  function straightHigh(values) {
    var unique = [];
    var i;
    var run;
    var best;
    for (i = 0; i < values.length; i += 1) {
      if (unique.indexOf(values[i]) === -1) unique.push(values[i]);
    }
    unique.sort(function (a, b) {
      return b - a;
    });
    if (unique.indexOf(14) !== -1) unique.push(1);
    best = 0;
    run = 1;
    for (i = 1; i < unique.length; i += 1) {
      if (unique[i] === unique[i - 1] - 1) {
        run += 1;
        if (run >= 5) best = Math.max(best, unique[i - 4]);
      } else if (unique[i] !== unique[i - 1]) {
        run = 1;
      }
    }
    return best;
  }

  function rankFive(cards) {
    var values = cards.map(rankValue).sort(function (a, b) {
      return b - a;
    });
    var flush = cards.every(function (card) {
      return card.charAt(1) === cards[0].charAt(1);
    });
    var counts = {};
    var groups;
    var high;
    var i;
    values.forEach(function (value) {
      counts[value] = (counts[value] || 0) + 1;
    });
    groups = Object.keys(counts)
      .map(function (key) {
        return { rank: Number(key), count: counts[key] };
      })
      .sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return b.rank - a.rank;
      });
    high = straightHigh(values);
    if (flush && high) return [8, high, 0, 0, 0, 0];
    if (groups[0].count === 4) return [7, groups[0].rank, groups[1].rank, 0, 0, 0];
    if (groups[0].count === 3 && groups[1] && groups[1].count === 2) {
      return [6, groups[0].rank, groups[1].rank, 0, 0, 0];
    }
    if (flush) return [5, values[0], values[1], values[2], values[3], values[4]];
    if (high) return [4, high, 0, 0, 0, 0];
    if (groups[0].count === 3) return [3, groups[0].rank, groups[1].rank, groups[2].rank, 0, 0];
    if (groups[0].count === 2 && groups[1] && groups[1].count === 2) {
      return [2, groups[0].rank, groups[1].rank, groups[2].rank, 0, 0];
    }
    if (groups[0].count === 2) {
      return [1, groups[0].rank, groups[1].rank, groups[2].rank, groups[3].rank, 0];
    }
    return [0, values[0], values[1], values[2], values[3], values[4]];
  }

  function compareRanks(a, b) {
    var i;
    for (i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
  }

  function bestHand(cards) {
    var best = null;
    var bestCards = null;
    if (!cards || cards.length < 5) return null;
    combinations(cards, 5).forEach(function (hand) {
      var rank = rankFive(hand);
      if (!best || compareRanks(rank, best) > 0) {
        best = rank;
        bestCards = hand.slice();
      }
    });
    if (!best) return null;
    return { rank: best, cards: bestCards };
  }

  function rankCards(cards) {
    var found = bestHand(cards);
    return found ? found.rank : null;
  }

  function handName(rank) {
    if (!rank) return null;
    if (rank[0] === 8 && rank[1] === 14) return "royal-flush";
    return HANDS[rank[0]];
  }

  function potSize(state) {
    return state.players.reduce(function (sum, player) {
      return sum + player.invested;
    }, 0);
  }

  function blindSeats(state) {
    var count = state.players.length;
    if (count === 2) {
      return { sb: state.button, bb: (state.button + 1) % count };
    }
    return {
      sb: (state.button + 1) % count,
      bb: (state.button + 2) % count,
    };
  }

  function mustAct(player, state) {
    if (player.folded || player.allIn) return false;
    if (player.streetBet < state.currentBet) return true;
    // Matched players still act when two or more people can bet. A lone
    // player does not get a free raise against opponents who are already all-in.
    return !player.acted && actorsLeft(state) >= 2;
  }

  function nextActor(state, from) {
    var count = state.players.length;
    var step;
    var index;
    for (step = 1; step <= count; step += 1) {
      index = (from + step) % count;
      if (mustAct(state.players[index], state)) return index;
    }
    return -1;
  }

  function actorsLeft(state) {
    return state.players.filter(function (player) {
      return !player.folded && !player.allIn;
    }).length;
  }

  function commit(player, chips) {
    var paid = Math.min(chips, player.stack);
    player.stack -= paid;
    player.streetBet += paid;
    player.invested += paid;
    if (player.stack === 0) player.allIn = true;
    return paid;
  }

  function postBlind(state, index, amount, kind) {
    var player = state.players[index];
    var paid = commit(player, amount);
    state.log.push({
      kind: "blind",
      playerId: player.id,
      blind: kind,
      amount: paid,
    });
  }

  function holeCount(state) {
    return state.variant === "five-card-draw" ? 5 : 2;
  }

  function isDrawPoker(state) {
    return state.variant === "five-card-draw";
  }

  function dealHoles(state) {
    var start = (state.button + 1) % state.players.length;
    var rounds = holeCount(state);
    var round;
    var step;
    var index;
    if (state.players.length === 2) start = state.button;
    for (round = 0; round < rounds; round += 1) {
      for (step = 0; step < state.players.length; step += 1) {
        index = (start + step) % state.players.length;
        if (state.players[index].folded) continue;
        state.players[index].hole.push(state.deck.shift());
      }
    }
  }

  function openPreflop(state) {
    var blinds = blindSeats(state);
    var bets;
    postBlind(state, blinds.sb, state.sb, "sb");
    postBlind(state, blinds.bb, state.bb, "bb");
    bets = state.players.map(function (player) {
      return player.streetBet;
    });
    state.currentBet = Math.max.apply(null, bets);
    state.lastFullRaiseSize = 1;
    state.toAct = nextActor(state, blinds.bb);
  }

  function createHand(opts) {
    var seated = 0;
    var state;
    var variant;
    opts = opts || {};
    variant = opts.variant === "five-card-draw" ? "five-card-draw" : "holdem";
    state = {
      variant: variant,
      sb: opts.sb,
      bb: opts.bb,
      button: opts.button || 0,
      players: (opts.players || []).map(function (player) {
        return {
          id: player.id,
          name: player.name,
          stack: player.stack,
          isHuman: !!player.isHuman,
          hole: [],
          streetBet: 0,
          invested: 0,
          folded: player.stack <= 0,
          allIn: false,
          acted: false,
          discarded: false,
        };
      }),
      deck: (opts.deck || freshDeck(opts.rng)).slice(),
      board: [],
      street: "preflop",
      currentBet: 0,
      lastFullRaiseSize: 1,
      toAct: -1,
      handOver: false,
      revealed: false,
      payouts: [],
      log: [],
    };
    state.players.forEach(function (player) {
      if (!player.folded) seated += 1;
    });
    if (seated < 2) throw new Error("Need two players with chips.");
    openPreflop(state);
    dealHoles(state);
    return state;
  }

  function mustDiscard(player) {
    return !player.folded && !player.discarded;
  }

  function nextDrawer(state, from) {
    var count = state.players.length;
    var step;
    var index;
    for (step = 1; step <= count; step += 1) {
      index = (from + step) % count;
      if (mustDiscard(state.players[index])) return index;
    }
    return -1;
  }

  function openDrawRound(state) {
    state.street = "draw";
    state.players.forEach(function (player) {
      player.streetBet = 0;
      player.acted = false;
      player.discarded = false;
    });
    state.currentBet = 0;
    state.lastFullRaiseSize = 1;
    state.toAct = nextDrawer(state, state.button);
    state.log.push({ kind: "street", street: "draw" });
  }

  function openDrawBet(state) {
    state.street = "draw-bet";
    state.players.forEach(function (player) {
      player.streetBet = 0;
      player.acted = false;
    });
    state.currentBet = 0;
    state.lastFullRaiseSize = 1;
    state.log.push({ kind: "street", street: "draw-bet" });
    state.toAct = nextActor(state, state.button);
  }

  function discardBudget(state) {
    var waiting = 0;
    var i;
    for (i = 0; i < state.players.length; i += 1) {
      if (mustDiscard(state.players[i])) waiting += 1;
    }
    if (waiting <= 0) return 0;
    return Math.min(5, Math.floor(state.deck.length / waiting));
  }

  function legalActions(state) {
    var player;
    var toCall;
    var actions;
    var maxTo;
    if (!state || state.handOver || state.toAct < 0) return null;
    player = state.players[state.toAct];
    if (state.street === "draw") {
      return {
        discard: true,
        maxDiscard: Math.min(player.hole.length, discardBudget(state)),
        fold: false,
        check: false,
        call: 0,
        minRaiseTo: null,
        maxRaiseTo: null,
      };
    }
    toCall = state.currentBet - player.streetBet;
    actions = {
      fold: toCall > 0,
      check: toCall === 0,
      call: toCall > 0 ? Math.min(toCall, player.stack) : 0,
      minRaiseTo: null,
      maxRaiseTo: null,
    };
    // Any whole dollar above the current bet is legal, up to the player's stack.
    if (!player.acted && player.stack > toCall) {
      maxTo = player.streetBet + player.stack;
      if (maxTo > state.currentBet) {
        actions.maxRaiseTo = maxTo;
        actions.minRaiseTo = Math.min(maxTo, state.currentBet + 1);
      }
    }
    return actions;
  }

  function fail(message) {
    return { ok: false, error: message };
  }

  function applyRaise(state, player, to) {
    var previous = state.currentBet;
    var paid = commit(player, to - player.streetBet);
    var increment = player.streetBet - previous;
    if (player.streetBet > previous) {
      state.lastFullRaiseSize = increment;
      state.currentBet = player.streetBet;
      state.players.forEach(function (other) {
        if (other !== player && !other.folded && !other.allIn) other.acted = false;
      });
    }
    player.acted = true;
    return paid;
  }

  function uniqueSortedIndices(indices, max) {
    var seen = {};
    var out = [];
    var i;
    var index;
    if (!Array.isArray(indices)) return null;
    for (i = 0; i < indices.length; i += 1) {
      index = indices[i];
      if (typeof index !== "number" || Math.floor(index) !== index) return null;
      if (index < 0 || index >= max) return null;
      if (seen[index]) return null;
      seen[index] = true;
      out.push(index);
    }
    out.sort(function (a, b) {
      return b - a;
    });
    return out;
  }

  function applyDiscard(state, player, indices) {
    var legal = legalActions(state);
    var maxDiscard = legal && legal.maxDiscard != null ? legal.maxDiscard : 0;
    var sorted = uniqueSortedIndices(indices || [], player.hole.length);
    var removed = [];
    var i;
    if (!sorted) return fail("Discard indices are invalid.");
    if (sorted.length > maxDiscard) return fail("Too many discards.");
    if (sorted.length > state.deck.length) return fail("Deck is empty.");
    for (i = 0; i < sorted.length; i += 1) {
      removed.push(player.hole.splice(sorted[i], 1)[0]);
    }
    for (i = 0; i < removed.length; i += 1) {
      player.hole.push(state.deck.shift());
    }
    player.discarded = true;
    player.acted = true;
    state.log.push({
      kind: "discard",
      playerId: player.id,
      count: removed.length,
    });
    state.toAct = nextDrawer(state, state.toAct);
    return { ok: true };
  }

  function act(state, type, to) {
    var player;
    var legal;
    var paid;
    var opening;
    if (!state || state.handOver) return fail("Hand is over.");
    if (state.toAct < 0) return fail("No action is pending.");
    player = state.players[state.toAct];
    legal = legalActions(state);
    paid = 0;
    opening = state.currentBet === 0;
    if (type === "discard") {
      if (!legal || !legal.discard) return fail("Discard is not legal.");
      return applyDiscard(state, player, to);
    }
    if (type === "fold") {
      if (!legal.fold) return fail("Fold is not legal.");
      player.folded = true;
      player.acted = true;
    } else if (type === "check") {
      if (!legal.check) return fail("Check is not legal.");
      player.acted = true;
    } else if (type === "call") {
      if (!(legal.call > 0)) return fail("Call is not legal.");
      paid = commit(player, legal.call);
      player.acted = true;
    } else if (type === "raise") {
      if (legal.minRaiseTo == null) return fail("Raise is not legal.");
      if (typeof to !== "number" || Math.floor(to) !== to) return fail("Raise must be a whole number.");
      if (to < legal.minRaiseTo || to > legal.maxRaiseTo) return fail("Raise is outside the legal range.");
      paid = applyRaise(state, player, to);
    } else {
      return fail("Unknown action.");
    }
    state.log.push({
      kind: "action",
      playerId: player.id,
      type: type,
      amount: paid,
      to: player.streetBet,
      opening: type === "raise" && opening,
      allIn: player.allIn,
    });
    state.toAct = nextActor(state, state.toAct);
    return { ok: true };
  }

  function dealStreet(state) {
    var count = state.board.length === 0 ? 3 : 1;
    var cards = [];
    var i;
    for (i = 0; i < count; i += 1) cards.push(state.deck.shift());
    state.board = state.board.concat(cards);
    state.street = state.board.length === 3 ? "flop" : state.board.length === 4 ? "turn" : "river";
    state.players.forEach(function (player) {
      player.streetBet = 0;
      player.acted = false;
    });
    state.currentBet = 0;
    state.lastFullRaiseSize = 1;
    state.log.push({ kind: "board", street: state.street, cards: cards.slice() });
    state.toAct = nextActor(state, state.button);
  }

  function seatsAfterButton(state, players) {
    var ordered = [];
    var count = state.players.length;
    var step;
    var player;
    for (step = 1; step <= count; step += 1) {
      player = state.players[(state.button + step) % count];
      if (players.indexOf(player) !== -1) ordered.push(player);
    }
    return ordered;
  }

  function buildPots(players) {
    var levels = [];
    var pots = [];
    var previous = 0;
    players.forEach(function (player) {
      if (player.invested > 0 && levels.indexOf(player.invested) === -1) levels.push(player.invested);
    });
    levels.sort(function (a, b) {
      return a - b;
    });
    levels.forEach(function (level) {
      var contributors = players.filter(function (player) {
        return player.invested >= level;
      });
      var contenders = contributors.filter(function (player) {
        return !player.folded;
      });
      var amount = (level - previous) * contributors.length;
      if (amount > 0 && contenders.length) pots.push({ amount: amount, contenders: contenders });
      previous = level;
    });
    return pots;
  }

  function award(state) {
    var live = state.players.filter(function (player) {
      return !player.folded;
    });
    var totals = {};
    var pots;
    state.revealed = live.length > 1;
    if (state.revealed) {
      live.forEach(function (player) {
        var found = bestHand(player.hole.concat(state.board));
        player.handRank = found ? found.rank : null;
        player.handCards = found ? found.cards.slice() : null;
        state.log.push({
          kind: "show",
          playerId: player.id,
          hand: handName(player.handRank),
          cards: player.handCards ? player.handCards.slice() : null,
        });
      });
    }
    pots = buildPots(state.players);
    pots.forEach(function (pot) {
      var best = null;
      var winners = [];
      var ordered;
      var share;
      var extra;
      pot.contenders.forEach(function (player) {
        var available = player.hole.concat(state.board);
        var rank = player.handRank || (available.length >= 5 ? rankCards(available) : null);
        var cmp = best == null || !rank ? 1 : compareRanks(rank, best);
        if (!state.revealed) {
          winners = pot.contenders.slice();
          return;
        }
        if (cmp > 0) {
          best = rank;
          winners = [player];
        } else if (cmp === 0) winners.push(player);
      });
      if (!state.revealed) winners = pot.contenders.slice();
      ordered = seatsAfterButton(state, winners);
      share = Math.floor(pot.amount / ordered.length);
      extra = pot.amount % ordered.length;
      ordered.forEach(function (player, index) {
        var gain = share + (index < extra ? 1 : 0);
        var row = totals[player.id] || { playerId: player.id, amount: 0, hand: null, cards: null, refund: true };
        var uncalled = state.revealed && pot.contenders.length === 1;
        player.stack += gain;
        row.amount += gain;
        if (!uncalled) row.refund = false;
        if (pot.contenders.length > 1 && player.handRank) {
          row.hand = handName(player.handRank);
          row.cards = player.handCards ? player.handCards.slice() : null;
        }
        totals[player.id] = row;
      });
    });
    state.payouts = seatsAfterButton(state, state.players).filter(function (player) {
      return totals[player.id];
    }).map(function (player) {
      return totals[player.id];
    });
    state.payouts.forEach(function (payout) {
      if (payout.amount > 0) {
        state.log.push({
          kind: "win",
          playerId: payout.playerId,
          amount: payout.amount,
          hand: payout.hand,
          cards: payout.cards ? payout.cards.slice() : null,
          refund: payout.refund,
        });
      }
    });
    state.handOver = true;
    state.street = "complete";
    state.toAct = -1;
  }

  function advance(state) {
    var live;
    if (!state || state.handOver) return fail("Hand is over.");
    if (state.toAct !== -1) return fail("Action is still pending.");
    live = state.players.filter(function (player) {
      return !player.folded;
    });
    if (live.length === 1) {
      award(state);
      return { ok: true, event: "fold-win" };
    }
    if (isDrawPoker(state)) {
      if (state.street === "preflop") {
        openDrawRound(state);
        return { ok: true, event: "draw" };
      }
      if (state.street === "draw") {
        openDrawBet(state);
        return { ok: true, event: "draw-bet" };
      }
      award(state);
      return { ok: true, event: "showdown" };
    }
    if (state.board.length < 5) {
      dealStreet(state);
      return { ok: true, event: state.street };
    }
    award(state);
    return { ok: true, event: "showdown" };
  }

  return {
    freshDeck: freshDeck,
    cardParts: cardParts,
    rankCards: rankCards,
    bestHand: bestHand,
    compareRanks: compareRanks,
    handName: handName,
    potSize: potSize,
    blindSeats: blindSeats,
    createHand: createHand,
    legalActions: legalActions,
    act: act,
    advance: advance,
  };
});
