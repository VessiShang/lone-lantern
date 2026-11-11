// 迷宫生成离线自测（不依赖 Electron）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {}, console, Math, Date, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['src/util.js', 'src/levels.js', 'src/maze.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const LL = sandbox.window.LL;

function bfsCells(m) {
  const cols = m.cols, rows = m.rows;
  const dist = new Int32Array(cols * rows).fill(-1);
  const idx = (i, j) => j * cols + i;
  dist[idx(0, 0)] = 0;
  const q = [idx(0, 0)];
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const i = c % cols, j = (c - i) / cols;
    const dirs = [[0, -1, 0], [1, 0, 1], [0, 1, 2], [-1, 0, 3]];
    for (const [di, dj, d] of dirs) {
      if (!m.isOpen(i, j, d)) continue;
      const nc = idx(i + di, j + dj);
      if (dist[nc] === -1) { dist[nc] = dist[c] + 1; q.push(nc); }
    }
  }
  return dist;
}

let allOk = true;
for (const lv of LL.LEVELS) {
  const t0 = Date.now();
  let m;
  try {
    m = LL.Maze.generate(lv, lv.seed);
  } catch (e) {
    console.log(`[FAIL] 关卡${lv.id} 生成失败: ${e.message}`);
    allOk = false;
    continue;
  }
  const ms = Date.now() - t0;
  const ok = LL.Maze.validate(m);
  const dist = bfsCells(m);
  const idx = (i, j) => j * lv.cols + i;
  const exitDist = dist[idx(m.exitCell.i, m.exitCell.j)];
  let reachCells = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] >= 0) reachCells++;

  console.log(
    `关卡${lv.id} ${lv.name} (${lv.cols}x${lv.rows}) 生成 ${ms}ms | 校验=${ok ? 'PASS' : 'FAIL'}` +
    ` | 墙=${m.walls.length} 坑=${m.pits.length} 箭口=${m.emitters.length} 箱=${m.chests.length}` +
    ` | 出口步数=${exitDist} 可达格=${reachCells}/${dist.length}` +
    ` | 世界=${m.W}x${m.H}px`
  );
  if (!ok) allOk = false;

  // 坑与坑最小间距
  let minPit = 1e9;
  for (let i = 0; i < m.pits.length; i++) {
    for (let j = i + 1; j < m.pits.length; j++) {
      minPit = Math.min(minPit, LL.dist(m.pits[i].x, m.pits[i].y, m.pits[j].x, m.pits[j].y));
    }
  }
  if (m.pits.length > 1) console.log(`      坑间最小间距 ${minPit.toFixed(1)}px (坑直径 ${(m.pits[0].r * 2).toFixed(1)}px)`);

  // 出生点是否干净
  const p = m.start;
  let minWall = 1e9;
  for (const w of m.walls) {
    const qx = LL.clamp(p.x, w.x, w.x + w.w);
    const qy = LL.clamp(p.y, w.y, w.y + w.h);
    minWall = Math.min(minWall, LL.dist(p.x, p.y, qx, qy));
  }
  console.log(`      出生点距墙 ${minWall.toFixed(1)}px (需 > ${LL.UNITS.playerR * LL.UNITS.U})`);

  // 宝箱之间是否分散
  const ds = [];
  for (let i = 0; i < m.chests.length; i++) {
    for (let j = i + 1; j < m.chests.length; j++) {
      ds.push(LL.dist(m.chests[i].x, m.chests[i].y, m.chests[j].x, m.chests[j].y));
    }
  }
  console.log(`      宝箱间距 ${ds.map((d) => Math.round(d / LL.UNITS.U) + '身位').join(' / ')}`);
}
console.log(allOk ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allOk ? 0 : 1);
