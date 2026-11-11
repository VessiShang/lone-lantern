// 迷宫生成 + 可通行性校验
// 规则：通道净宽 5 身位，墙厚 0.5 身位，坑洞直径 3 身位（半径 1.5）
window.LL = window.LL || {};
(function (LL) {
  'use strict';
  const U = LL.UNITS.U;

  const DIRS = [
    { d: 0, name: 'N', di: 0, dj: -1, od: 2 },
    { d: 1, name: 'E', di: 1, dj: 0, od: 3 },
    { d: 2, name: 'S', di: 0, dj: 1, od: 0 },
    { d: 3, name: 'W', di: -1, dj: 0, od: 1 }
  ];

  // ---------- 生成 ----------
  function build(cfg, seed) {
    const rnd = LL.mulberry32(seed >>> 0);
    const cols = cfg.cols, rows = cfg.rows;
    const pitch = (LL.UNITS.corridor + LL.UNITS.wall) * U; // 242
    const wallT = LL.UNITS.wall * U;                      // 22
    const cellW = pitch - wallT;                          // 220
    const W = cols * pitch + wallT;
    const H = rows * pitch + wallT;
    const n = cols * rows;
    const idx = (i, j) => j * cols + i;
    const inb = (i, j) => i >= 0 && i < cols && j >= 0 && j < rows;

    // 通道：open[cell*4+dir] = 1 表示该方向有洞
    const open = new Uint8Array(n * 4);
    const isOpen = (i, j, d) => (inb(i, j) ? open[idx(i, j) * 4 + d] === 1 : false);
    const carve = (i, j, d) => {
      open[idx(i, j) * 4 + d] = 1;
      const m = DIRS[d];
      open[idx(i + m.di, j + m.dj) * 4 + m.od] = 1;
    };

    // 1) DFS 生成完美迷宫
    const visited = new Uint8Array(n);
    visited[idx(0, 0)] = 1;
    const stack = [[0, 0]];
    while (stack.length) {
      const [i, j] = stack[stack.length - 1];
      const cand = [];
      for (const m of DIRS) {
        const ni = i + m.di, nj = j + m.dj;
        if (inb(ni, nj) && !visited[idx(ni, nj)]) cand.push(m);
      }
      if (!cand.length) { stack.pop(); continue; }
      const m = cand[Math.floor(rnd() * cand.length)];
      carve(i, j, m.d);
      visited[idx(i + m.di, j + m.dj)] = 1;
      stack.push([i + m.di, j + m.dj]);
    }

    // 2) 打环：按概率打通死胡同，减少"死路感"
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        let cnt = 0;
        for (const m of DIRS) if (isOpen(i, j, m.d)) cnt++;
        if (cnt !== 1) continue;
        if (rnd() > cfg.braid) continue;
        const closed = DIRS.filter((m) => inb(i + m.di, j + m.dj) && !isOpen(i, j, m.d));
        if (!closed.length) continue;
        carve(i, j, closed[Math.floor(rnd() * closed.length)].d);
      }
    }

    // 3) 单元格 BFS 距离
    const dist = new Int32Array(n).fill(-1);
    dist[idx(0, 0)] = 0;
    const q = [idx(0, 0)];
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      const i = c % cols, j = (c - i) / cols;
      const d0 = dist[c];
      for (const m of DIRS) {
        if (!isOpen(i, j, m.d)) continue;
        const ni = i + m.di, nj = j + m.dj;
        const nc = idx(ni, nj);
        if (dist[nc] === -1) { dist[nc] = d0 + 1; q.push(nc); }
      }
    }

    const cellCenter = (i, j) => ({
      x: i * pitch + wallT + cellW / 2,
      y: j * pitch + wallT + cellW / 2
    });

    // 4) 出生点 = 角落 (0,0)
    const start = cellCenter(0, 0);
    const startCell = { i: 0, j: 0 };
    // 出生点稍往里收，避免贴墙
    start.y = 0 * pitch + wallT + cellW / 2;

    // 5) 出口：距离最远的边界格
    let exitCell = null, exitBest = -1;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const border = i === 0 || j === 0 || i === cols - 1 || j === rows - 1;
        if (!border) continue;
        const c = idx(i, j);
        if (c === idx(0, 0)) continue;
        if (dist[c] > exitBest) { exitBest = dist[c]; exitCell = { i, j }; }
      }
    }
    if (!exitCell) return null;

    const exitSides = [];
    if (exitCell.i === 0) exitSides.push(3);
    if (exitCell.j === 0) exitSides.push(0);
    if (exitCell.i === cols - 1) exitSides.push(1);
    if (exitCell.j === rows - 1) exitSides.push(2);
    const exitSide = exitSides[Math.floor(rnd() * exitSides.length)];
    const ec = cellCenter(exitCell.i, exitCell.j);
    let exitPos;
    if (exitSide === 3) exitPos = { x: ec.x - cellW / 2 + 0.55 * U, y: ec.y };
    else if (exitSide === 1) exitPos = { x: ec.x + cellW / 2 - 0.55 * U, y: ec.y };
    else if (exitSide === 0) exitPos = { x: ec.x, y: ec.y - cellW / 2 + 0.55 * U };
    else exitPos = { x: ec.x, y: ec.y + cellW / 2 - 0.55 * U };

    // 6) 宝箱：距离远且彼此分散
    const chestCells = [];
    const order = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) order.push({ i, j, d: dist[idx(i, j)] });
    order.sort((a, b) => b.d - a.d);
    const minSep = Math.max(2, Math.floor(Math.min(cols, rows) / 2));
    for (const c of order) {
      if (chestCells.length >= 3) break;
      if (c.d < 2) continue;
      if (c.i === startCell.i && c.j === startCell.j) continue;
      if (c.i === exitCell.i && c.j === exitCell.j) continue;
      let ok = true;
      for (const o of chestCells) {
        if (Math.abs(o.i - c.i) + Math.abs(o.j - c.j) < minSep) { ok = false; break; }
      }
      if (!ok) continue;
      chestCells.push(c);
    }
    // 兜底
    for (const c of order) {
      if (chestCells.length >= 3) break;
      if (c === startCell) continue;
      if (chestCells.some((o) => o.i === c.i && o.j === c.j)) continue;
      chestCells.push(c);
    }
    if (chestCells.length < 3) return null;

    const chests = chestCells.map((c, k) => {
      const ct = cellCenter(c.i, c.j);
      // 轻微偏移，避免永远在正中心
      const ox = (rnd() - 0.5) * 1.6 * U;
      const oy = (rnd() - 0.5) * 1.6 * U;
      return {
        id: k, i: c.i, j: c.j,
        x: ct.x + ox, y: ct.y + oy,
        opened: false, openT: 0
      };
    });

    // 7) 陷阱坑洞：贴着某一面墙放，另一侧留出 2 身位通道
    const reserved = new Set();
    reserved.add(idx(startCell.i, startCell.j));
    reserved.add(idx(exitCell.i, exitCell.j));
    for (const c of chestCells) reserved.add(idx(c.i, c.j));
    // 出生点周围 2 格不放坑
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const ni = startCell.i + di, nj = startCell.j + dj;
        if (inb(ni, nj)) reserved.add(idx(ni, nj));
      }
    }

    const pitCand = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (!reserved.has(idx(i, j))) pitCand.push({ i, j });
    }
    LL.shuffle(rnd, pitCand);

    const pitR = LL.UNITS.pitR * U;
    const pits = [];
    for (const c of pitCand) {
      if (pits.length >= cfg.pits) break;
      const side = Math.floor(rnd() * 4);
      const x0 = c.i * pitch + wallT;
      const y0 = c.j * pitch + wallT;
      const cx = x0 + cellW / 2, cy = y0 + cellW / 2;
      let px = cx, py = cy;
      if (side === 3) px = x0 + pitR;           // 贴西墙
      else if (side === 1) px = x0 + cellW - pitR; // 贴东墙
      else if (side === 0) py = y0 + pitR;      // 贴北墙
      else py = y0 + cellW - pitR;              // 贴南墙
      pits.push({ x: px, y: py, r: pitR, phase: rnd() * 10 });
    }

    // 8) 弓箭口：装在封闭墙面上，朝通道内射击
    const emitCand = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (reserved.has(idx(i, j))) continue;
      for (const m of DIRS) {
        if (isOpen(i, j, m.d)) continue;
        if (!inb(i + m.di, j + m.dj) && !(i + m.di === -1 || j + m.dj === -1 || i + m.di === cols || j + m.dj === rows)) continue;
        emitCand.push({ i, j, d: m.d });
      }
    }
    LL.shuffle(rnd, emitCand);
    const emitters = [];
    const usedWalls = new Set();
    for (const c of emitCand) {
      if (emitters.length >= cfg.emitters) break;
      const m = DIRS[c.d];
      // 墙的全局坐标（用于去重）
      let wx, wy, horiz;
      if (c.d === 3) { wx = c.i; wy = c.j; horiz = false; }
      else if (c.d === 1) { wx = c.i + 1; wy = c.j; horiz = false; }
      else if (c.d === 0) { wx = c.i; wy = c.j; horiz = true; }
      else { wx = c.i; wy = c.j + 1; horiz = true; }
      const wk = (horiz ? 'H' : 'V') + wx + ',' + wy;
      if (usedWalls.has(wk)) continue;
      // 与宝箱/出生点保持距离
      const x0 = c.i * pitch + wallT;
      const y0 = c.j * pitch + wallT;
      const cx = x0 + cellW / 2, cy = y0 + cellW / 2;
      let mx, my, dx, dy;
      if (c.d === 3) { mx = x0 + 0.35 * U; my = cy; dx = 1; dy = 0; }
      else if (c.d === 1) { mx = x0 + cellW - 0.35 * U; my = cy; dx = -1; dy = 0; }
      else if (c.d === 0) { mx = cx; my = y0 + 0.35 * U; dx = 0; dy = 1; }
      else { mx = cx; my = y0 + cellW - 0.35 * U; dx = 0; dy = -1; }
      if (LL.dist(mx, my, start.x, start.y) < 4 * U) continue;
      usedWalls.add(wk);
      emitters.push({
        x: mx, y: my, dx, dy, side: c.d,
        cd: rnd() * cfg.arrowInterval,
        interval: cfg.arrowInterval,
        windup: cfg.arrowWindup,
        speed: cfg.arrowSpeed * U,
        charge: 0
      });
    }
    if (emitters.length < 1 && cfg.emitters > 0) return null;

    // 9) 墙体矩形
    const walls = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const connected = isOpen(i - 1, j, 1) && isOpen(i, j, 3);
        if (!connected) walls.push({ x: i * pitch, y: j * pitch, w: wallT, h: pitch });
      }
    }
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const connected = isOpen(i, j - 1, 2) && isOpen(i, j, 0);
        if (!connected) walls.push({ x: i * pitch, y: j * pitch, w: pitch, h: wallT });
      }
    }

    const m = {
      cfg, seed, cols, rows, pitch, wallT, cellW, W, H,
      open, dist, walls, pits, emitters, chests,
      start, startCell, exitCell, exitSide, exitPos,
      exitR: LL.UNITS.exitR * U,
      isOpen,
      cellCenter,
      r: LL.UNITS.playerR * U,
      path: null
    };
    return m;
  }

  // ---------- 可通行性校验（细网格 BFS） ----------
  function validate(m) {
    const res = 8; // 世界像素 / 格
    const gw = Math.ceil(m.W / res), gh = Math.ceil(m.H / res);
    const blocked = new Uint8Array(gw * gh);
    const pr = LL.UNITS.playerR * U;

    // 墙体膨胀
    for (const w of m.walls) {
      const x0 = Math.floor((w.x - pr) / res), x1 = Math.ceil((w.x + w.w + pr) / res);
      const y0 = Math.floor((w.y - pr) / res), y1 = Math.ceil((w.y + w.h + pr) / res);
      for (let gy = Math.max(0, y0); gy < Math.min(gh, y1); gy++) {
        for (let gx = Math.max(0, x0); gx < Math.min(gw, x1); gx++) {
          const cx = (gx + 0.5) * res, cy = (gy + 0.5) * res;
          const qx = LL.clamp(cx, w.x, w.x + w.w);
          const qy = LL.clamp(cy, w.y, w.y + w.h);
          if (LL.dist2(cx, cy, qx, qy) < pr * pr) blocked[gy * gw + gx] = 1;
        }
      }
    }
    // 坑洞：中心进入即死亡，所以半径内一律视为不可通行
    for (const p of m.pits) {
      const x0 = Math.floor((p.x - p.r) / res), x1 = Math.ceil((p.x + p.r) / res);
      const y0 = Math.floor((p.y - p.r) / res), y1 = Math.ceil((p.y + p.r) / res);
      for (let gy = Math.max(0, y0); gy < Math.min(gh, y1); gy++) {
        for (let gx = Math.max(0, x0); gx < Math.min(gw, x1); gx++) {
          const cx = (gx + 0.5) * res, cy = (gy + 0.5) * res;
          if (LL.dist2(cx, cy, p.x, p.y) < p.r * p.r) blocked[gy * gw + gx] = 1;
        }
      }
    }

    const toG = (x, y) => [Math.floor(x / res), Math.floor(y / res)];
    const [sx, sy] = toG(m.start.x, m.start.y);
    if (sx < 0 || sy < 0 || sx >= gw || sy >= gh) return false;
    if (blocked[sy * gw + sx]) return false;

    const seen = new Uint8Array(gw * gh);
    const q = [sy * gw + sx];
    seen[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      const gx = c % gw, gy = (c - gx) / gw;
      const nb = [
        [gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]
      ];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const nc = ny * gw + nx;
        if (seen[nc] || blocked[nc]) continue;
        seen[nc] = 1;
        q.push(nc);
      }
    }

    const reach = (x, y) => {
      const [gx, gy] = toG(x, y);
      if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return false;
      return !!seen[gy * gw + gx];
    };
    if (!reach(m.exitPos.x, m.exitPos.y)) return false;
    for (const c of m.chests) if (!reach(c.x, c.y)) return false;
    // 出口要能从格子内部走到
    return true;
  }

  // ---------- 对外 ----------
  LL.Maze = {
    generate: function (cfg, seedBase) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const m = build(cfg, (seedBase + attempt * 7919) >>> 0);
        if (!m) continue;
        if (validate(m)) return m;
      }
      throw new Error('迷宫生成失败（无法生成可通行布局）');
    },
    validate: validate
  };
})(window.LL);
