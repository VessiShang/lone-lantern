const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const isSelftest = process.argv.includes('--selftest');
const ROOT = path.join(__dirname, '..');
const SELFTEST_DIR = process.env.LL_SELFTEST_DIR || path.join(ROOT, 'selftest');

// 兼容打包后 asar 内路径
function asset(p) {
  return path.join(__dirname, '..', p);
}

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#03050a',
    title: '孤灯迷径',
    show: false,
    autoHideMenuBar: true,
    icon: asset(path.join('assets', 'icon.png')),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(ROOT, 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    mainWindow = createWindow();
    if (isSelftest) {
      try {
        await runSelftest(mainWindow);
      } catch (err) {
        console.error('SELFTEST FAILED:', err);
        try {
          fs.mkdirSync(SELFTEST_DIR, { recursive: true });
          fs.writeFileSync(path.join(SELFTEST_DIR, 'error.txt'), String(err && err.stack || err));
        } catch (e) {}
        app.exit(2);
        return;
      }
      app.exit(0);
      return;
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

// ---------------- 自动化自测 ----------------
async function runSelftest(win) {
  const outDir = SELFTEST_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const logs = [];
  const push = (s) => { logs.push(s); console.log(s); };

  win.webContents.on('console-message', (e, level, message, line, source) => {
    // level: 0=verbose 1=info 2=warning 3=error
    if (level >= 2) push('[console:' + level + '] ' + message + ' @' + source + ':' + line);
  });
  win.webContents.on('render-process-gone', (e, details) => {
    push('[renderer-gone] ' + JSON.stringify(details));
  });

  const js = (code) => win.webContents.executeJavaScript(code, true);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, name), img.toPNG());
    push('shot ' + name + ' ' + img.toPNG().length + 'B');
  };

  const waitLoaded = async () => {
    for (let i = 0; i < 100; i++) {
      const ok = await js('!!(window.LL_GAME && window.__LL_TEST__)').catch(() => false);
      if (ok) return true;
      await sleep(100);
    }
    throw new Error('游戏未加载');
  };

  await waitLoaded();
  await sleep(500);
  await js('window.LL_GAME.testMode = true; 1');
  push('LOCALSTORAGE ' + (await js('(function(){ try { localStorage.setItem("ll_t","42"); const v = localStorage.getItem("ll_t"); localStorage.removeItem("ll_t"); return "OK:"+v; } catch(e) { return "ERR:"+e.message; } })()')));

  // 0. 随机走位压力测试：找"小人跑出画面 / 跑出地图 / NaN"这类问题
  const runFuzz = async (seed, lvIndex, frames) => {
    const res = await js(`
      (function(){
        const g = LL_GAME;
        __LL_TEST__.startLevel(${lvIndex});
        const bad = [];
        let s = ${seed};
        const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
        const picks = ['KeyW','KeyA','KeyS','KeyD'];
        let n = 0;
        for (let i = 0; i < ${frames}; i++) {
          if (i % 40 === 0) {
            for (const k of picks) LL.Input.inject(k, false);
            LL.Input.inject(picks[Math.floor(rnd()*4)], true);
            if (rnd() < 0.4) LL.Input.inject(picks[Math.floor(rnd()*4)], true);
          }
          g.update(1/60); LL.Input.endFrame(); n++;
          if (!isFinite(g.player.x) || !isFinite(g.player.y)) { bad.push(['NaN', i]); break; }
          if (g.player.x < 0 || g.player.y < 0 || g.player.x > g.maze.W || g.player.y > g.maze.H) {
            bad.push(['OUT_OF_MAP', i, Math.round(g.player.x), Math.round(g.player.y)]); break;
          }
          g.render();
          const sx = g.player.x * g.scale + g.tx, sy = g.player.y * g.scale + g.ty;
          if (sx < 0 || sy < 0 || sx > g.cw || sy > g.ch) {
            bad.push(['OFFSCREEN', i, Math.round(sx), Math.round(sy)]); break;
          }
          if (g.state === 'dead' || g.state === 'win') { g.retry(); }
        }
        for (const k of picks) LL.Input.inject(k, false);
        return JSON.stringify({bad: bad, frames: n, maze: [g.maze.cols, g.maze.rows]});
      })()
    `);
    push('FUZZ lv' + (lvIndex + 1) + ' seed=' + seed + ' ' + res);
    if (JSON.parse(res).bad.length) throw new Error('随机走位测试发现问题: ' + res);
  };

  await runFuzz(12345, 0, 3000);
  win.setSize(1680, 900);
  await sleep(600);
  await runFuzz(98765, 1, 2000);
  await runFuzz(24680, 2, 1200);
  win.setSize(1280, 780);
  await sleep(600);
  await js('for (const k of ["KeyW","KeyA","KeyS","KeyD"]) LL.Input.inject(k,false); LL_GAME.startLevel(0); LL_GAME.retry(); 1');
  await sleep(200);

  // 1. 标题
  await sleep(300);
  await shot('01-title.png');

  // 2. 章节选择
  await js('LL.UI.show("select"); 1');
  await sleep(400);
  await shot('02-select.png');

  // 2b. 操作说明
  await js('LL.UI.show("help"); 1');
  await sleep(350);
  await shot('02b-help.png');
  await js('LL.UI.show("select"); 1');
  await sleep(200);

  // 3. 进入第一关
  await js('__LL_TEST__.startLevel(0); 1');
  await sleep(300);
  await js('__LL_TEST__.advance(0.5); 1');
  await sleep(200);
  push('INFO ' + JSON.stringify(await js('JSON.stringify(__LL_TEST__.info())')));
  await shot('03-start.png');

  // 4. 向右走一段，验证移动/碰撞/光照
  const p0 = await js('JSON.stringify([Math.round(LL_GAME.player.x), Math.round(LL_GAME.player.y)])');
  await js('LL.Input.inject("KeyD", true); __LL_TEST__.advance(1.2); LL.Input.inject("KeyD", false); __LL_TEST__.advance(0.1); 1');
  const p1 = await js('JSON.stringify([Math.round(LL_GAME.player.x), Math.round(LL_GAME.player.y)])');
  push('MOVE ' + p0 + ' -> ' + p1);
  await sleep(200);
  await shot('04-walk.png');

  // 5. 走到地图中部看光照与迷宫
  await js(`
    const m = LL_GAME.maze;
    __LL_TEST__.teleport(m.W * 0.5, m.H * 0.5);
    __LL_TEST__.advance(0.4);
    1
  `);
  await sleep(200);
  await shot('05-middle.png');

  // 6. 宝箱交互
  const chestInfo = await js(`
    (function(){
      const c = LL_GAME.maze.chests[0];
      __LL_TEST__.teleport(c.x - 30, c.y + 20);
      __LL_TEST__.advance(0.3);
      return JSON.stringify({x: c.x, y: c.y, stars: LL_GAME.stars, hint: !!LL_GAME.hint});
    })()
  `);
  push('CHEST ' + chestInfo);
  await sleep(200);
  await shot('06-chest-hint.png');

  await js('LL.Input.inject("Space", true); __LL_TEST__.advance(0.05); LL.Input.inject("Space", false); __LL_TEST__.advance(0.9); 1');
  await sleep(200);
  const afterChest = await js('LL_GAME.stars');
  push('STARS AFTER OPEN=' + afterChest);
  await shot('07-chest-open.png');

  // 7. 弓箭：站在射线旁边（不挡箭）看箭飞出来，顺便看缩小后的弓箭口
  const arrowInfo = await js(`
    (function(){
      const e = LL_GAME.maze.emitters[0];
      if (!e) return 'NO_EMITTER';
      const px = e.x + e.dx * 74 - e.dy * 42;
      const py = e.y + e.dy * 74 + e.dx * 42;
      __LL_TEST__.teleport(px, py);
      let frames = 0;
      while (frames < 600 && LL_GAME.arrows.length === 0 && LL_GAME.state === 'playing') {
        LL_GAME.update(1/60); LL.Input.endFrame(); frames++;
      }
      if (LL_GAME.arrows.length > 0) __LL_TEST__.advance(0.12);
      return JSON.stringify({frames: frames, arrows: LL_GAME.arrows.length, state: LL_GAME.state});
    })()
  `);
  push('ARROW TEST ' + arrowInfo);
  await sleep(150);
  await shot('08-arrow.png');

  // 7b. 站到射线上被射死
  const shotDeath = await js(`
    (function(){
      for (const k of ['KeyW','KeyA','KeyS','KeyD']) LL.Input.inject(k, false);
      LL_GAME.retry();
      const e = LL_GAME.maze.emitters[0];
      __LL_TEST__.teleport(e.x + e.dx * 90, e.y + e.dy * 90);
      let n = 0;
      while (n < 600 && LL_GAME.state === 'playing') {
        LL_GAME.update(1/60); LL.Input.endFrame(); n++;
      }
      return JSON.stringify({state: LL_GAME.state, type: LL_GAME.deathType, frames: n});
    })()
  `);
  push('ARROW DEATH ' + shotDeath);
  await js('__LL_TEST__.advance(1.6); 1');
  await sleep(400);
  push('DEAD(shot) STATE=' + (await js('LL_GAME.state')));
  await shot('08b-shot-dead.png');

  // 8. 掉坑死亡
  await js(`
    (function(){
      LL_GAME.retry();
      const p = LL_GAME.maze.pits[0];
      __LL_TEST__.teleport(p.x, p.y);
      __LL_TEST__.advance(0.15);
    })();
    1
  `);
  const st1 = await js('LL_GAME.state');
  push('AFTER PIT STATE=' + st1);
  await js('__LL_TEST__.advance(1.6); 1');
  await sleep(500);
  push('DEAD(fall) STATE=' + (await js('LL_GAME.state')));
  await shot('09-dead.png');

  // 9. 通关
  await js(`
    (function(){
      LL_GAME.retry();
      LL_GAME.stars = 3;
      const ex = LL_GAME.maze.exitPos;
      __LL_TEST__.teleport(ex.x, ex.y);
      __LL_TEST__.advance(0.1);
    })();
    1
  `);
  await sleep(900);
  push('WIN STATE=' + (await js('LL_GAME.state')));
  await shot('10-win.png');

  // 12. 相机边界回归测试：贴四个角时小人必须还在屏幕安全区内
  const camTest = await js(`
    (function(){
      const m = LL_GAME.maze, g = LL_GAME;
      const corner = [[30,30],[m.W-30,30],[30,m.H-30],[m.W-30,m.H-30]];
      const pts = [];
      for (const [x,y] of corner) {
        __LL_TEST__.teleport(x, y);
        g.render();                       // 必须先渲染一次，tx/scale 才是新值
        const sx = g.player.x * g.scale + g.tx;
        const sy = g.player.y * g.scale + g.ty;
        pts.push([Math.round(sx), Math.round(sy)]);
      }
      return JSON.stringify({view:[g.cw,g.ch], pts: pts});
    })()
  `);
  push('CAMERA ' + camTest);
  const camData = JSON.parse(camTest);
  const [vw, vh] = camData.view;
  let camOK = true;
  for (const [sx, sy] of camData.pts) {
    if (sx < vw * 0.10 || sx > vw * 0.90 || sy < vh * 0.12 || sy > vh * 0.90) camOK = false;
  }
  push('CAMERA SAFE AREA = ' + (camOK ? 'PASS' : 'FAIL'));
  if (!camOK) throw new Error('相机边界测试失败: ' + camTest);

  // 回到起点截图
  await js('LL_GAME.retry(); 1');
  await sleep(200);

  // 13. 第二、三章截图 + 生成耗时 + 渲染性能
  for (const [idx, name] of [[1, '12-level2.png'], [2, '13-level3.png']]) {
    const info = await js(`
      (function(){
        const t0 = performance.now();
        __LL_TEST__.startLevel(${idx});
        const genMs = performance.now() - t0;
        __LL_TEST__.advance(0.5);
        // 渲染性能：100 帧
        const t1 = performance.now();
        for (let i = 0; i < 100; i++) LL_GAME.render();
        const renderMs = (performance.now() - t1) / 100;
        return JSON.stringify({genMs: Math.round(genMs), renderMs: +renderMs.toFixed(2),
          maze: [LL_GAME.maze.cols, LL_GAME.maze.rows], walls: LL_GAME.maze.walls.length,
          pits: LL_GAME.maze.pits.length, emitters: LL_GAME.maze.emitters.length});
      })()
    `);
    push('LEVEL' + (idx + 1) + ' ' + info);
    await sleep(300);
    await shot(name);
  }
  await js('LL_GAME.startLevel(0); 1');
  await sleep(200);

  fs.writeFileSync(path.join(outDir, 'log.txt'), logs.join('\n') + '\n');
  push('SELFTEST OK');
}
