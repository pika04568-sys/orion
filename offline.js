(() => {
  const pageBridge = window.orionPage || null;
  const helpers = window.OfflineArcadeHelpers || {};
  const params = new URLSearchParams(window.location.search);
  const GAME_LABELS = {
    pacman: "Pac-Man",
    snake: "Snake",
    tetris: "Tetris"
  };
  const CONTROL_COPY = {
    pacman: "Arrow keys or WASD move. Press P to pause.",
    snake: "Arrow keys or WASD steer. Press P to pause.",
    tetris: "Arrow keys move, Up/X rotates clockwise, Z rotates backward, Space hard-drops. Press P to pause."
  };

  const enqueueDirection = typeof helpers.enqueueDirection === "function"
    ? helpers.enqueueDirection
    : (queue, currentDirection, candidate, maxQueueLength = 3) => {
      const next = candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
        ? { x: candidate.x, y: candidate.y }
        : null;
      const lastQueued = queue.length ? queue[queue.length - 1] : currentDirection;
      if (!next || (lastQueued && lastQueued.x === -next.x && lastQueued.y === -next.y)) return queue.slice();
      return queue.concat(next).slice(-Math.max(1, maxQueueLength));
    };
  const directionToAngle = typeof helpers.directionToAngle === "function"
    ? helpers.directionToAngle
    : (direction, fallback = { x: 1, y: 0 }) => {
      const active = direction || fallback;
      if (active.x === 1) return 0;
      if (active.x === -1) return Math.PI;
      if (active.y === 1) return Math.PI / 2;
      if (active.y === -1) return -Math.PI / 2;
      return 0;
    };
  const createPieceStream = typeof helpers.createPieceStream === "function"
    ? helpers.createPieceStream
    : (pieces, random = Math.random) => {
      function cloneMatrix(matrix) {
        return matrix.map((row) => row.slice());
      }

      function clonePiece(piece) {
        return {
          color: piece.color,
          shape: cloneMatrix(piece.shape)
        };
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
    };

  const game = GAME_LABELS[params.get("game")] ? params.get("game") : "snake";
  const target = params.get("target") || "chrome://newtab";
  const title = GAME_LABELS[game];

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const gameTitle = document.getElementById("game-title");
  const targetLabel = document.getElementById("target-label");
  const controlsText = document.getElementById("controls-text");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const statusEl = document.getElementById("status");
  const retryBtn = document.getElementById("retry-btn");
  const restartBtn = document.getElementById("restart-btn");
  const pauseBtn = document.getElementById("pause-btn");

  let controller = null;
  let animationFrame = null;
  let lastTimestamp = 0;
  let paused = false;

  gameTitle.textContent = title;
  controlsText.textContent = CONTROL_COPY[game];
  document.title = `${title} • Offline`;
  targetLabel.textContent = target === "chrome://newtab"
    ? "Retry target: new tab"
    : `Retry target: ${target}`;

  function setScore(score) {
    const safeScore = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
    scoreEl.textContent = String(safeScore);
    const bestKey = `orion-offline-best-${game}`;
    const previousBest = Number(localStorage.getItem(bestKey) || "0");
    const nextBest = Math.max(previousBest, safeScore);
    bestEl.textContent = String(nextBest);
    if (nextBest !== previousBest) localStorage.setItem(bestKey, String(nextBest));
  }

  function setStatus(message, type = "") {
    statusEl.textContent = message;
    statusEl.className = type ? `status ${type}` : "status";
  }

  function setPaused(nextPaused) {
    paused = !!nextPaused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
  }

  function togglePause() {
    if (!controller || controller.gameOver) return;
    setPaused(!paused);
    setStatus(paused ? "Game paused. Press P or Resume to continue." : controller.baseStatus || "Back in the game.");
  }

  function drawPauseOverlay() {
    if (!paused) return;
    ctx.save();
    ctx.fillStyle = "rgba(2, 6, 16, 0.52)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f6f1dd";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 44px \"Avenir Next\", \"Trebuchet MS\", sans-serif";
    ctx.fillText("Paused", canvas.width / 2, canvas.height / 2 - 18);
    ctx.font = "600 18px \"Avenir Next\", \"Trebuchet MS\", sans-serif";
    ctx.fillStyle = "rgba(246, 241, 221, 0.84)";
    ctx.fillText("Press P or Resume to continue", canvas.width / 2, canvas.height / 2 + 26);
    ctx.restore();
  }

  function drawBackdrop(gridSize) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const size = gridSize || 24;
    ctx.fillStyle = "#071021";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += size) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += size) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
      ctx.stroke();
    }
  }

  function fitRect(cols, rows, padding = 48) {
    const width = canvas.width - padding * 2;
    const height = canvas.height - padding * 2;
    const cell = Math.floor(Math.min(width / cols, height / rows));
    const drawWidth = cols * cell;
    const drawHeight = rows * cell;
    return {
      cell,
      height: drawHeight,
      width: drawWidth,
      x: Math.floor((canvas.width - drawWidth) / 2),
      y: Math.floor((canvas.height - drawHeight) / 2)
    };
  }

  function createSnakeGame() {
    const cols = 20;
    const rows = 20;
    const board = fitRect(cols, rows, 64);
    const origin = {
      x: Math.floor(cols / 2),
      y: Math.floor(rows / 2)
    };
    let snake = [origin, { x: origin.x - 1, y: origin.y }, { x: origin.x - 2, y: origin.y }];
    let direction = { x: 1, y: 0 };
    let directionQueue = [];
    let food = placeFood();
    let accumulator = 0;
    let gameOver = false;
    let score = 0;
    const baseStatus = "Collect as much fruit as you can before the walls or your tail catch you.";

    setScore(0);
    setStatus(baseStatus);

    function placeFood() {
      const free = [];
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          if (!snake.some((part) => part.x === x && part.y === y)) free.push({ x, y });
        }
      }
      return free[Math.floor(Math.random() * free.length)] || { x: 1, y: 1 };
    }

    function sameCell(left, right) {
      return left.x === right.x && left.y === right.y;
    }

    return {
      baseStatus,
      get gameOver() {
        return gameOver;
      },
      keydown(event) {
        const key = event.key.toLowerCase();
        const candidate = (
          key === "arrowup" || key === "w" ? { x: 0, y: -1 } :
          key === "arrowdown" || key === "s" ? { x: 0, y: 1 } :
          key === "arrowleft" || key === "a" ? { x: -1, y: 0 } :
          key === "arrowright" || key === "d" ? { x: 1, y: 0 } :
          null
        );
        if (!candidate || gameOver) return;
        directionQueue = enqueueDirection(directionQueue, direction, candidate, 3);
      },
      render(time) {
        drawBackdrop(board.cell);
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.fillRect(board.x - 12, board.y - 12, board.width + 24, board.height + 24);

        ctx.fillStyle = "#ff8c69";
        ctx.beginPath();
        ctx.arc(
          board.x + food.x * board.cell + board.cell / 2,
          board.y + food.y * board.cell + board.cell / 2,
          board.cell * 0.32 + Math.sin(time / 180) * 1.6,
          0,
          Math.PI * 2
        );
        ctx.fill();

        snake.forEach((part, index) => {
          const x = board.x + part.x * board.cell;
          const y = board.y + part.y * board.cell;
          const gradient = ctx.createLinearGradient(x, y, x + board.cell, y + board.cell);
          gradient.addColorStop(0, index === 0 ? "#63b8ff" : "#56f39a");
          gradient.addColorStop(1, index === 0 ? "#94d0ff" : "#2fe37f");
          ctx.fillStyle = gradient;
          roundRect(x + 2, y + 2, board.cell - 4, board.cell - 4, 8);
          ctx.fill();
        });

        drawPauseOverlay();
      },
      update(delta) {
        if (gameOver || paused) return;
        accumulator += delta;
        if (accumulator < 110) return;
        accumulator = 0;
        if (directionQueue.length) direction = directionQueue.shift();
        const head = {
          x: snake[0].x + direction.x,
          y: snake[0].y + direction.y
        };
        const hitsWall = head.x < 0 || head.x >= cols || head.y < 0 || head.y >= rows;
        const hitsSelf = snake.some((part) => sameCell(part, head));
        if (hitsWall || hitsSelf) {
          gameOver = true;
          setStatus("Snake down. Press Enter or Restart Game to try again.", "alert");
          return;
        }
        snake.unshift(head);
        if (sameCell(head, food)) {
          score += 10;
          setScore(score);
          food = placeFood();
        } else {
          snake.pop();
        }
      }
    };
  }

  function createTetrisGame() {
    const cols = 10;
    const rows = 20;
    const boardRect = fitRect(cols + 5, rows, 48);
    const cell = boardRect.cell;
    const boardX = boardRect.x;
    const boardY = boardRect.y;
    const sidebarX = boardX + cols * cell + cell;
    const previewBox = {
      x: sidebarX - 4,
      y: boardY + 108,
      width: cell * 4 + 8,
      height: cell * 4 + 8
    };
    const pieces = [
      { color: "#63b8ff", shape: [[1, 1, 1, 1]] },
      { color: "#ffd166", shape: [[1, 1], [1, 1]] },
      { color: "#56f39a", shape: [[0, 1, 1], [1, 1, 0]] },
      { color: "#ff6978", shape: [[1, 1, 0], [0, 1, 1]] },
      { color: "#c18cff", shape: [[0, 1, 0], [1, 1, 1]] },
      { color: "#ff9f1c", shape: [[1, 0, 0], [1, 1, 1]] },
      { color: "#2ec4b6", shape: [[0, 0, 1], [1, 1, 1]] }
    ];
    const pieceStream = createPieceStream(pieces);
    let board = Array.from({ length: rows }, () => Array(cols).fill(null));
    let piece = spawnPiece();
    let accumulator = 0;
    let score = 0;
    let clearedRows = 0;
    let gameOver = false;
    const baseStatus = "Stack clean clears to keep the board open. Hard-drops are worth the risk.";

    setScore(0);
    setStatus(baseStatus);

    function cloneMatrix(matrix) {
      return matrix.map((row) => row.slice());
    }

    function rotateMatrix(matrix, dir) {
      const rotated = matrix[0].map((_, index) => matrix.map((row) => row[index]));
      return dir > 0
        ? rotated.map((row) => row.reverse())
        : rotated.reverse();
    }

    function spawnPiece() {
      const template = pieceStream.takeNextPiece();
      const shape = cloneMatrix(template.shape);
      const next = {
        color: template.color,
        shape,
        x: Math.floor((cols - shape[0].length) / 2),
        y: 0
      };
      if (collides(next)) {
        gameOver = true;
        setStatus("Board topped out. Press Enter or Restart Game to go again.", "alert");
      }
      return next;
    }

    function collides(candidate) {
      for (let y = 0; y < candidate.shape.length; y += 1) {
        for (let x = 0; x < candidate.shape[y].length; x += 1) {
          if (!candidate.shape[y][x]) continue;
          const nx = candidate.x + x;
          const ny = candidate.y + y;
          if (nx < 0 || nx >= cols || ny >= rows) return true;
          if (ny >= 0 && board[ny][nx]) return true;
        }
      }
      return false;
    }

    function mergeCurrent() {
      piece.shape.forEach((row, y) => {
        row.forEach((value, x) => {
          if (!value) return;
          const boardYPosition = piece.y + y;
          if (boardYPosition >= 0) board[boardYPosition][piece.x + x] = piece.color;
        });
      });
    }

    function clearLines() {
      let cleared = 0;
      board = board.filter((row) => {
        if (row.every(Boolean)) {
          cleared += 1;
          return false;
        }
        return true;
      });
      while (board.length < rows) board.unshift(Array(cols).fill(null));
      if (!cleared) return;
      clearedRows += cleared;
      score += [0, 100, 280, 500, 800][cleared] || cleared * 260;
      setScore(score);
    }

    function move(dx, dy) {
      if (gameOver) return false;
      const candidate = { ...piece, x: piece.x + dx, y: piece.y + dy };
      if (collides(candidate)) return false;
      piece = candidate;
      return true;
    }

    function drop() {
      if (move(0, 1)) return;
      mergeCurrent();
      clearLines();
      piece = spawnPiece();
    }

    function rotate(dir) {
      if (gameOver) return;
      const rotated = { ...piece, shape: rotateMatrix(piece.shape, dir) };
      const kicks = [0, -1, 1, -2, 2];
      for (const offset of kicks) {
        const candidate = { ...rotated, x: rotated.x + offset };
        if (!collides(candidate)) {
          piece = candidate;
          return;
        }
      }
    }

    return {
      baseStatus,
      get gameOver() {
        return gameOver;
      },
      keydown(event) {
        const key = event.key.toLowerCase();
        if (gameOver) return;
        if (key === "arrowleft" || key === "a") move(-1, 0);
        else if (key === "arrowright" || key === "d") move(1, 0);
        else if (key === "arrowdown" || key === "s") {
          if (move(0, 1)) {
            score += 1;
            setScore(score);
          }
        } else if (key === "arrowup" || key === "x") rotate(1);
        else if (key === "z") rotate(-1);
        else if (key === " ") {
          let hardDrop = 0;
          while (move(0, 1)) hardDrop += 1;
          score += hardDrop * 2;
          setScore(score);
          drop();
        }
      },
      render() {
        drawBackdrop(cell);
        ctx.fillStyle = "rgba(255,255,255,0.045)";
        roundRect(boardX - 12, boardY - 12, cols * cell + 24, rows * cell + 24, 18);
        ctx.fill();

        board.forEach((row, y) => {
          row.forEach((color, x) => {
            if (!color) return;
            drawBlock(boardX + x * cell, boardY + y * cell, cell, color);
          });
        });

        piece.shape.forEach((row, y) => {
          row.forEach((value, x) => {
            if (!value) return;
            drawBlock(boardX + (piece.x + x) * cell, boardY + (piece.y + y) * cell, cell, piece.color);
          });
        });

        ctx.fillStyle = "#f6f1dd";
        ctx.font = "700 22px \"Avenir Next\", \"Trebuchet MS\", sans-serif";
        ctx.fillText("Score", sidebarX, boardY + 42);
        ctx.font = "700 44px \"Avenir Next\", \"Trebuchet MS\", sans-serif";
        ctx.fillText(String(score), sidebarX, boardY + 88);
        ctx.font = "700 18px \"Avenir Next\", \"Trebuchet MS\", sans-serif";
        ctx.fillText("Next", sidebarX, boardY + 158);
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        roundRect(previewBox.x, previewBox.y, previewBox.width, previewBox.height, 16);
        ctx.fill();

        const nextPiece = pieceStream.peekNextPiece();
        const previewCell = Math.max(6, Math.floor(Math.min((previewBox.width - 16) / 4, (previewBox.height - 16) / 4)));
        const previewWidth = nextPiece.shape[0].length * previewCell;
        const previewHeight = nextPiece.shape.length * previewCell;
        const previewX = previewBox.x + Math.floor((previewBox.width - previewWidth) / 2);
        const previewY = previewBox.y + Math.floor((previewBox.height - previewHeight) / 2);
        nextPiece.shape.forEach((row, y) => {
          row.forEach((value, x) => {
            if (!value) return;
            drawBlock(previewX + x * previewCell, previewY + y * previewCell, previewCell, nextPiece.color);
          });
        });

        drawPauseOverlay();
      },
      update(delta) {
        if (gameOver || paused) return;
        accumulator += delta;
        const interval = Math.max(120, 580 - Math.floor(clearedRows / 3) * 30);
        if (accumulator < interval) return;
        accumulator = 0;
        drop();
      }
    };
  }

  function createPacmanGame() {
    const layout = [
      "###############",
      "#.............#",
      "#.###.###.###.#",
      "#o###.###.###o#",
      "#.............#",
      "#.###.#.#.###.#",
      "#.....#.#.....#",
      "#####.#.#.#####",
      "#.....#.#.....#",
      "#.###.#.#.###.#",
      "#.............#",
      "#.###.###.###.#",
      "#o..#.....#..o#",
      "#.##.#####.##.#",
      "#.............#",
      "###############"
    ];
    const cols = layout[0].length;
    const rows = layout.length;
    const maze = layout.map((row) => row.split(""));
    const board = fitRect(cols, rows, 52);
    const ghosts = [
      { color: "#ff6978", dir: { x: 1, y: 0 }, x: 7, y: 7 },
      { color: "#63b8ff", dir: { x: -1, y: 0 }, x: 7, y: 8 },
      { color: "#ffd166", dir: { x: 0, y: 1 }, x: 6, y: 7 }
    ];
    const player = { dir: { x: 0, y: 0 }, nextDir: { x: 0, y: 0 }, x: 1, y: 1 };
    let accumulator = 0;
    let ghostAccumulator = 0;
    let score = 0;
    let gameOver = false;
    let won = false;
    let pellets = countPellets();
    const baseStatus = "Clear the maze and keep moving. The ghosts get bolder once you hesitate.";

    maze[player.y][player.x] = " ";
    setScore(0);
    setStatus(baseStatus);

    function countPellets() {
      return maze.reduce((total, row) => total + row.filter((cell) => cell === "." || cell === "o").length, 0);
    }

    function isWall(x, y) {
      return x < 0 || x >= cols || y < 0 || y >= rows || maze[y][x] === "#";
    }

    function availableDirections(entity) {
      const options = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 }
      ].filter((dir) => !isWall(entity.x + dir.x, entity.y + dir.y));

      const reverse = { x: -entity.dir.x, y: -entity.dir.y };
      const withoutReverse = options.filter((dir) => dir.x !== reverse.x || dir.y !== reverse.y);
      return withoutReverse.length ? withoutReverse : options;
    }

    function chooseGhostDirection(ghost) {
      const options = availableDirections(ghost);
      if (!options.length) return { x: 0, y: 0 };
      if (Math.random() < 0.28) return options[Math.floor(Math.random() * options.length)];

      return options.reduce((best, dir) => {
        const next = { x: ghost.x + dir.x, y: ghost.y + dir.y };
        const distance = Math.abs(player.x - next.x) + Math.abs(player.y - next.y);
        if (!best || distance < best.distance) return { dir, distance };
        return best;
      }, null).dir;
    }

    function consumePellet() {
      const cell = maze[player.y][player.x];
      if (cell !== "." && cell !== "o") return;
      maze[player.y][player.x] = " ";
      pellets -= 1;
      score += cell === "o" ? 25 : 10;
      setScore(score);
      if (pellets <= 0) {
        won = true;
        gameOver = true;
        setStatus("Maze clear. Press Enter or Restart Game for another run.", "alert");
      }
    }

    function checkCollision() {
      if (ghosts.some((ghost) => ghost.x === player.x && ghost.y === player.y)) {
        gameOver = true;
        setStatus("Caught by a ghost. Press Enter or Restart Game to jump back in.", "alert");
      }
    }

    return {
      baseStatus,
      get gameOver() {
        return gameOver;
      },
      keydown(event) {
        const key = event.key.toLowerCase();
        const next = (
          key === "arrowup" || key === "w" ? { x: 0, y: -1 } :
          key === "arrowdown" || key === "s" ? { x: 0, y: 1 } :
          key === "arrowleft" || key === "a" ? { x: -1, y: 0 } :
          key === "arrowright" || key === "d" ? { x: 1, y: 0 } :
          null
        );
        if (!next || gameOver) return;
        player.nextDir = next;
      },
      render(time) {
        drawBackdrop(board.cell);
        ctx.fillStyle = "rgba(255,255,255,0.045)";
        roundRect(board.x - 16, board.y - 16, board.width + 32, board.height + 32, 18);
        ctx.fill();

        maze.forEach((row, y) => {
          row.forEach((cell, x) => {
            const px = board.x + x * board.cell;
            const py = board.y + y * board.cell;
            if (cell === "#") {
              ctx.fillStyle = "#123c8d";
              roundRect(px + 2, py + 2, board.cell - 4, board.cell - 4, 8);
              ctx.fill();
            } else if (cell === "." || cell === "o") {
              ctx.fillStyle = cell === "o" ? "#ffd166" : "#f6f1dd";
              ctx.beginPath();
              ctx.arc(
                px + board.cell / 2,
                py + board.cell / 2,
                cell === "o" ? board.cell * 0.18 : board.cell * 0.09,
                0,
                Math.PI * 2
              );
              ctx.fill();
            }
          });
        });

        const mouth = 0.22 + (Math.sin(time / 130) + 1) * 0.12;
        const faceAngle = directionToAngle(player.dir, player.nextDir);
        ctx.fillStyle = "#ffd166";
        ctx.beginPath();
        ctx.moveTo(board.x + player.x * board.cell + board.cell / 2, board.y + player.y * board.cell + board.cell / 2);
        ctx.arc(
          board.x + player.x * board.cell + board.cell / 2,
          board.y + player.y * board.cell + board.cell / 2,
          board.cell * 0.38,
          faceAngle + mouth,
          faceAngle + Math.PI * 2 - mouth
        );
        ctx.closePath();
        ctx.fill();

        ghosts.forEach((ghost) => {
          const gx = board.x + ghost.x * board.cell + board.cell / 2;
          const gy = board.y + ghost.y * board.cell + board.cell / 2;
          ctx.fillStyle = ghost.color;
          ctx.beginPath();
          ctx.moveTo(gx - board.cell * 0.34, gy + board.cell * 0.3);
          ctx.lineTo(gx - board.cell * 0.34, gy - board.cell * 0.05);
          ctx.quadraticCurveTo(gx - board.cell * 0.34, gy - board.cell * 0.42, gx, gy - board.cell * 0.42);
          ctx.quadraticCurveTo(gx + board.cell * 0.34, gy - board.cell * 0.42, gx + board.cell * 0.34, gy - board.cell * 0.05);
          ctx.lineTo(gx + board.cell * 0.34, gy + board.cell * 0.3);
          ctx.lineTo(gx + board.cell * 0.14, gy + board.cell * 0.18);
          ctx.lineTo(gx, gy + board.cell * 0.3);
          ctx.lineTo(gx - board.cell * 0.14, gy + board.cell * 0.18);
          ctx.closePath();
          ctx.fill();
        });

        if (won) {
          ctx.fillStyle = "rgba(255, 209, 102, 0.16)";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        drawPauseOverlay();
      },
      update(delta) {
        if (gameOver || paused) return;
        accumulator += delta;
        ghostAccumulator += delta;

        if (accumulator >= 145) {
          accumulator = 0;
          const desired = player.nextDir;
          if (!isWall(player.x + desired.x, player.y + desired.y)) player.dir = desired;
          if (!isWall(player.x + player.dir.x, player.y + player.dir.y)) {
            player.x += player.dir.x;
            player.y += player.dir.y;
          }
          consumePellet();
          checkCollision();
        }

        if (ghostAccumulator >= 185) {
          ghostAccumulator = 0;
          ghosts.forEach((ghost) => {
            ghost.dir = chooseGhostDirection(ghost);
            ghost.x += ghost.dir.x;
            ghost.y += ghost.dir.y;
          });
          checkCollision();
        }
      }
    };
  }

  function drawBlock(x, y, size, color) {
    const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "#ffffff");
    ctx.fillStyle = gradient;
    roundRect(x + 2, y + 2, size - 4, size - 4, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function roundRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function buildController() {
    if (game === "tetris") return createTetrisGame();
    if (game === "pacman") return createPacmanGame();
    return createSnakeGame();
  }

  function stopLoop() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  function startLoop() {
    stopLoop();
    lastTimestamp = 0;
    const tick = (timestamp) => {
      const delta = lastTimestamp ? timestamp - lastTimestamp : 0;
      lastTimestamp = timestamp;
      if (controller && !paused) controller.update(delta);
      if (controller) controller.render(timestamp);
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
  }

  function restartGame() {
    setPaused(false);
    controller = buildController();
    startLoop();
  }

  function retryTarget() {
    if (pageBridge && typeof pageBridge.navigateTo === "function") {
      pageBridge.navigateTo(target);
      return;
    }
    if (target === "chrome://newtab") window.location.reload();
    else window.location.href = target;
  }

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const handledKeys = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "x", "z", " ", "p"]);
    if (handledKeys.has(key)) event.preventDefault();
    if (key === "p") {
      togglePause();
      return;
    }
    if (event.key === "Enter" && statusEl.classList.contains("alert")) {
      restartGame();
      return;
    }
    if (paused) return;
    if (controller && typeof controller.keydown === "function") controller.keydown(event);
  });

  retryBtn.addEventListener("click", retryTarget);
  restartBtn.addEventListener("click", restartGame);
  pauseBtn.addEventListener("click", togglePause);
  window.addEventListener("beforeunload", stopLoop);

  restartGame();
})();
