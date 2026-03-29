(function () {
  const BOARD_SIZE = 9;
  const HUMAN_COLOR = "black";
  const AI_COLOR = "white";
  const WHITE_KOMI = 5.5;
  const COLUMN_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "J"];
  const STAR_POINTS = new Set([20, 24, 40, 56, 60]);

  const dom = {
    board: document.getElementById("board"),
    topAxis: document.getElementById("topAxis"),
    leftAxis: document.getElementById("leftAxis"),
    playerSeatBadge: document.getElementById("playerSeatBadge"),
    modeBadge: document.getElementById("modeBadge"),
    providerBadge: document.getElementById("providerBadge"),
    newGameButton: document.getElementById("newGameButton"),
    passButton: document.getElementById("passButton"),
    undoButton: document.getElementById("undoButton"),
    scoreButton: document.getElementById("scoreButton"),
    suggestionButton: document.getElementById("suggestionButton"),
    turnStatus: document.getElementById("turnStatus"),
    captureStatus: document.getElementById("captureStatus"),
    scoreStatus: document.getElementById("scoreStatus"),
    lastMoveStatus: document.getElementById("lastMoveStatus"),
    statusNote: document.getElementById("statusNote"),
    scoringPanel: document.getElementById("scoringPanel"),
    scoringSummary: document.getElementById("scoringSummary"),
    scoreBlackTotal: document.getElementById("scoreBlackTotal"),
    scoreBlackDetail: document.getElementById("scoreBlackDetail"),
    scoreWhiteTotal: document.getElementById("scoreWhiteTotal"),
    scoreWhiteDetail: document.getElementById("scoreWhiteDetail"),
    scoreNeutralTotal: document.getElementById("scoreNeutralTotal"),
    scoreNeutralDetail: document.getElementById("scoreNeutralDetail"),
    scoringHint: document.getElementById("scoringHint"),
    resumePlayButton: document.getElementById("resumePlayButton"),
    finishScoringButton: document.getElementById("finishScoringButton"),
    aiMood: document.getElementById("aiMood"),
    chatMessages: document.getElementById("chatMessages"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    chatSend: document.querySelector(".chat-send"),
    promptChips: Array.from(document.querySelectorAll(".prompt-chip")),
  };

  let state = createInitialState();
  let aiThinking = false;
  let chatThinking = false;
  let aiTimer = null;
  let chatHistory = [];
  let stateHistory = [];
  let appConfig = {
    serverAvailable: false,
    chatApiEnabled: false,
    apiEnabled: false,
    model: null,
    boardAiApiEnabled: false,
    boardAiProvider: null,
    boardAiLabel: null,
    moveModel: null,
  };
  const cellElements = [];

  function createInitialState() {
    const board = Array(BOARD_SIZE * BOARD_SIZE).fill(null);
    return {
      size: BOARD_SIZE,
      board,
      currentPlayer: HUMAN_COLOR,
      humanColor: HUMAN_COLOR,
      aiColor: AI_COLOR,
      captures: { black: 0, white: 0 },
      turn: 1,
      boardHash: hashBoard(board),
      previousBoardHash: null,
      lastMove: null,
      recommendedMove: null,
      consecutivePasses: 0,
      gameOver: false,
      winnerText: "",
      moveLog: [],
      scoring: createScoringState(),
    };
  }

  function cloneGameState(snapshot) {
    return {
      ...snapshot,
      board: Array.isArray(snapshot.board) ? snapshot.board.slice() : [],
      captures: {
        black: snapshot.captures?.black ?? 0,
        white: snapshot.captures?.white ?? 0,
      },
      lastMove: snapshot.lastMove ? { ...snapshot.lastMove } : null,
      moveLog: Array.isArray(snapshot.moveLog)
        ? snapshot.moveLog.map((move) => ({ ...move }))
        : [],
      scoring: {
        active: Boolean(snapshot.scoring?.active),
        finalized: Boolean(snapshot.scoring?.finalized),
        deadStones: Array.isArray(snapshot.scoring?.deadStones)
          ? snapshot.scoring.deadStones.slice()
          : [],
      },
    };
  }

  function createScoringState() {
    return {
      active: false,
      finalized: false,
      deadStones: [],
    };
  }

  function otherColor(color) {
    return color === "black" ? "white" : "black";
  }

  function hashBoard(board) {
    return board.map((stone) => (stone ? stone[0] : ".")).join("");
  }

  function indexToCoord(index, size = BOARD_SIZE) {
    const row = Math.floor(index / size);
    const col = index % size;
    return `${COLUMN_LABELS[col]}${size - row}`;
  }

  function coordToIndex(coord, size = BOARD_SIZE) {
    if (typeof coord !== "string" || coord.length < 2) {
      return null;
    }

    const normalized = coord.trim().toUpperCase();
    const column = normalized[0];
    const rowValue = Number(normalized.slice(1));
    const col = COLUMN_LABELS.indexOf(column);

    if (col === -1 || Number.isNaN(rowValue) || rowValue < 1 || rowValue > size) {
      return null;
    }

    const row = size - rowValue;
    return row * size + col;
  }

  function getNeighbors(index, size = BOARD_SIZE) {
    const row = Math.floor(index / size);
    const col = index % size;
    const neighbors = [];

    if (row > 0) {
      neighbors.push(index - size);
    }
    if (row < size - 1) {
      neighbors.push(index + size);
    }
    if (col > 0) {
      neighbors.push(index - 1);
    }
    if (col < size - 1) {
      neighbors.push(index + 1);
    }

    return neighbors;
  }

  function getGroup(board, startIndex, size = BOARD_SIZE) {
    const color = board[startIndex];

    if (!color) {
      return null;
    }

    const stones = [];
    const liberties = new Set();
    const visited = new Set([startIndex]);
    const stack = [startIndex];

    while (stack.length) {
      const current = stack.pop();
      stones.push(current);

      for (const neighbor of getNeighbors(current, size)) {
        const occupant = board[neighbor];

        if (!occupant) {
          liberties.add(neighbor);
          continue;
        }

        if (occupant === color && !visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }

    return {
      color,
      stones,
      liberties,
      anchor: stones[0],
    };
  }

  function collectGroups(board, size = BOARD_SIZE) {
    const groups = [];
    const visited = new Set();

    board.forEach((stone, index) => {
      if (!stone || visited.has(index)) {
        return;
      }

      const group = getGroup(board, index, size);
      group.stones.forEach((member) => visited.add(member));
      groups.push(group);
    });

    return groups;
  }

  function simulateMove(board, size, index, color, koReferenceHash) {
    if (index === null) {
      return {
        legal: true,
        isPass: true,
        board: board.slice(),
        hash: hashBoard(board),
        captured: [],
      };
    }

    if (board[index]) {
      return { legal: false, reason: "occupied" };
    }

    const working = board.slice();
    const opponent = otherColor(color);
    const capturedSet = new Set();
    working[index] = color;

    for (const neighbor of getNeighbors(index, size)) {
      if (working[neighbor] !== opponent) {
        continue;
      }

      const enemyGroup = getGroup(working, neighbor, size);

      if (enemyGroup.liberties.size === 0) {
        enemyGroup.stones.forEach((stoneIndex) => capturedSet.add(stoneIndex));
      }
    }

    capturedSet.forEach((stoneIndex) => {
      working[stoneIndex] = null;
    });

    const selfGroup = getGroup(working, index, size);

    if (!selfGroup || selfGroup.liberties.size === 0) {
      return { legal: false, reason: "suicide" };
    }

    const nextHash = hashBoard(working);

    if (koReferenceHash && nextHash === koReferenceHash) {
      return { legal: false, reason: "ko" };
    }

    return {
      legal: true,
      isPass: false,
      board: working,
      hash: nextHash,
      captured: Array.from(capturedSet),
      selfGroup,
    };
  }

  function estimateScore(snapshot) {
    const board = snapshot.board;
    const visited = new Set();
    let blackStones = 0;
    let whiteStones = 0;
    let blackTerritory = 0;
    let whiteTerritory = 0;

    board.forEach((stone) => {
      if (stone === "black") {
        blackStones += 1;
      }
      if (stone === "white") {
        whiteStones += 1;
      }
    });

    board.forEach((stone, index) => {
      if (stone || visited.has(index)) {
        return;
      }

      const queue = [index];
      const region = [];
      const borders = new Set();
      visited.add(index);

      while (queue.length) {
        const current = queue.pop();
        region.push(current);

        for (const neighbor of getNeighbors(current, snapshot.size)) {
          const occupant = board[neighbor];

          if (!occupant && !visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
            continue;
          }

          if (occupant) {
            borders.add(occupant);
          }
        }
      }

      if (borders.size === 1) {
        const [owner] = Array.from(borders);
        if (owner === "black") {
          blackTerritory += region.length;
        } else {
          whiteTerritory += region.length;
        }
      }
    });

    const blackTotal = blackStones + blackTerritory;
    const whiteTotal = whiteStones + whiteTerritory + WHITE_KOMI;

    return {
      blackStones,
      whiteStones,
      blackTerritory,
      whiteTerritory,
      blackTotal,
      whiteTotal,
      margin: blackTotal - whiteTotal,
    };
  }

  function getDeadStoneSet(snapshot) {
    return new Set(
      Array.isArray(snapshot.scoring?.deadStones) ? snapshot.scoring.deadStones : []
    );
  }

  function analyzeScoring(snapshot) {
    const deadStones = getDeadStoneSet(snapshot);
    const effectiveBoard = snapshot.board.map((stone, index) =>
      deadStones.has(index) ? null : stone
    );
    const territoryMap = Array(snapshot.size * snapshot.size).fill(null);
    const visited = new Set();
    let blackAlive = 0;
    let whiteAlive = 0;
    let blackDead = 0;
    let whiteDead = 0;
    let blackTerritory = 0;
    let whiteTerritory = 0;
    let neutralPoints = 0;

    snapshot.board.forEach((stone, index) => {
      if (deadStones.has(index)) {
        if (stone === "black") {
          blackDead += 1;
        } else if (stone === "white") {
          whiteDead += 1;
        }
        return;
      }

      if (stone === "black") {
        blackAlive += 1;
      } else if (stone === "white") {
        whiteAlive += 1;
      }
    });

    effectiveBoard.forEach((stone, index) => {
      if (stone || visited.has(index)) {
        return;
      }

      const queue = [index];
      const region = [];
      const borders = new Set();
      visited.add(index);

      while (queue.length) {
        const current = queue.pop();
        region.push(current);

        for (const neighbor of getNeighbors(current, snapshot.size)) {
          const occupant = effectiveBoard[neighbor];

          if (!occupant && !visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
            continue;
          }

          if (occupant) {
            borders.add(occupant);
          }
        }
      }

      if (borders.size === 1) {
        const [owner] = Array.from(borders);

        region.forEach((point) => {
          territoryMap[point] = owner;
        });

        if (owner === "black") {
          blackTerritory += region.length;
        } else {
          whiteTerritory += region.length;
        }
      } else {
        neutralPoints += region.length;
      }
    });

    const blackTotal = blackAlive + blackTerritory;
    const whiteTotal = whiteAlive + whiteTerritory + WHITE_KOMI;

    return {
      effectiveBoard,
      territoryMap,
      blackAlive,
      whiteAlive,
      blackDead,
      whiteDead,
      blackTerritory,
      whiteTerritory,
      neutralPoints,
      blackTotal,
      whiteTotal,
      margin: blackTotal - whiteTotal,
    };
  }

  function createWinnerTextFromMargin(margin) {
    if (margin > 0) {
      return `ดำชนะประมาณ ${margin.toFixed(1)} แต้ม`;
    }

    if (margin < 0) {
      return `ขาวชนะประมาณ ${Math.abs(margin).toFixed(1)} แต้ม`;
    }

    return "คะแนนสูสีกันมาก";
  }

  function listLegalMoves(snapshot, color) {
    const legalMoves = [];

    snapshot.board.forEach((stone, index) => {
      if (stone) {
        return;
      }

      const result = simulateMove(
        snapshot.board,
        snapshot.size,
        index,
        color,
        snapshot.previousBoardHash
      );

      if (result.legal) {
        legalMoves.push({ index, result });
      }
    });

    return legalMoves;
  }

  function describeMoveReasons(metrics) {
    const reasons = [];

    if (metrics.captured > 0) {
      reasons.push(`กินได้ทันที ${metrics.captured} เม็ด`);
    }
    if (metrics.escapeBonus >= 3) {
      reasons.push("ช่วยพยุงกลุ่มที่กำลังหายใจน้อย");
    }
    if (metrics.pressureBonus >= 3) {
      reasons.push("กดเสรีภาพของกลุ่มคู่แข่งได้แรง");
    }
    if (metrics.connectionBonus >= 2) {
      reasons.push("เชื่อมกลุ่มตัวเองให้หนาแน่นขึ้น");
    }
    if (metrics.territoryDelta >= 1.2) {
      reasons.push("ทำให้คะแนนประมาณการดีขึ้น");
    }
    if (metrics.centerBonus >= 1.4) {
      reasons.push("ยึดพื้นที่กลางกระดานได้ดี");
    }

    return reasons.slice(0, 2);
  }

  function evaluateMove(snapshot, moveResult, color) {
    const before = estimateScore(snapshot);
    const nextSnapshot = { ...snapshot, board: moveResult.board };
    const after = estimateScore(nextSnapshot);
    const beforeMargin = color === "black" ? before.margin : -before.margin;
    const afterMargin = color === "black" ? after.margin : -after.margin;
    const territoryDelta = afterMargin - beforeMargin;
    const row = Math.floor(moveResult.selfGroup.anchor / snapshot.size);
    const col = moveResult.selfGroup.anchor % snapshot.size;
    const center = (snapshot.size - 1) / 2;
    const centerDistance = Math.abs(center - row) + Math.abs(center - col);
    const centerBonus = Math.max(0, 3.2 - centerDistance * 0.6);
    const selfLiberties = moveResult.selfGroup.liberties.size;
    const adjacentFriendRoots = new Set();
    let pressureBonus = 0;
    let escapeBonus = 0;

    for (const neighbor of getNeighbors(moveResult.selfGroup.anchor, snapshot.size)) {
      const occupant = snapshot.board[neighbor];

      if (occupant === color) {
        const friendlyGroup = getGroup(snapshot.board, neighbor, snapshot.size);
        adjacentFriendRoots.add(friendlyGroup.anchor);

        if (friendlyGroup.liberties.size <= 2 && selfLiberties >= 3) {
          escapeBonus += 2.2;
        }
      }

      if (occupant === otherColor(color)) {
        const enemyGroup = getGroup(snapshot.board, neighbor, snapshot.size);

        if (enemyGroup.liberties.size === 2) {
          pressureBonus += 2.6;
        } else if (enemyGroup.liberties.size === 3) {
          pressureBonus += 1.2;
        }
      }
    }

    const connectionBonus = Math.max(0, adjacentFriendRoots.size - 1) * 2.4;
    const edgeDistance = Math.min(
      row,
      col,
      snapshot.size - 1 - row,
      snapshot.size - 1 - col
    );
    const shapeBonus = edgeDistance === 0 ? -0.9 : edgeDistance === 1 ? 0.3 : 0.9;
    const score =
      moveResult.captured.length * 19 +
      selfLiberties * 1.25 +
      territoryDelta * 4.4 +
      centerBonus +
      pressureBonus +
      escapeBonus +
      connectionBonus +
      shapeBonus +
      Math.random() * 0.18;

    return {
      score,
      metrics: {
        captured: moveResult.captured.length,
        selfLiberties,
        territoryDelta,
        centerBonus,
        pressureBonus,
        escapeBonus,
        connectionBonus,
      },
    };
  }

  function chooseStrategicMove(snapshot, color) {
    const legalMoves = listLegalMoves(snapshot, color);

    if (!legalMoves.length) {
      return {
        type: "pass",
        explanation: "ไม่มีจุดที่ลงได้โดยไม่ผิดกติกา จึงขอผ่านตานี้",
      };
    }

    const ranked = legalMoves
      .map(({ index, result }) => {
        const evaluation = evaluateMove(snapshot, result, color);
        return {
          index,
          result,
          score: evaluation.score,
          metrics: evaluation.metrics,
        };
      })
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];

    if (snapshot.consecutivePasses === 1 && best.score < 3.8) {
      return {
        type: "pass",
        explanation: "รูปกระดานค่อนข้างนิ่งแล้ว ผมขอผ่านเพื่อปิดเกม",
      };
    }

    const reasons = describeMoveReasons(best.metrics);
    const coord = indexToCoord(best.index, snapshot.size);
    const explanation =
      reasons.length > 0
        ? `ผมชอบ ${coord} เพราะ${reasons.join(" และ ")}`
        : `ผมเลือก ${coord} เพื่อรักษาสมดุลของพื้นที่และเสรีภาพ`;

    return {
      type: "move",
      index: best.index,
      coord,
      explanation,
      metrics: best.metrics,
    };
  }

  function countEmptyPoints(snapshot) {
    let emptyCount = 0;

    snapshot.board.forEach((stone) => {
      if (!stone) {
        emptyCount += 1;
      }
    });

    return emptyCount;
  }

  function createSnapshotAfterMove(snapshot, color, moveResult, index) {
    const capturedCount = moveResult.captured.length;
    const consecutivePasses = moveResult.isPass ? snapshot.consecutivePasses + 1 : 0;

    return {
      ...snapshot,
      board: moveResult.board,
      boardHash: moveResult.hash,
      previousBoardHash: snapshot.boardHash,
      currentPlayer: otherColor(color),
      captures: {
        ...snapshot.captures,
        [color]: snapshot.captures[color] + capturedCount,
      },
      turn: snapshot.turn + 1,
      consecutivePasses,
      gameOver: consecutivePasses >= 2,
      lastMove: moveResult.isPass
        ? {
            isPass: true,
            color,
          }
        : {
            isPass: false,
            color,
            index,
            coord: indexToCoord(index, snapshot.size),
          },
    };
  }

  function evaluateGroupValue(group, perspectiveColor) {
    const liberties = group.liberties.size;
    const size = group.stones.length;
    const ownGroup = group.color === perspectiveColor;
    let value = size * 3.1;

    if (liberties === 1) {
      value -= ownGroup ? 28 + size * 8.5 : 9 + size * 3.5;
    } else if (liberties === 2) {
      value -= ownGroup ? 12 + size * 4.4 : 4.5 + size * 1.9;
    } else if (liberties === 3) {
      value += 1.8 + size * 0.4;
    } else {
      value += Math.min(liberties, 6) * 2.2;
    }

    if (liberties >= 2 && size >= 2) {
      value += Math.min(liberties, 5) * Math.min(size, 4) * 0.45;
    }

    return value;
  }

  function getBoundedMargin(snapshot, perspectiveColor, estimate = estimateScore(snapshot)) {
    const rawMargin = perspectiveColor === "black" ? estimate.margin : -estimate.margin;
    const emptyCount = countEmptyPoints(snapshot);
    const clamp =
      emptyCount > 60 ? 3.5 : emptyCount > 45 ? 6 : emptyCount > 25 ? 10 : 20;

    return Math.max(-clamp, Math.min(clamp, rawMargin));
  }

  function evaluateBoard(snapshot, perspectiveColor) {
    const estimate = estimateScore(snapshot);
    const scoreMargin = getBoundedMargin(snapshot, perspectiveColor, estimate);
    const captureMargin =
      snapshot.captures[perspectiveColor] - snapshot.captures[otherColor(perspectiveColor)];
    const emptyCount = countEmptyPoints(snapshot);
    const territoryWeight = emptyCount > 50 ? 4.8 : emptyCount > 28 ? 7.2 : 10.2;
    let groupScore = 0;
    let tacticalScore = 0;

    for (const group of collectGroups(snapshot.board, snapshot.size)) {
      const sign = group.color === perspectiveColor ? 1 : -1;
      const liberties = group.liberties.size;
      const ownGroup = group.color === perspectiveColor;
      groupScore += sign * evaluateGroupValue(group, perspectiveColor);

      if (liberties === 1) {
        tacticalScore += ownGroup ? -16 : 7;
      } else if (liberties === 2) {
        tacticalScore += ownGroup ? -5 : 2;
      }
    }

    return scoreMargin * territoryWeight + captureMargin * 6.8 + groupScore + tacticalScore;
  }

  function collectUrgentMoveMap(snapshot, color) {
    const urgentMap = new Map();

    for (const group of collectGroups(snapshot.board, snapshot.size)) {
      const libertyCount = group.liberties.size;

      if (libertyCount > 3) {
        continue;
      }

      const severity =
        libertyCount === 1
          ? 18 + group.stones.length * 2.5
          : libertyCount === 2
            ? 9 + group.stones.length * 1.8
            : 3 + group.stones.length * 0.7;

      group.liberties.forEach((libertyIndex) => {
        const entry = urgentMap.get(libertyIndex) || { attack: 0, defense: 0 };

        if (group.color === color) {
          entry.defense += severity;
        } else {
          entry.attack += severity;
        }

        urgentMap.set(libertyIndex, entry);
      });
    }

    return urgentMap;
  }

  function getPositionalMoveBonus(snapshot, index, emptyCount) {
    const row = Math.floor(index / snapshot.size);
    const col = index % snapshot.size;
    const edgeDistance = Math.min(
      row,
      col,
      snapshot.size - 1 - row,
      snapshot.size - 1 - col
    );

    if (emptyCount >= 66) {
      if (STAR_POINTS.has(index)) {
        return 4.2;
      }
      if (edgeDistance === 2) {
        return 3.1;
      }
      if (edgeDistance === 1) {
        return 1.6;
      }
      if (edgeDistance === 0) {
        return -2.4;
      }
      return -1.5;
    }

    if (emptyCount >= 42) {
      if (STAR_POINTS.has(index)) {
        return 2.5;
      }
      if (edgeDistance === 2) {
        return 2.1;
      }
      if (edgeDistance === 1) {
        return 1.1;
      }
      if (edgeDistance === 0) {
        return -1.4;
      }
      return 0.6;
    }

    if (edgeDistance === 0) {
      return -0.8;
    }
    if (edgeDistance === 1) {
      return 0.6;
    }
    if (edgeDistance === 2) {
      return 1.2;
    }

    return 0.9;
  }

  function evaluateMove(snapshot, index, moveResult, color, context = {}) {
    const beforeEstimate = context.beforeEstimate || estimateScore(snapshot);
    const baselineScore =
      typeof context.baselineScore === "number"
        ? context.baselineScore
        : evaluateBoard(snapshot, color);
    const urgentEntry = context.urgentMoves?.get(index) || { attack: 0, defense: 0 };
    const emptyCount =
      typeof context.emptyCount === "number" ? context.emptyCount : countEmptyPoints(snapshot);
    const nextSnapshot = createSnapshotAfterMove(snapshot, color, moveResult, index);
    const afterEstimate = estimateScore(nextSnapshot);
    const boardScore = evaluateBoard(nextSnapshot, color);
    const boardDelta = boardScore - baselineScore;
    const beforeMargin = getBoundedMargin(snapshot, color, beforeEstimate);
    const afterMargin = getBoundedMargin(nextSnapshot, color, afterEstimate);
    const territoryDelta = afterMargin - beforeMargin;
    const selfLiberties = moveResult.selfGroup.liberties.size;
    const adjacentFriendRoots = new Set();
    const adjacentEnemyRoots = new Set();
    const adjacentOccupiedCount = getNeighbors(index, snapshot.size).filter(
      (neighbor) => snapshot.board[neighbor]
    ).length;
    let pressureBonus = 0;
    let escapeBonus = 0;
    let opponentAtariCount = 0;

    for (const neighbor of getNeighbors(index, snapshot.size)) {
      const occupant = snapshot.board[neighbor];

      if (occupant === color) {
        const friendlyGroup = getGroup(snapshot.board, neighbor, snapshot.size);
        adjacentFriendRoots.add(friendlyGroup.anchor);

        if (friendlyGroup.liberties.size <= 2 && selfLiberties >= 3) {
          escapeBonus += 3.2;
        }
      }

      if (occupant === otherColor(color)) {
        const enemyGroupBefore = getGroup(snapshot.board, neighbor, snapshot.size);

        if (adjacentEnemyRoots.has(enemyGroupBefore.anchor)) {
          continue;
        }

        adjacentEnemyRoots.add(enemyGroupBefore.anchor);

        const enemyGroupAfter =
          nextSnapshot.board[neighbor] === otherColor(color)
            ? getGroup(nextSnapshot.board, neighbor, snapshot.size)
            : null;

        if (!enemyGroupAfter) {
          pressureBonus += 6 + enemyGroupBefore.stones.length * 1.4;
          continue;
        }

        if (enemyGroupAfter.liberties.size === 1) {
          opponentAtariCount += 1;
          pressureBonus += 5.4 + enemyGroupAfter.stones.length * 1.1;
        } else if (enemyGroupAfter.liberties.size === 2) {
          pressureBonus += 2.6;
        }
      }
    }

    const connectionBonus = Math.max(0, adjacentFriendRoots.size - 1) * 3.1;
    const positionalBonus = getPositionalMoveBonus(snapshot, index, emptyCount);
    const contactPenalty =
      adjacentOccupiedCount === 0
        ? emptyCount >= 60
          ? 0
          : emptyCount >= 36
            ? 0.8
            : 2.1
        : 0;
    const selfAtariPenalty =
      selfLiberties === 1 ? Math.max(0, 19 - moveResult.captured.length * 5) : 0;
    const score =
      boardDelta * 1.1 +
      moveResult.captured.length * 18 +
      selfLiberties * 1.15 +
      territoryDelta * 2.6 +
      pressureBonus +
      escapeBonus +
      connectionBonus +
      positionalBonus +
      urgentEntry.attack * 1.15 +
      urgentEntry.defense * 1.1 +
      opponentAtariCount * 7 -
      selfAtariPenalty -
      contactPenalty;

    return {
      score,
      metrics: {
        captured: moveResult.captured.length,
        selfLiberties,
        territoryDelta,
        pressureBonus,
        escapeBonus,
        connectionBonus,
        positionalBonus,
        attackUrgencyBonus: urgentEntry.attack,
        defenseUrgencyBonus: urgentEntry.defense,
        opponentAtariCount,
        boardDelta,
        boardScore,
      },
    };
  }

  function listInterestingMoves(snapshot, color) {
    const candidateIndices = new Set();
    const occupiedCount = snapshot.board.filter(Boolean).length;

    snapshot.board.forEach((stone, index) => {
      if (!stone) {
        return;
      }

      for (const neighbor of getNeighbors(index, snapshot.size)) {
        if (!snapshot.board[neighbor]) {
          candidateIndices.add(neighbor);
        }

        for (const secondary of getNeighbors(neighbor, snapshot.size)) {
          if (!snapshot.board[secondary]) {
            candidateIndices.add(secondary);
          }
        }
      }
    });

    for (const group of collectGroups(snapshot.board, snapshot.size)) {
      if (group.liberties.size <= 3) {
        group.liberties.forEach((libertyIndex) => candidateIndices.add(libertyIndex));
      }
    }

    if (occupiedCount <= 6) {
      [0, 2, 6, 8, 18, 20, 24, 40, 56, 60, 62, 72, 74, 78, 80].forEach((index) => {
        if (!snapshot.board[index]) {
          candidateIndices.add(index);
        }
      });
    }

    if (!candidateIndices.size) {
      return listLegalMoves(snapshot, color);
    }

    const interestingMoves = [];

    candidateIndices.forEach((index) => {
      const result = simulateMove(
        snapshot.board,
        snapshot.size,
        index,
        color,
        snapshot.previousBoardHash
      );

      if (result.legal) {
        interestingMoves.push({ index, result });
      }
    });

    return interestingMoves.length ? interestingMoves : listLegalMoves(snapshot, color);
  }

  function rankMovesStatic(snapshot, color, options = {}) {
    const movePool = options.onlyInteresting
      ? listInterestingMoves(snapshot, color)
      : listLegalMoves(snapshot, color);

    if (!movePool.length) {
      return [];
    }

    const context = {
      beforeEstimate: estimateScore(snapshot),
      baselineScore: evaluateBoard(snapshot, color),
      urgentMoves: collectUrgentMoveMap(snapshot, color),
      emptyCount: countEmptyPoints(snapshot),
    };

    return movePool
      .map(({ index, result }) => {
        const evaluation = evaluateMove(snapshot, index, result, color, context);
        return {
          index,
          result,
          score: evaluation.score,
          metrics: evaluation.metrics,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.metrics.boardDelta - a.metrics.boardDelta ||
          b.metrics.captured - a.metrics.captured
      );
  }

  function hasCriticalGroups(snapshot) {
    return collectGroups(snapshot.board, snapshot.size).some(
      (group) => group.liberties.size <= 2
    );
  }

  function getSearchDepth(snapshot) {
    const emptyCount = countEmptyPoints(snapshot);
    const critical = hasCriticalGroups(snapshot);

    if (emptyCount > 60) {
      return critical ? 3 : 2;
    }

    if (emptyCount > 26) {
      return 3;
    }

    return critical ? 3 : 2;
  }

  function getSearchCandidateLimit(snapshot, depth) {
    const emptyCount = countEmptyPoints(snapshot);

    if (depth >= 3) {
      return emptyCount > 45 ? 6 : emptyCount > 24 ? 7 : 8;
    }

    return emptyCount > 45 ? 7 : 9;
  }

  function isUrgentCandidate(move) {
    return (
      move.metrics.captured > 0 ||
      move.metrics.opponentAtariCount > 0 ||
      move.metrics.attackUrgencyBonus >= 8 ||
      move.metrics.defenseUrgencyBonus >= 8
    );
  }

  function selectSearchCandidates(snapshot, rankedMoves, depth) {
    const limit = getSearchCandidateLimit(snapshot, depth);
    const selected = rankedMoves.slice(0, limit);
    const seen = new Set(selected.map((move) => move.index));

    for (const move of rankedMoves) {
      if (selected.length >= limit + 4) {
        break;
      }

      if (!isUrgentCandidate(move) || seen.has(move.index)) {
        continue;
      }

      selected.push(move);
      seen.add(move.index);
    }

    return selected;
  }

  function searchPosition(snapshot, colorToPlay, rootColor, depth, alpha, beta, cache) {
    const cacheKey = [
      snapshot.boardHash,
      snapshot.previousBoardHash || "",
      colorToPlay,
      depth,
      snapshot.consecutivePasses,
    ].join("|");
    const cachedScore = cache.get(cacheKey);

    if (typeof cachedScore === "number") {
      return cachedScore;
    }

    if (depth <= 0 || snapshot.gameOver) {
      const leafScore = evaluateBoard(snapshot, rootColor);
      cache.set(cacheKey, leafScore);
      return leafScore;
    }

    const rankedMoves = rankMovesStatic(snapshot, colorToPlay, { onlyInteresting: true });

    if (!rankedMoves.length) {
      const fallbackScore = evaluateBoard(snapshot, rootColor);
      cache.set(cacheKey, fallbackScore);
      return fallbackScore;
    }

    const candidates = selectSearchCandidates(snapshot, rankedMoves, depth);
    const maximizing = colorToPlay === rootColor;
    let bestScore = maximizing ? -Infinity : Infinity;

    for (const candidate of candidates) {
      const nextSnapshot = createSnapshotAfterMove(
        snapshot,
        colorToPlay,
        candidate.result,
        candidate.index
      );
      const replyScore = searchPosition(
        nextSnapshot,
        otherColor(colorToPlay),
        rootColor,
        depth - 1,
        alpha,
        beta,
        cache
      );

      if (maximizing) {
        bestScore = Math.max(bestScore, replyScore);
        alpha = Math.max(alpha, bestScore);
      } else {
        bestScore = Math.min(bestScore, replyScore);
        beta = Math.min(beta, bestScore);
      }

      if (beta <= alpha) {
        break;
      }
    }

    cache.set(cacheKey, bestScore);
    return bestScore;
  }

  function describeMoveReasons(metrics) {
    const reasons = [];

    if (metrics.captured > 0) {
      reasons.push(`กินได้ทันที ${metrics.captured} เม็ด`);
    }
    if (metrics.defenseUrgencyBonus >= 8 || metrics.escapeBonus >= 3) {
      reasons.push("ช่วยประคองกลุ่มตัวเองที่กำลังลำบาก");
    }
    if (
      metrics.attackUrgencyBonus >= 8 ||
      metrics.opponentAtariCount > 0 ||
      metrics.pressureBonus >= 4
    ) {
      reasons.push("กดดันกลุ่มคู่แข่งที่กำลังอ่อนแรง");
    }
    if (metrics.connectionBonus >= 2.5) {
      reasons.push("เชื่อมกลุ่มตัวเองให้แน่นขึ้น");
    }
    if (metrics.boardDelta >= 8 || metrics.territoryDelta >= 1.5) {
      reasons.push("ทำให้ภาพรวมของกระดานดีขึ้น");
    }
    if (metrics.positionalBonus >= 2.4) {
      reasons.push("ได้ตำแหน่งเชิงเปิดกระดานที่ดี");
    }

    return reasons.slice(0, 2);
  }

  function chooseStrategicMove(snapshot, color) {
    const rankedMoves = rankMovesStatic(snapshot, color);

    if (!rankedMoves.length) {
      return {
        type: "pass",
        explanation: "ไม่มีจุดที่ลงได้โดยไม่ผิดกติกา จึงขอผ่านตานี้",
      };
    }

    const depth = getSearchDepth(snapshot);
    const searchCandidates = selectSearchCandidates(snapshot, rankedMoves, depth);
    const searchCache = new Map();
    let bestMove = null;

    for (const candidate of searchCandidates) {
      const nextSnapshot = createSnapshotAfterMove(
        snapshot,
        color,
        candidate.result,
        candidate.index
      );
      const searchScore =
        depth > 1
          ? searchPosition(
              nextSnapshot,
              otherColor(color),
              color,
              depth - 1,
              -Infinity,
              Infinity,
              searchCache
            )
          : evaluateBoard(nextSnapshot, color);
      const combinedScore = searchScore + candidate.score * 0.08;

      if (
        !bestMove ||
        combinedScore > bestMove.combinedScore ||
        (combinedScore === bestMove.combinedScore && candidate.score > bestMove.score)
      ) {
        bestMove = {
          ...candidate,
          combinedScore,
          searchScore,
        };
      }
    }

    const fallbackMove = bestMove || rankedMoves[0];
    const emptyCount = countEmptyPoints(snapshot);

    if (
      snapshot.consecutivePasses === 1 &&
      emptyCount <= 16 &&
      fallbackMove.metrics.boardDelta < 2.5
    ) {
      return {
        type: "pass",
        explanation: "รูปกระดานค่อนข้างนิ่งแล้ว ผมขอผ่านเพื่อปิดเกมตานี้",
      };
    }

    const reasons = describeMoveReasons(fallbackMove.metrics);
    const coord = indexToCoord(fallbackMove.index, snapshot.size);
    const explanation =
      reasons.length > 0
        ? `ผมชอบ ${coord} เพราะ${reasons.join(" และ ")}`
        : `ผมเลือก ${coord} เพราะอ่านลำดับตาต่อเนื่องแล้วสมดุลที่สุดในตำแหน่งนี้`;

    return {
      type: "move",
      index: fallbackMove.index,
      coord,
      explanation,
      metrics: {
        ...fallbackMove.metrics,
        searchScore: fallbackMove.searchScore,
      },
    };
  }

  function analyzeGroups(snapshot) {
    return collectGroups(snapshot.board, snapshot.size)
      .map((group) => ({
        ...group,
        libertyCount: group.liberties.size,
      }))
      .sort((a, b) => a.libertyCount - b.libertyCount || b.stones.length - a.stones.length);
  }

  function summarizeDanger(snapshot) {
    const groups = analyzeGroups(snapshot);
    const myWeakest = groups.find(
      (group) => group.color === snapshot.humanColor && group.libertyCount <= 2
    );
    const enemyWeakest = groups.find(
      (group) => group.color === snapshot.aiColor && group.libertyCount <= 2
    );

    if (myWeakest) {
      const escapePoint = Array.from(myWeakest.liberties)[0];
      return `กลุ่มดำแถว ${indexToCoord(myWeakest.anchor, snapshot.size)} กำลังอันตราย เหลือ ${myWeakest.libertyCount} เสรีภาพ${
        typeof escapePoint === "number"
          ? ` ลองมองจุด ${indexToCoord(escapePoint, snapshot.size)} เพื่อหายใจเพิ่ม`
          : ""
      }`;
    }

    if (enemyWeakest) {
      const attackPoint = Array.from(enemyWeakest.liberties)[0];
      return `กลุ่มขาวแถว ${indexToCoord(enemyWeakest.anchor, snapshot.size)} เริ่มอึดอัด เหลือ ${enemyWeakest.libertyCount} เสรีภาพ${
        typeof attackPoint === "number"
          ? ` ถ้าได้จังหวะ ลองกดที่ ${indexToCoord(attackPoint, snapshot.size)}`
          : ""
      }`;
    }

    return "ตอนนี้ยังไม่มีกลุ่มไหนอยู่ในภาวะฉุกเฉินมาก กระดานค่อนข้างสมดุล";
  }

  function updateStatusNote(text) {
    dom.statusNote.textContent = text;
  }

  function getBoardAiLabel() {
    return appConfig.boardAiLabel || appConfig.moveModel || "remote board AI";
  }

  function updateAiMood() {
    if (chatThinking || aiThinking) {
      dom.aiMood.textContent = "Thinking";
      return;
    }

    if (state.scoring?.active && !state.gameOver) {
      dom.aiMood.textContent = "Scoring";
      return;
    }

    if (appConfig.boardAiApiEnabled) {
      dom.aiMood.textContent =
        appConfig.boardAiProvider === "katago" ? "KataGo" : "Live Board AI";
      return;
    }

    if (appConfig.chatApiEnabled) {
      dom.aiMood.textContent = "Live Chat";
      return;
    }

    if (appConfig.serverAvailable) {
      dom.aiMood.textContent = "Local Fallback";
      return;
    }

    dom.aiMood.textContent = "Offline";
  }

  function renderSessionSummary() {
    dom.playerSeatBadge.textContent = "You: Black • AI: White";

    if (state.gameOver) {
      dom.modeBadge.textContent = "Game finished";
    } else if (state.scoring?.active) {
      dom.modeBadge.textContent = "Score review";
    } else if (aiThinking) {
      dom.modeBadge.textContent = "AI is thinking";
    } else if (chatThinking) {
      dom.modeBadge.textContent = "Sensei is replying";
    } else if (state.currentPlayer === state.humanColor) {
      dom.modeBadge.textContent = "Your move";
    } else {
      dom.modeBadge.textContent = "Waiting for AI";
    }

    if (appConfig.boardAiApiEnabled && appConfig.chatApiEnabled) {
      dom.providerBadge.textContent = `Chat: ${appConfig.model || "Remote AI"} • Board: ${getBoardAiLabel()}`;
      return;
    }

    if (appConfig.boardAiApiEnabled) {
      dom.providerBadge.textContent = `Board AI: ${getBoardAiLabel()}`;
      return;
    }

    if (appConfig.chatApiEnabled) {
      dom.providerBadge.textContent = `Chat: ${appConfig.model || "Remote AI"} • Board: Local`;
      return;
    }

    if (appConfig.serverAvailable) {
      dom.providerBadge.textContent = "Server ready • local fallback";
      return;
    }

    dom.providerBadge.textContent = "Browser fallback only";
  }

  function setChatBusy(isBusy) {
    chatThinking = isBusy;
    dom.chatInput.disabled = isBusy;
    dom.chatSend.disabled = isBusy;
    dom.promptChips.forEach((chip) => {
      chip.disabled = isBusy;
    });
    updateAiMood();
    renderSessionSummary();
  }

  function addChatMessage(role, text, meta) {
    chatHistory.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text,
      meta,
    });
    renderChat();
  }

  function resetChat() {
    chatHistory = [];
    addChatMessage(
      "assistant",
      "ผมคือ Sensei Chat ลองเดินหมากทางซ้าย แล้วถามผมได้เลย เช่น “ตานี้ควรลงตรงไหน” หรือ “ตอนนี้ใครนำอยู่”",
      "AI Coach"
    );
    addChatMessage(
      "system",
      "กำลังตรวจสอบโหมดแชทอยู่ ถ้าเซิร์ฟเวอร์และ API พร้อม ระบบจะสลับไปใช้ AI จริงให้อัตโนมัติ",
      "System"
    );
  }

  function announceChatMode() {
    addChatMessage(
      "system",
      appConfig.apiEnabled
        ? appConfig.boardAiApiEnabled
          ? `เชื่อมต่อผู้ช่วยระยะไกลแล้ว แชทใช้ ${appConfig.model || "default model"} และ AI บนกระดานใช้ ${appConfig.moveModel || appConfig.model || "default model"}`
          : `เชื่อมต่อผู้ช่วยระยะไกลแล้ว รุ่นที่ใช้อยู่คือ ${appConfig.model || "default model"}`
        : appConfig.serverAvailable
          ? "เซิร์ฟเวอร์พร้อมแล้ว แต่ยังใช้ local fallback สำหรับแชทต่อไปก่อน"
          : "ยังไม่พบ backend ของโปรเจกต์นี้ ถ้าอยากใช้ Live API ให้รันผ่าน server แล้วเปิด http://localhost:3000",
      "System"
    );
  }

  function describeEstimate(snapshot) {
    const estimate = estimateScore(snapshot);
    const leader =
      estimate.margin > 0
        ? `ดำนำประมาณ ${estimate.margin.toFixed(1)} แต้ม`
        : estimate.margin < 0
          ? `ขาวนำประมาณ ${Math.abs(estimate.margin).toFixed(1)} แต้ม`
          : "คะแนนสูสีกันมาก";

    return {
      estimate,
      leader,
    };
  }

  function getBoardRows(snapshot) {
    const rows = [];

    for (let row = 0; row < snapshot.size; row += 1) {
      let line = "";

      for (let col = 0; col < snapshot.size; col += 1) {
        const stone = snapshot.board[row * snapshot.size + col];
        line += stone === "black" ? "B" : stone === "white" ? "W" : ".";
      }

      rows.push(`${snapshot.size - row}: ${line}`);
    }

    return rows;
  }

  function getRecentMoveLog(limit = 8) {
    return state.moveLog.slice(-limit).map((move) => {
      const color = move.color === "black" ? "B" : "W";
      return `${color}-${move.coord}`;
    });
  }

  function createBoardSnapshotForApi() {
    const estimateInfo = describeEstimate(state);

    return {
      size: state.size,
      boardRows: getBoardRows(state),
      currentPlayer: state.currentPlayer,
      lastMove: state.lastMove
        ? state.lastMove.isPass
          ? `${state.lastMove.color} pass`
          : `${state.lastMove.color} ${state.lastMove.coord}`
        : "none",
      captures: {
        black: state.captures.black,
        white: state.captures.white,
      },
      estimate: estimateInfo.estimate,
      leader: estimateInfo.leader,
      dangerSummary: summarizeDanger(state),
      moveLog: getRecentMoveLog(),
    };
  }

  function getConversationContext(limit = 6) {
    const visibleConversation = chatHistory.filter(
      (message) => message.role === "assistant" || message.role === "user"
    );
    return visibleConversation.slice(-limit);
  }

  function formatScoreHint(value) {
    return Number(value.toFixed(2));
  }

  function createLegalMovesSnapshot(snapshot, color) {
    const rankedMoves = rankMovesStatic(snapshot, color).map((move) => ({
      ...move,
      coord: indexToCoord(move.index, snapshot.size),
    }));

    return {
      allCoords: rankedMoves.map((move) => move.coord),
      shortlist: rankedMoves.slice(0, 12).map((move) => ({
        coord: move.coord,
        scoreHint: formatScoreHint(move.score),
        captured: move.metrics.captured,
        selfLiberties: move.metrics.selfLiberties,
        reasons: describeMoveReasons(move.metrics),
      })),
    };
  }

  function getRuleHelp() {
    return [
      "กติกาหลักของต้นแบบนี้คือ วางหมากสลับกันที่จุดตัด วงล้อมคู่แข่งให้หมดเสรีภาพเพื่อจับกิน",
      "ลงแบบ suicide ไม่ได้ ถ้าหมากที่เพิ่งวางไม่มีเสรีภาพและไม่ได้จับฝ่ายตรงข้าม ระบบจะไม่ยอมให้ลง",
      "กติกา ko จะกันไม่ให้คุณตอบโต้แล้วทำให้กระดานย้อนกลับเป็นรูปเดิมทันที",
      "ถ้าทั้งสองฝ่ายกด Pass ติดกันสองครั้ง เกมจะจบและระบบจะประเมินคะแนนให้อัตโนมัติ",
    ].join("\n");
  }

  async function fetchServerConfig() {
    try {
      const response = await fetch("./api/config");

      if (!response.ok) {
        throw new Error(`Config request failed with ${response.status}`);
      }

      const payload = await response.json();
      appConfig = {
        serverAvailable: true,
        apiEnabled: Boolean(payload.apiEnabled),
        model: payload.model || null,
        boardAiApiEnabled: Boolean(payload.boardAiApiEnabled),
        moveModel: payload.moveModel || null,
      };
    } catch (_error) {
      appConfig = {
        serverAvailable: false,
        apiEnabled: false,
        model: null,
        boardAiApiEnabled: false,
        moveModel: null,
      };
    }

    updateAiMood();
    renderSessionSummary();
    announceChatMode();
  }

  async function requestRemoteChatReply(userMessage) {
    const priorMessages = getConversationContext().slice(0, -1);
    const response = await fetch("./api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userMessage,
        messages: priorMessages,
        boardState: createBoardSnapshotForApi(),
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Live API request failed");
    }

    return {
      text: payload.text || "AI ไม่ส่งข้อความกลับมา",
      meta: payload.providerLabel || payload.model || "Remote AI",
    };
  }

  async function requestRemoteMove(color) {
    const legalMoves = createLegalMovesSnapshot(state, color);

    if (!legalMoves.allCoords.length) {
      return {
        type: "pass",
        explanation: "ไม่มีจุดที่ลงได้โดยไม่ผิดกติกา จึงขอผ่านตานี้",
        meta: "Remote AI",
      };
    }

    const response = await fetch("./api/move", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        playerColor: color,
        boardState: createBoardSnapshotForApi(),
        legalMoves,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Live move request failed");
    }

    return {
      type: payload.type === "move" ? "move" : "pass",
      coord: typeof payload.coord === "string" ? payload.coord : null,
      explanation: payload.explanation || "AI เลือกตาเดินใหม่",
      meta: payload.providerLabel || payload.model || "Remote AI",
    };
  }

  function getChatReply(rawText) {
    const text = rawText.trim();

    if (!text) {
      return {
        text: "พิมพ์คำถามสั้น ๆ ได้เลย เช่น “ช่วยแนะนำตาเดิน” หรือ “สรุปสถานะกระดาน”",
      };
    }

    if (/(ko|โค)/i.test(text)) {
      return {
        text: "กติกา ko ใช้กันลูปจับกินแบบเดิมทันที ถ้าคุณจะลงแล้วทำให้กระดานกลับไปเหมือนก่อนหน้าพอดี ระบบจะห้ามไว้ก่อน ต้องไปเล่นที่อื่นหนึ่งตาก่อนแล้วค่อยกลับมาใหม่",
      };
    }

    if (/(กติกา|เล่นยังไง|สอน|help|how)/i.test(text)) {
      return { text: getRuleHelp() };
    }

    if (/(ใครนำ|คะแนน|score|นำอยู่|territory|ประเมิน)/i.test(text)) {
      const summary = describeEstimate(state);
      return {
        text: `${summary.leader}\nดำ ${summary.estimate.blackTotal.toFixed(1)} | ขาว ${summary.estimate.whiteTotal.toFixed(1)} (รวม komi ${WHITE_KOMI} ให้ขาว)\n${summarizeDanger(state)}`,
      };
    }

    if (/(อันตราย|ตาย|liberty|หายใจ|กลุ่ม|capture|กิน)/i.test(text)) {
      return {
        text: summarizeDanger(state),
      };
    }

    if (/(แนะนำ|ไหนดี|ตาเดิน|suggest|move|ลงตรง)/i.test(text)) {
      if (state.gameOver) {
        return {
          text: "เกมนี้จบแล้ว ถ้าอยากลองอีกตา กด New Game แล้วผมจะช่วยดูให้ใหม่ทันที",
        };
      }

      if (state.currentPlayer !== state.humanColor) {
        return {
          text: "ตอนนี้เป็นตาของ AI อยู่ เดี๋ยวผมเดินให้ก่อน แล้วคุณค่อยถามหาตาแนะนำรอบถัดไป",
        };
      }

      const suggestion = chooseStrategicMove(state, state.humanColor);

      if (suggestion.type === "pass") {
        state.recommendedMove = null;
        renderBoard();
        return {
          text: `${suggestion.explanation}\nถ้าคุณรู้สึกว่าพื้นที่นิ่งแล้ว การกด Pass ก็สมเหตุสมผล`,
        };
      }

      state.recommendedMove = suggestion.index;
      renderBoard();
      return {
        text: `${suggestion.explanation}\nลองวางที่ ${suggestion.coord} แล้วดูว่าขาวจะตอบอย่างไร`,
      };
    }

    if (/(pass|ผ่าน)/i.test(text)) {
      return {
        text: "Pass คือการยอมไม่เดินตานี้ ถ้าทั้งสองฝ่าย Pass ติดต่อกันสองครั้ง เกมจะจบแล้วคำนวณคะแนนประมาณการให้ทันที",
      };
    }

    const estimate = describeEstimate(state);
    return {
      text: `ตอนนี้ ${estimate.leader}\nคุณลองถามต่อได้ เช่น “ช่วยแนะนำตาเดิน”, “จุดไหนอันตราย”, หรือ “อธิบายกติกา ko”`,
    };
  }

  function renderChat() {
    dom.chatMessages.replaceChildren();

    for (const message of chatHistory) {
      const wrapper = document.createElement("article");
      wrapper.className = `message ${message.role}`;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = message.meta || (message.role === "user" ? "You" : "Sensei");

      const bubble = document.createElement("div");
      bubble.className = "message-bubble";
      bubble.textContent = message.text;

      wrapper.append(meta, bubble);
      dom.chatMessages.append(wrapper);
    }

    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  function buildAxes() {
    COLUMN_LABELS.forEach((label) => {
      const span = document.createElement("span");
      span.textContent = label;
      dom.topAxis.append(span);
    });

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      const span = document.createElement("span");
      span.textContent = String(BOARD_SIZE - row);
      dom.leftAxis.append(span);
    }
  }

  function buildBoard() {
    for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index += 1) {
      const row = Math.floor(index / BOARD_SIZE);
      const col = index % BOARD_SIZE;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "intersection empty";
      button.dataset.index = String(index);
      button.setAttribute("aria-label", `play at ${indexToCoord(index)}`);

      if (row === 0) {
        button.classList.add("edge-top");
      }
      if (row === BOARD_SIZE - 1) {
        button.classList.add("edge-bottom");
      }
      if (col === 0) {
        button.classList.add("edge-left");
      }
      if (col === BOARD_SIZE - 1) {
        button.classList.add("edge-right");
      }
      if (STAR_POINTS.has(index)) {
        button.classList.add("star-point");
      }

      const ghostStone = document.createElement("span");
      ghostStone.className = "ghost-stone";

      const star = document.createElement("span");
      star.className = "star";
      star.hidden = !STAR_POINTS.has(index);

      button.append(ghostStone, star);
      button.addEventListener("click", () => handleBoardClick(index));
      dom.board.append(button);
      cellElements.push(button);
    }
  }

  function handleBoardClick(index) {
    if (state.scoring?.active && !state.gameOver) {
      handleDeadStoneToggle(index);
      return;
    }

    handleHumanMove(index);
  }

  function renderBoard() {
    dom.board.dataset.turn = state.currentPlayer;
    dom.board.dataset.mode = state.scoring?.active ? "scoring" : "play";
    const scoring = state.scoring?.active ? analyzeScoring(state) : null;
    const deadStones = state.scoring?.active ? getDeadStoneSet(state) : null;

    state.board.forEach((stone, index) => {
      const cell = cellElements[index];
      cell.classList.remove(
        "empty",
        "is-last-move",
        "is-recommended",
        "is-legal-hint",
        "territory-black",
        "territory-white",
        "is-dead",
        "is-score-selectable"
      );
      cell.disabled = state.gameOver
        ? true
        : aiThinking || chatThinking
          ? true
          : state.scoring?.active
            ? !stone
            : state.currentPlayer !== state.humanColor;

      const existingStone = cell.querySelector(".stone");
      const existingPulse = cell.querySelector(".pulse-ring");

      if (existingStone) {
        existingStone.remove();
      }
      if (existingPulse) {
        existingPulse.remove();
      }

      if (!stone) {
        cell.classList.add("empty");
      } else {
        const stoneElement = document.createElement("span");
        stoneElement.className = `stone ${stone}`;
        cell.append(stoneElement);

        if (deadStones?.has(index)) {
          cell.classList.add("is-dead");
        }

        if (state.scoring?.active && !state.gameOver) {
          cell.classList.add("is-score-selectable");
        }
      }

      if (state.lastMove && !state.lastMove.isPass && state.lastMove.index === index) {
        cell.classList.add("is-last-move");
      }

      if (!stone && state.recommendedMove === index) {
        cell.classList.add("is-recommended");
        const pulse = document.createElement("span");
        pulse.className = "pulse-ring";
        cell.append(pulse);
      }

      if (!stone && scoring?.territoryMap[index] === "black") {
        cell.classList.add("territory-black");
      } else if (!stone && scoring?.territoryMap[index] === "white") {
        cell.classList.add("territory-white");
      }
    });
  }

  function renderStatus() {
    const estimateInfo = describeEstimate(state);
    const scoring = state.scoring?.active ? analyzeScoring(state) : null;
    const latest = state.lastMove;
    const currentTurnText = state.gameOver
      ? state.winnerText
      : aiThinking
        ? "AI กำลังคิดตาเดิน..."
        : state.currentPlayer === state.humanColor
          ? "ตาของคุณ (ดำ)"
          : "ตาของ AI (ขาว)";

    dom.turnStatus.textContent = state.scoring?.active
      ? state.gameOver
        ? state.winnerText
        : "Score review"
      : currentTurnText;
    dom.captureStatus.textContent = `B ${state.captures.black} | W ${state.captures.white}`;
    dom.scoreStatus.textContent = state.scoring?.active
      ? `B ${scoring.blackTotal.toFixed(1)} | W ${scoring.whiteTotal.toFixed(1)}`
      : `B ${estimateInfo.estimate.blackTotal.toFixed(1)} | W ${estimateInfo.estimate.whiteTotal.toFixed(1)}`;
    dom.lastMoveStatus.textContent = latest
      ? latest.isPass
        ? `${latest.color === "black" ? "ดำ" : "ขาว"} Pass`
        : `${latest.color === "black" ? "ดำ" : "ขาว"} ที่ ${latest.coord}`
      : "ยังไม่มีตาเดิน";

    if (state.scoring?.active) {
      dom.lastMoveStatus.textContent = state.gameOver ? "Score confirmed" : "Mark dead groups";
    }

    dom.passButton.disabled =
      state.gameOver ||
      state.scoring?.active ||
      aiThinking ||
      chatThinking ||
      state.currentPlayer !== state.humanColor;
    dom.undoButton.disabled =
      state.scoring?.active || aiThinking || chatThinking || stateHistory.length === 0;
    dom.scoreButton.disabled = state.gameOver || state.scoring?.active || aiThinking || chatThinking;
    dom.suggestionButton.disabled =
      state.gameOver ||
      state.scoring?.active ||
      aiThinking ||
      chatThinking ||
      state.currentPlayer !== state.humanColor;
    updateAiMood();
  }

  function renderScoringPanel() {
    const isVisible = Boolean(state.scoring?.active || state.gameOver);
    dom.scoringPanel.hidden = !isVisible;

    if (!isVisible) {
      return;
    }

    const scoring = analyzeScoring(state);
    const winnerText = createWinnerTextFromMargin(scoring.margin);

    dom.scoringSummary.textContent = state.gameOver
      ? `${winnerText}. Final score has been locked in.`
      : "Click a dead group to toggle it, then press Finish Score when the board looks settled.";
    dom.scoreBlackTotal.textContent = scoring.blackTotal.toFixed(1);
    dom.scoreBlackDetail.textContent = `Stones ${scoring.blackAlive} + Territory ${scoring.blackTerritory} | Dead marked ${scoring.blackDead}`;
    dom.scoreWhiteTotal.textContent = scoring.whiteTotal.toFixed(1);
    dom.scoreWhiteDetail.textContent = `Stones ${scoring.whiteAlive} + Territory ${scoring.whiteTerritory} + Komi ${WHITE_KOMI.toFixed(1)} | Dead marked ${scoring.whiteDead}`;
    dom.scoreNeutralTotal.textContent = String(scoring.neutralPoints);
    dom.scoreNeutralDetail.textContent = `Dame ${scoring.neutralPoints} | Captures B ${state.captures.black} / W ${state.captures.white}`;
    dom.scoringHint.textContent = state.gameOver
      ? "Start a new game if you want to review another ending."
      : "During scoring, each click marks the whole connected group as dead or alive.";
    dom.resumePlayButton.disabled =
      state.gameOver || aiThinking || chatThinking || !state.scoring?.active;
    dom.finishScoringButton.disabled = state.gameOver || aiThinking || chatThinking;
  }

  function render() {
    renderBoard();
    renderStatus();
    renderScoringPanel();
    renderSessionSummary();
  }

  function finishGameIfNeeded(nextState) {
    if (nextState.consecutivePasses < 2) {
      return nextState;
    }

    return {
      ...nextState,
      gameOver: false,
      winnerText: "",
      scoring: {
        ...nextState.scoring,
        active: true,
        finalized: false,
      },
    };

    const summary = describeEstimate(nextState);
    const winnerText =
      summary.estimate.margin > 0
        ? `เกมจบแล้ว ดำนำประมาณ ${summary.estimate.margin.toFixed(1)} แต้ม`
        : summary.estimate.margin < 0
          ? `เกมจบแล้ว ขาวนำประมาณ ${Math.abs(summary.estimate.margin).toFixed(1)} แต้ม`
          : "เกมจบแล้ว คะแนนสูสีมาก";

    return {
      ...nextState,
      gameOver: true,
      winnerText,
    };
  }

  function commitMove(simulation, actor, commentary) {
    const movingColor = state.currentPlayer;
    const capturedCount = simulation.captured.length;
    const moveCoord =
      commentary && commentary.coord
        ? commentary.coord
        : typeof commentary?.index === "number"
          ? indexToCoord(commentary.index, state.size)
          : "";
    stateHistory.push(cloneGameState(state));

    const nextState = finishGameIfNeeded({
      ...state,
      board: simulation.board,
      boardHash: simulation.hash,
      previousBoardHash: state.boardHash,
      currentPlayer: otherColor(movingColor),
      captures: {
        ...state.captures,
        [movingColor]: state.captures[movingColor] + capturedCount,
      },
      turn: state.turn + 1,
      lastMove: simulation.isPass
        ? {
            isPass: true,
            color: movingColor,
          }
        : {
            isPass: false,
            color: movingColor,
            index: typeof commentary?.index === "number" ? commentary.index : null,
            coord: moveCoord,
          },
      recommendedMove: actor === "human" ? null : state.recommendedMove,
      consecutivePasses: simulation.isPass ? state.consecutivePasses + 1 : 0,
      moveLog: state.moveLog.concat({
        color: movingColor,
        isPass: simulation.isPass,
        coord: simulation.isPass ? "pass" : moveCoord,
      }),
    });

    state = nextState;
    render();

    if (simulation.isPass) {
      const side = movingColor === "black" ? "ดำ" : "ขาว";
      updateStatusNote(`${side} เลือก Pass`);
      addChatMessage(
        actor === "human" ? "system" : "assistant",
        actor === "human"
          ? "คุณเลือกผ่านตานี้แล้ว"
          : commentary?.explanation || "ผมขอผ่านตานี้",
        actor === "human" ? "System" : commentary?.meta || "AI Move"
      );
    } else if (capturedCount > 0) {
      updateStatusNote(
        `${movingColor === "black" ? "ดำ" : "ขาว"} จับกินได้ ${capturedCount} เม็ด`
      );
    } else {
      updateStatusNote(`${movingColor === "black" ? "ดำ" : "ขาว"} ลงที่ ${moveCoord}`);
    }

    if (state.scoring?.active && state.consecutivePasses >= 2) {
      const scoring = analyzeScoring(state);
      const message = `${createWinnerTextFromMargin(scoring.margin)}\nคลิกกลุ่มหมากที่ตายเพื่อปรับผล แล้วกด Finish Score`;
      updateStatusNote("เข้าสู่โหมดนับแต้มแล้ว คลิกกลุ่มหมากที่ตายเพื่อสลับสถานะ");
      addChatMessage("system", message, "Scoring");
    }

    if (state.gameOver) {
      addChatMessage("assistant", `${state.winnerText}\n${summarizeDanger(state)}`, "Game Over");
    }
  }

  function handleIllegalMove(reason) {
    const textMap = {
      occupied: "จุดนี้มีหมากอยู่แล้ว ลองเลือกจุดตัดอื่น",
      suicide: "ตานี้เป็น suicide เพราะลงแล้วกลุ่มใหม่ไม่มีเสรีภาพเหลือ",
      ko: "ลงจุดนี้ไม่ได้เพราะติดกติกา ko ต้องไปเล่นที่อื่นก่อนหนึ่งตา",
    };
    const message = textMap[reason] || "ตานี้ไม่ถูกต้องตามกติกา";
    updateStatusNote(message);
    addChatMessage("system", message, "Rules");
  }

  function handleHumanMove(index) {
    if (state.gameOver || state.scoring?.active || aiThinking || state.currentPlayer !== state.humanColor) {
      return;
    }

    const simulation = simulateMove(
      state.board,
      state.size,
      index,
      state.humanColor,
      state.previousBoardHash
    );

    if (!simulation.legal) {
      handleIllegalMove(simulation.reason);
      return;
    }

    const coord = indexToCoord(index, state.size);
    addChatMessage("user", `ผมลงที่ ${coord}`, "You");
    commitMove(simulation, "human", { index, coord });

    if (!state.gameOver) {
      scheduleAiTurn();
    }
  }

  function getUndoStepCount() {
    if (!stateHistory.length || !state.moveLog.length) {
      return 0;
    }

    const desiredSteps = state.currentPlayer === state.humanColor ? 2 : 1;
    return Math.min(desiredSteps, stateHistory.length);
  }

  function handleUndo() {
    if (state.scoring?.active || aiThinking || chatThinking) {
      return;
    }

    const stepCount = getUndoStepCount();

    if (!stepCount) {
      return;
    }

    clearTimeout(aiTimer);
    aiTimer = null;
    aiThinking = false;

    let restoredState = null;

    for (let step = 0; step < stepCount; step += 1) {
      restoredState = stateHistory.pop() || restoredState;
    }

    if (!restoredState) {
      return;
    }

    state = cloneGameState(restoredState);
    render();

    const message =
      stepCount === 2
        ? "ย้อนกลับครบ 1 จังหวะแล้ว ลองเลือกตาใหม่ได้เลย"
        : "ย้อนกลับ 1 ตาเดินแล้ว";

    updateStatusNote(message);
    addChatMessage("system", message, "Undo");
  }

  function handlePass() {
    if (state.gameOver || state.scoring?.active || aiThinking || state.currentPlayer !== state.humanColor) {
      return;
    }

    const simulation = simulateMove(
      state.board,
      state.size,
      null,
      state.humanColor,
      state.previousBoardHash
    );

    addChatMessage("user", "ขอผ่านตานี้", "You");
    commitMove(simulation, "human", { explanation: "คุณเลือกผ่านตานี้" });

    if (!state.gameOver) {
      scheduleAiTurn();
    }
  }

  function handleDeadStoneToggle(index) {
    if (state.gameOver || !state.scoring?.active || aiThinking || chatThinking) {
      return;
    }

    const stone = state.board[index];

    if (!stone) {
      return;
    }

    const group = getGroup(state.board, index, state.size);

    if (!group) {
      return;
    }

    const nextDeadStones = getDeadStoneSet(state);
    const clearGroup = group.stones.every((stoneIndex) => nextDeadStones.has(stoneIndex));

    group.stones.forEach((stoneIndex) => {
      if (clearGroup) {
        nextDeadStones.delete(stoneIndex);
      } else {
        nextDeadStones.add(stoneIndex);
      }
    });

    state = {
      ...state,
      scoring: {
        ...state.scoring,
        active: true,
        finalized: false,
        deadStones: Array.from(nextDeadStones).sort((a, b) => a - b),
      },
      gameOver: false,
      winnerText: "",
    };

    render();
    updateStatusNote(
      clearGroup
        ? `คืนสถานะกลุ่มที่ ${indexToCoord(index, state.size)} ให้เป็นหมากมีชีวิตแล้ว`
        : `ทำเครื่องหมายกลุ่มที่ ${indexToCoord(index, state.size)} ว่าเป็นหมากตายแล้ว`
    );
  }

  function handleScoreButton() {
    if (state.gameOver || state.scoring?.active || aiThinking || chatThinking) {
      return;
    }

    clearTimeout(aiTimer);
    aiTimer = null;
    aiThinking = false;
    state = {
      ...state,
      scoring: {
        ...state.scoring,
        active: true,
        finalized: false,
      },
      winnerText: "",
      gameOver: false,
    };

    render();
    updateStatusNote("เข้าสู่โหมดนับแต้มแล้ว คลิกกลุ่มหมากที่ตายเพื่อสลับสถานะ");
    addChatMessage("system", "เข้าสู่โหมดนับแต้มแล้ว คลิกกลุ่มหมากที่ตายเพื่อปรับผลได้", "Scoring");
  }

  function handleResumePlay() {
    if (!state.scoring?.active || state.gameOver || aiThinking || chatThinking) {
      return;
    }

    state = {
      ...state,
      consecutivePasses: 0,
      winnerText: "",
      scoring: createScoringState(),
    };

    render();
    updateStatusNote("ออกจากโหมดนับแต้มแล้ว กลับไปเล่นต่อได้");
    addChatMessage("system", "ออกจากโหมดนับแต้มแล้ว กลับไปเดินหมากต่อได้", "Scoring");

    if (state.currentPlayer === state.aiColor) {
      scheduleAiTurn();
    }
  }

  function handleFinishScoring() {
    if (!state.scoring?.active || state.gameOver || aiThinking || chatThinking) {
      return;
    }

    const scoring = analyzeScoring(state);
    const winnerText = createWinnerTextFromMargin(scoring.margin);

    state = {
      ...state,
      gameOver: true,
      winnerText,
      scoring: {
        ...state.scoring,
        active: true,
        finalized: true,
      },
    };

    render();
    updateStatusNote(`นับแต้มเสร็จแล้ว ${winnerText}`);
    addChatMessage(
      "assistant",
      `${winnerText}\nดำ ${scoring.blackTotal.toFixed(1)} | ขาว ${scoring.whiteTotal.toFixed(1)}\nDead marked: ดำ ${scoring.blackDead} / ขาว ${scoring.whiteDead}`,
      "Score"
    );
  }

  function scheduleAiTurn() {
    if (state.gameOver || state.scoring?.active || state.currentPlayer !== state.aiColor) {
      return;
    }

    aiThinking = true;
    render();
    updateStatusNote(
      appConfig.boardAiApiEnabled
        ? "AI กำลังวิเคราะห์กระดานผ่าน server AI"
        : "AI กำลังประเมินกระดานและเลือกตาเดิน"
    );

    clearTimeout(aiTimer);
    aiTimer = window.setTimeout(async () => {
      let choice;

      try {
        choice = appConfig.boardAiApiEnabled
          ? await requestRemoteMove(state.aiColor)
          : chooseStrategicMove(state, state.aiColor);
      } catch (error) {
        choice = chooseStrategicMove(state, state.aiColor);
        addChatMessage(
          "system",
          `AI บนกระดานติดต่อ Live API ไม่สำเร็จ จึงกลับมาใช้ local engine แทน (${error instanceof Error ? error.message : String(error)})`,
          "System"
        );
      }

      aiThinking = false;

      if (choice.type === "pass") {
        const simulation = simulateMove(
          state.board,
          state.size,
          null,
          state.aiColor,
          state.previousBoardHash
        );
        commitMove(simulation, "ai", choice);
        render();
        return;
      }

      const chosenIndex =
        typeof choice.index === "number"
          ? choice.index
          : typeof choice.coord === "string"
            ? coordToIndex(choice.coord, state.size)
            : null;
      const fallbackChoice = chooseStrategicMove(state, state.aiColor);
      const resolvedIndex =
        typeof chosenIndex === "number" ? chosenIndex : fallbackChoice.type === "move" ? fallbackChoice.index : null;

      const simulation = simulateMove(
        state.board,
        state.size,
        resolvedIndex,
        state.aiColor,
        state.previousBoardHash
      );

      if (!simulation.legal || typeof resolvedIndex !== "number") {
        if (fallbackChoice.type === "move") {
          const fallbackSimulation = simulateMove(
            state.board,
            state.size,
            fallbackChoice.index,
            state.aiColor,
            state.previousBoardHash
          );

          if (fallbackSimulation.legal) {
            commitMove(fallbackSimulation, "ai", fallbackChoice);
            addChatMessage(
              "assistant",
              `${fallbackChoice.explanation}\nตอนนี้ ${summarizeDanger(state)}`,
              fallbackChoice.meta || "AI Move"
            );
            render();
            return;
          }
        }

        updateStatusNote("AI เลือกตาที่ไม่ผ่านการตรวจ ระบบจึงขอผ่านตานี้แทน");
        const passSimulation = simulateMove(
          state.board,
          state.size,
          null,
          state.aiColor,
          state.previousBoardHash
        );
        commitMove(passSimulation, "ai", {
          explanation: "ผมหาจุดที่มั่นใจไม่ได้ เลยขอผ่านตานี้",
          meta: choice.meta || "AI Move",
        });
        render();
        return;
      }

      commitMove(simulation, "ai", {
        ...choice,
        index: resolvedIndex,
        coord: indexToCoord(resolvedIndex, state.size),
      });
      addChatMessage(
        "assistant",
        `${choice.explanation}\nตอนนี้ ${summarizeDanger(state)}`,
        choice.meta || "AI Move"
      );

      render();
    }, appConfig.boardAiApiEnabled ? 350 : 650);
  }

  async function askForSuggestion() {
    const text = "ช่วยแนะนำตาเดินให้หน่อย";
    dom.chatInput.value = text;
    await handleChatSubmit(text);
  }

  function isSuggestionPrompt(text) {
    return /(?:\u0e41\u0e19\u0e30\u0e19\u0e33|\u0e44\u0e2b\u0e19\u0e14\u0e35|\u0e15\u0e32\u0e40\u0e14\u0e34\u0e19|suggest|move|\u0e25\u0e07\u0e15\u0e23\u0e07)/i.test(
      text
    );
  }

  function normalizeSuggestionChoice(choice) {
    if (!choice || typeof choice !== "object") {
      return null;
    }

    if (choice.type === "pass") {
      return {
        type: "pass",
        coord: null,
        index: null,
        explanation: choice.explanation || "The position looks settled enough to pass.",
        meta: choice.meta || (appConfig.boardAiApiEnabled ? getBoardAiLabel() : "Sensei"),
      };
    }

    const coord = typeof choice.coord === "string" ? choice.coord : null;
    const index =
      typeof choice.index === "number"
        ? choice.index
        : coord
          ? coordToIndex(coord, state.size)
          : null;

    if (!coord || typeof index !== "number") {
      return null;
    }

    return {
      type: "move",
      coord,
      index,
      explanation: choice.explanation || `Try ${coord}.`,
      meta: choice.meta || (appConfig.boardAiApiEnabled ? getBoardAiLabel() : "Sensei"),
    };
  }

  async function provideMoveSuggestion(promptText) {
    addChatMessage("user", promptText, "You");
    dom.chatInput.value = "";

    setChatBusy(true);

    try {
      if (state.gameOver) {
        state.recommendedMove = null;
        addChatMessage(
          "assistant",
          "This game is already over. Start a new game and I can suggest a move there.",
          "Sensei"
        );
        return;
      }

      if (state.scoring?.active) {
        state.recommendedMove = null;
        addChatMessage(
          "assistant",
          "Scoring mode is active right now. Resume play first if you want a move suggestion.",
          "Sensei"
        );
        return;
      }

      if (state.currentPlayer !== state.humanColor) {
        state.recommendedMove = null;
        addChatMessage(
          "assistant",
          "It is the AI's turn right now. Let it play first, then ask for a suggestion again.",
          "Sensei"
        );
        return;
      }

      let choice;

      if (appConfig.boardAiApiEnabled) {
        updateStatusNote(`Asking ${getBoardAiLabel()} for a move suggestion`);

        try {
          choice = await requestRemoteMove(state.humanColor);
        } catch (error) {
          addChatMessage(
            "system",
            `Could not get a suggestion from ${getBoardAiLabel()}, so local fallback is being used instead (${error instanceof Error ? error.message : String(error)})`,
            "System"
          );
          choice = {
            ...chooseStrategicMove(state, state.humanColor),
            meta: "Local Fallback",
          };
        }
      } else {
        updateStatusNote("Evaluating a move suggestion with the local engine");
        choice = {
          ...chooseStrategicMove(state, state.humanColor),
          meta: "Local Fallback",
        };
      }

      const suggestion = normalizeSuggestionChoice(choice);

      if (!suggestion) {
        state.recommendedMove = null;
        addChatMessage(
          "assistant",
          "I could not parse the suggested move this time. Please try Ask AI again.",
          "Sensei"
        );
        return;
      }

      if (suggestion.type === "pass") {
        state.recommendedMove = null;
        addChatMessage(
          "assistant",
          `${suggestion.explanation}\nIf the board already feels settled, passing is reasonable here.`,
          suggestion.meta
        );
        return;
      }

      state.recommendedMove = suggestion.index;
      updateStatusNote(`Latest suggestion: ${suggestion.coord} by ${suggestion.meta}`);
      addChatMessage(
        "assistant",
        `${suggestion.explanation}\nTry ${suggestion.coord} and see how White responds.`,
        suggestion.meta
      );
    } finally {
      setChatBusy(false);
      render();
    }
  }

  async function handleChatSubmit(overrideText) {
    const text = typeof overrideText === "string" ? overrideText : dom.chatInput.value.trim();

    if (!text || chatThinking) {
      return;
    }

    if (isSuggestionPrompt(text)) {
      await provideMoveSuggestion(text);
      return;
    }

    addChatMessage("user", text, "You");
    dom.chatInput.value = "";

    setChatBusy(true);

    try {
      if (appConfig.apiEnabled) {
        const reply = await requestRemoteChatReply(text);
        addChatMessage("assistant", reply.text, reply.meta);
      } else {
        const reply = getChatReply(text);
        addChatMessage("assistant", reply.text, "Sensei");
      }
    } catch (error) {
      const fallback = getChatReply(text);
      addChatMessage(
        "system",
        `Live API ใช้งานไม่ได้ชั่วคราว จึงตอบด้วย local fallback แทน (${error instanceof Error ? error.message : String(error)})`,
        "System"
      );
      addChatMessage("assistant", fallback.text, "Sensei");
    } finally {
      setChatBusy(false);
      renderStatus();
    }
  }

  function getMoveSequenceForApi() {
    return state.moveLog.map((move) => [
      move.color === "black" ? "B" : "W",
      move.isPass ? "pass" : move.coord,
    ]);
  }

  function announceChatMode() {
    let message;

    if (appConfig.chatApiEnabled && appConfig.boardAiApiEnabled) {
      message =
        appConfig.boardAiProvider === "katago"
          ? `เชื่อมต่อแชทด้วย ${appConfig.model || "Remote AI"} แล้ว และ AI บนกระดานใช้ ${getBoardAiLabel()}`
          : `เชื่อมต่อผู้ช่วยระยะไกลแล้ว แชทใช้ ${appConfig.model || "default model"} และ AI บนกระดานใช้ ${getBoardAiLabel()}`;
    } else if (appConfig.boardAiApiEnabled) {
      message = `AI บนกระดานพร้อมแล้ว ใช้ ${getBoardAiLabel()} ส่วนแชทยังใช้ local fallback อยู่`;
    } else if (appConfig.chatApiEnabled) {
      message = `เชื่อมต่อผู้ช่วยระยะไกลแล้ว รุ่นที่ใช้อยู่คือ ${appConfig.model || "default model"}`;
    } else if (appConfig.serverAvailable) {
      message =
        "เซิร์ฟเวอร์พร้อมแล้ว แต่ยังไม่พบ remote provider สำหรับแชทหรือบอร์ด จึงใช้ local fallback ต่อไปก่อน";
    } else {
      message =
        "ยังไม่พบ backend ของโปรเจ็กต์นี้ ถ้าอยากใช้ Live API ให้รันผ่าน server แล้วเปิด http://localhost:3000";
    }

    addChatMessage("system", message, "System");
  }

  function createBoardSnapshotForApi() {
    const estimateInfo = describeEstimate(state);

    return {
      size: state.size,
      boardRows: getBoardRows(state),
      currentPlayer: state.currentPlayer,
      lastMove: state.lastMove
        ? state.lastMove.isPass
          ? `${state.lastMove.color} pass`
          : `${state.lastMove.color} ${state.lastMove.coord}`
        : "none",
      captures: {
        black: state.captures.black,
        white: state.captures.white,
      },
      estimate: estimateInfo.estimate,
      leader: estimateInfo.leader,
      dangerSummary: summarizeDanger(state),
      moveLog: getRecentMoveLog(),
      moveSequence: getMoveSequenceForApi(),
      komi: WHITE_KOMI,
      rules: "chinese",
    };
  }

  async function fetchServerConfig() {
    try {
      const response = await fetch("./api/config");

      if (!response.ok) {
        throw new Error(`Config request failed with ${response.status}`);
      }

      const payload = await response.json();
      const chatApiEnabled = Boolean(payload.chatApiEnabled ?? payload.apiEnabled);

      appConfig = {
        serverAvailable: true,
        chatApiEnabled,
        apiEnabled: chatApiEnabled,
        model: payload.model || null,
        boardAiApiEnabled: Boolean(payload.boardAiApiEnabled),
        boardAiProvider: payload.boardAiProvider || null,
        boardAiLabel: payload.boardAiLabel || payload.moveModel || null,
        moveModel: payload.moveModel || null,
      };
    } catch (_error) {
      appConfig = {
        serverAvailable: false,
        chatApiEnabled: false,
        apiEnabled: false,
        model: null,
        boardAiApiEnabled: false,
        boardAiProvider: null,
        boardAiLabel: null,
        moveModel: null,
      };
    }

    updateAiMood();
    renderSessionSummary();
    announceChatMode();
  }

  async function requestRemoteChatReply(userMessage) {
    const priorMessages = getConversationContext().slice(0, -1);
    const response = await fetch("./api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userMessage,
        messages: priorMessages,
        boardState: createBoardSnapshotForApi(),
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Live API request failed");
    }

    return {
      text: payload.text || "AI ไม่ส่งข้อความกลับมา",
      meta: payload.providerLabel || payload.model || "Remote AI",
    };
  }

  async function requestRemoteMove(color) {
    const legalMoves = createLegalMovesSnapshot(state, color);

    if (!legalMoves.allCoords.length) {
      return {
        type: "pass",
        explanation: "ไม่มีจุดที่ลงได้โดยไม่ผิดกติกา จึงขอผ่านตานี้",
        meta: getBoardAiLabel(),
      };
    }

    const response = await fetch("./api/move", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        playerColor: color,
        boardState: createBoardSnapshotForApi(),
        legalMoves,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Live move request failed");
    }

    return {
      type: payload.type === "move" ? "move" : "pass",
      coord: typeof payload.coord === "string" ? payload.coord : null,
      explanation: payload.explanation || "AI เลือกตาเดินใหม่",
      meta:
        payload.providerLabel ||
        payload.model ||
        (payload.provider === "katago" ? "KataGo" : "Remote AI"),
    };
  }

  function scheduleAiTurn() {
    if (state.gameOver || state.scoring?.active || state.currentPlayer !== state.aiColor) {
      return;
    }

    aiThinking = true;
    render();
    updateStatusNote(
      appConfig.boardAiApiEnabled
        ? `AI กำลังวิเคราะห์กระดานผ่าน ${getBoardAiLabel()}`
        : "AI กำลังประเมินกระดานและเลือกตาเดิน"
    );

    clearTimeout(aiTimer);
    aiTimer = window.setTimeout(async () => {
      let choice;

      try {
        choice = appConfig.boardAiApiEnabled
          ? await requestRemoteMove(state.aiColor)
          : chooseStrategicMove(state, state.aiColor);
      } catch (error) {
        choice = chooseStrategicMove(state, state.aiColor);
        addChatMessage(
          "system",
          `AI บนกระดานติดต่อ remote engine ไม่สำเร็จ จึงกลับมาใช้ local engine แทน (${error instanceof Error ? error.message : String(error)})`,
          "System"
        );
      }

      aiThinking = false;

      if (choice.type === "pass") {
        const simulation = simulateMove(
          state.board,
          state.size,
          null,
          state.aiColor,
          state.previousBoardHash
        );
        commitMove(simulation, "ai", choice);
        render();
        return;
      }

      const chosenIndex =
        typeof choice.index === "number"
          ? choice.index
          : typeof choice.coord === "string"
            ? coordToIndex(choice.coord, state.size)
            : null;
      const fallbackChoice = chooseStrategicMove(state, state.aiColor);
      const resolvedIndex =
        typeof chosenIndex === "number" ? chosenIndex : fallbackChoice.type === "move" ? fallbackChoice.index : null;

      const simulation = simulateMove(
        state.board,
        state.size,
        resolvedIndex,
        state.aiColor,
        state.previousBoardHash
      );

      if (!simulation.legal || typeof resolvedIndex !== "number") {
        if (fallbackChoice.type === "move") {
          const fallbackSimulation = simulateMove(
            state.board,
            state.size,
            fallbackChoice.index,
            state.aiColor,
            state.previousBoardHash
          );

          if (fallbackSimulation.legal) {
            commitMove(fallbackSimulation, "ai", fallbackChoice);
            addChatMessage(
              "assistant",
              `${fallbackChoice.explanation}\nตอนนี้ ${summarizeDanger(state)}`,
              fallbackChoice.meta || "AI Move"
            );
            render();
            return;
          }
        }

        updateStatusNote("AI เลือกตาที่ไม่ผ่านการตรวจ ระบบจึงขอผ่านตานี้แทน");
        const passSimulation = simulateMove(
          state.board,
          state.size,
          null,
          state.aiColor,
          state.previousBoardHash
        );
        commitMove(passSimulation, "ai", {
          explanation: "ผมหาจุดที่มั่นใจไม่ได้ เลยขอผ่านตานี้",
          meta: choice.meta || "AI Move",
        });
        render();
        return;
      }

      commitMove(simulation, "ai", {
        ...choice,
        index: resolvedIndex,
        coord: indexToCoord(resolvedIndex, state.size),
      });
      addChatMessage(
        "assistant",
        `${choice.explanation}\nตอนนี้ ${summarizeDanger(state)}`,
        choice.meta || "AI Move"
      );

      render();
    }, appConfig.boardAiApiEnabled ? 350 : 650);
  }

  async function handleChatSubmit(overrideText) {
    const text = typeof overrideText === "string" ? overrideText : dom.chatInput.value.trim();

    if (!text || chatThinking) {
      return;
    }

    if (isSuggestionPrompt(text)) {
      await provideMoveSuggestion(text);
      return;
    }

    addChatMessage("user", text, "You");
    dom.chatInput.value = "";

    setChatBusy(true);

    try {
      if (appConfig.chatApiEnabled) {
        const reply = await requestRemoteChatReply(text);
        addChatMessage("assistant", reply.text, reply.meta);
      } else {
        const reply = getChatReply(text);
        addChatMessage("assistant", reply.text, "Sensei");
      }
    } catch (error) {
      const fallback = getChatReply(text);
      addChatMessage(
        "system",
        `Live chat ใช้งานไม่ได้ชั่วคราว จึงตอบด้วย local fallback แทน (${error instanceof Error ? error.message : String(error)})`,
        "System"
      );
      addChatMessage("assistant", fallback.text, "Sensei");
    } finally {
      setChatBusy(false);
      render();
    }
  }

  function startNewGame() {
    clearTimeout(aiTimer);
    aiTimer = null;
    aiThinking = false;
    stateHistory = [];
    state = createInitialState();
    resetChat();
    announceChatMode();
    updateStatusNote(
      "เกมใหม่เริ่มแล้ว คุณเล่นเป็นดำ ลองเริ่มจากมุมหรือด้านข้างเพื่อสร้างพื้นที่ก่อน"
    );
    render();
  }

  function shouldSubmitChatOnEnter(event) {
    return (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.isComposing
    );
  }

  function attachEvents() {
    dom.newGameButton.addEventListener("click", startNewGame);
    dom.passButton.addEventListener("click", handlePass);
    dom.undoButton.addEventListener("click", handleUndo);
    dom.scoreButton.addEventListener("click", handleScoreButton);
    dom.suggestionButton.addEventListener("click", () => {
      askForSuggestion();
    });
    dom.resumePlayButton.addEventListener("click", handleResumePlay);
    dom.finishScoringButton.addEventListener("click", handleFinishScoring);

    dom.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleChatSubmit();
    });

    dom.chatInput.addEventListener("keydown", (event) => {
      if (!shouldSubmitChatOnEnter(event)) {
        return;
      }

      event.preventDefault();

      if (typeof dom.chatForm.requestSubmit === "function") {
        dom.chatForm.requestSubmit();
        return;
      }

      handleChatSubmit();
    });

    dom.promptChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        dom.chatInput.value = chip.dataset.prompt || "";
        handleChatSubmit(chip.dataset.prompt || "");
      });
    });
  }

  async function init() {
    buildAxes();
    buildBoard();
    attachEvents();
    resetChat();
    render();
    await fetchServerConfig();
  }

  init();
})();
