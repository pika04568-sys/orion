(function (global, factory) {
  const helpers = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = helpers;
  }

  global.OfflineArcadeHelpers = helpers;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  function normalizeDirection(direction) {
    if (!direction || !Number.isFinite(direction.x) || !Number.isFinite(direction.y)) return null;
    return { x: direction.x, y: direction.y };
  }

  function isOppositeDirection(left, right) {
    return !!left && !!right && left.x === -right.x && left.y === -right.y;
  }

  function enqueueDirection(queue, currentDirection, candidate, maxQueueLength = 3) {
    const next = normalizeDirection(candidate);
    const lastQueued = queue.length ? queue[queue.length - 1] : normalizeDirection(currentDirection);
    if (!next || isOppositeDirection(lastQueued, next)) return queue.slice();
    return queue.concat(next).slice(-Math.max(1, maxQueueLength));
  }

  function directionToAngle(direction, fallback = { x: 1, y: 0 }) {
    const active = normalizeDirection(direction) || normalizeDirection(fallback) || { x: 1, y: 0 };
    if (active.x === 1) return 0;
    if (active.x === -1) return Math.PI;
    if (active.y === 1) return Math.PI / 2;
    if (active.y === -1) return -Math.PI / 2;
    return 0;
  }

  function cloneMatrix(matrix) {
    return matrix.map((row) => row.slice());
  }

  function clonePiece(piece) {
    return {
      color: piece.color,
      shape: cloneMatrix(piece.shape)
    };
  }

  function createPieceStream(pieces, random = Math.random) {
    if (!Array.isArray(pieces) || pieces.length === 0) {
      throw new Error("createPieceStream requires at least one piece template");
    }

    function drawPiece() {
      const template = pieces[Math.floor(random() * pieces.length)] || pieces[0];
      return clonePiece(template);
    }

    let nextPiece = drawPiece();

    return {
      peekNextPiece() {
        return clonePiece(nextPiece);
      },
      takeNextPiece() {
        const current = clonePiece(nextPiece);
        nextPiece = drawPiece();
        return current;
      }
    };
  }

  return {
    createPieceStream,
    directionToAngle,
    enqueueDirection,
    isOppositeDirection
  };
});
