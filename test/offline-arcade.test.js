const test = require("node:test");
const assert = require("node:assert/strict");

const offlineArcade = require("../offline-arcade");
const arcadeHelpers = require("../offline-game-helpers");

function fixedRandom(value) {
  return () => value;
}

test("shuffle bag yields all three arcade games before repeating", () => {
  let state = {};
  const seen = [];

  for (let i = 0; i < 3; i += 1) {
    const next = offlineArcade.nextOfflineGame(state, fixedRandom(0));
    seen.push(next.game);
    state = next.state;
  }

  assert.equal(new Set(seen).size, 3);
  assert.deepEqual(seen.slice().sort(), offlineArcade.OFFLINE_GAMES.slice().sort());
});

test("refilling the bag avoids an immediate repeat of the previously shown game", () => {
  const next = offlineArcade.nextOfflineGame({
    bag: [],
    lastGame: "snake"
  }, fixedRandom(0));

  assert.notEqual(next.game, "snake");
  assert.equal(next.state.lastGame, next.game);
});

test("opening another offline page advances the remaining bag instead of resetting it", () => {
  const first = offlineArcade.nextOfflineGame({}, fixedRandom(0));
  const second = offlineArcade.nextOfflineGame(first.state, fixedRandom(0));

  assert.notEqual(second.game, first.game);
  assert.equal(second.state.bag.length, 1);
});

test("snake turn queue keeps rapid turns in order and blocks reversals", () => {
  const right = { x: 1, y: 0 };
  const up = { x: 0, y: -1 };
  const left = { x: -1, y: 0 };
  const down = { x: 0, y: 1 };

  let queue = [];
  queue = arcadeHelpers.enqueueDirection(queue, right, up);
  queue = arcadeHelpers.enqueueDirection(queue, right, down);
  queue = arcadeHelpers.enqueueDirection(queue, right, left);

  assert.deepEqual(queue, [up, left]);
});

test("tetris piece stream exposes a preview piece and advances it after spawn", () => {
  const randomValues = [0, 0.66, 0.99];
  let index = 0;
  const pieces = [
    { color: "red", shape: [[1]] },
    { color: "green", shape: [[1, 1]] },
    { color: "blue", shape: [[1, 1, 1]] }
  ];

  const stream = arcadeHelpers.createPieceStream(pieces, () => randomValues[index++] ?? randomValues[randomValues.length - 1]);

  assert.equal(stream.peekNextPiece().color, "red");
  assert.equal(stream.takeNextPiece().color, "red");
  assert.equal(stream.peekNextPiece().color, "green");
  assert.equal(stream.takeNextPiece().color, "green");
  assert.equal(stream.peekNextPiece().color, "blue");
});
