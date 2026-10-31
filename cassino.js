(function () {
  var START = 500;
  var SB = 5;
  var BB = 10;
  var BOT_PAUSE = 1700;
  var STREET_PAUSE = 2000;
  var HAND_PAUSE = 3600;
  var DEAL_TRAVEL = 520;
  var DEAL_FLIP = 180;
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
  var statusMessage = "";

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

  function chooseBot(table) {
    var legal = Poker.legalActions(table);
    var player = table.players[table.toAct];
    var score = clamp(strength(player, table) + (Math.random() - 0.5) * 0.1, 0, 1);
    var pot = Poker.potSize(table);
    var odds = legal.call > 0 ? legal.call / (pot + legal.call) : 0;
    if (legal.call > 0) {
      if (score >= 0.8 && legal.minRaiseTo != null && Math.random() < 0.75) {
        return { type: "raise", to: sizedBet(table, legal, Math.random() < 0.5 ? 0.5 : 1) };
      }
      if (score >= 0.58 && legal.minRaiseTo != null && Math.random() < 0.35) {
        return { type: "raise", to: sizedBet(table, legal, 0.5) };
      }
      if (score >= odds && score >= 0.28) return { type: "call" };
      if (score >= 0.22 && odds <= 0.22) return { type: "call" };
      if (Math.random() < 0.06 && legal.minRaiseTo != null) return { type: "raise", to: sizedBet(table, legal, 0.5) };
      return { type: "fold" };
    }
    if (legal.minRaiseTo != null && (score >= 0.64 || (score >= 0.36 && Math.random() < 0.45) || Math.random() < 0.07)) {
      return { type: "raise", to: sizedBet(table, legal, score >= 0.82 ? 1 : 0.5) };
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

  function formatEntry(entry) {
    var name = playerById(entry.playerId);
    var label = name ? name.name : entry.playerId;
    var suffix = entry.allIn ? " (all-in)" : "";
    var cards;
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
      cards = entry.cards.map(function (card) {
        return Poker.cardParts(card).text;
      });
      return { flop: "Flop", turn: "Turn", river: "River" }[entry.street] + ": " + cards.join(" ");
    }
    if (entry.kind === "show") return label + " mostra " + (HANDS[entry.hand] || entry.hand);
    if (entry.kind === "win") {
      if (entry.refund) return label + " recebe $" + entry.amount + " de volta";
      if (entry.hand) return label + " ganha $" + entry.amount + " com " + HANDS[entry.hand];
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

  function cardNode(card, faceDown) {
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

  function renderSeat(player, index, opts) {
    var className = "seat s" + index;
    var seat;
    var meta = [];
    var cards;
    var hidden;
    var i;
    opts = opts || {};
    if (index === state.toAct) className += " acting";
    if (player.folded) className += " folded";
    seat = el("article", className);
    seat.appendChild(el("p", "seat-name", player.name));
    meta.push("$" + player.stack);
    if (seatBadge(index)) meta.push(seatBadge(index));
    if (player.allIn && !player.folded) meta.push("all-in");
    if (player.folded) meta.push("fora");
    seat.appendChild(el("p", "seat-meta", meta.join(" · ")));
    if (player.streetBet > 0 && !state.handOver) {
      seat.appendChild(el("p", "seat-bet", "Aposta $" + player.streetBet));
    }
    cards = el("div", "cards");
    if (!opts.hideHoles) {
      hidden = !player.isHuman && !(state.revealed && !player.folded);
      for (i = 0; i < player.hole.length; i += 1) cards.appendChild(cardNode(player.hole[i], hidden));
    }
    seat.appendChild(cards);
    return seat;
  }

  function renderLobbySeat(player, index) {
    var seat = el("article", "seat s" + index);
    seat.appendChild(el("p", "seat-name", player.name));
    seat.appendChild(el("p", "seat-meta", "$" + player.stack));
    seat.appendChild(el("div", "cards"));
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
    node.setAttribute("aria-live", "polite");
    return node;
  }

  function renderLobby() {
    var table = document.getElementById("table");
    var board = el("section", "board-panel");
    var i;
    clear(table);
    setStatus("");
    document.getElementById("play-bots").hidden = false;
    for (i = 0; i < roster.length; i += 1) table.appendChild(renderLobbySeat(roster[i], i));
    board.appendChild(el("p", "pot", "Pote $0"));
    board.appendChild(el("div", "cards board-cards"));
    board.appendChild(el("p", "street-label", ""));
    board.appendChild(statusNode());
    table.appendChild(board);
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
        var flipOut;
        if (!alive()) return;
        if (!player.isHuman) {
          tick();
          return;
        }
        flipOut = node.animate([
          { transform: "scaleX(1)" },
          { transform: "scaleX(0)" }
        ], { duration: DEAL_FLIP, easing: "ease-in", fill: "forwards" });
        flipOut.onfinish = function () {
          var face;
          var flipIn;
          if (!alive()) return;
          face = cardNode(player.hole[step.card], false);
          node.replaceWith(face);
          if (typeof face.animate !== "function") {
            tick();
            return;
          }
          flipIn = face.animate([
            { transform: "scaleX(0)" },
            { transform: "scaleX(1)" }
          ], { duration: DEAL_FLIP, easing: "ease-out", fill: "both" });
          flipIn.onfinish = function () {
            if (alive()) tick();
          };
        };
      };
    }
    tick();
  }

  function renderTable(opts) {
    var table = document.getElementById("table");
    var board = el("section", "board-panel");
    var cards = el("div", "cards board-cards");
    var i;
    clear(table);
    for (i = 0; i < state.players.length; i += 1) table.appendChild(renderSeat(state.players[i], i, opts));
    board.appendChild(el("p", "pot", "Pote $" + Poker.potSize(state)));
    for (i = 0; i < state.board.length; i += 1) cards.appendChild(cardNode(state.board[i], false));
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
  }

  function renderActions() {
    var box = document.getElementById("actions");
    var raiseBox = document.getElementById("raise-box");
    var legal;
    var player;
    clear(box);
    if (raiseBox) raiseBox.remove();
    if (!state || state.handOver || state.toAct < 0 || !state.players[state.toAct].isHuman) return;
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

  function render() {
    if (!state) return;
    setStatus(statusText());
    renderTable();
    renderActions();
    syncLog();
  }

  function syncRoster() {
    var i;
    var j;
    for (i = 0; i < state.players.length; i += 1) {
      for (j = 0; j < roster.length; j += 1) {
        if (roster[j].id === state.players[i].id) roster[j].stack = state.players[i].stack;
      }
    }
  }

  function showBust() {
    setStatus("Você ficou sem fichas.");
    document.getElementById("rebuy").hidden = false;
    clear(document.getElementById("actions"));
  }

  function finishHand() {
    syncRoster();
    button = (button + 1) % roster.length;
    render();
    if (roster[0].stack <= 0) {
      showBust();
      return;
    }
    later(startHand, HAND_PAUSE);
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
    render();
    if (!state || state.handOver) {
      if (state && state.handOver) finishHand();
      return;
    }
    if (state.toAct < 0) {
      later(function () {
        Poker.advance(state);
        pump();
      }, STREET_PAUSE);
      return;
    }
    if (state.players[state.toAct].isHuman) return;
    later(function () {
      if (!applyBot()) return;
      pump();
    }, BOT_PAUSE);
  }

  function startHand() {
    var seated = 0;
    document.getElementById("rebuy").hidden = true;
    document.getElementById("play-bots").hidden = true;
    roster.forEach(function (player) {
      if (!player.isHuman && player.stack <= 0) player.stack = START;
      if (player.stack > 0) seated += 1;
    });
    if (roster[0].stack <= 0 || seated < 2) {
      showBust();
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
    roster = [
      { id: "hero", name: "Você", stack: START, isHuman: true },
      { id: "lia", name: "Bot 1", stack: START, isHuman: false },
      { id: "caio", name: "Bot 2", stack: START, isHuman: false },
      { id: "duda", name: "Bot 3", stack: START, isHuman: false },
      { id: "ravi", name: "Bot 4", stack: START, isHuman: false },
      { id: "nanda", name: "Bot 5", stack: START, isHuman: false },
    ];
    button = roster.length - 1;
    document.getElementById("rebuy").addEventListener("click", function () {
      roster[0].stack = START;
      startHand();
    });
    document.getElementById("play-bots").addEventListener("click", function () {
      document.getElementById("play-bots").hidden = true;
      startHand();
    });
    renderLobby();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { chooseBot: chooseBot };
})();
