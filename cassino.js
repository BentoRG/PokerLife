(function () {
  var START = 500;
  var BOT_STACK = 200;
  var SB = 5;
  var BB = 10;
  var BOT_PAUSE = 1700;
  var STREET_PAUSE = 2000;
  var DEAL_TRAVEL = 640;
  var REVEAL_OUT = 460;
  var REVEAL_IN = 560;
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
    complete: "Mão encerrada",
  };
  var RANK = "23456789TJQKA";

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
  var statusMessage = "";
  var noticeTimer;
  var NOTICE_MS = 3200;

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

  function sizedBet(table, legal, fraction) {
    var pot = Poker.potSize(table);
    var raw;
    if (table.currentBet === 0) raw = Math.max(table.bb, Math.round(pot * fraction));
    else raw = table.currentBet + Math.max(table.bb, Math.round((pot + legal.call) * fraction));
    return clamp(raw, legal.minRaiseTo, legal.maxRaiseTo);
  }

  // Bot difficulties: 1=6/10, 2=11/10, 3=7/10, 4=10/10.
  var SKILL = {
    lia: 6,
    caio: 11,
    duda: 7,
    ravi: 10,
  };

  function skillOf(player) {
    var skill = SKILL[player.id];
    return skill == null ? 5 : skill;
  }

  function chooseBot(table) {
    var legal = Poker.legalActions(table);
    var player = table.players[table.toAct];
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
      if (score + error * 0.28 >= price && score >= 0.2 - error * 0.18) return { type: "call" };
      if (Math.random() < error * 0.38) return { type: "call" };
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

  function later(fn, ms) {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
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

  function seatBadge(index) {
    var blinds = Poker.blindSeats(state);
    var parts = [];
    if (index === state.button) parts.push("Dealer");
    if (index === blinds.sb) parts.push("Small blind");
    if (index === blinds.bb) parts.push("Big blind");
    return parts.join(" · ");
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

  function renderSeat(player, index, opts, winners) {
    var className = "seat s" + index;
    var seat;
    var meta = [];
    var cards;
    var hidden;
    var payout;
    var i;
    opts = opts || {};
    winners = winners || {};
    payout = winners[player.id];
    if (index === state.toAct) className += " acting";
    if (player.folded) className += " folded";
    if (payout) className += " winner";
    seat = el("article", className);
    seat.appendChild(el("p", "seat-name", player.name));
    meta.push("$" + player.stack);
    if (seatBadge(index)) meta.push(seatBadge(index));
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
      hidden = !player.isHuman && (player.folded || opts.coverShowdown || !state.revealed);
      for (i = 0; i < player.hole.length; i += 1) {
        cards.appendChild(cardNode(player.hole[i], hidden, !hidden && cardWasUsed(winners, player.hole[i])));
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

  function showUnavailable() {
    var notice = document.getElementById("mode-notice");
    notice.hidden = false;
    notice.textContent = "essa funcionalidade ainda nao foi aplicada";
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(hideNotice, NOTICE_MS);
  }

  function showModeSelect() {
    var raiseBox = document.getElementById("raise-box");
    clearTimeout(timer);
    dealToken += 1;
    state = null;
    if (raiseBox) raiseBox.remove();
    clear(document.getElementById("actions"));
    clear(document.getElementById("table"));
    clear(document.getElementById("log"));
    hideNotice();
    document.getElementById("match").hidden = true;
    document.getElementById("mode-select").hidden = false;
  }

  function heroMoney() {
    if (typeof window !== "undefined" && window.PokerLifeAuth) return window.PokerLifeAuth.currentMoney();
    return START;
  }

  function saveHeroMoney() {
    var i;
    if (typeof window === "undefined" || !window.PokerLifeAuth || !roster) return;
    for (i = 0; i < roster.length; i += 1) {
      if (roster[i].isHuman) {
        window.PokerLifeAuth.setMoney(roster[i].stack, "partida de poker");
        return;
      }
    }
  }

  function freshRoster() {
    roster = [
      { id: "hero", name: "Você", stack: heroMoney(), isHuman: true },
      { id: "lia", name: "Bot 1", stack: BOT_STACK, isHuman: false },
      { id: "caio", name: "Bot 2", stack: BOT_STACK, isHuman: false },
      { id: "duda", name: "Bot 3", stack: BOT_STACK, isHuman: false },
      { id: "ravi", name: "Bot 4", stack: BOT_STACK, isHuman: false },
    ];
    button = roster.length - 1;
  }

  function startMatch() {
    vsBots = true;
    freshRoster();
    hideNotice();
    document.getElementById("mode-select").hidden = true;
    document.getElementById("match").hidden = false;
    startHand();
  }

  function heroFolded() {
    var i;
    if (!state) return false;
    for (i = 0; i < state.players.length; i += 1) {
      if (state.players[i].isHuman) return !!state.players[i].folded;
    }
    return false;
  }

  function canSkipRound() {
    return !!(vsBots && state && !handClosing && heroFolded());
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
    var queue = [];
    var round;
    var step;
    var index;
    if (table.players.length === 2) start = table.button;
    for (round = 0; round < 2; round += 1) {
      for (step = 0; step < table.players.length; step += 1) {
        index = (start + step) % table.players.length;
        if (table.players[index].hole.length <= round) continue;
        queue.push({ index: index, card: round });
      }
    }
    return queue;
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
    ], { duration: REVEAL_OUT, easing: "ease-in", fill: "forwards" }).onfinish = function () {
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
      ], { duration: REVEAL_IN, easing: "ease-out", fill: "both" });
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
      seatCards = document.querySelector("#table .s" + step.index + " .cards");
      if (!seatCards) {
        done();
        return;
      }
      node = cardNode(player.hole[step.card], true);
      seatCards.appendChild(node);
      if (typeof node.animate !== "function") {
        if (player.isHuman) node.replaceWith(cardNode(player.hole[step.card], false));
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
      ], { duration: DEAL_TRAVEL, easing: "ease-out", fill: "both" });
      travel.onfinish = function () {
        if (!alive()) return;
        if (!player.isHuman) {
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
    if (state.toAct >= 0 && state.players[state.toAct].isHuman) return "Sua vez · pote $" + Poker.potSize(state);
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
    result = Poker.act(state, type, to);
    if (!result.ok) {
      renderActions();
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
    if (state.handOver || state.toAct < 0 || !state.players[state.toAct].isHuman) return;
    legal = Poker.legalActions(state);
    player = state.players[state.toAct];
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
      cards = document.querySelectorAll("#table .s" + seatIndex + " .cards .card");
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
      if (player.isHuman || player.folded) continue;
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
    if (!state || handClosing) return;
    renderActions();
    if (state.handOver) {
      finishHand();
      return;
    }
    if (state.toAct < 0) {
      later(function () {
        if (!state || handClosing) return;
        Poker.advance(state);
        pump();
      }, STREET_PAUSE);
      return;
    }
    if (state.players[state.toAct].isHuman) return;
    later(function () {
      if (!state || handClosing || !applyBot()) return;
      pump();
    }, BOT_PAUSE);
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
    advanceButton();
    startHand();
  }

  function showPlayAgain() {
    var box = document.getElementById("actions");
    var raiseBox = document.getElementById("raise-box");
    var again;
    if (!box) return;
    if (raiseBox) raiseBox.remove();
    clear(box);
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
    shownBoard = 0;
    shownHoles = false;
    handClosing = false;
    if (actions) clear(actions);
    if (raiseBox) raiseBox.remove();
    document.documentElement.style.removeProperty("--dock-height");
    roster.forEach(function (player) {
      if (player.stack > 0) seated += 1;
    });
    if (roster[0].stack <= 0 || seated < 2) {
      showModeSelect();
      return;
    }
    state = Poker.createHand({
      players: roster,
      button: button,
      sb: SB,
      bb: BB,
    });
    logCursor = 0;
    marker("Nova mão · dealer com " + roster[button].name);
    setStatus("Distribuindo as cartas");
    syncLog();
    playDeal(function () {
      pump();
    });
  }

  function init() {
    document.getElementById("play-bots").addEventListener("click", startMatch);
    document.getElementById("play-friends").addEventListener("click", showUnavailable);
    window.addEventListener("resize", keepHeroVisible);
    showModeSelect();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { chooseBot: chooseBot };
})();
