const OFFLINE_GAMES = Object.freeze(["tetris", "snake", "pacman"]);
const OFFLINE_GAME_LABELS = Object.freeze({
  tetris: "Tetris",
  snake: "Snake",
  pacman: "Pac-Man"
});
const OFFLINE_DISCONNECT_ERROR_CODES = Object.freeze(["ERR_INTERNET_DISCONNECTED"]);
const OFFLINE_IGNORED_ERROR_CODES = Object.freeze(["ERR_ABORTED"]);
const DEFAULT_OFFLINE_TARGET = "chrome://newtab";

function normalizeErrorCode(errorCode, errorDescription = "") {
  if (typeof errorCode === "string" && errorCode.startsWith("ERR_")) return errorCode;

  const description = typeof errorDescription === "string" ? errorDescription : "";
  const match = description.match(/ERR_[A-Z_]+/);
  if (match) return match[0];

  return typeof errorCode === "number" ? String(errorCode) : "";
}

function shuffleGames(random = Math.random) {
  const bag = OFFLINE_GAMES.slice();
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function refillBag(lastGame, random = Math.random) {
  const bag = shuffleGames(random);
  if (lastGame && bag.length > 1 && bag[0] === lastGame) {
    const swapIndex = bag.findIndex((game) => game !== lastGame);
    if (swapIndex > 0) [bag[0], bag[swapIndex]] = [bag[swapIndex], bag[0]];
  }
  return bag;
}

function sanitizeRotationState(state = {}) {
  const bag = Array.isArray(state.bag)
    ? state.bag.filter((game) => OFFLINE_GAMES.includes(game))
    : [];
  const lastGame = OFFLINE_GAMES.includes(state.lastGame) ? state.lastGame : null;

  return { bag, lastGame };
}

function nextOfflineGame(state = {}, random = Math.random) {
  const current = sanitizeRotationState(state);
  const bag = current.bag.length ? current.bag.slice() : refillBag(current.lastGame, random);
  const game = bag.shift() || OFFLINE_GAMES[0];

  return {
    game,
    state: {
      bag,
      lastGame: game
    }
  };
}

function getOfflineGameLabel(game) {
  return OFFLINE_GAME_LABELS[game] || "Offline";
}

function buildOfflineTitle(game) {
  return `${getOfflineGameLabel(game)} • Offline`;
}

function normalizeOfflineTargetUrl(targetUrl) {
  if (!targetUrl || typeof targetUrl !== "string") return DEFAULT_OFFLINE_TARGET;
  return targetUrl;
}

function shouldTriggerOfflinePage({ errorCode, errorDescription = "", isMainFrame = false } = {}) {
  if (!isMainFrame) return false;
  return OFFLINE_DISCONNECT_ERROR_CODES.includes(normalizeErrorCode(errorCode, errorDescription));
}

function shouldIgnoreLoadFailure({ errorCode, errorDescription = "", isMainFrame = false } = {}) {
  if (!isMainFrame) return true;
  return OFFLINE_IGNORED_ERROR_CODES.includes(normalizeErrorCode(errorCode, errorDescription));
}

function shouldRouteNewTabToOffline(isOnline) {
  return !isOnline;
}

function resolveOfflineReloadTarget(context = {}) {
  return normalizeOfflineTargetUrl(context.targetUrl);
}

module.exports = {
  DEFAULT_OFFLINE_TARGET,
  OFFLINE_DISCONNECT_ERROR_CODES,
  OFFLINE_GAMES,
  OFFLINE_GAME_LABELS,
  OFFLINE_IGNORED_ERROR_CODES,
  buildOfflineTitle,
  getOfflineGameLabel,
  nextOfflineGame,
  normalizeErrorCode,
  normalizeOfflineTargetUrl,
  refillBag,
  resolveOfflineReloadTarget,
  sanitizeRotationState,
  shouldIgnoreLoadFailure,
  shouldRouteNewTabToOffline,
  shouldTriggerOfflinePage,
  shuffleGames
};
