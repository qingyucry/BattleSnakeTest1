// Welcome to
// __________         __    __  .__                               __
// \______   \_____ _/  |__/  |_|  |   ____   ______ ____ _____  |  | __ ____
//  |    |  _/\__  \\   __\   __\  | _/ __ \ /  ___//    \\__  \ |  |/ // __ \
//  |    |   \ / __ \|  |  |  | |  |_\  ___/ \___ \|   |  \/ __ \|    <\  ___/
//  |________/(______/__|  |__| |____/\_____>______>___|__(______/__|__\\_____>
//
// This file can be a nice home for your Battlesnake logic and helper functions.

import runServer from './server';
import { Coord, GameState, Battlesnake, Board, InfoResponse, MoveResponse } from './types';

// info is called when you create your Battlesnake on play.battlesnake.com
// and controls your Battlesnake's appearance
function info(): InfoResponse {
  console.log("INFO");
  return {
    apiversion: "1",
    author: "",
    color: "#888888",
    head: "default",
    tail: "default",
  };
}

// start is called when your Battlesnake begins a game
function start(gameState: GameState): void {
  console.log("GAME START");
}

// end is called when your Battlesnake finishes a game
function end(gameState: GameState): void {
  console.log("GAME OVER\n");
}

// ─────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────

function coordKey(c: Coord): string {
  return `${c.x},${c.y}`;
}

function coordEq(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y;
}

function applyDir(head: Coord, dir: string): Coord {
  switch (dir) {
    case "up":    return { x: head.x,     y: head.y + 1 };
    case "down":  return { x: head.x,     y: head.y - 1 };
    case "left":  return { x: head.x - 1, y: head.y     };
    case "right": return { x: head.x + 1, y: head.y     };
  }
  return head;
}

function inBounds(c: Coord, width: number, height: number): boolean {
  return c.x >= 0 && c.x < width && c.y >= 0 && c.y < height;
}

// ─────────────────────────────────────────────
// Result of synchronized BFS (flood fill)
// ─────────────────────────────────────────────
interface FloodResult {
  myArea: number;          // checkered-discounted area for me
  enemyMaxArea: number;    // max checkered-discounted area among all enemies
  myFoodDist: number;      // nearest food dist inside my territory (W if none)
  myFoodCount: number;     // food count in my territory
  enemyMaxFoodCount: number; // max food count in any enemy territory
  myTailCount: number;     // tails in my territory
  enemyTailCount: number;  // tails in enemy territory (net: my_area - enemy_area)
}

/**
 * Synchronized BFS from me + all enemies.
 * Obstacles for BFS: my body (excl. last segment) ONLY.
 * Enemy bodies are NOT obstacles during BFS (they will move).
 */
function floodFill(
  myHead: Coord,
  me: Battlesnake,
  enemies: Battlesnake[],
  board: Board
): FloodResult {
  const W = board.width;
  const H = board.height;

  // Build obstacle set: my body excluding last segment (tail)
  const myObstacles = new Set<string>();
  for (let i = 0; i < me.body.length - 1; i++) {
    myObstacles.add(coordKey(me.body[i]));
  }

  // Build food set
  const foodSet = new Set<string>();
  for (const f of board.food) foodSet.add(coordKey(f));

  // Build all tail positions
  const allTails = new Set<string>();
  allTails.add(coordKey(me.body[me.body.length - 1]));
  for (const e of enemies) {
    if (e.body.length > 0) {
      allTails.add(coordKey(e.body[e.body.length - 1]));
    }
  }

  // ownership: 0=unvisited, 1=mine, 2=enemy_i+2 (index), -1=contested
  const ownership = new Int8Array(W * H); // 0=unvisited
  const dist = new Int32Array(W * H).fill(-1);

  // BFS queue: [x, y, owner_id]  owner_id: 0=me, 1..N=enemies
  // We use a simple array-based queue
  const queue: number[] = [];

  function idx(c: Coord) { return c.y * W + c.x; }

  // Enqueue my head
  const myIdx = idx(myHead);
  if (!myObstacles.has(coordKey(myHead))) {
    ownership[myIdx] = 1;
    dist[myIdx] = 0;
    queue.push(myHead.x, myHead.y, 0); // owner 0 = me
  }

  // Enqueue enemy heads
  for (let ei = 0; ei < enemies.length; ei++) {
    const eHead = enemies[ei].head;
    const eIdx = idx(eHead);
    if (!inBounds(eHead, W, H)) continue;
    if (dist[eIdx] === -1 && ownership[eIdx] !== -1) {
      ownership[eIdx] = 2 + ei;
      dist[eIdx] = 0;
      queue.push(eHead.x, eHead.y, 1 + ei); // owner 1+ei = enemy[ei]
    } else if (dist[eIdx] === 0) {
      // contested at start (two snakes share same head? unlikely but handle)
      ownership[eIdx] = -1;
    }
  }

  const DIRS = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];

  let qi = 0;
  while (qi < queue.length) {
    const cx = queue[qi++];
    const cy = queue[qi++];
    const owner = queue[qi++];
    const curCoord: Coord = { x: cx, y: cy };
    const curIdx = idx(curCoord);

    for (const d of DIRS) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      const nc: Coord = { x: nx, y: ny };
      if (!inBounds(nc, W, H)) continue;
      // Obstacle: my body segments (excl. tail)
      if (myObstacles.has(coordKey(nc))) continue;
      const ni = idx(nc);
      const nd = dist[curIdx] + 1;

      if (dist[ni] === -1) {
        // Unvisited
        dist[ni] = nd;
        ownership[ni] = owner === 0 ? 1 : (2 + (owner - 1));
        queue.push(nx, ny, owner);
      } else if (dist[ni] === nd && ownership[ni] !== -1) {
        // Arrived at same dist from a different owner → contested
        const prevOwner = ownership[ni];
        const curOwnerTag = owner === 0 ? 1 : (2 + (owner - 1));
        if (prevOwner !== curOwnerTag) {
          ownership[ni] = -1;
        }
      }
    }
  }

  // Compute checkered-discounted area for me and each enemy
  function checkeredDiscount(evenCount: number, oddCount: number): number {
    const diff = Math.abs(evenCount - oddCount);
    return evenCount + oddCount - diff + Math.min(1, diff);
  }

  let myEven = 0, myOdd = 0;
  let myFoodDistVal = W;
  let myFoodCount = 0;
  let myTailCount = 0;

  // Per-enemy tracking
  const enemyEven: number[] = new Array(enemies.length).fill(0);
  const enemyOdd: number[]  = new Array(enemies.length).fill(0);
  const enemyFoodCount: number[] = new Array(enemies.length).fill(0);
  let enemyTailCount = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c: Coord = { x, y };
      const i = idx(c);
      const ow = ownership[i];
      if (ow === -1 || dist[i] === -1) continue; // contested or unvisited
      const parity = (x + y) % 2 === 0 ? 'even' : 'odd';
      const key = coordKey(c);
      const isFood = foodSet.has(key);
      const isTail = allTails.has(key);

      if (ow === 1) {
        // Mine
        if (parity === 'even') myEven++; else myOdd++;
        if (isFood) {
          myFoodCount++;
          if (dist[i] < myFoodDistVal) myFoodDistVal = dist[i];
        }
        if (isTail) myTailCount++;
      } else if (ow >= 2) {
        // Enemy index = ow - 2
        const ei = ow - 2;
        if (parity === 'even') enemyEven[ei]++; else enemyOdd[ei]++;
        if (isFood) enemyFoodCount[ei]++;
        if (isTail) enemyTailCount++;
      }
    }
  }

  const myAreaVal = checkeredDiscount(myEven, myOdd);

  let enemyMaxArea = 0;
  let enemyMaxFoodCount = 0;
  for (let ei = 0; ei < enemies.length; ei++) {
    const ea = checkeredDiscount(enemyEven[ei], enemyOdd[ei]);
    if (ea > enemyMaxArea) enemyMaxArea = ea;
    if (enemyFoodCount[ei] > enemyMaxFoodCount) enemyMaxFoodCount = enemyFoodCount[ei];
  }

  return {
    myArea: myAreaVal,
    enemyMaxArea,
    myFoodDist: myFoodDistVal,
    myFoodCount,
    enemyMaxFoodCount,
    myTailCount,
    enemyTailCount,
  };
}

// ─────────────────────────────────────────────
// Simulate one step: returns a new virtual game state
// ─────────────────────────────────────────────
interface SimState {
  myHead: Coord;
  myBody: Coord[];
  myHealth: number;
  myLength: number;
  foodSet: Set<string>;
}

function simulateStep(
  dir: string,
  me: Battlesnake,
  board: Board
): SimState {
  const newHead = applyDir(me.head, dir);
  const foodSet = new Set<string>();
  for (const f of board.food) foodSet.add(coordKey(f));

  const headKey = coordKey(newHead);
  const ateFood = foodSet.has(headKey);

  let newBody: Coord[];
  let newHealth: number;

  if (ateFood) {
    // Grow: don't remove tail
    newBody = [newHead, ...me.body];
    newHealth = 100;
    foodSet.delete(headKey);
  } else {
    // Move: remove tail
    newBody = [newHead, ...me.body.slice(0, me.body.length - 1)];
    newHealth = me.health - 1;
  }

  return {
    myHead: newHead,
    myBody: newBody,
    myHealth: newHealth,
    myLength: newBody.length,
    foodSet,
  };
}

// ─────────────────────────────────────────────
// Score calculation for one direction
// ─────────────────────────────────────────────

// Early / late weights for 7 features:
// [being_longer, food_dist, controlled_tail_diff, area_size_diff,
//  controlled_food_diff, me_health, lowest_enemy_health]
const EARLY_WEIGHTS = [9, 7, 6, 1, 0, 1, -2];
const LATE_WEIGHTS  = [0, 0, 20, 7, 3, 0, 0];
const PROGRESS_MAX_TURN = 632;

function computeWeights(turn: number): number[] {
  const progress = Math.min(turn / PROGRESS_MAX_TURN, 1);
  return EARLY_WEIGHTS.map((ew, i) => ew * (1 - progress) + LATE_WEIGHTS[i] * progress);
}

function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

function beingLonger(myLen: number, enemies: Battlesnake[], W: number): number {
  if (enemies.length === 0) return 0;
  const maxEnemyLen = Math.max(...enemies.map(e => e.length));
  const diff = myLen - maxEnemyLen;
  const s = sign(diff);
  const absVal = Math.abs(diff);
  const inner = W * absVal + 1;
  const logVal = Math.log(inner) / Math.log(1.5);
  return s * Math.floor(logVal) * W;
}

function scoreDirection(
  dir: string,
  me: Battlesnake,
  enemies: Battlesnake[],
  board: Board,
  turn: number
): number {
  const W = board.width;

  // Simulate one step
  const sim = simulateStep(dir, me, board);

  // Build a virtual "me" for flood fill
  const virtualMe: Battlesnake = {
    ...me,
    head: sim.myHead,
    body: sim.myBody,
    health: sim.myHealth,
    length: sim.myLength,
  };

  // Build virtual board with updated food
  const virtualBoard: Board = {
    ...board,
    food: Array.from(sim.foodSet).map(k => {
      const [x, y] = k.split(',').map(Number);
      return { x, y };
    }),
  };

  // Run flood fill with simulated state
  const flood = floodFill(sim.myHead, virtualMe, enemies, virtualBoard);

  // Compute 7 feature values
  const lowestEnemyHealth = enemies.length > 0
    ? Math.min(...enemies.map(e => e.health))
    : 0;

  const features = [
    beingLonger(sim.myLength, enemies, W),                          // being_longer
    flood.myFoodDist,                                               // food_dist
    flood.myTailCount - flood.enemyTailCount,                      // controlled_tail_diff
    flood.myArea - flood.enemyMaxArea,                             // area_size_diff
    flood.myFoodCount - flood.enemyMaxFoodCount,                   // controlled_food_diff
    sim.myHealth,                                                   // me.health
    lowestEnemyHealth,                                              // lowest_enemy_health
  ];

  const weights = computeWeights(turn);
  let score = 0;
  for (let i = 0; i < features.length; i++) {
    score += features[i] * weights[i];
  }

  return score;
}

// ─────────────────────────────────────────────
// Determine if a cell is a lethal obstacle
// for the "is this direction safe?" check.
// Obstacles: all snake bodies except each snake's last tail segment.
// ─────────────────────────────────────────────
function buildObstacleSet(me: Battlesnake, board: Board): Set<string> {
  const obs = new Set<string>();

  // My body except last segment
  for (let i = 0; i < me.body.length - 1; i++) {
    obs.add(coordKey(me.body[i]));
  }

  // All enemy bodies except their last segment
  for (const snake of board.snakes) {
    if (snake.id === me.id) continue;
    for (let i = 0; i < snake.body.length - 1; i++) {
      obs.add(coordKey(snake.body[i]));
    }
  }

  return obs;
}

// ─────────────────────────────────────────────
// Main move function
// ─────────────────────────────────────────────
function move(gameState: GameState): MoveResponse {
  const me = gameState.you;
  const board = gameState.board;
  const turn = gameState.turn;
  const W = board.width;
  const H = board.height;

  const enemies = board.snakes.filter(s => s.id !== me.id);

  const DIRS = ["up", "down", "left", "right"];
  const FALLBACK_ORDER = ["up", "left", "down", "right"];

  // Build obstacle set for lethality check
  const obstacles = buildObstacleSet(me, board);

  // Determine safe directions
  const safeDirs: string[] = [];
  for (const dir of DIRS) {
    const next = applyDir(me.head, dir);
    if (!inBounds(next, W, H)) continue;
    if (obstacles.has(coordKey(next))) continue;
    safeDirs.push(dir);
  }

  if (safeDirs.length === 0) {
    // All directions are lethal — fall back to priority order
    const fallback = FALLBACK_ORDER[0];
    console.log(`MOVE ${turn}: No safe moves! Falling back to ${fallback}`);
    return { move: fallback };
  }

  // Score each safe direction
  let bestDir = safeDirs[0];
  let bestScore = -Infinity;

  for (const dir of safeDirs) {
    const score = scoreDirection(dir, me, enemies, board, turn);
    console.log(`MOVE ${turn}: dir=${dir} score=${score.toFixed(2)}`);
    if (score > bestScore) {
      bestScore = score;
      bestDir = dir;
    }
  }

  console.log(`MOVE ${turn}: chosen=${bestDir}`);
  return { move: bestDir };
}

runServer({
  info: info,
  start: start,
  move: move,
  end: end
});
