var assert = require("assert");
var Poker = require("./poker.js");

var passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log("ok " + name);
}

function rankOf(cards) {
  return Poker.rankCards(cards);
}

function beats(winner, loser) {
  assert.ok(Poker.compareRanks(rankOf(winner), rankOf(loser)) > 0);
}

function ties(left, right) {
  assert.strictEqual(Poker.compareRanks(rankOf(left), rankOf(right)), 0);
}

function act(state, type, to) {
  var result = Poker.act(state, type, to);
  assert.strictEqual(result.ok, true, (result.error || "action failed") + " (" + type + ")");
}

function chips(state) {
  return state.players.reduce(function (sum, player) {
    return sum + player.stack;
  }, 0);
}

check("hand ladder and wheel", function () {
  var ladder = [
    ["As", "Ks", "Qs", "Js", "Ts"],
    ["Ks", "Qs", "Js", "Ts", "9s"],
    ["As", "2s", "3s", "4s", "5s"],
    ["As", "Ah", "Ad", "Ac", "Kd"],
    ["As", "Ah", "Ad", "Kd", "Kh"],
    ["As", "Ah", "Ad", "Qd", "Qh"],
    ["As", "Qs", "9s", "5s", "2s"],
    ["Ks", "Qs", "9s", "5s", "2s"],
    ["As", "Kc", "Qd", "Jh", "Ts"],
    ["6s", "5c", "4d", "3h", "2s"],
    ["As", "2c", "3d", "4h", "5s"],
    ["As", "Ah", "Ad", "Kc", "Qd"],
    ["As", "Ah", "Ad", "Kc", "Jd"],
    ["As", "Ah", "Kc", "Kd", "Qs"],
    ["As", "Ah", "Qc", "Qd", "Ks"],
    ["As", "Ah", "Kc", "Qd", "Js"],
    ["As", "Ah", "Qc", "Jd", "9s"],
    ["As", "Kd", "Qc", "Jh", "9s"],
  ];
  var i;
  for (i = 1; i < ladder.length; i += 1) beats(ladder[i - 1], ladder[i]);
  ties(["As", "Kd", "Qc", "Jh", "9s"], ["Ad", "Kh", "Qs", "Jc", "9d"]);
  assert.deepStrictEqual(
    Poker.bestHand(["Th", "2c", "Ah", "Kh", "Qh", "Jh", "9h"]).cards.slice().sort(),
    ["Ah", "Jh", "Kh", "Qh", "Th"]
  );
  assert.strictEqual(Poker.handName(rankOf(["As", "Ks", "Qs", "Js", "Ts"])), "royal-flush");
  assert.strictEqual(Poker.handName(rankOf(["As", "2s", "3s", "4s", "5s"])), "straight-flush");
  assert.strictEqual(Poker.handName(rankOf(["As", "2c", "3d", "4h", "5s"])), "straight");
  assert.deepStrictEqual(rankOf(["As", "Kd", "Qc", "Jh", "9s"]), [0, 14, 13, 12, 11, 9]);
});

check("seven cards use the best five", function () {
  var royal = rankOf(["Th", "2c", "Ah", "Kh", "Qh", "Jh", "9h"]);
  var lower = rankOf(["9h", "2c", "Kh", "Qh", "Jh", "Th", "8h"]);
  assert.strictEqual(Poker.handName(royal), "royal-flush");
  assert.strictEqual(Poker.handName(lower), "straight-flush");
  beats(["Th", "2c", "Ah", "Kh", "Qh", "Jh", "9h"], ["9h", "2c", "Kh", "Qh", "Jh", "Th", "8h"]);
  assert.deepStrictEqual(rankOf(["As", "Ah", "Ad", "Ac", "Kd", "Qs", "2c"]), [7, 14, 13, 0, 0, 0]);
});

check("heads-up blinds allow a bet of any size", function () {
  var state = Poker.createHand({
    players: [
      { id: "a", name: "Ana", stack: 500 },
      { id: "b", name: "Bia", stack: 500 },
    ],
    button: 0,
    sb: 5,
    bb: 10,
    deck: ["As", "Kd", "Qs", "Jc", "2h", "3d", "4c", "5s", "6h", "7d", "8c", "9s"],
  });
  assert.strictEqual(state.players[0].streetBet, 5);
  assert.strictEqual(state.players[1].streetBet, 10);
  assert.strictEqual(state.players[state.toAct].id, "a");
  act(state, "call");
  act(state, "check");
  assert.strictEqual(Poker.advance(state).event, "flop");
  assert.strictEqual(state.players[state.toAct].id, "b");
  assert.strictEqual(Poker.act(state, "raise", 0).ok, false);
  assert.strictEqual(state.players[1].stack, 490);
  assert.strictEqual(Poker.act(state, "raise", 1).ok, true);
  assert.strictEqual(state.players[1].streetBet, 1);
  assert.strictEqual(state.players[1].stack, 489);
  act(state, "call");
  assert.strictEqual(Poker.advance(state).event, "turn");
});

check("full hand awards the straight", function () {
  var state = Poker.createHand({
    players: [
      { id: "a", name: "Ana", stack: 500 },
      { id: "b", name: "Bia", stack: 500 },
      { id: "c", name: "Caio", stack: 500 },
    ],
    button: 2,
    sb: 5,
    bb: 10,
    deck: ["Ah", "2c", "9s", "Kh", "7d", "9d", "Qc", "Jd", "Tc", "2h", "3c"],
  });
  assert.strictEqual(state.players[state.toAct].id, "c");
  act(state, "raise", 30);
  act(state, "raise", 100);
  act(state, "fold");
  act(state, "call");
  assert.strictEqual(state.toAct, -1);
  assert.strictEqual(Poker.advance(state).event, "flop");
  assert.strictEqual(state.players[state.toAct].id, "a");
  act(state, "raise", 50);
  act(state, "call");
  assert.strictEqual(Poker.advance(state).event, "turn");
  act(state, "raise", 100);
  act(state, "call");
  assert.strictEqual(Poker.advance(state).event, "river");
  act(state, "check");
  act(state, "check");
  assert.strictEqual(Poker.advance(state).event, "showdown");
  assert.strictEqual(state.revealed, true);
  assert.strictEqual(state.players[0].stack, 760);
  assert.strictEqual(state.players[1].stack, 490);
  assert.strictEqual(state.players[2].stack, 250);
  assert.strictEqual(chips(state), 1500);
  assert.strictEqual(state.payouts[0].playerId, "a");
  assert.strictEqual(state.payouts[0].hand, "straight");
  assert.deepStrictEqual(state.payouts[0].cards.slice().sort(), ["Ah", "Jd", "Kh", "Qc", "Tc"]);
});

check("side pots pay the short all-in only the main pot", function () {
  var state = Poker.createHand({
    players: [
      { id: "a", name: "Ana", stack: 100 },
      { id: "b", name: "Bia", stack: 300 },
      { id: "c", name: "Caio", stack: 300 },
    ],
    button: 2,
    sb: 5,
    bb: 10,
    deck: ["As", "Ks", "9d", "Ac", "Qs", "9c", "2h", "7d", "Jd", "4c", "3s"],
  });
  act(state, "call");
  act(state, "call");
  act(state, "check");
  assert.strictEqual(Poker.advance(state).event, "flop");
  assert.strictEqual(state.players[0].stack, 90);
  act(state, "raise", 90);
  act(state, "call");
  act(state, "call");
  assert.strictEqual(Poker.advance(state).event, "turn");
  assert.strictEqual(state.players[state.toAct].id, "b");
  act(state, "raise", 100);
  act(state, "call");
  assert.strictEqual(Poker.advance(state).event, "river");
  act(state, "check");
  act(state, "check");
  assert.strictEqual(Poker.advance(state).event, "showdown");
  assert.strictEqual(state.players[0].stack, 300);
  assert.strictEqual(state.players[1].stack, 100);
  assert.strictEqual(state.players[2].stack, 300);
  assert.strictEqual(chips(state), 700);
  assert.strictEqual(state.payouts.filter(function (payout) {
    return payout.playerId === "a";
  })[0].hand, "pair");
});

check("odd chip goes to the first live seat left of the button", function () {
  var state = Poker.createHand({
    players: [
      { id: "a", name: "Ana", stack: 5 },
      { id: "b", name: "Bia", stack: 5 },
      { id: "c", name: "Caio", stack: 5 },
    ],
    button: 2,
    sb: 5,
    bb: 10,
    deck: ["Kc", "Kd", "2s", "Qs", "Qh", "3d", "Ac", "7d", "9h", "Js", "4d"],
  });
  act(state, "call");
  assert.strictEqual(state.toAct, -1);
  assert.strictEqual(Poker.advance(state).event, "flop");
  assert.strictEqual(Poker.advance(state).event, "turn");
  assert.strictEqual(Poker.advance(state).event, "river");
  assert.strictEqual(Poker.advance(state).event, "showdown");
  assert.strictEqual(state.players[0].stack, 8);
  assert.strictEqual(state.players[1].stack, 7);
  assert.strictEqual(state.players[2].stack, 0);
  assert.strictEqual(chips(state), 15);
});

check("a raise of one dollar above the current bet is legal", function () {
  var state = Poker.createHand({
    players: [
      { id: "a", name: "Ana", stack: 500 },
      { id: "b", name: "Bia", stack: 500 },
      { id: "c", name: "Caio", stack: 140 },
      { id: "d", name: "Duda", stack: 500 },
    ],
    button: 3,
    sb: 5,
    bb: 10,
    deck: [
      "Ah", "2c", "3d", "4s",
      "Kh", "5c", "6d", "7s",
      "Qc", "Jd", "Tc", "2h", "3c",
    ],
  });
  var legal;
  assert.strictEqual(state.players[state.toAct].id, "c");
  act(state, "call");
  act(state, "call");
  act(state, "call");
  act(state, "check");
  assert.strictEqual(Poker.advance(state).event, "flop");
  assert.strictEqual(state.players[state.toAct].id, "a");
  act(state, "raise", 100);
  act(state, "call");
  legal = Poker.legalActions(state);
  assert.strictEqual(state.players[state.toAct].id, "c");
  assert.strictEqual(legal.minRaiseTo, 101);
  act(state, "raise", 130);
  legal = Poker.legalActions(state);
  assert.strictEqual(state.players[state.toAct].id, "d");
  assert.strictEqual(legal.call, 130);
  assert.strictEqual(legal.minRaiseTo, 131);
  act(state, "fold");
  legal = Poker.legalActions(state);
  assert.strictEqual(state.players[state.toAct].id, "a");
  assert.strictEqual(legal.call, 30);
  assert.strictEqual(legal.minRaiseTo, 131);
  assert.strictEqual(Poker.act(state, "raise", 131).ok, true);
});

check("any raise above the current bet reopens action", function () {
  var state = Poker.createHand({
    players: [
      { id: "a", name: "Ana", stack: 500 },
      { id: "b", name: "Bia", stack: 500 },
      { id: "c", name: "Caio", stack: 140 },
      { id: "d", name: "Duda", stack: 500 },
    ],
    button: 3,
    sb: 5,
    bb: 10,
    deck: [
      "Ah", "2c", "3d", "4s",
      "Kh", "5c", "6d", "7s",
      "Qc", "Jd", "Tc", "2h", "3c",
    ],
  });
  var legal;
  act(state, "call");
  act(state, "call");
  act(state, "call");
  act(state, "check");
  Poker.advance(state);
  act(state, "raise", 100);
  act(state, "call");
  act(state, "raise", 130);
  legal = Poker.legalActions(state);
  assert.strictEqual(legal.minRaiseTo, 131);
  act(state, "raise", 131);
  legal = Poker.legalActions(state);
  assert.strictEqual(state.players[state.toAct].id, "a");
  assert.strictEqual(legal.minRaiseTo, 132);
  assert.ok(legal.maxRaiseTo > legal.minRaiseTo);
});

check("five card draw deals five, draws, then showdown", function () {
  var state = Poker.createHand({
    variant: "five-card-draw",
    players: [
      { id: "a", name: "Ana", stack: 500 },
      { id: "b", name: "Bia", stack: 500 },
    ],
    button: 0,
    sb: 5,
    bb: 10,
    deck: [
      "As", "Kd",
      "Ah", "Qc",
      "Ad", "Jd",
      "2c", "3c",
      "4c", "5c",
      "Kh", "Qh", "Jh", "Th", "9h",
      "8s", "7s", "6s", "5s", "4s",
    ],
  });
  var legal;
  assert.strictEqual(state.variant, "five-card-draw");
  assert.strictEqual(state.players[0].hole.length, 5);
  assert.strictEqual(state.players[1].hole.length, 5);
  assert.deepStrictEqual(state.players[0].hole, ["As", "Ah", "Ad", "2c", "4c"]);
  assert.deepStrictEqual(state.players[1].hole, ["Kd", "Qc", "Jd", "3c", "5c"]);
  act(state, "call");
  act(state, "check");
  assert.strictEqual(Poker.advance(state).event, "draw");
  assert.strictEqual(state.street, "draw");
  legal = Poker.legalActions(state);
  assert.strictEqual(legal.discard, true);
  assert.ok(legal.maxDiscard >= 2);
  assert.strictEqual(state.players[state.toAct].id, "b");
  act(state, "discard", [1, 2, 3, 4]);
  assert.strictEqual(state.players[1].hole.length, 5);
  assert.strictEqual(state.players[1].hole[0], "Kd");
  act(state, "discard", [3, 4]);
  assert.strictEqual(state.toAct, -1);
  assert.strictEqual(Poker.advance(state).event, "draw-bet");
  assert.strictEqual(state.street, "draw-bet");
  act(state, "check");
  act(state, "check");
  assert.strictEqual(Poker.advance(state).event, "showdown");
  assert.strictEqual(state.revealed, true);
  assert.strictEqual(state.payouts[0].playerId, "a");
  assert.strictEqual(state.payouts[0].hand, "trips");
  assert.strictEqual(chips(state), 1000);
});

check("five card draw stand pat keeps the same five cards", function () {
  var state = Poker.createHand({
    variant: "five-card-draw",
    players: [
      { id: "a", name: "Ana", stack: 200 },
      { id: "b", name: "Bia", stack: 200 },
    ],
    button: 0,
    sb: 5,
    bb: 10,
    deck: [
      "As", "Ks",
      "Ah", "Kh",
      "Ad", "Kd",
      "Ac", "Kc",
      "2s", "2h",
      "9c", "8c", "7c", "6c", "5c",
    ],
  });
  var kept;
  act(state, "call");
  act(state, "check");
  Poker.advance(state);
  kept = state.players[1].hole.slice();
  act(state, "discard", []);
  assert.deepStrictEqual(state.players[1].hole, kept);
  act(state, "discard", []);
  Poker.advance(state);
  act(state, "check");
  act(state, "check");
  Poker.advance(state);
  assert.strictEqual(state.payouts[0].hand, "quads");
});

console.log(passed + " passed");
