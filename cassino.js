(function () {
  var START = 500;
  var SB = 5;
  var BB = 10;
  var BOT_PAUSE = 1700;
  var STREET_PAUSE = 2000;
  var DEAL_TRAVEL = 640;
  var REVEAL_OUT = 460;
  var REVEAL_IN = 560;

  function speedScale() {
    if (typeof window !== "undefined" && window.PokerLifeAuth && window.PokerLifeAuth.gameSpeedScale) {
      return window.PokerLifeAuth.gameSpeedScale();
    }
    return 1;
  }

  function timed(ms) {
    return Math.max(40, Math.round(ms * speedScale()));
  }
  var HANDS = {
    "royal-flush": "um royal flush",
    "straight-flush": "um straight flush",
    quads: "uma quadra",
    "full-house": "um full house",
    flush: "um flush",
    straight: "uma sequência",
    trips: "uma trinca",
    "two-pair": "dois pares",
    pair: "um par",
    "high-card": "carta alta",
  };
  var STREETS = {
    preflop: "Pré-flop",
    flop: "Flop",
    turn: "Turn",
    river: "River",
    draw: "Troca",
    "draw-bet": "Pós-troca",
    complete: "Mão encerrada",
  };
  var VARIANT_LABELS = {
    holdem: "Texas Hold'em",
    "five-card-draw": "Five Card Draw",
  };
  var RANK = "23456789TJQKA";
  // Persist the live match so a refresh cannot discard a bad hand for a new deal.
  var MATCH_KEY = "pokerlife.cassino.match";

  var roster;
  var button;
  var state;
  var timer;
  var logCursor;
  var dealToken = 0;
  var shownBoard = 0;
  var shownHoles = false;
  var handClosing = false;
  var vsBots = false;
  var vsFriends = false;
  var gameVariant = "holdem";
  var pendingVariant = "holdem";
  var selectedDiscards = {};
  var statusMessage = "";
  var noticeTimer;
  var NOTICE_MS = 3200;
  // Personalities are shuffled onto Bot 1–4 each hand (maniac/bluffer/calling-station move around).
  var botStyles = {};
  // Maniac style: wild big-bet mood on ~12% of hands; otherwise plays normally.
  var maniacWildHand = false;
  var maniacFired = false;
  // Stack bots started the match with; used so richer bots fold less and poorer ones fold more.
  var startStack = START;
  // Blinds fixed when the player enters the cassino (3% of their money for the big blind).
  var matchSb = SB;
  var matchBb = BB;
  // Friends match: host runs the engine; guests publish actions and poll shared room state.
  var FRIENDS_SB = 10;
  var FRIENDS_BB = 20;
  var MAX_FRIENDS = 5;
  var FRIEND_BOTS = [
    { id: "lia", name: "Bot 1" },
    { id: "caio", name: "Bot 2" },
    { id: "duda", name: "Bot 3" },
    { id: "ravi", name: "Bot 4" },
  ];
  var ROOM_POLL_MS = 2500;
  var roomCode = null;
  var room = null;
  var localPlayerId = null;
  var isHost = false;
  var roomPollTimer = null;
  var publishing = false;
  var waitingForRemote = false;
  var lastRoomSeq = 0;
  var friendsNoticeTimer;

  function clearMatchSave() {
    try {
      sessionStorage.removeItem(MATCH_KEY);
    } catch (error) {}
  }

  function saveMatch() {
    if (!vsBots || vsFriends || !roster) return;
    try {
      sessionStorage.setItem(
        MATCH_KEY,
        JSON.stringify({
          vsBots: vsBots,
          gameVariant: gameVariant,
          button: button,
          roster: roster,
          state: state,
          shownBoard: shownBoard,
          shownHoles: shownHoles,
          handClosing: handClosing,
          statusMessage: statusMessage,
          botStyles: botStyles,
          maniacWildHand: maniacWildHand,
          maniacFired: maniacFired,
          startStack: startStack,
          matchSb: matchSb,
          matchBb: matchBb,
        })
      );
    } catch (error) {}
  }

  function loadMatch() {
    try {
      var raw = sessionStorage.getItem(MATCH_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      clearMatchSave();
      return null;
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rankValue(card) {
    return RANK.indexOf(card.charAt(0)) + 2;
  }

  function chen(left, right) {
    var high = Math.max(rankValue(left), rankValue(right));
    var low = Math.min(rankValue(left), rankValue(right));
    var bases = { 14: 10, 13: 8, 12: 7, 11: 6, 10: 5 };
    var score = bases[high] == null ? high / 2 : bases[high];
    var gap = high - low - 1;
    if (rankValue(left) === rankValue(right)) score = Math.max(score * 2, 5);
    if (left.charAt(1) === right.charAt(1)) score += 2;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    if (gap <= 1 && high < 12 && rankValue(left) !== rankValue(right)) score += 1;
    return score;
  }

  function hasFlushDraw(cards) {
    var counts = { s: 0, h: 0, d: 0, c: 0 };
    var suits = ["s", "h", "d", "c"];
    var i;
    cards.forEach(function (card) {
      counts[card.charAt(1)] += 1;
    });
    for (i = 0; i < suits.length; i += 1) {
      if (counts[suits[i]] === 4) return true;
    }
    return false;
  }

  function straightDraw(cards) {
    var has = {};
    var low;
    var missing;
    var present;
    var rank;
    var openEnded = false;
    var gutshot = false;
    cards.forEach(function (card) {
      has[rankValue(card)] = true;
    });
    if (has[14]) has[1] = true;
    for (low = 1; low <= 10; low += 1) {
      missing = 0;
      present = [];
      for (rank = low; rank < low + 5; rank += 1) {
        if (has[rank]) present.push(rank);
        else missing += 1;
      }
      if (missing === 1 && present.length === 4) {
        if (present[present.length - 1] - present[0] === 3) openEnded = true;
        else gutshot = true;
      }
    }
    return { openEnded: openEnded, gutshot: gutshot && !openEnded };
  }

  function strength(player, table) {
    var made;
    var base;
    var score;
    var cards;
    var draw;
    var bases = [0.12, 0.42, 0.6, 0.72, 0.8, 0.84, 0.9, 0.96, 0.99];
    if (table.variant === "five-card-draw") {
      made = Poker.rankCards(player.hole);
      if (!made) return 0;
      return clamp(bases[made[0]] + made[1] / 100, 0, 1);
    }
    if (!table.board.length) return clamp(chen(player.hole[0], player.hole[1]) / 20, 0, 1);
    made = Poker.rankCards(player.hole.concat(table.board));
    base = bases[made[0]];
    score = base + made[1] / 100;
    if (table.board.length < 5 && made[0] < 4) {
      cards = player.hole.concat(table.board);
      if (hasFlushDraw(cards)) score += 0.16;
      draw = straightDraw(cards);
      if (draw.openEnded) score += 0.12;
      else if (draw.gutshot) score += 0.05;
    }
    return clamp(score, 0, 1);
  }

  function chooseDiscardIndices(hole) {
    var counts = {};
    var suits = {};
    var keep = {};
    var discard = [];
    var i;
    var card;
    var rank;
    var suit;
    var bestSuit = null;
    var bestSuitCount = 0;
    var groups;
    var made;
    var pairRanks = {};
    var order;
    if (!hole || hole.length < 5) return [];
    made = Poker.rankCards(hole);
    for (i = 0; i < hole.length; i += 1) {
      card = hole[i];
      rank = rankValue(card);
      suit = card.charAt(1);
      counts[rank] = (counts[rank] || 0) + 1;
      suits[suit] = (suits[suit] || 0) + 1;
      if (suits[suit] > bestSuitCount) {
        bestSuitCount = suits[suit];
        bestSuit = suit;
      }
    }
    groups = Object.keys(counts)
      .map(function (key) {
        return { rank: Number(key), count: counts[key] };
      })
      .sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return b.rank - a.rank;
      });
    if (made && made[0] >= 4) return [];
    if (groups[0] && groups[0].count >= 2) {
      for (i = 0; i < groups.length; i += 1) {
        if (groups[i].count >= 2) pairRanks[groups[i].rank] = true;
      }
      for (i = 0; i < hole.length; i += 1) {
        if (pairRanks[rankValue(hole[i])]) keep[i] = true;
      }
      if (groups[0].count === 3 && groups[1] && groups[1].count === 1) {
        // Keep trips; discard both kickers unless one is an ace for full-house hopes.
        for (i = 0; i < hole.length; i += 1) {
          if (!keep[i] && rankValue(hole[i]) === 14) keep[i] = true;
        }
      }
    } else if (bestSuitCount >= 4) {
      for (i = 0; i < hole.length; i += 1) {
        if (hole[i].charAt(1) === bestSuit) keep[i] = true;
      }
    } else {
      // Keep the two highest cards when nothing is made.
      order = hole.map(function (item, index) {
        return { index: index, rank: rankValue(item) };
      }).sort(function (a, b) {
        return b.rank - a.rank;
      });
      keep[order[0].index] = true;
      keep[order[1].index] = true;
    }
    for (i = 0; i < hole.length; i += 1) {
      if (!keep[i]) discard.push(i);
    }
    return discard;
  }

  function sizedBet(table, legal, fraction) {
    var pot = Poker.potSize(table);
    var raw;
    if (table.currentBet === 0) raw = Math.max(table.bb, Math.round(pot * fraction));
    else raw = table.currentBet + Math.max(table.bb, Math.round((pot + legal.call) * fraction));
    return clamp(raw, legal.minRaiseTo, legal.maxRaiseTo);
  }

  // Bot difficulties: all 10/10 (maximum).
  var SKILL = {
    lia: 10,
    caio: 10,
    duda: 10,
    ravi: 10,
  };

  var STYLES = ["calling-station", "bluffer", "maniac"];

  function skillOf(player) {
    var skill = SKILL[player.id];
    return skill == null ? 10 : skill;
  }

  function pickBotStyles() {
    var ids = ["lia", "caio", "duda", "ravi"];
    var styles = STYLES.slice();
    var i;
    var j;
    var tmp;
    // Four bots, three styles: keep every style in play, then add one random duplicate.
    styles.push(STYLES[Math.floor(Math.random() * STYLES.length)]);
    for (i = styles.length - 1; i > 0; i -= 1) {
      j = Math.floor(Math.random() * (i + 1));
      tmp = styles[i];
      styles[i] = styles[j];
      styles[j] = tmp;
    }
    botStyles = {};
    for (i = 0; i < ids.length; i += 1) botStyles[ids[i]] = styles[i];
  }

  function pickManiacMood() {
    maniacWildHand = Math.random() < 0.12;
    maniacFired = false;
  }

  function styleOf(player) {
    if (botStyles[player.id]) return botStyles[player.id];
    return "calling-station";
  }

  function hasMadeCombination(player, table) {
    var made;
    if (!table.board.length) return false;
    made = Poker.rankCards(player.hole.concat(table.board));
    return !!(made && made[0] >= 1);
  }

  function hasGoodDrawChance(player, table) {
    var cards;
    var draw;
    if (!table.board.length || table.board.length >= 5) return false;
    cards = player.hole.concat(table.board);
    if (hasFlushDraw(cards)) return true;
    draw = straightDraw(cards);
    return !!(draw.openEnded || draw.gutshot);
  }

  function canContinuePostflop(player, table) {
    return hasMadeCombination(player, table) || hasGoodDrawChance(player, table);
  }

  function chooseSkillful(table, legal, player) {
    var skill = skillOf(player);
    var error = (10 - skill) / 10;
    var trueScore = strength(player, table);
    var score = clamp(trueScore + (Math.random() - 0.5) * error * 0.9, 0, 1);
    var pot = Poker.potSize(table);
    var price = legal.call > 0 ? legal.call / (pot + legal.call) : 0;
    var size = skill >= 9 ? 1 : skill >= 7 ? 0.66 : 0.4;
    var valueAt = skill >= 9 ? 0.62 : skill >= 7 ? 0.72 : 0.84;
    if (legal.call > 0) {
      if (score >= valueAt && legal.minRaiseTo != null && Math.random() < 0.92 - error * 0.55) {
        return { type: "raise", to: sizedBet(table, legal, size) };
      }
      if (
        legal.minRaiseTo != null &&
        score < 0.72 &&
        Math.random() < (skill >= 9 ? 0.05 : error * 0.22) &&
        (skill < 9 || score >= 0.34)
      ) {
        return { type: "raise", to: sizedBet(table, legal, skill >= 9 ? 0.66 : Math.random() < 0.5 ? 0.25 : 1.25) };
      }
      if (score + error * 0.35 >= price && score >= 0.1 - error * 0.2) return { type: "call" };
      if (Math.random() < error * 0.55) return { type: "call" };
      // Prefer calling cheap prices instead of folding light.
      if (price <= 0.3 && score >= 0.06 && Math.random() < 0.62) return { type: "call" };
      if (trueScore >= 0.8 && Math.random() < error * 0.22) return { type: "fold" };
      return legal.fold ? { type: "fold" } : { type: "call" };
    }
    if (legal.minRaiseTo != null && score >= valueAt && Math.random() < 0.94 - error * 0.5) {
      return { type: "raise", to: sizedBet(table, legal, size) };
    }
    if (legal.minRaiseTo != null && score >= 0.48 && Math.random() < 0.42 - error * 0.28) {
      return { type: "raise", to: sizedBet(table, legal, skill >= 9 ? 0.55 : 0.4) };
    }
    if (legal.minRaiseTo != null && Math.random() < 0.05 + error * 0.18 && (skill < 9 || score >= 0.32)) {
      return { type: "raise", to: sizedBet(table, legal, skill >= 9 ? 0.66 : 0.35) };
    }
    if (legal.check) return { type: "check" };
    if (legal.fold) return { type: "fold" };
    return { type: "check" };
  }

  // Calling-station: always continues preflop; postflop only with a made hand or strong draw.
  function chooseCallingStation(table, legal, player) {
    var score = strength(player, table);
    var price;
    if (table.variant === "five-card-draw") return chooseSkillful(table, legal, player);
    if (!table.board.length) {
      if (legal.call > 0) {
        if (legal.minRaiseTo != null && score >= 0.62 && Math.random() < 0.92) {
          return { type: "raise", to: sizedBet(table, legal, 1) };
        }
        return { type: "call" };
      }
      if (legal.minRaiseTo != null && score >= 0.62 && Math.random() < 0.94) {
        return { type: "raise", to: sizedBet(table, legal, 1) };
      }
      if (legal.minRaiseTo != null && score >= 0.48 && Math.random() < 0.42) {
        return { type: "raise", to: sizedBet(table, legal, 0.55) };
      }
      if (legal.check) return { type: "check" };
      return { type: "call" };
    }
    if (!canContinuePostflop(player, table)) {
      if (legal.check) return { type: "check" };
      // Sometimes float a small stab instead of always folding air.
      if (legal.call > 0) {
        price = legal.call / (Poker.potSize(table) + legal.call);
        if (price <= 0.28 && Math.random() < 0.5) return { type: "call" };
      }
      if (legal.fold) return { type: "fold" };
      return { type: "check" };
    }
    return chooseSkillful(table, legal, player);
  }

  // Bluffer: bluffs 3 out of 5 times when the hand is not strong enough to value-bet.
  function chooseBluffer(table, legal, player) {
    var score = strength(player, table);
    if (legal.minRaiseTo != null && score < 0.62 && Math.random() < 0.6) {
      return { type: "raise", to: sizedBet(table, legal, Math.random() < 0.5 ? 0.66 : 1) };
    }
    return chooseSkillful(table, legal, player);
  }

  // Best street to fire a huge bet: monsters act sooner; medium value waits for later streets.
  function maniacShouldFire(table, score, made) {
    var boardLen = table.board.length;
    var category = made && made[0] != null ? made[0] : 0;
    var chance;
    if (maniacFired) return false;
    if (category >= 6) chance = boardLen === 3 ? 0.9 : boardLen === 4 ? 0.85 : 0.95;
    else if (category >= 4) chance = boardLen === 3 ? 0.35 : boardLen === 4 ? 0.7 : 0.88;
    else if (category >= 2 || score >= 0.78) chance = boardLen === 3 ? 0.22 : boardLen === 4 ? 0.55 : 0.75;
    else return false;
    // Prefer spots that extract value: checked to us, or only a small bet to raise.
    if (table.currentBet === 0) chance += 0.12;
    else if (table.currentBet <= table.bb * 3) chance += 0.08;
    else chance -= 0.15;
    return Math.random() < clamp(chance, 0.08, 0.96);
  }

  // Maniac: mostly normal play; on the wild hand, oversized bets postflop, rare all-ins with monsters.
  function chooseManiac(table, legal, player) {
    var score;
    var made;
    var allInWorthy;
    if (!maniacWildHand) return chooseSkillful(table, legal, player);
    if (table.variant === "five-card-draw") {
      if (table.street !== "draw-bet") return chooseSkillful(table, legal, player);
      score = strength(player, table);
      made = Poker.rankCards(player.hole);
      allInWorthy = score >= 0.93 || (made && made[0] >= 6);
      if (legal.minRaiseTo != null && !maniacFired && (allInWorthy || score >= 0.75) && Math.random() < 0.7) {
        maniacFired = true;
        if (allInWorthy && Math.random() < 0.22) return { type: "raise", to: legal.maxRaiseTo };
        return { type: "raise", to: sizedBet(table, legal, Math.random() < 0.5 ? 0.9 : 1.25) };
      }
      return chooseSkillful(table, legal, player);
    }
    if (!table.board.length) return chooseSkillful(table, legal, player);
    score = strength(player, table);
    made = Poker.rankCards(player.hole.concat(table.board));
    allInWorthy = score >= 0.93 || (made && made[0] >= 6);
    if (legal.minRaiseTo != null && maniacShouldFire(table, score, made)) {
      maniacFired = true;
      if (allInWorthy && Math.random() < 0.22) return { type: "raise", to: legal.maxRaiseTo };
      return { type: "raise", to: sizedBet(table, legal, Math.random() < 0.5 ? 0.9 : 1.25) };
    }
    return chooseSkillful(table, legal, player);
  }

  function chooseByStyle(style, table, legal, player) {
    if (style === "bluffer") return chooseBluffer(table, legal, player);
    if (style === "maniac") return chooseManiac(table, legal, player);
    return chooseCallingStation(table, legal, player);
  }

  // 0.5 at the match starting stack; lower when rich (brave), higher when poor (scared).
  function moneyFear(player) {
    var baseline = startStack > 0 ? startStack : START;
    var ratio = player.stack / baseline;
    return clamp(0.5 - (Math.log(Math.max(ratio, 0.08)) / Math.LN2) * 0.28, 0.05, 0.95);
  }

  // Rich bots often call instead of folding; poor bots rarely fold instead of continuing.
  function withMoneyFear(choice, table, legal, player) {
    var fear = moneyFear(player);
    var loosen = 0.5 - fear;
    if (!choice) return choice;
    if (choice.type === "fold" && legal.call > 0 && loosen > 0 && Math.random() < loosen * 1.9) {
      return { type: "call" };
    }
    if (legal.fold && legal.call > 0 && loosen < 0) {
      if ((choice.type === "call" || choice.type === "raise") && Math.random() < -loosen * 0.55) {
        return { type: "fold" };
      }
    }
    return choice;
  }

  function usedCardSet(table, player) {
    var used = {};
    (player.hole || []).forEach(function (card) {
      used[card] = true;
    });
    (table.board || []).forEach(function (card) {
      used[card] = true;
    });
    return used;
  }

  function remainingDeck(table, player) {
    var used = usedCardSet(table, player);
    var deck = [];
    var ranks = "23456789TJQKA";
    var suits = "shdc";
    var r;
    var s;
    var card;
    for (r = 0; r < ranks.length; r += 1) {
      for (s = 0; s < suits.length; s += 1) {
        card = ranks.charAt(r) + suits.charAt(s);
        if (!used[card]) deck.push(card);
      }
    }
    return deck;
  }

  function comboLooksStrong(hole, board) {
    var made;
    var cards;
    var draw;
    if (!board.length) return chen(hole[0], hole[1]) >= 8;
    made = Poker.rankCards(hole.concat(board));
    if (!made) return false;
    if (made[0] >= 2) return true;
    if (made[0] === 1) return made[1] >= 10;
    if (board.length >= 5) return false;
    cards = hole.concat(board);
    if (hasFlushDraw(cards)) return true;
    draw = straightDraw(cards);
    return !!(draw.openEnded || draw.gutshot);
  }

  // Bayes: P(strong hand | this bet size) vs P(bluff), from remaining combos and bet sizing.
  function estimateBetMeaning(table, player, legal) {
    var call = legal && legal.call > 0 ? legal.call : 0;
    var pot = Poker.potSize(table);
    var sizeRatio = call > 0 ? call / Math.max(pot, table.bb) : 0;
    var deck;
    var i;
    var j;
    var strong = 0;
    var total = 0;
    var priorStrong;
    var priorWeak;
    var betGivenStrong;
    var betGivenWeak;
    var pBet;
    var valueChance;
    if (call <= 0) {
      return { valueChance: 0, bluffChance: 1, sizeRatio: 0, priorStrong: 0 };
    }
    deck = remainingDeck(table, player);
    for (i = 0; i < deck.length; i += 1) {
      for (j = i + 1; j < deck.length; j += 1) {
        total += 1;
        if (comboLooksStrong([deck[i], deck[j]], table.board)) strong += 1;
      }
    }
    priorStrong = total > 0 ? strong / total : 0.25;
    priorWeak = 1 - priorStrong;
    // Bigger bets are more often value; huge overbets stay polarized (some bluffs remain).
    betGivenStrong = clamp(0.48 + sizeRatio * 0.36, 0.5, 0.94);
    betGivenWeak = clamp(0.2 - sizeRatio * 0.07, 0.035, 0.2);
    if (sizeRatio > 1) betGivenWeak += Math.min(0.14, (sizeRatio - 1) * 0.09);
    pBet = betGivenStrong * priorStrong + betGivenWeak * priorWeak;
    valueChance = pBet > 0 ? (betGivenStrong * priorStrong) / pBet : priorStrong;
    valueChance = clamp(valueChance, 0.08, 0.95);
    return {
      valueChance: valueChance,
      bluffChance: 1 - valueChance,
      sizeRatio: sizeRatio,
      priorStrong: priorStrong,
    };
  }

  // Facing a big bet, sometimes fold when value is likely; still call more often as a bluff-catch.
  function withBigBetFear(choice, table, legal, player) {
    var meaning;
    var score;
    var pot;
    var price;
    var needed;
    var fear;
    if (!choice || !legal || !(legal.call > 0) || !legal.fold) return choice;
    if (choice.type !== "call" && choice.type !== "raise") return choice;
    meaning = estimateBetMeaning(table, player, legal);
    // Ignore small probes; fear only kicks in on meaningfully large bets.
    if (meaning.sizeRatio < 0.45 && legal.call < table.bb * 5) return choice;
    score = strength(player, table);
    pot = Poker.potSize(table);
    price = legal.call / (pot + legal.call);
    needed = price * (0.48 + meaning.valueChance * 0.8);
    if (score >= Math.max(needed, meaning.valueChance * 0.58) + 0.02) return choice;
    if (score >= price * 0.85 && Math.random() < meaning.bluffChance * 0.85) {
      return choice.type === "raise" ? { type: "call" } : choice;
    }
    fear = meaning.valueChance * clamp((meaning.sizeRatio - 0.35) / 1.2, 0.12, 0.78) * 0.62;
    if (Math.random() < fear) return { type: "fold" };
    if (choice.type === "raise" && Math.random() < fear * 0.7) return { type: "call" };
    return choice;
  }

  function chooseBot(table) {
    var legal = Poker.legalActions(table);
    var player = table.players[table.toAct];
    var choice;
    if (legal && legal.discard) {
      return {
        type: "discard",
        to: chooseDiscardIndices(player.hole).slice(0, legal.maxDiscard || 0),
      };
    }
    choice = chooseByStyle(styleOf(player), table, legal, player);
    if (table.variant !== "five-card-draw") {
      choice = withBigBetFear(choice, table, legal, player);
    }
    return withMoneyFear(choice, table, legal, player);
  }

  function later(fn, ms) {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  }

  function auth() {
    return typeof window !== "undefined" ? window.PokerLifeAuth : null;
  }

  function localName() {
    var api = auth();
    return api && api.currentUser ? api.currentUser() || "" : "";
  }

  function isLocalPlayer(player) {
    if (!player) return false;
    if (vsFriends) return player.id === localPlayerId;
    return !!player.isHuman;
  }

  function isBotPlayer(player) {
    return !!(player && player.isHuman === false);
  }

  function mapRoomPlayer(player) {
    return {
      id: player.id,
      name: player.name,
      stack: player.stack,
      left: !!player.left,
      isHuman: !isBotPlayer(player),
    };
  }

  // Rotate seats so the viewing player always sits in s0 (below the board).
  function localLogicalSeat() {
    var i;
    if (!state || !state.players) return 0;
    for (i = 0; i < state.players.length; i += 1) {
      if (isLocalPlayer(state.players[i])) return i;
    }
    return 0;
  }

  function visualSeatIndex(logicalIndex) {
    var count = state && state.players ? state.players.length : 0;
    if (count <= 0) return logicalIndex;
    return (logicalIndex - localLogicalSeat() + count) % count;
  }

  function stopRoomPoll() {
    if (roomPollTimer) {
      clearInterval(roomPollTimer);
      roomPollTimer = null;
    }
  }

  function showFriendsNotice(message) {
    var notice = document.getElementById("friends-notice");
    if (!notice) return;
    notice.hidden = !message;
    notice.textContent = message || "";
    clearTimeout(friendsNoticeTimer);
    if (message) {
      friendsNoticeTimer = setTimeout(function () {
        notice.hidden = true;
        notice.textContent = "";
      }, timed(NOTICE_MS));
    }
  }

  function randomRoomCode() {
    var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var out = "";
    var i;
    for (i = 0; i < 6; i += 1) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    return out;
  }

  function readRoomCodeInput() {
    var api = auth();
    var input = document.getElementById("room-code");
    var raw = input ? input.value : "";
    if (api && api.normalizeRoomCode) return api.normalizeRoomCode(raw);
    return String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);
  }

  function activeRoomPlayers(list) {
    var out = [];
    var i;
    var player;
    if (!Array.isArray(list)) return out;
    for (i = 0; i < list.length; i += 1) {
      player = list[i];
      if (!player || typeof player.id !== "string" || !player.id) continue;
      if (player.left) continue;
      out.push(player);
    }
    return out;
  }

  function publishRoom(next) {
    var api = auth();
    if (!api || !roomCode || !next) return Promise.resolve(null);
    publishing = true;
    next.seq = (next.seq || 0) + 1;
    room = next;
    lastRoomSeq = next.seq;
    return api.saveRoom(roomCode, next).then(
      function (saved) {
        publishing = false;
        room = saved;
        lastRoomSeq = saved.seq || lastRoomSeq;
        return saved;
      },
      function (error) {
        publishing = false;
        throw error;
      }
    );
  }

  function localPokerLedgerDetail() {
    var localId = null;
    var i;
    var payout;
    var cards;
    if (!state || !Array.isArray(state.payouts)) return null;
    for (i = 0; i < state.players.length; i += 1) {
      if (isLocalPlayer(state.players[i])) {
        localId = state.players[i].id;
        break;
      }
    }
    if (!localId) return null;
    for (i = 0; i < state.payouts.length; i += 1) {
      payout = state.payouts[i];
      if (!payout || payout.playerId !== localId) continue;
      if (!(payout.amount > 0) || payout.refund) continue;
      if (!Array.isArray(payout.cards) || !payout.cards.length) continue;
      cards = payout.cards.map(cardLabel);
      return {
        hand: HANDS[payout.hand] || payout.hand || "",
        cards: cards,
      };
    }
    return null;
  }

  function syncLocalMoneyFromRoster() {
    var api = auth();
    var i;
    if (!api || !roster || !localPlayerId) return;
    for (i = 0; i < roster.length; i += 1) {
      if (roster[i].id === localPlayerId) {
        api.setMoney(roster[i].stack, "poker", localPokerLedgerDetail());
        return;
      }
    }
  }

  function leaveButtonVisible(show) {
    var button = document.getElementById("leave-match");
    if (button) button.hidden = !show;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function playerById(id) {
    var i;
    for (i = 0; i < state.players.length; i += 1) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }

  function cardLabel(card) {
    return Poker.cardParts(card).text;
  }

  function combinationText(hand, cards) {
    var name = HANDS[hand] || hand;
    if (!hand) return "";
    if (!cards || !cards.length) return name;
    return name + ": " + cards.slice().sort(function (a, b) {
      return rankValue(b) - rankValue(a);
    }).map(cardLabel).join(" ");
  }

  function formatEntry(entry) {
    var name = playerById(entry.playerId);
    var label = name ? name.name : entry.playerId;
    var suffix = entry.allIn ? " (all-in)" : "";
    var cards;
    var combo;
    if (entry.kind === "blind") {
      return label + " posta " + (entry.blind === "sb" ? "o small blind" : "o big blind") + " de $" + entry.amount;
    }
    if (entry.kind === "action") {
      if (entry.type === "fold") return label + " desiste";
      if (entry.type === "check") return label + " passa";
      if (entry.type === "call") return label + " paga $" + entry.amount + suffix;
      if (entry.opening) return label + " aposta $" + entry.to + suffix;
      return label + " aumenta para $" + entry.to + suffix;
    }
    if (entry.kind === "discard") {
      if (!entry.count) return label + " fica";
      return label + " troca " + entry.count + (entry.count === 1 ? " carta" : " cartas");
    }
    if (entry.kind === "street") {
      return STREETS[entry.street] || entry.street;
    }
    if (entry.kind === "board") {
      cards = entry.cards.map(cardLabel);
      return { flop: "Flop", turn: "Turn", river: "River" }[entry.street] + ": " + cards.join(" ");
    }
    if (entry.kind === "show") return label + " mostra " + combinationText(entry.hand, entry.cards);
    if (entry.kind === "win") {
      if (entry.refund) return label + " recebe $" + entry.amount + " de volta";
      combo = combinationText(entry.hand, entry.cards);
      if (combo) return label + " ganha $" + entry.amount + " com " + combo;
      return label + " ganha $" + entry.amount;
    }
    return "";
  }

  function syncLog() {
    var list = document.getElementById("log");
    var item;
    if (!state) return;
    while (logCursor < state.log.length) {
      item = document.createElement("li");
      item.textContent = formatEntry(state.log[logCursor]);
      list.appendChild(item);
      logCursor += 1;
    }
    while (list.children.length > 60) list.removeChild(list.firstChild);
    list.scrollTop = list.scrollHeight;
  }

  function marker(text) {
    var item = document.createElement("li");
    item.className = "log-marker";
    item.textContent = text;
    document.getElementById("log").appendChild(item);
  }

  function cardNode(card, faceDown, used) {
    var node = document.createElement("span");
    var parts;
    var rank;
    var suit;
    node.className = "card";
    if (faceDown || !card) {
      node.className += " back";
      node.setAttribute("aria-hidden", "true");
      return node;
    }
    if (used) node.className += " made";
    parts = Poker.cardParts(card);
    if (parts.red) node.className += " red";
    rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = parts.rank;
    suit = document.createElement("span");
    suit.className = "suit";
    suit.textContent = parts.suit;
    node.appendChild(rank);
    node.appendChild(suit);
    node.setAttribute("aria-label", parts.text);
    return node;
  }

  function roleChip(label, kind, aria) {
    var chip = el("span", "role-chip role-chip-" + kind, label);
    chip.setAttribute("aria-label", aria || label);
    chip.title = aria || label;
    return chip;
  }

  function seatRoleChips(index) {
    var blinds = Poker.blindSeats(state);
    var wrap = el("span", "seat-chips");
    if (index === state.button) wrap.appendChild(roleChip("Dealer", "dealer", "Dealer"));
    if (index === blinds.sb) wrap.appendChild(roleChip("Small", "small", "Small blind"));
    if (index === blinds.bb) wrap.appendChild(roleChip("Big", "big", "Big blind"));
    return wrap.childNodes.length ? wrap : null;
  }

  function handWinners() {
    var map = {};
    if (!state || !state.handOver || !state.payouts) return map;
    state.payouts.forEach(function (payout) {
      if (payout.amount > 0 && !payout.refund) map[payout.playerId] = payout;
    });
    return map;
  }

  function cardWasUsed(winners, card) {
    var id;
    var cards;
    for (id in winners) {
      if (!Object.prototype.hasOwnProperty.call(winners, id)) continue;
      cards = winners[id].cards;
      if (cards && cards.indexOf(card) !== -1) return true;
    }
    return false;
  }

  function renderSeat(player, logicalIndex, opts, winners) {
    var visualIndex = visualSeatIndex(logicalIndex);
    var className = "seat s" + visualIndex;
    var seat;
    var heading;
    var chips;
    var meta = [];
    var cards;
    var hidden;
    var payout;
    var i;
    opts = opts || {};
    winners = winners || {};
    payout = winners[player.id];
    if (logicalIndex === state.toAct) className += " acting";
    if (player.folded) className += " folded";
    if (payout) className += " winner";
    seat = el("article", className);
    heading = el("div", "seat-heading");
    chips = seatRoleChips(logicalIndex);
    heading.appendChild(el("p", "seat-name", player.name));
    if (chips) heading.appendChild(chips);
    seat.appendChild(heading);
    meta.push("$" + player.stack);
    if (player.allIn && !player.folded) meta.push("all-in");
    if (player.folded) meta.push("fora");
    seat.appendChild(el("p", "seat-meta", meta.join(" · ")));
    if (payout) {
      seat.appendChild(el(
        "p",
        "seat-result",
        payout.hand ? "Ganhou com " + (HANDS[payout.hand] || payout.hand) : "Ganhou"
      ));
    }
    if (player.streetBet > 0 && !state.handOver) {
      seat.appendChild(el("p", "seat-bet", "Aposta $" + player.streetBet));
    }
    cards = el("div", "cards");
    if (!opts.hideHoles) {
      hidden = !isLocalPlayer(player) && (player.folded || opts.coverShowdown || !state.revealed);
      for (i = 0; i < player.hole.length; i += 1) {
        (function (cardIndex) {
          var node = cardNode(
            player.hole[cardIndex],
            hidden,
            !hidden && cardWasUsed(winners, player.hole[cardIndex])
          );
          if (!hidden && isLocalPlayer(player) && isDiscardTurn()) {
            node.className += " selectable";
            if (selectedDiscards[cardIndex]) node.className += " selected";
            node.setAttribute("role", "button");
            node.setAttribute("tabindex", "0");
            node.setAttribute(
              "aria-pressed",
              selectedDiscards[cardIndex] ? "true" : "false"
            );
            node.addEventListener("click", function () {
              toggleDiscard(cardIndex);
            });
            node.addEventListener("keydown", function (event) {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleDiscard(cardIndex);
              }
            });
          }
          cards.appendChild(node);
        })(i);
      }
    }
    seat.appendChild(cards);
    return seat;
  }

  function setStatus(text) {
    var node;
    statusMessage = text;
    node = document.getElementById("status");
    if (node) node.textContent = statusMessage;
  }

  function statusNode() {
    var node = el("p", "table-status", statusMessage);
    node.id = "status";
    if (state && state.handOver) node.className += " result";
    node.setAttribute("aria-live", "polite");
    return node;
  }

  function hideNotice() {
    var notice = document.getElementById("mode-notice");
    clearTimeout(noticeTimer);
    if (!notice) return;
    notice.hidden = true;
    notice.textContent = "";
  }

  function variantLabel(variant) {
    return VARIANT_LABELS[variant] || VARIANT_LABELS.holdem;
  }

  function setFriendsVariantLabel(variant) {
    var node = document.getElementById("friends-variant-label");
    if (node) node.textContent = variantLabel(variant || gameVariant || pendingVariant);
  }

  function showFriendsSetup(variant) {
    var lobby = document.getElementById("friends-lobby");
    var setup = document.getElementById("friends-setup");
    var waiting = document.getElementById("friends-waiting");
    var codeInput = document.getElementById("room-code");
    pendingVariant = variant === "five-card-draw" ? "five-card-draw" : "holdem";
    gameVariant = pendingVariant;
    hideNotice();
    showFriendsNotice("");
    document.getElementById("mode-select").hidden = true;
    document.getElementById("match").hidden = true;
    document.getElementById("hand-guide").hidden = true;
    leaveButtonVisible(false);
    if (lobby) lobby.hidden = false;
    if (setup) setup.hidden = false;
    if (waiting) waiting.hidden = true;
    setFriendsVariantLabel(pendingVariant);
    if (codeInput && !codeInput.value) codeInput.value = randomRoomCode();
  }

  function paintRoomPlayers() {
    var list = document.getElementById("room-players");
    var start = document.getElementById("start-friends-game");
    var addBot = document.getElementById("add-room-bot");
    var display = document.getElementById("room-code-display");
    var players = activeRoomPlayers(room && room.players);
    var i;
    var item;
    var label;
    var removeBtn;
    if (display) display.textContent = roomCode || "";
    if (!list) return;
    list.textContent = "";
    for (i = 0; i < players.length; i += 1) {
      item = document.createElement("li");
      label =
        players[i].name +
        " ($" +
        players[i].stack +
        ")" +
        (players[i].id === (room && room.hostId) ? " · host" : "") +
        (isBotPlayer(players[i]) ? " · bot" : "");
      item.appendChild(document.createTextNode(label));
      if (isHost && isBotPlayer(players[i])) {
        removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "room-remove-bot";
        removeBtn.textContent = "Remover";
        removeBtn.setAttribute("data-bot-id", players[i].id);
        removeBtn.addEventListener("click", function (event) {
          var id = event.currentTarget.getAttribute("data-bot-id");
          removeFriendsBot(id);
        });
        item.appendChild(removeBtn);
      }
      list.appendChild(item);
    }
    if (addBot) {
      addBot.hidden = !isHost;
      addBot.disabled = !(isHost && players.length < MAX_FRIENDS);
      addBot.textContent =
        players.length < MAX_FRIENDS
          ? "Adicionar bot"
          : "Mesa cheia (máx. " + MAX_FRIENDS + ")";
    }
    if (start) {
      start.hidden = !isHost;
      start.disabled = !(isHost && players.length >= 2);
      start.textContent =
        players.length >= 2 ? "Iniciar jogo" : "Aguardando pelo menos 2 jogadores";
    }
  }

  function nextFriendsBot() {
    var players = activeRoomPlayers(room && room.players);
    var used = {};
    var i;
    var def;
    for (i = 0; i < players.length; i += 1) {
      if (players[i] && players[i].id) used[players[i].id] = true;
    }
    for (i = 0; i < FRIEND_BOTS.length; i += 1) {
      def = FRIEND_BOTS[i];
      if (!used[def.id]) return def;
    }
    return null;
  }

  function addFriendsBot() {
    var players;
    var def;
    var stack;
    if (!isHost || !room || room.phase !== "lobby") return;
    players = activeRoomPlayers(room.players);
    if (players.length >= MAX_FRIENDS) {
      showFriendsNotice("A mesa aceita no máximo " + MAX_FRIENDS + " jogadores.");
      return;
    }
    def = nextFriendsBot();
    if (!def) {
      showFriendsNotice("Não há mais bots disponíveis.");
      return;
    }
    stack = botStack();
    room.players = players.concat([
      {
        id: def.id,
        name: def.name,
        stack: stack,
        left: false,
        isHuman: false,
      },
    ]);
    publishRoom(room).then(function () {
      showFriendsNotice("");
      paintRoomPlayers();
    }).catch(function () {
      showFriendsNotice("Não foi possível adicionar o bot.");
    });
  }

  function removeFriendsBot(botId) {
    var players;
    if (!isHost || !room || room.phase !== "lobby" || !botId) return;
    players = activeRoomPlayers(room.players).filter(function (player) {
      return !(isBotPlayer(player) && player.id === botId);
    });
    room.players = players;
    publishRoom(room).then(function () {
      showFriendsNotice("");
      paintRoomPlayers();
    }).catch(function () {
      showFriendsNotice("Não foi possível remover o bot.");
    });
  }

  function showFriendsWaiting() {
    var lobby = document.getElementById("friends-lobby");
    var setup = document.getElementById("friends-setup");
    var waiting = document.getElementById("friends-waiting");
    document.getElementById("mode-select").hidden = true;
    document.getElementById("match").hidden = true;
    document.getElementById("hand-guide").hidden = true;
    leaveButtonVisible(false);
    if (lobby) lobby.hidden = false;
    if (setup) setup.hidden = true;
    if (waiting) waiting.hidden = false;
    setFriendsVariantLabel(gameVariant || pendingVariant);
    paintRoomPlayers();
  }

  function beginRoomPoll(handler) {
    stopRoomPoll();
    roomPollTimer = setInterval(handler, ROOM_POLL_MS);
  }

  function createFriendsRoom() {
    var api = auth();
    var code = readRoomCodeInput();
    var name = localName();
    var money = heroMoney();
    var next;
    if (!api || !name) {
      showFriendsNotice("Faça login para criar uma sala.");
      return;
    }
    if (!code || code.length < 3) {
      showFriendsNotice("Escolha um código com pelo menos 3 caracteres.");
      return;
    }
    if (!isFinite(money) || money <= 0) {
      showFriendsNotice("Você precisa de dinheiro para jogar.");
      return;
    }
    showFriendsNotice("Criando sala…");
    api.loadRoom(code).then(function (existing) {
      if (existing && existing.phase && existing.phase !== "closed") {
        showFriendsNotice("Esse código já está em uso. Escolha outro.");
        return null;
      }
      gameVariant = pendingVariant === "five-card-draw" ? "five-card-draw" : "holdem";
      next = {
        code: code,
        hostId: name,
        phase: "lobby",
        variant: gameVariant,
        players: [{ id: name, name: name, stack: money, left: false }],
        button: 0,
        matchSb: FRIENDS_SB,
        matchBb: FRIENDS_BB,
        seq: 0,
        state: null,
        pendingAction: null,
        handClosing: false,
        statusMessage: "",
      };
      roomCode = code;
      localPlayerId = name;
      isHost = true;
      vsFriends = true;
      vsBots = false;
      return publishRoom(next);
    }).then(function (saved) {
      if (!saved) return;
      showFriendsNotice("");
      showFriendsWaiting();
      beginRoomPoll(pollFriendsLobby);
    }).catch(function () {
      showFriendsNotice("Não foi possível criar a sala. Tente de novo.");
    });
  }

  function joinFriendsRoom() {
    var api = auth();
    var code = readRoomCodeInput();
    var name = localName();
    var money = heroMoney();
    var attempt = 0;

    function tryJoin() {
      attempt += 1;
      return api.loadRoom(code).then(function (existing) {
        var players;
        var i;
        if (!existing || existing.phase === "closed") {
          throw new Error("missing");
        }
        if (existing.phase !== "lobby") {
          throw new Error("started");
        }
        players = Array.isArray(existing.players) ? existing.players.slice() : [];
        for (i = 0; i < players.length; i += 1) {
          if (players[i] && players[i].id === name && !players[i].left) {
            room = existing;
            return existing;
          }
        }
        players = activeRoomPlayers(players);
        if (players.length >= MAX_FRIENDS) throw new Error("full");
        players.push({ id: name, name: name, stack: money, left: false });
        existing.players = players;
        return api.saveRoom(code, existing);
      }).then(function (saved) {
        room = saved;
        roomCode = code;
        localPlayerId = name;
        isHost = saved.hostId === name;
        vsFriends = true;
        vsBots = false;
        gameVariant = saved.variant === "five-card-draw" ? "five-card-draw" : "holdem";
        pendingVariant = gameVariant;
        showFriendsNotice("");
        showFriendsWaiting();
        beginRoomPoll(pollFriendsLobby);
      }, function (error) {
        if (error && error.message === "missing") {
          showFriendsNotice("Sala não encontrada.");
          return;
        }
        if (error && error.message === "started") {
          showFriendsNotice("Essa partida já começou.");
          return;
        }
        if (error && error.message === "full") {
          showFriendsNotice("A sala está cheia.");
          return;
        }
        if (attempt < 3) return tryJoin();
        showFriendsNotice("Não foi possível entrar na sala. Tente de novo.");
      });
    }

    if (!api || !name) {
      showFriendsNotice("Faça login para entrar em uma sala.");
      return;
    }
    if (!code || code.length < 3) {
      showFriendsNotice("Informe o código da sala.");
      return;
    }
    if (!isFinite(money) || money <= 0) {
      showFriendsNotice("Você precisa de dinheiro para jogar.");
      return;
    }
    showFriendsNotice("Entrando…");
    tryJoin();
  }

  function pollFriendsLobby() {
    var api = auth();
    if (!api || !roomCode || publishing) return;
    api.loadRoom(roomCode).then(function (remote) {
      if (!remote || remote.phase === "closed") {
        showFriendsNotice("A sala foi fechada.");
        exitFriendsToMenu();
        return;
      }
      room = remote;
      lastRoomSeq = remote.seq || lastRoomSeq;
      gameVariant = remote.variant === "five-card-draw" ? "five-card-draw" : "holdem";
      if (remote.phase === "playing") {
        stopRoomPoll();
        enterFriendsMatch(remote);
        return;
      }
      setFriendsVariantLabel(gameVariant);
      paintRoomPlayers();
    }).catch(function () {});
  }

  function startFriendsGame() {
    var players;
    var next;
    if (!isHost || !room) return;
    players = activeRoomPlayers(room.players).map(function (player) {
      return mapRoomPlayer(player);
    });
    if (players.length < 2) {
      showFriendsNotice("Precisa de pelo menos 2 jogadores.");
      return;
    }
    if (players.length > MAX_FRIENDS) {
      showFriendsNotice("A mesa aceita no máximo " + MAX_FRIENDS + " jogadores.");
      return;
    }
    roster = players;
    button = players.length - 1;
    matchSb = FRIENDS_SB;
    matchBb = FRIENDS_BB;
    startStack = botStack();
    gameVariant = room.variant === "five-card-draw" ? "five-card-draw" : gameVariant || "holdem";
    next = Object.assign({}, room, {
      phase: "playing",
      variant: gameVariant,
      players: players,
      button: button,
      matchSb: matchSb,
      matchBb: matchBb,
      pendingAction: null,
      handClosing: false,
      state: null,
    });
    publishRoom(next).then(function () {
      stopRoomPoll();
      enterFriendsMatch(next);
      startHand();
    }).catch(function () {
      showFriendsNotice("Não foi possível iniciar a partida.");
    });
  }

  function enterFriendsMatch(remote) {
    var lobby = document.getElementById("friends-lobby");
    hideNotice();
    showFriendsNotice("");
    if (lobby) lobby.hidden = true;
    document.getElementById("mode-select").hidden = true;
    document.getElementById("match").hidden = false;
    document.getElementById("hand-guide").hidden = false;
    leaveButtonVisible(true);
    vsFriends = true;
    vsBots = false;
    room = remote;
    roomCode = remote.code || roomCode;
    isHost = remote.hostId === localPlayerId;
    gameVariant = remote.variant === "five-card-draw" ? "five-card-draw" : "holdem";
    matchSb = remote.matchSb || FRIENDS_SB;
    matchBb = remote.matchBb || FRIENDS_BB;
    button = typeof remote.button === "number" ? remote.button : 0;
    roster = activeRoomPlayers(remote.players).map(function (player) {
      return mapRoomPlayer(player);
    });
    clear(document.getElementById("log"));
    logCursor = 0;
    if (remote.state) {
      applyRemoteFriendsState(remote);
      beginRoomPoll(pollFriendsMatch);
      return;
    }
    if (isHost) {
      beginRoomPoll(pollFriendsMatch);
      return;
    }
    setStatus("Aguardando o host distribuir as cartas…");
    beginRoomPoll(pollFriendsMatch);
  }

  function snapshotFriendsRoom() {
    var players = (roster || []).map(function (player) {
      return mapRoomPlayer(player);
    });
    return Object.assign({}, room || {}, {
      code: roomCode,
      hostId: room && room.hostId ? room.hostId : localPlayerId,
      phase: "playing",
      variant: gameVariant,
      players: players,
      button: button,
      matchSb: matchSb,
      matchBb: matchBb,
      state: state,
      pendingAction: null,
      handClosing: handClosing,
      statusMessage: statusMessage,
      shownBoard: shownBoard,
      shownHoles: shownHoles,
    });
  }

  function publishFriendsState() {
    if (!vsFriends || !isHost) return Promise.resolve(room);
    syncRoster();
    return publishRoom(snapshotFriendsRoom()).catch(function () {
      return null;
    });
  }

  function applyRemoteFriendsState(remote) {
    var sameHand;
    if (!remote) return;
    room = remote;
    lastRoomSeq = remote.seq || lastRoomSeq;
    if (Array.isArray(remote.players)) {
      roster = activeRoomPlayers(remote.players).map(function (player) {
        return mapRoomPlayer(player);
      });
    }
    if (typeof remote.button === "number") button = remote.button;
    gameVariant = remote.variant === "five-card-draw" ? "five-card-draw" : gameVariant || "holdem";
    matchSb = remote.matchSb || FRIENDS_SB;
    matchBb = remote.matchBb || FRIENDS_BB;
    sameHand = !!(state && remote.state && state.log && remote.state.log && state.log.length === remote.state.log.length && state.street === remote.state.street);
    state = remote.state || null;
    handClosing = !!remote.handClosing;
    statusMessage = remote.statusMessage || statusMessage;
    if (!sameHand) {
      shownBoard = remote.shownBoard || (state ? state.board.length : 0);
      shownHoles = !!remote.shownHoles || !!(state && state.revealed);
      logCursor = 0;
      clear(document.getElementById("log"));
    } else {
      shownBoard = Math.max(shownBoard, remote.shownBoard || 0);
      shownHoles = shownHoles || !!remote.shownHoles;
    }
    if (!state) {
      setStatus("Aguardando o host…");
      clear(document.getElementById("actions"));
      return;
    }
    syncLog();
    render();
    if (handClosing || state.handOver) {
      showPlayAgain();
    }
  }

  function pollFriendsMatch() {
    var api = auth();
    if (!api || !roomCode || !vsFriends || publishing) return;
    api.loadRoom(roomCode).then(function (remote) {
      var actor;
      if (!remote || remote.phase === "closed") {
        showModeSelect();
        return;
      }
      if ((remote.seq || 0) < lastRoomSeq && isHost) return;
      if (isHost) {
        room = remote;
        if (remote.pendingAction && state && !handClosing) {
          actor = state.toAct >= 0 ? state.players[state.toAct] : null;
          if (
            actor &&
            remote.pendingAction.playerId === actor.id &&
            remote.pendingAction.playerId !== localPlayerId
          ) {
            waitingForRemote = false;
            Poker.act(state, remote.pendingAction.type, remote.pendingAction.to);
            remote.pendingAction = null;
            room = remote;
            publishFriendsState().then(function () {
              pump();
            });
            return;
          }
          if (remote.pendingAction) {
            remote.pendingAction = null;
            room = remote;
            publishRoom(remote);
          }
        }
        handleFriendsLeaves(remote);
        return;
      }
      if ((remote.seq || 0) !== lastRoomSeq) applyRemoteFriendsState(remote);
      else if (remote.state) {
        state = remote.state;
        renderActions();
      }
    }).catch(function () {});
  }

  function handleFriendsLeaves(remote) {
    var current;
    var next;
    var changed = false;
    var foldedActor = false;
    var i;
    var player;
    if (!isHost || !remote) return;
    current = Array.isArray(remote.players) ? remote.players : [];
    next = [];
    for (i = 0; i < current.length; i += 1) {
      player = current[i];
      if (!player) continue;
      if (player.left) {
        changed = true;
        if (state && !handClosing) {
          if (state.toAct >= 0 && state.players[state.toAct].id === player.id) foldedActor = true;
          foldPlayerById(player.id);
        }
        continue;
      }
      next.push(player);
    }
    if (!changed) return;
    room.players = next;
    roster = next.map(function (entry) {
      return mapRoomPlayer(entry);
    });
    if (roster.length < 2) {
      endFriendsRoom("Jogadores insuficientes. Sala encerrada.");
      return;
    }
    publishFriendsState().then(function () {
      if (foldedActor) pump();
    });
  }

  function foldPlayerById(playerId) {
    var i;
    var player;
    if (!state || state.handOver) return;
    for (i = 0; i < state.players.length; i += 1) {
      player = state.players[i];
      if (player.id !== playerId || player.folded) continue;
      if (state.toAct === i) Poker.act(state, "fold");
      else {
        player.folded = true;
        player.acted = true;
      }
      break;
    }
  }

  function endFriendsRoom(message) {
    var api = auth();
    var notice;
    stopRoomPoll();
    syncLocalMoneyFromRoster();
    if (api && roomCode) {
      if (room) {
        room.phase = "closed";
        api.saveRoom(roomCode, room).catch(function () {});
      } else {
        api.deleteRoom(roomCode);
      }
    }
    resetFriendsFlags();
    showModeSelect();
    if (message) {
      notice = document.getElementById("mode-notice");
      if (notice) {
        notice.hidden = false;
        notice.textContent = message;
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(hideNotice, timed(NOTICE_MS + 1200));
      }
    }
  }

  function resetFriendsFlags() {
    vsFriends = false;
    roomCode = null;
    room = null;
    localPlayerId = null;
    isHost = false;
    waitingForRemote = false;
    publishing = false;
    lastRoomSeq = 0;
    leaveButtonVisible(false);
  }

  function exitFriendsToMenu() {
    stopRoomPoll();
    syncLocalMoneyFromRoster();
    resetFriendsFlags();
    showModeSelect();
  }

  function leaveFriendsRoom() {
    var api = auth();
    var players;
    var i;
    if (!api || !roomCode) {
      exitFriendsToMenu();
      return;
    }
    if (isHost && (!room || room.phase === "lobby")) {
      endFriendsRoom("Host encerrou a sala.");
      return;
    }
    api.loadRoom(roomCode).then(function (remote) {
      if (!remote) {
        exitFriendsToMenu();
        return null;
      }
      if (remote.hostId === localPlayerId) {
        remote.phase = "closed";
        return api.saveRoom(roomCode, remote).then(function () {
          exitFriendsToMenu();
        });
      }
      players = Array.isArray(remote.players) ? remote.players.slice() : [];
      for (i = 0; i < players.length; i += 1) {
        if (players[i] && players[i].id === localPlayerId) players[i].left = true;
      }
      remote.players = players;
      if (remote.phase === "lobby") {
        remote.players = activeRoomPlayers(players);
      }
      return api.saveRoom(roomCode, remote).then(function () {
        exitFriendsToMenu();
      });
    }).catch(function () {
      exitFriendsToMenu();
    });
  }

  function leaveFriendsMatch() {
    leaveFriendsRoom();
  }

  function submitFriendsAction(type, to) {
    var api = auth();
    if (!api || !roomCode) return;
    api.loadRoom(roomCode).then(function (remote) {
      if (!remote || remote.phase !== "playing") return null;
      remote.pendingAction = {
        playerId: localPlayerId,
        type: type,
        to: to,
        at: Date.now(),
      };
      return api.saveRoom(roomCode, remote);
    }).then(function (saved) {
      if (saved) room = saved;
      clear(document.getElementById("actions"));
      setStatus("Enviando jogada…");
    }).catch(function () {
      renderActions();
      setStatus("Não foi possível enviar a jogada.");
    });
  }

  function showModeSelect() {
    var raiseBox = document.getElementById("raise-box");
    var lobby = document.getElementById("friends-lobby");
    var setup = document.getElementById("friends-setup");
    var waiting = document.getElementById("friends-waiting");
    clearTimeout(timer);
    dealToken += 1;
    stopRoomPoll();
    clearMatchSave();
    vsBots = false;
    gameVariant = "holdem";
    pendingVariant = "holdem";
    selectedDiscards = {};
    resetFriendsFlags();
    roster = null;
    state = null;
    if (raiseBox) raiseBox.remove();
    clear(document.getElementById("actions"));
    clear(document.getElementById("table"));
    clear(document.getElementById("log"));
    hideNotice();
    showFriendsNotice("");
    document.getElementById("match").hidden = true;
    document.getElementById("hand-guide").hidden = true;
    leaveButtonVisible(false);
    if (lobby) lobby.hidden = true;
    if (setup) setup.hidden = false;
    if (waiting) waiting.hidden = true;
    document.getElementById("mode-select").hidden = false;
  }

  function heroMoney() {
    if (typeof window !== "undefined" && window.PokerLifeAuth) return window.PokerLifeAuth.currentMoney();
    return START;
  }

  // Big blind is 3% of the player's money on entry, rounded down; small blind is half of that.
  function blindsForMoney(money) {
    var bb;
    if (!isFinite(money) || money <= 0) {
      return { sb: SB, bb: BB };
    }
    bb = Math.max(1, Math.floor(money * 0.03));
    return { sb: Math.max(1, Math.floor(bb / 2)), bb: bb };
  }

  function botStack() {
    var money = heroMoney();
    if (!isFinite(money) || money <= 0) return 100;
    return Math.ceil(money / 100) * 100;
  }

  function saveHeroMoney() {
    var i;
    if (typeof window === "undefined" || !window.PokerLifeAuth || !roster) return;
    if (vsFriends && localPlayerId) {
      syncLocalMoneyFromRoster();
      return;
    }
    for (i = 0; i < roster.length; i += 1) {
      if (roster[i].isHuman) {
        window.PokerLifeAuth.setMoney(roster[i].stack, "poker", localPokerLedgerDetail());
        return;
      }
    }
  }

  function freshRoster() {
    var money = heroMoney();
    var stack = botStack();
    var blinds = blindsForMoney(money);
    startStack = stack;
    matchSb = blinds.sb;
    matchBb = blinds.bb;
    roster = [
      { id: "hero", name: "Você", stack: money, isHuman: true },
      { id: "lia", name: "Bot 1", stack: stack, isHuman: false },
      { id: "caio", name: "Bot 2", stack: stack, isHuman: false },
      { id: "duda", name: "Bot 3", stack: stack, isHuman: false },
      { id: "ravi", name: "Bot 4", stack: stack, isHuman: false },
    ];
    button = roster.length - 1;
  }

  function startMatch(variant) {
    clearTimeout(timer);
    dealToken += 1;
    stopRoomPoll();
    resetFriendsFlags();
    vsBots = true;
    gameVariant = variant === "five-card-draw" ? "five-card-draw" : "holdem";
    pendingVariant = gameVariant;
    selectedDiscards = {};
    freshRoster();
    hideNotice();
    document.getElementById("mode-select").hidden = true;
    document.getElementById("friends-lobby").hidden = true;
    document.getElementById("match").hidden = false;
    document.getElementById("hand-guide").hidden = false;
    leaveButtonVisible(false);
    startHand();
  }

  function resumeMatch(saved) {
    clearTimeout(timer);
    dealToken += 1;
    vsBots = true;
    gameVariant = saved.gameVariant === "five-card-draw" || (saved.state && saved.state.variant === "five-card-draw")
      ? "five-card-draw"
      : "holdem";
    pendingVariant = gameVariant;
    selectedDiscards = {};
    button = saved.button;
    roster = saved.roster;
    state = saved.state || null;
    shownBoard = saved.shownBoard || 0;
    shownHoles = !!saved.shownHoles;
    handClosing = !!saved.handClosing;
    logCursor = 0;
    statusMessage = saved.statusMessage || "";
    startStack = saved.startStack > 0 ? saved.startStack : botStack();
    matchSb = saved.matchSb > 0 ? saved.matchSb : blindsForMoney(heroMoney()).sb;
    matchBb = saved.matchBb > 0 ? saved.matchBb : blindsForMoney(heroMoney()).bb;
    if (saved.botStyles && typeof saved.botStyles === "object") {
      botStyles = saved.botStyles;
    } else {
      pickBotStyles();
    }
    maniacWildHand = !!saved.maniacWildHand;
    maniacFired = !!saved.maniacFired;
    hideNotice();
    document.getElementById("mode-select").hidden = true;
    document.getElementById("match").hidden = false;
    document.getElementById("hand-guide").hidden = false;
    clear(document.getElementById("log"));
    if (!roster || !roster.length) {
      showModeSelect();
      return;
    }
    if (!state) {
      startHand();
      return;
    }
    syncLog();
    if (handClosing || (state.handOver && shownHoles)) {
      handClosing = true;
      render();
      showPlayAgain();
      saveMatch();
      return;
    }
    shownBoard = state.board.length;
    if (state.handOver && state.revealed) {
      shownHoles = true;
      finishHand();
      return;
    }
    render();
    continueHand();
    saveMatch();
  }

  function heroFolded() {
    var i;
    if (!state) return false;
    for (i = 0; i < state.players.length; i += 1) {
      if (isLocalPlayer(state.players[i])) return !!state.players[i].folded;
    }
    return false;
  }

  function canSkipRound() {
    return !!(vsBots && !vsFriends && state && !handClosing && heroFolded());
  }

  function skipToHandEnd() {
    var guard = 0;
    if (!canSkipRound()) return;
    clearTimeout(timer);
    dealToken += 1;
    while (state && !state.handOver && guard < 500) {
      guard += 1;
      if (state.toAct < 0) {
        Poker.advance(state);
        continue;
      }
      if (state.players[state.toAct].isHuman) break;
      if (!applyBot()) break;
    }
    if (state) {
      shownBoard = state.board.length;
      shownHoles = true;
    }
    finishHand();
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function dealQueue(table) {
    var start = (table.button + 1) % table.players.length;
    var rounds = table.variant === "five-card-draw" ? 5 : 2;
    var queue = [];
    var round;
    var step;
    var index;
    if (table.players.length === 2) start = table.button;
    for (round = 0; round < rounds; round += 1) {
      for (step = 0; step < table.players.length; step += 1) {
        index = (start + step) % table.players.length;
        if (table.players[index].hole.length <= round) continue;
        queue.push({ index: index, card: round });
      }
    }
    return queue;
  }

  function isDiscardTurn() {
    return !!(
      state &&
      !handClosing &&
      state.street === "draw" &&
      state.toAct >= 0 &&
      isLocalPlayer(state.players[state.toAct])
    );
  }

  function selectedDiscardList() {
    return Object.keys(selectedDiscards)
      .map(Number)
      .filter(function (index) {
        return !isNaN(index);
      })
      .sort(function (a, b) {
        return a - b;
      });
  }

  function toggleDiscard(index) {
    var legal;
    var picks;
    if (!isDiscardTurn()) return;
    if (selectedDiscards[index]) {
      delete selectedDiscards[index];
      render();
      return;
    }
    legal = Poker.legalActions(state);
    picks = selectedDiscardList();
    if (legal && picks.length >= (legal.maxDiscard || 0)) return;
    selectedDiscards[index] = true;
    render();
  }

  function confirmDiscard(indices) {
    selectedDiscards = {};
    humanAct("discard", indices || []);
  }

  function flipCard(node, card, done) {
    var token = dealToken;
    var face;
    function alive() {
      return token === dealToken;
    }
    function finish() {
      if (alive() && done) done();
    }
    if (!alive()) return;
    if (prefersReducedMotion() || typeof node.animate !== "function") {
      node.replaceWith(cardNode(card, false));
      finish();
      return;
    }
    node.animate([
      { transform: "scaleX(1)" },
      { transform: "scaleX(0)" }
    ], { duration: timed(REVEAL_OUT), easing: "ease-in", fill: "forwards" }).onfinish = function () {
      var flipIn;
      if (!alive()) return;
      face = cardNode(card, false);
      node.replaceWith(face);
      if (typeof face.animate !== "function") {
        finish();
        return;
      }
      flipIn = face.animate([
        { transform: "scaleX(0)" },
        { transform: "scaleX(1)" }
      ], { duration: timed(REVEAL_IN), easing: "ease-out", fill: "both" });
      flipIn.onfinish = function () {
        finish();
      };
    };
  }

  function playDeal(done) {
    var token = dealToken + 1;
    var queue;
    dealToken = token;
    queue = dealQueue(state);
    renderTable({ hideHoles: true });
    if (prefersReducedMotion()) {
      done();
      return;
    }
    function alive() {
      return token === dealToken;
    }
    function tick() {
      var step;
      var player;
      var seatCards;
      var node;
      var board;
      var origin;
      var cardRect;
      var dx;
      var dy;
      var travel;
      if (!alive()) return;
      if (!queue.length) {
        done();
        return;
      }
      step = queue.shift();
      player = state.players[step.index];
      seatCards = document.querySelector("#table .s" + visualSeatIndex(step.index) + " .cards");
      if (!seatCards) {
        done();
        return;
      }
      node = cardNode(player.hole[step.card], true);
      seatCards.appendChild(node);
      if (typeof node.animate !== "function") {
        if (isLocalPlayer(player)) node.replaceWith(cardNode(player.hole[step.card], false));
        tick();
        return;
      }
      board = document.querySelector("#table .board-panel");
      origin = board.getBoundingClientRect();
      cardRect = node.getBoundingClientRect();
      dx = origin.left + origin.width / 2 - (cardRect.left + cardRect.width / 2);
      dy = origin.top + origin.height / 2 - (cardRect.top + cardRect.height / 2);
      travel = node.animate([
        { transform: "translate(" + dx + "px, " + dy + "px) scale(0.82)", opacity: 0.35 },
        { transform: "translate(0px, 0px) scale(1)", opacity: 1 }
      ], { duration: timed(DEAL_TRAVEL), easing: "ease-out", fill: "both" });
      travel.onfinish = function () {
        if (!alive()) return;
        if (!isLocalPlayer(player)) {
          tick();
          return;
        }
        flipCard(node, player.hole[step.card], tick);
      };
    }
    tick();
  }

  function renderTable(opts) {
    var table = document.getElementById("table");
    var board = el("section", "board-panel");
    var cards = el("div", "cards board-cards");
    var winners = handWinners();
    var faceDown;
    var i;
    opts = opts || {};
    clear(table);
    for (i = 0; i < state.players.length; i += 1) table.appendChild(renderSeat(state.players[i], i, opts, winners));
    board.appendChild(el("p", "pot", "Pote $" + Poker.potSize(state)));
    for (i = 0; i < state.board.length; i += 1) {
      faceDown = opts.boardDownFrom != null && i >= opts.boardDownFrom;
      cards.appendChild(cardNode(state.board[i], faceDown, !faceDown && cardWasUsed(winners, state.board[i])));
    }
    board.appendChild(cards);
    board.appendChild(el("p", "street-label", STREETS[state.street] || ""));
    board.appendChild(statusNode());
    table.appendChild(board);
  }

  function statusText() {
    var wins;
    if (state.handOver) {
      wins = state.payouts.filter(function (payout) {
        return payout.amount > 0 && !payout.refund;
      });
      if (!wins.length) return "Mão encerrada";
      return wins.map(function (payout) {
        var name = playerById(payout.playerId).name;
        var combo = combinationText(payout.hand, payout.cards);
        if (combo) return name + " ganha $" + payout.amount + " com " + combo;
        return name + " ganha $" + payout.amount;
      }).join(" · ");
    }
    if (state.toAct >= 0 && isLocalPlayer(state.players[state.toAct])) {
      if (state.street === "draw") {
        return "Escolha as cartas para trocar · pote $" + Poker.potSize(state);
      }
      return "Sua vez · pote $" + Poker.potSize(state);
    }
    if (state.toAct >= 0) return state.players[state.toAct].name + " está pensando · pote $" + Poker.potSize(state);
    return (STREETS[state.street] || "") + " · pote $" + Poker.potSize(state);
  }

  function actionButton(label, onClick) {
    var node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.addEventListener("click", onClick);
    return node;
  }

  function humanAct(type, to) {
    var result;
    var raiseBox = document.getElementById("raise-box");
    clear(document.getElementById("actions"));
    if (raiseBox) raiseBox.remove();
    if (type === "discard") selectedDiscards = {};
    if (vsFriends && !isHost) {
      submitFriendsAction(type, to);
      return;
    }
    result = Poker.act(state, type, to);
    if (!result.ok) {
      renderActions();
      return;
    }
    if (vsFriends && isHost) {
      publishFriendsState().then(function () {
        pump();
      });
      return;
    }
    pump();
  }

  function openRaise(legal) {
    var existing = document.getElementById("raise-box");
    var box;
    var input;
    var error;
    var seen = {};
    var half;
    var pot;
    if (existing) {
      existing.remove();
      return;
    }
    box = document.createElement("div");
    box.id = "raise-box";
    box.className = "raise-box";
    half = sizedBet(state, legal, 0.5);
    pot = sizedBet(state, legal, 1);
    function addPreset(label, amount) {
      if (seen[amount]) return;
      seen[amount] = true;
      box.appendChild(actionButton(label, function () {
        humanAct("raise", amount);
      }));
    }
    addPreset("Meio pote $" + half, half);
    addPreset("Pote $" + pot, pot);
    input = document.createElement("input");
    input.type = "number";
    input.min = String(legal.minRaiseTo);
    input.max = String(legal.maxRaiseTo);
    input.step = "1";
    input.value = String(legal.minRaiseTo);
    input.setAttribute("aria-label", "Aumentar para");
    error = el("p", "form-error", "");
    error.hidden = true;
    error.setAttribute("role", "alert");
    function confirm() {
      var value = Number(input.value);
      if (Math.floor(value) !== value || value < legal.minRaiseTo || value > legal.maxRaiseTo) {
        error.hidden = false;
        error.textContent = "Entre $" + legal.minRaiseTo + " e $" + legal.maxRaiseTo + ".";
        return;
      }
      humanAct("raise", value);
    }
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        confirm();
      }
    });
    box.appendChild(input);
    box.appendChild(actionButton("Confirmar", confirm));
    box.appendChild(error);
    document.getElementById("actions").insertAdjacentElement("afterend", box);
    keepHeroVisible();
  }

  function renderActions() {
    var box = document.getElementById("actions");
    var raiseBox = document.getElementById("raise-box");
    var legal;
    var player;
    var skip;
    clear(box);
    if (raiseBox) raiseBox.remove();
    if (!state || handClosing) return;
    if (canSkipRound()) {
      skip = actionButton("Pular ao fim", skipToHandEnd);
      skip.id = "skip-round";
      skip.className = "skip-round";
      box.appendChild(skip);
      return;
    }
    if (state.handOver || state.toAct < 0 || !isLocalPlayer(state.players[state.toAct])) return;
    legal = Poker.legalActions(state);
    player = state.players[state.toAct];
    if (legal && legal.discard) {
      (function () {
        var picks = selectedDiscardList();
        var note = el(
          "p",
          "discard-hint",
          picks.length
            ? "Selecionadas: " + picks.length
            : "Toque nas cartas que deseja trocar"
        );
        box.appendChild(note);
        box.appendChild(actionButton("Ficar", function () {
          confirmDiscard([]);
        }));
        if (picks.length) {
          box.appendChild(actionButton("Trocar " + picks.length, function () {
            confirmDiscard(picks);
          }));
        }
      })();
      return;
    }
    if (legal.fold) box.appendChild(actionButton("Desistir", function () { humanAct("fold"); }));
    if (legal.check) box.appendChild(actionButton("Passar", function () { humanAct("check"); }));
    if (legal.call > 0) {
      box.appendChild(actionButton(
        legal.call === player.stack ? "All-in $" + legal.call : "Pagar $" + legal.call,
        function () { humanAct("call"); }
      ));
    }
    if (legal.minRaiseTo != null && legal.minRaiseTo === legal.maxRaiseTo) {
      box.appendChild(actionButton("All-in $" + player.stack, function () {
        humanAct("raise", legal.maxRaiseTo);
      }));
    } else if (legal.minRaiseTo != null) {
      box.appendChild(actionButton(state.currentBet === 0 ? "Apostar" : "Aumentar", function () {
        openRaise(legal);
      }));
      box.appendChild(actionButton("All-in", function () {
        humanAct("raise", legal.maxRaiseTo);
      }));
    }
  }

  function keepHeroVisible() {
    var hero = document.querySelector(".s0");
    var controls = document.querySelector(".controls");
    var dock;
    var rect;
    var limit;
    if (!hero || !controls || !controls.querySelector("button")) {
      document.documentElement.style.removeProperty("--dock-height");
      return;
    }
    dock = Math.ceil(controls.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--dock-height", dock + "px");
    rect = hero.getBoundingClientRect();
    limit = window.innerHeight - dock - 8;
    if (rect.bottom > limit) hero.scrollIntoView({ block: "end", inline: "nearest" });
  }

  function render() {
    if (!state) return;
    setStatus(statusText());
    renderTable();
    renderActions();
    syncLog();
    keepHeroVisible();
  }

  function syncRoster() {
    var i;
    var j;
    for (i = 0; i < state.players.length; i += 1) {
      for (j = 0; j < roster.length; j += 1) {
        if (roster[j].id === state.players[i].id) roster[j].stack = state.players[i].stack;
      }
    }
    saveHeroMoney();
  }

  function finishHand() {
    if (handClosing) return;
    handClosing = true;
    clearTimeout(timer);
    syncRoster();
    render();
    showPlayAgain();
    if (vsFriends && isHost) publishFriendsState();
    else saveMatch();
  }

  function presentBoard(done) {
    var from = shownBoard;
    var token = dealToken;
    var nodes;
    var index;
    function alive() {
      return token === dealToken && state;
    }
    renderTable(prefersReducedMotion() ? null : { boardDownFrom: from });
    setStatus(statusText());
    if (!alive()) return;
    if (prefersReducedMotion()) {
      syncLog();
      done();
      return;
    }
    nodes = document.querySelectorAll("#table .board-cards .card");
    index = from;
    function next() {
      if (!alive()) return;
      if (index >= state.board.length) {
        syncLog();
        done();
        return;
      }
      if (!nodes[index]) {
        index += 1;
        next();
        return;
      }
      flipCard(nodes[index], state.board[index], function () {
        index += 1;
        next();
      });
    }
    next();
  }

  function presentShowdown(done) {
    var token = dealToken;
    var order = [];
    var step;
    var index;
    var player;
    function alive() {
      return token === dealToken && state;
    }
    function revealSeat(seatIndex, cardIndex, nextSeat) {
      var cards;
      if (!alive()) return;
      cards = document.querySelectorAll("#table .s" + visualSeatIndex(seatIndex) + " .cards .card");
      if (cardIndex >= cards.length) {
        nextSeat();
        return;
      }
      flipCard(cards[cardIndex], state.players[seatIndex].hole[cardIndex], function () {
        revealSeat(seatIndex, cardIndex + 1, nextSeat);
      });
    }
    function nextPlayer() {
      var seatIndex;
      if (!alive()) return;
      if (!order.length) {
        setStatus(statusText());
        syncLog();
        done();
        return;
      }
      seatIndex = order.shift();
      revealSeat(seatIndex, 0, nextPlayer);
    }
    renderTable(prefersReducedMotion() ? null : { coverShowdown: true });
    setStatus("Mostrando as cartas");
    if (!alive()) return;
    for (step = 1; step <= state.players.length; step += 1) {
      index = (state.button + step) % state.players.length;
      player = state.players[index];
      if (isLocalPlayer(player) || player.folded) continue;
      order.push(index);
    }
    if (prefersReducedMotion()) {
      renderTable();
      setStatus(statusText());
      syncLog();
      done();
      return;
    }
    nextPlayer();
  }

  function continueHand() {
    var actor;
    if (!state || handClosing) return;
    renderActions();
    if (state.handOver) {
      finishHand();
      return;
    }
    if (state.toAct < 0) {
      if (vsFriends && !isHost) return;
      later(function () {
        if (!state || handClosing) return;
        Poker.advance(state);
        if (vsFriends && isHost) {
          publishFriendsState().then(function () {
            pump();
          });
          return;
        }
        pump();
      }, timed(STREET_PAUSE));
      return;
    }
    actor = state.players[state.toAct];
    if (isLocalPlayer(actor)) return;
    if (vsFriends && !isHost) {
      waitingForRemote = true;
      return;
    }
    if (vsFriends && actor.isHuman) {
      waitingForRemote = true;
      return;
    }
    later(function () {
      if (!state || handClosing || !applyBot()) return;
      if (vsFriends && isHost) {
        publishFriendsState().then(function () {
          pump();
        });
        return;
      }
      pump();
    }, timed(BOT_PAUSE));
  }

  function applyBot() {
    var choice = chooseBot(state);
    var result = Poker.act(state, choice.type, choice.to);
    var legal;
    if (result.ok) return true;
    legal = Poker.legalActions(state);
    if (legal && legal.check) return Poker.act(state, "check").ok;
    if (legal && legal.call > 0) return Poker.act(state, "call").ok;
    if (legal && legal.fold) return Poker.act(state, "fold").ok;
    return false;
  }

  function pump() {
    if (!state || handClosing) return;
    if (state.board.length > shownBoard) {
      presentBoard(function () {
        if (!state || handClosing) return;
        shownBoard = state.board.length;
        if (vsFriends && isHost) publishFriendsState();
        continueHand();
      });
      return;
    }
    if (state.handOver && state.revealed && !shownHoles) {
      presentShowdown(function () {
        if (!state || handClosing) return;
        shownHoles = true;
        finishHand();
      });
      return;
    }
    render();
    if (vsFriends && isHost) publishFriendsState();
    else saveMatch();
    continueHand();
  }

  function advanceButton() {
    var i;
    var index;
    for (i = 1; i <= roster.length; i += 1) {
      index = (button + i) % roster.length;
      if (roster[index].stack > 0) {
        button = index;
        return;
      }
    }
  }

  function playAgain() {
    if (vsFriends && !isHost) return;
    advanceButton();
    startHand();
  }

  function showPlayAgain() {
    var box = document.getElementById("actions");
    var raiseBox = document.getElementById("raise-box");
    var again;
    var note;
    if (!box) return;
    if (raiseBox) raiseBox.remove();
    clear(box);
    if (vsFriends && !isHost) {
      note = document.createElement("p");
      note.className = "friends-wait-note";
      note.textContent = "Aguardando o host iniciar a próxima mão…";
      box.appendChild(note);
      keepHeroVisible();
      return;
    }
    again = actionButton("Jogar de novo", playAgain);
    again.id = "play-again";
    again.className = "play-again";
    box.appendChild(again);
    keepHeroVisible();
  }

  function startHand() {
    var seated = 0;
    var raiseBox = document.getElementById("raise-box");
    var actions = document.getElementById("actions");
    var localStack = 0;
    shownBoard = 0;
    shownHoles = false;
    handClosing = false;
    selectedDiscards = {};
    pickBotStyles();
    pickManiacMood();
    if (actions) clear(actions);
    if (raiseBox) raiseBox.remove();
    document.documentElement.style.removeProperty("--dock-height");
    roster.forEach(function (player) {
      if (player.stack > 0) seated += 1;
      if (player.id === localPlayerId) localStack = player.stack;
    });
    if (vsFriends) {
      if (seated < 2) {
        endFriendsRoom("Jogadores insuficientes. Sala encerrada.");
        return;
      }
    } else if (roster[0].stack <= 0 || seated < 2) {
      showModeSelect();
      return;
    }
    if (vsFriends && localStack <= 0 && !isHost) {
      setStatus("Você ficou sem fichas.");
    }
    state = Poker.createHand({
      players: roster,
      button: button,
      sb: matchSb,
      bb: matchBb,
      variant: gameVariant,
    });
    logCursor = 0;
    marker("Nova mão · dealer com " + roster[button].name);
    setStatus("Distribuindo as cartas");
    syncLog();
    if (vsFriends && isHost) {
      publishFriendsState().then(function () {
        playDeal(function () {
          pump();
        });
      });
      return;
    }
    saveMatch();
    playDeal(function () {
      pump();
    });
  }

  function init() {
    var homeLink = document.querySelector(".table-nav a");
    var saved = loadMatch();
    var createBtn = document.getElementById("create-room");
    var joinBtn = document.getElementById("join-room");
    var backBtn = document.getElementById("friends-back");
    var startBtn = document.getElementById("start-friends-game");
    var addBotBtn = document.getElementById("add-room-bot");
    var leaveRoomBtn = document.getElementById("leave-room");
    var leaveMatchBtn = document.getElementById("leave-match");
    document.getElementById("play-bots").addEventListener("click", function () {
      startMatch("holdem");
    });
    document.getElementById("play-friends").addEventListener("click", function () {
      showFriendsSetup("holdem");
    });
    document.getElementById("play-draw-bots").addEventListener("click", function () {
      startMatch("five-card-draw");
    });
    document.getElementById("play-draw-friends").addEventListener("click", function () {
      showFriendsSetup("five-card-draw");
    });
    if (createBtn) createBtn.addEventListener("click", createFriendsRoom);
    if (joinBtn) joinBtn.addEventListener("click", joinFriendsRoom);
    if (backBtn) backBtn.addEventListener("click", showModeSelect);
    if (startBtn) startBtn.addEventListener("click", startFriendsGame);
    if (addBotBtn) addBotBtn.addEventListener("click", addFriendsBot);
    if (leaveRoomBtn) leaveRoomBtn.addEventListener("click", leaveFriendsRoom);
    if (leaveMatchBtn) leaveMatchBtn.addEventListener("click", leaveFriendsMatch);
    window.addEventListener("resize", keepHeroVisible);
    if (homeLink) {
      homeLink.addEventListener("click", function () {
        clearMatchSave();
        if (vsFriends) leaveFriendsRoom();
      });
    }
    if (saved && saved.vsBots && saved.roster) resumeMatch(saved);
    else showModeSelect();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      chooseBot: chooseBot,
      chooseDiscardIndices: chooseDiscardIndices,
      estimateBetMeaning: estimateBetMeaning,
      withBigBetFear: withBigBetFear,
      comboLooksStrong: comboLooksStrong,
      blindsForMoney: blindsForMoney,
    };
  }
})();
