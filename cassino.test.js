var assert = require("assert");
global.Poker = require("./poker.js");
var Cassino = require("./cassino.js");

var passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log("ok " + name);
}

function tableFacingBet(opts) {
  var state = Poker.createHand({
    players: [
      { id: "hero", name: "Hero", stack: opts.heroStack || 500, isHuman: true },
      { id: "lia", name: "Bot 1", stack: opts.botStack || 500, isHuman: false },
    ],
    button: 0,
    sb: 5,
    bb: 10,
    deck: opts.deck,
  });
  // Button (hero) acts first heads-up preflop; get to a postflop big bet when asked.
  if (opts.board) {
    Poker.act(state, "call");
    Poker.act(state, "check");
    Poker.advance(state);
    while (state.board.length < opts.board.length) Poker.advance(state);
    state.board = opts.board.slice();
    state.players[0].hole = opts.heroHole.slice();
    state.players[1].hole = opts.botHole.slice();
    state.players.forEach(function (player) {
      player.streetBet = 0;
      player.acted = false;
      player.invested = 10;
    });
    state.currentBet = 0;
    state.toAct = 0;
    Poker.act(state, "raise", opts.betTo);
    // Bot to act facing the human's bet.
    assert.strictEqual(state.players[state.toAct].id, "lia");
  }
  return state;
}

check("big bets raise estimated value chance vs tiny bets", function () {
  var board = ["Ah", "Kd", "7c"];
  var heroHole = ["2s", "3s"];
  var botHole = ["9h", "8h"];
  var deck = [
    "2s", "9h", "3s", "8h",
    "Ah", "Kd", "7c", "4d", "5c", "6s", "Ts", "Jc",
  ];
  var small = tableFacingBet({ deck: deck, board: board, heroHole: heroHole, botHole: botHole, betTo: 15 });
  var big = tableFacingBet({ deck: deck, board: board, heroHole: heroHole, botHole: botHole, betTo: 120 });
  var smallMeaning = Cassino.estimateBetMeaning(small, small.players[1], Poker.legalActions(small));
  var bigMeaning = Cassino.estimateBetMeaning(big, big.players[1], Poker.legalActions(big));
  assert.ok(bigMeaning.sizeRatio > smallMeaning.sizeRatio);
  assert.ok(bigMeaning.valueChance > smallMeaning.valueChance);
  assert.ok(Math.abs(bigMeaning.valueChance + bigMeaning.bluffChance - 1) < 1e-9);
});

check("paired board has higher prior of strong opponent combos", function () {
  var dry = tableFacingBet({
    deck: ["2s", "9h", "3s", "8h", "Ah", "Kd", "7c", "4d", "5c", "6s", "Ts", "Jc"],
    board: ["Ah", "Kd", "7c"],
    heroHole: ["2s", "3s"],
    botHole: ["9h", "8h"],
    betTo: 80,
  });
  var paired = tableFacingBet({
    deck: ["2s", "9h", "3s", "8h", "Ah", "Ad", "7c", "4d", "5c", "6s", "Ts", "Jc"],
    board: ["Ah", "Ad", "7c"],
    heroHole: ["2s", "3s"],
    botHole: ["9h", "8h"],
    betTo: 80,
  });
  var dryMeaning = Cassino.estimateBetMeaning(dry, dry.players[1], Poker.legalActions(dry));
  var pairedMeaning = Cassino.estimateBetMeaning(paired, paired.players[1], Poker.legalActions(paired));
  assert.ok(pairedMeaning.priorStrong > dryMeaning.priorStrong);
});

check("comboLooksStrong treats top pair and draws as strong", function () {
  assert.strictEqual(Cassino.comboLooksStrong(["As", "Kd"], ["Ah", "9c", "2d"]), true);
  assert.strictEqual(Cassino.comboLooksStrong(["2s", "3h"], ["Ah", "Kd", "9c"]), false);
  assert.strictEqual(Cassino.comboLooksStrong(["As", "2s"], ["Ks", "9s", "3d"]), true);
});

check("withBigBetFear often folds weak hands to huge bets", function () {
  var state = tableFacingBet({
    deck: ["2s", "9h", "3s", "8h", "Ah", "Kd", "7c", "4d", "5c", "6s", "Ts", "Jc"],
    board: ["Ah", "Kd", "7c"],
    heroHole: ["Qs", "Js"],
    botHole: ["2s", "3s"],
    betTo: 200,
  });
  var legal = Poker.legalActions(state);
  var player = state.players[state.toAct];
  var folds = 0;
  var i;
  var original = Math.random;
  // Cycle through deterministic rolls so the fear branch is exercised.
  var rolls = [0.01, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  var idx = 0;
  Math.random = function () {
    var value = rolls[idx % rolls.length];
    idx += 1;
    return value;
  };
  try {
    for (i = 0; i < 40; i += 1) {
      if (Cassino.withBigBetFear({ type: "call" }, state, legal, player).type === "fold") folds += 1;
    }
  } finally {
    Math.random = original;
  }
  assert.ok(folds >= 20, "expected frequent folds to a huge bet with trash, got " + folds);
});

check("blindsForMoney uses 3% of money floored for the big blind", function () {
  assert.deepStrictEqual(Cassino.blindsForMoney(1000), { sb: 15, bb: 30 });
  assert.deepStrictEqual(Cassino.blindsForMoney(333), { sb: 4, bb: 9 });
  assert.deepStrictEqual(Cassino.blindsForMoney(10), { sb: 1, bb: 1 });
  assert.deepStrictEqual(Cassino.blindsForMoney(0), { sb: 5, bb: 10 });
});

check("withBigBetFear keeps strong hands against big bets", function () {
  var state = tableFacingBet({
    deck: ["As", "9h", "Ad", "8h", "Kh", "Kd", "7c", "4d", "5c", "6s", "Ts", "Jc"],
    board: ["Kh", "Kd", "7c"],
    heroHole: ["2s", "3s"],
    botHole: ["As", "Ad"],
    betTo: 150,
  });
  var legal = Poker.legalActions(state);
  var player = state.players[state.toAct];
  var folds = 0;
  var i;
  var original = Math.random;
  var rolls = [0.01, 0.2, 0.4, 0.6, 0.8, 0.99];
  var idx = 0;
  Math.random = function () {
    var value = rolls[idx % rolls.length];
    idx += 1;
    return value;
  };
  try {
    for (i = 0; i < 30; i += 1) {
      if (Cassino.withBigBetFear({ type: "call" }, state, legal, player).type === "fold") folds += 1;
    }
  } finally {
    Math.random = original;
  }
  assert.strictEqual(folds, 0);
});

check("chooseDiscardIndices keeps pairs and trips", function () {
  var pair = Cassino.chooseDiscardIndices(["As", "Ah", "9c", "4d", "2s"]);
  var trips = Cassino.chooseDiscardIndices(["Kc", "Kd", "Kh", "9s", "3c"]);
  var flushDraw = Cassino.chooseDiscardIndices(["As", "Ks", "9s", "4s", "2h"]);
  assert.deepStrictEqual(pair.slice().sort(), [2, 3, 4]);
  assert.deepStrictEqual(trips.slice().sort(), [3, 4]);
  assert.deepStrictEqual(flushDraw, [4]);
});

check("draw bots discard instead of betting on the draw street", function () {
  var state = Poker.createHand({
    variant: "five-card-draw",
    players: [
      { id: "hero", name: "Hero", stack: 500, isHuman: true },
      { id: "lia", name: "Bot 1", stack: 500, isHuman: false },
    ],
    button: 0,
    sb: 5,
    bb: 10,
    deck: [
      "As", "Kd",
      "Ah", "Qc",
      "2c", "Jd",
      "3c", "9c",
      "4c", "8c",
      "Kh", "Qh", "Jh", "Th", "9h",
      "7s", "6s", "5s", "4s", "3s",
    ],
  });
  var choice;
  Poker.act(state, "call");
  Poker.act(state, "check");
  Poker.advance(state);
  assert.strictEqual(state.street, "draw");
  assert.strictEqual(state.players[state.toAct].id, "lia");
  choice = Cassino.chooseBot(state);
  assert.strictEqual(choice.type, "discard");
  assert.ok(Array.isArray(choice.to));
});

console.log(passed + " passed");
