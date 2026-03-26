const test = require("node:test");
const assert = require("node:assert/strict");

const offlineArcade = require("../offline-arcade");

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
