// 游戏主体：渲染 / 光照 / 玩法循环
window.LL = window.LL || {};
(function (LL) {
  'use strict';
  const U = LL.UNITS.U;
  const TAU = LL.TAU;

  function hash2(x, y) {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  }

  function starPath(ctx, cx, cy, R, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 === 0 ? R : r;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function Game(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cw = 0; this.ch = 0; this.dpr = 1;
    this.state = 'title';
    this.levelIndex = 0;
    this.level = null;
    this.maze = null;
    this.player = { x: 0, y: 0, vx: 0, vy: 0, r: LL.UNITS.playerR * U, facing: Math.PI / 2, walkT: 0, bob: 0 };
    this.arrows = [];
    this.particles = [];
    this.texts = [];
    this.stars = 0;
    this.timeSec = 0;
    this.tGlobal = 0;
    this.cam = { x: 0, y: 0 };
    this.scale = 1; this.tx = 0; this.ty = 0;
    this.shake = 0;
    this.deathType = null;
    this.deathT = 0;
    this.pitTarget = null;
    this.hint = null;
    this.exitCooldown = 0;
    this.invuln = false;
    this.onStateChange = null;
    this.lightCanvas = document.createElement('canvas');
    this.exploredCanvas = document.createElement('canvas');
    this.exScale = 0.28;
    this.stepAcc = 0;
    this.muted = false;
    this.fastTest = false;
  }

  Game.prototype.emitState = function () {
    if (this.onStateChange) this.onStateChange(this.state);
  };

  Game.prototype.resize = function () {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cw = Math.max(320, Math.round(rect.width));
    this.ch = Math.max(240, Math.round(rect.height));
    this.dpr = dpr;
    this.canvas.width = Math.round(this.cw * dpr);
    this.canvas.height = Math.round(this.ch * dpr);
    this.lightCanvas.width = this.canvas.width;
    this.lightCanvas.height = this.canvas.height;
  };

  // ---------------- 关卡 ----------------
  Game.prototype.startLevel = function (index) {
    this.levelIndex = index;
    this.level = LL.LEVELS[index];
    this.maze = LL.Maze.generate(this.level, this.level.seed);
    this.buildExplored();
    this.resetLevel();
    this.state = 'playing';
    this.emitState();
  };

  Game.prototype.buildExplored = function () {
    const m = this.maze;
    const s = this.exScale;
    const ec = this.exploredCanvas;
    ec.width = Math.ceil(m.W * s) + 2;
    ec.height = Math.ceil(m.H * s) + 2;
    const c = ec.getContext('2d');
    // 必须保持透明底：合成时用 destination-out，按 alpha 擦除
    c.clearRect(0, 0, ec.width, ec.height);
  };

  Game.prototype.resetLevel = function () {
    const m = this.maze;
    this.player.x = m.start.x;
    this.player.y = m.start.y;
    this.player.vx = this.player.vy = 0;
    this.player.facing = Math.PI / 2;
    this.player.walkT = 0;
    this.arrows.length = 0;
    this.particles.length = 0;
    this.texts.length = 0;
    this.stars = 0;
    this.timeSec = 0;
    this.deathType = null;
    this.deathT = 0;
    this.shake = 0;
    this.exitCooldown = 0;
    this.stepAcc = 0;
    for (const ch of m.chests) { ch.opened = false; ch.openT = 0; }
    for (const e of m.emitters) {
      e.cd = e.interval * (0.35 + 0.5 * ((e.x * 13 + e.y * 7) % 100) / 100);
      e.charge = 0;
    }
    // 相机立即对准
    this.updateCamera(1);
    this.stampExplored();
  };

  Game.prototype.pause = function () {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.emitState();
  };
  Game.prototype.resume = function () {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.emitState();
  };
  Game.prototype.retry = function () {
    this.resetLevel();
    this.state = 'playing';
    this.emitState();
  };
  Game.prototype.toTitle = function () {
    this.state = 'title';
    this.emitState();
  };

  // ---------------- 更新 ----------------
  Game.prototype.update = function (dt) {
    this.tGlobal += dt;
    if (this.state === 'playing') {
      this.updatePlaying(dt);
    } else if (this.state === 'dying') {
      this.updateDying(dt);
    }
    this.updateParticles(dt);
    this.updateTexts(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.4);
  };

  Game.prototype.updatePlaying = function (dt) {
    const p = this.player;
    const m = this.maze;
    this.timeSec += dt;
    if (this.exitCooldown > 0) this.exitCooldown -= dt;

    const ax = LL.Input.axis();
    const speed = 3.5 * U;
    const k = 1 - Math.exp(-dt * 16);
    p.vx = LL.lerp(p.vx, ax.x * speed, k);
    p.vy = LL.lerp(p.vy, ax.y * speed, k);

    this.moveEntity(p, p.vx * dt, p.vy * dt, m.walls);

    const moved = Math.hypot(p.vx, p.vy);
    if (moved > 6) {
      const target = Math.atan2(p.vy, p.vx);
      let diff = target - p.facing;
      while (diff > Math.PI) diff -= TAU;
      while (diff < -Math.PI) diff += TAU;
      p.facing += diff * (1 - Math.exp(-dt * 14));
      p.walkT += dt * Math.min(1.6, moved / speed * 1.4);
      p.bob = Math.sin(p.walkT * 9.5) * 0.035 * U;
      // 脚步声
      this.stepAcc += moved * dt;
      if (this.stepAcc > 0.95 * U) {
        this.stepAcc = 0;
        LL.Audio.play('step', 0.20 + Math.random() * 0.1, 0.92 + Math.random() * 0.16);
      }
    } else {
      p.bob *= Math.max(0, 1 - dt * 8);
    }

    this.updateCamera(dt);
    this.stampExplored();
    this.updateEmitters(dt);
    this.updateArrows(dt);
    this.updateChests(dt);
    this.checkHazards();
    this.checkExit();
    this.handleInteract();
  };

  Game.prototype.updateCamera = function (dt) {
    const m = this.maze;
    if (!m) return;
    const scale = Math.min(this.cw, this.ch) / (2 * this.level.viewR * U);
    const halfW = this.cw / (2 * scale), halfH = this.ch / (2 * scale);
    // 允许镜头越出地图边缘一段距离：
    // 否则贴边时相机会被硬夹住，把小人顶到屏幕最外沿（左上角还会被 HUD 盖住）
    const margin = this.level.viewR * U * 0.45;
    const clampAxis = (v, size, half) => {
      if (size < 2 * (half - margin)) return size / 2;
      return LL.clamp(v, half - margin, size - half + margin);
    };
    const tx = clampAxis(this.player.x, m.W, halfW);
    const ty = clampAxis(this.player.y, m.H, halfH);
    if (dt >= 1) { this.cam.x = tx; this.cam.y = ty; }
    else {
      const k = 1 - Math.exp(-dt * 12);
      this.cam.x = LL.lerp(this.cam.x, tx, k);
      this.cam.y = LL.lerp(this.cam.y, ty, k);
    }
  };

  // 圆形(用方形近似)与墙体的分轴滑动碰撞
  // 关键：用 min/max 夹取而不是直接赋值，并且最后硬性限制在迷宫内。
  // 否则一旦因为浮点误差嵌进墙里，反向移动会被推到墙的外侧，直接飞出地图。
  Game.prototype.moveEntity = function (e, dx, dy, walls) {
    const h = e.r * 0.90;
    const EPS = 0.01;
    if (dx) {
      e.x += dx;
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (e.x + h > w.x && e.x - h < w.x + w.w && e.y + h > w.y && e.y - h < w.y + w.h) {
          if (dx > 0) e.x = Math.min(e.x, w.x - h - EPS);
          else e.x = Math.max(e.x, w.x + w.w + h + EPS);
        }
      }
    }
    if (dy) {
      e.y += dy;
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (e.x + h > w.x && e.x - h < w.x + w.w && e.y + h > w.y && e.y - h < w.y + w.h) {
          if (dy > 0) e.y = Math.min(e.y, w.y - h - EPS);
          else e.y = Math.max(e.y, w.y + w.h + h + EPS);
        }
      }
    }
    // 兜底：绝不能离开迷宫（外墙内侧边界）
    const m = this.maze;
    if (m) {
      e.x = LL.clamp(e.x, m.wallT + h + EPS, m.W - m.wallT - h - EPS);
      e.y = LL.clamp(e.y, m.wallT + h + EPS, m.H - m.wallT - h - EPS);
    }
  };

  Game.prototype.stampExplored = function () {
    const m = this.maze;
    if (!m) return;
    const s = this.exScale;
    const ec = this.exploredCanvas;
    const c = ec.getContext('2d');
    const R = this.level.lanternR * U * 0.92 * s;
    const px = this.player.x * s, py = this.player.y * s;
    c.globalCompositeOperation = 'source-over';
    const g = c.createRadialGradient(px, py, R * 0.15, px, py, R);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.62, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(px, py, R, 0, TAU);
    c.fill();
  };

  Game.prototype.updateEmitters = function (dt) {
    for (const e of this.maze.emitters) {
      e.cd -= dt;
      if (e.cd <= e.windup) e.charge = LL.clamp(1 - e.cd / e.windup, 0, 1);
      else e.charge = 0;
      if (e.cd <= 0) {
        e.cd += e.interval;
        this.fireArrow(e);
      }
    }
  };

  Game.prototype.fireArrow = function (e) {
    this.arrows.push({
      x: e.x + e.dx * 0.42 * U,
      y: e.y + e.dy * 0.42 * U,
      dx: e.dx, dy: e.dy,
      speed: e.speed,
      life: 0, maxLife: 2.2,
      trail: []
    });
    LL.Audio.playAt('arrow', e.x, e.y, this.player.x, this.player.y, 0.75);
  };

  Game.prototype.updateArrows = function (dt) {
    const m = this.maze;
    const p = this.player;
    const walls = m.walls;
    const out = [];
    for (const a of this.arrows) {
      a.life += dt;
      if (a.life > a.maxLife) continue;
      const total = a.speed * dt;
      const steps = Math.max(1, Math.ceil(total / 7));
      const sx = total / steps;
      let alive = true;
      a.trail.push({ x: a.x, y: a.y });
      if (a.trail.length > 5) a.trail.shift();
      for (let s = 0; s < steps && alive; s++) {
        a.x += a.dx * sx;
        a.y += a.dy * sx;
        // 撞墙
        for (let i = 0; i < walls.length; i++) {
          const w = walls[i];
          if (a.x > w.x && a.x < w.x + w.w && a.y > w.y && a.y < w.y + w.h) {
            alive = false;
            this.spawnSparks(a.x, a.y);
            break;
          }
        }
        if (!alive) break;
        // 撞玩家
        if (this.state === 'playing' && !this.invuln) {
          if (LL.dist2(a.x, a.y, p.x, p.y) < (p.r * 0.86) * (p.r * 0.86)) {
            this.die('shot', a);
            alive = false;
            break;
          }
        }
      }
      if (alive) out.push(a);
    }
    this.arrows = out;
  };

  Game.prototype.spawnSparks = function (x, y) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * TAU;
      const sp = 40 + Math.random() * 90;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, maxLife: 0.28 + Math.random() * 0.22,
        size: 1.5 + Math.random() * 2, color: '#c9b27a', grav: 0
      });
    }
  };

  Game.prototype.updateChests = function (dt) {
    for (const c of this.maze.chests) {
      if (c.opened && c.openT < 1) c.openT = Math.min(1, c.openT + dt * 3.2);
    }
  };

  Game.prototype.checkHazards = function () {
    const p = this.player;
    if (this.invuln) return;
    for (const pit of this.maze.pits) {
      if (LL.dist2(p.x, p.y, pit.x, pit.y) < (pit.r * 0.95) * (pit.r * 0.95)) {
        this.die('fall', pit);
        return;
      }
    }
  };

  Game.prototype.checkExit = function () {
    if (this.exitCooldown > 0) return;
    const p = this.player;
    const ex = this.maze.exitPos;
    if (LL.dist2(p.x, p.y, ex.x, ex.y) < this.maze.exitR * this.maze.exitR) {
      this.win();
    }
  };

  Game.prototype.handleInteract = function () {
    const p = this.player;
    let near = null;
    for (const c of this.maze.chests) {
      if (c.opened) continue;
      if (LL.dist2(p.x, p.y, c.x, c.y) < (1.75 * U) * (1.75 * U)) { near = c; break; }
    }
    this.hint = near ? { x: near.x, y: near.y } : null;
    if (near && LL.Input.consumeAction()) {
      near.opened = true;
      near.openT = 0;
      this.stars++;
      LL.Audio.play('chest', 0.85);
      setTimeout(() => LL.Audio.play('star', 0.8), 260);
      this.texts.push({
        x: near.x, y: near.y - 0.9 * U, text: '+1 星辰', life: 0,
        maxLife: 1.4, color: '#ffd98a'
      });
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * TAU;
        const sp = 30 + Math.random() * 110;
        this.particles.push({
          x: near.x, y: near.y - 0.2 * U,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
          life: 0, maxLife: 0.5 + Math.random() * 0.5,
          size: 1.5 + Math.random() * 2.5,
          color: Math.random() < 0.5 ? '#ffe9a8' : '#ffb347', grav: 120
        });
      }
      this.emitState();
    }
  };

  Game.prototype.updateParticles = function (dt) {
    const out = [];
    for (const q of this.particles) {
      q.life += dt;
      if (q.life >= q.maxLife) continue;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.grav) q.vy += q.grav * dt;
      q.vx *= (1 - dt * 1.6);
      q.vy *= (1 - dt * 1.6);
      out.push(q);
    }
    this.particles = out;
  };

  Game.prototype.updateTexts = function (dt) {
    const out = [];
    for (const t of this.texts) {
      t.life += dt;
      if (t.life >= t.maxLife) continue;
      out.push(t);
    }
    this.texts = out;
  };

  // ---------------- 死亡 / 通关 ----------------
  Game.prototype.die = function (type, src) {
    if (this.state !== 'playing') return;
    this.state = 'dying';
    this.deathType = type;
    this.deathT = 0;
    this.shake = 1;
    this.pitTarget = type === 'fall' && src ? { x: src.x, y: src.y } : null;
    LL.Audio.play(type === 'fall' ? 'death' : 'death', 0.95);
    if (type === 'shot') {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * TAU;
        const sp = 40 + Math.random() * 150;
        this.particles.push({
          x: this.player.x, y: this.player.y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0, maxLife: 0.4 + Math.random() * 0.4,
          size: 2 + Math.random() * 2.5,
          color: Math.random() < 0.6 ? '#a8232b' : '#f0d0c0', grav: 200
        });
      }
    }
    this.emitState();
  };

  Game.prototype.updateDying = function (dt) {
    this.deathT += dt;
    const p = this.player;
    if (this.deathType === 'fall' && this.pitTarget) {
      const k = Math.min(1, this.deathT / 0.55);
      p.x = LL.lerp(p.x, this.pitTarget.x, 1 - Math.exp(-dt * 9));
      p.y = LL.lerp(p.y, this.pitTarget.y, 1 - Math.exp(-dt * 9));
      p.fallK = k;
    }
    if (this.deathT > 1.15) {
      this.state = 'dead';
      this.emitState();
    }
  };

  Game.prototype.win = function () {
    if (this.state !== 'playing') return;
    this.state = 'win';
    LL.Audio.play('win', 0.85);
    // 星辰迸发
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * TAU;
      const sp = 60 + Math.random() * 220;
      this.particles.push({
        x: this.player.x, y: this.player.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, maxLife: 0.7 + Math.random() * 0.8,
        size: 1.5 + Math.random() * 3,
        color: Math.random() < 0.5 ? '#ffd98a' : '#8fd8ff', grav: 60
      });
    }
    this.emitState();
  };

  Game.prototype.continueExploring = function () {
    if (this.state !== 'win') return;
    this.state = 'playing';
    this.exitCooldown = 2.6;
    this.emitState();
  };

  // ---------------- 渲染 ----------------
  Game.prototype.render = function () {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#03050a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.maze || this.state === 'title') return;

    const m = this.maze;
    const scale = Math.min(this.cw, this.ch) / (2 * this.level.viewR * U);
    let shakeX = 0, shakeY = 0;
    if (this.shake > 0) {
      const s = this.shake * this.shake * 9;
      shakeX = (Math.random() - 0.5) * s;
      shakeY = (Math.random() - 0.5) * s;
    }
    const tx = this.cw / 2 - this.cam.x * scale + shakeX;
    const ty = this.ch / 2 - this.cam.y * scale + shakeY;
    this.scale = scale; this.tx = tx; this.ty = ty;
    this.viewL = this.cam.x - this.cw / (2 * scale);
    this.viewT = this.cam.y - this.ch / (2 * scale);
    this.viewR2 = this.cam.x + this.cw / (2 * scale);
    this.viewB = this.cam.y + this.ch / (2 * scale);

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);
    this.drawFloor(ctx);
    this.drawPits(ctx);
    this.drawExit(ctx);
    this.drawWalls(ctx);
    this.drawEmitters(ctx);
    this.drawChests(ctx);
    this.drawArrows(ctx);
    this.drawPlayer(ctx);
    this.drawParticles(ctx);
    this.drawTexts(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.renderLighting();
    this.renderGlow();
    this.renderVignette();
    // 宝箱信标压在所有黑暗之上
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);
    this.drawChestBeacons(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.renderOverlayUI();
  };

  Game.prototype.drawFloor = function (ctx) {
    const m = this.maze;
    const x0 = Math.max(0, Math.floor(this.viewL / m.pitch) - 1);
    const x1 = Math.min(m.cols - 1, Math.floor(this.viewR2 / m.pitch) + 1);
    const y0 = Math.max(0, Math.floor(this.viewT / m.pitch) - 1);
    const y1 = Math.min(m.rows - 1, Math.floor(this.viewB / m.pitch) + 1);
    // 迷宫外面是实心岩层（不是纯黑空洞），镜头越界时也不会"穿帮"
    ctx.fillStyle = '#15181f';
    ctx.fillRect(this.viewL - U, this.viewT - U,
      (this.viewR2 - this.viewL) + U * 2, (this.viewB - this.viewT) + U * 2);
    // 迷宫内是一整块干净地面（压暗，和墙拉开对比）
    ctx.fillStyle = '#252b39';
    ctx.fillRect(
      x0 * m.pitch, y0 * m.pitch,
      (x1 - x0 + 1) * m.pitch + m.wallT, (y1 - y0 + 1) * m.pitch + m.wallT
    );
  };

  Game.prototype.drawWalls = function (ctx) {
    const m = this.maze;
    const walls = m.walls;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (w.x > this.viewR2 || w.x + w.w < this.viewL || w.y > this.viewB || w.y + w.h < this.viewT) continue;
      // 实心石块：亮一档的石色 + 上/左受光、下/右背光，和地面拉开明显对比
      ctx.fillStyle = '#66739a';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      const b = Math.min(5, Math.min(w.w, w.h) * 0.32);
      ctx.fillStyle = 'rgba(205,222,255,0.30)';
      ctx.fillRect(w.x, w.y, w.w, b);              // 上沿受光
      ctx.fillRect(w.x, w.y, b, w.h);              // 左沿受光
      ctx.fillStyle = 'rgba(3,5,11,0.50)';
      ctx.fillRect(w.x, w.y + w.h - b, w.w, b);    // 下沿背光
      ctx.fillRect(w.x + w.w - b, w.y, b, w.h);    // 右沿背光
    }
  };

  Game.prototype.drawPits = function (ctx) {
    for (const p of this.maze.pits) {
      if (p.x + p.r < this.viewL || p.x - p.r > this.viewR2 || p.y + p.r < this.viewT || p.y - p.r > this.viewB) continue;
      // 只比地面暗一点点：靠一点点明暗差暗示"这里不是实地"
      const g = ctx.createRadialGradient(p.x, p.y, p.r * 0.12, p.x, p.y, p.r);
      g.addColorStop(0, '#1e2431');
      g.addColorStop(0.45, '#242b3a');
      g.addColorStop(0.78, '#2c3444');
      g.addColorStop(1, '#333c50');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
      // 极淡的一圈内沿
      ctx.strokeStyle = 'rgba(150,168,205,0.07)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r - 1.0, 0, TAU);
      ctx.stroke();
    }
  };

  Game.prototype.drawChests = function (ctx) {
    for (const c of this.maze.chests) {
      if (c.x + 60 < this.viewL || c.x - 60 > this.viewR2 || c.y + 60 < this.viewT || c.y - 60 > this.viewB) continue;
      const t = this.tGlobal;
      const bob = Math.sin(t * 2 + c.id) * 1.2;
      const s = 0.62 * U;
      const near = !c.opened && LL.dist2(this.player.x, this.player.y, c.x, c.y) < (1.75 * U) * (1.75 * U);
      // 光晕
      const gl = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, s * 3.0);
      const a = c.opened ? 0.16 : (near ? 0.34 : 0.24) + Math.sin(t * 2.4 + c.id) * 0.05;
      gl.addColorStop(0, 'rgba(255,206,110,' + a + ')');
      gl.addColorStop(0.45, 'rgba(255,180,70,' + (a * 0.45) + ')');
      gl.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(c.x, c.y, s * 3.0, 0, TAU);
      ctx.fill();

      // 影子
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + s * 0.55, s * 0.85, s * 0.32, 0, 0, TAU);
      ctx.fill();

      const top = c.y - s * 0.35 + bob;
      // 箱体
      ctx.fillStyle = '#5a4026';
      ctx.fillRect(c.x - s * 0.8, top, s * 1.6, s * 1.0);
      ctx.fillStyle = '#8a6132';
      ctx.fillRect(c.x - s * 0.8, top, s * 1.6, s * 0.34);
      // 金属包边
      ctx.fillStyle = '#46341f';
      ctx.fillRect(c.x - s * 0.8, top + s * 0.30, s * 1.6, s * 0.10);
      ctx.fillStyle = '#e8c46a';
      ctx.fillRect(c.x - s * 0.14, top + s * 0.28, s * 0.28, s * 0.30);
      // 盖（打开时翻起）
      const openK = c.opened ? c.openT : 0;
      const lidY = top - openK * s * 0.55;
      const lidH = s * 0.34 * (1 - openK * 0.5);
      ctx.fillStyle = '#a06f34';
      ctx.fillRect(c.x - s * 0.86, lidY - lidH, s * 1.72, lidH);
      ctx.fillStyle = 'rgba(255,225,160,0.28)';
      ctx.fillRect(c.x - s * 0.86, lidY - lidH, s * 1.72, 2);

      // 星光
      if (c.opened && c.openT > 0.35) {
        const k = LL.clamp((c.openT - 0.35) / 0.65, 0, 1);
        const sy = c.y - s * 0.5 - k * s * 0.9 + Math.sin(t * 3 + c.id) * 2;
        ctx.save();
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 4);
        const g2 = ctx.createRadialGradient(c.x, sy, 0, c.x, sy, s * 1.5);
        g2.addColorStop(0, 'rgba(255,235,170,0.55)');
        g2.addColorStop(1, 'rgba(255,200,90,0)');
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(c.x, sy, s * 1.5, 0, TAU); ctx.fill();
        starPath(ctx, c.x, sy, s * 0.42, s * 0.18, t * 0.8);
        const sg = ctx.createLinearGradient(c.x, sy - s * 0.4, c.x, sy + s * 0.4);
        sg.addColorStop(0, '#fff6d0');
        sg.addColorStop(1, '#ffc247');
        ctx.fillStyle = sg;
        ctx.fill();
        ctx.restore();
      } else if (!c.opened) {
        // 未开启时箱内透出的微光
        ctx.fillStyle = 'rgba(255,200,110,' + (0.10 + Math.sin(t * 2.4 + c.id) * 0.04) + ')';
        ctx.fillRect(c.x - s * 0.7, top + s * 0.02, s * 1.4, s * 0.05);
      }
    }
  };

  Game.prototype.drawEmitters = function (ctx) {
    for (const e of this.maze.emitters) {
      if (e.x + 80 < this.viewL || e.x - 80 > this.viewR2 || e.y + 80 < this.viewT || e.y - 80 > this.viewB) continue;
      // 画在墙面上、且大半嵌进墙里——只留一条很窄的暗槽
      const s = 0.30 * U;
      const fx = e.x - e.dx * 0.35 * U;   // 墙面位置
      const fy = e.y - e.dy * 0.35 * U;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(Math.atan2(e.dy, e.dx));
      // 凹槽（比墙略深一点，靠"暗"而不是靠"亮"来辨认）
      ctx.fillStyle = '#191d29';
      ctx.fillRect(-s * 0.22, -s * 0.34, s * 0.44, s * 0.68);
      // 槽口一点微弱的冷光，暗示这不是墙缝
      ctx.fillStyle = 'rgba(120,140,180,0.14)';
      ctx.fillRect(-s * 0.22, -s * 0.34, s * 0.10, s * 0.68);
      // 弓臂：只露出很窄的一段
      ctx.strokeStyle = 'rgba(120,106,72,0.75)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(s * 0.10, -s * 0.30);
      ctx.quadraticCurveTo(s * 0.30, 0, s * 0.10, s * 0.30);
      ctx.stroke();
      // 蓄力时才亮（公平性提示：射之前能看到一点点红）
      if (e.charge > 0.02) {
        const a = e.charge * 0.55;
        const g = ctx.createRadialGradient(s * 0.05, 0, 0, s * 0.05, 0, s * (0.25 + e.charge * 0.45));
        g.addColorStop(0, 'rgba(255,120,90,' + a + ')');
        g.addColorStop(1, 'rgba(255,60,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(s * 0.05, 0, s * (0.25 + e.charge * 0.45), 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  };

  Game.prototype.drawArrows = function (ctx) {
    for (const a of this.arrows) {
      // 拖尾
      for (let i = 0; i < a.trail.length; i++) {
        const t = a.trail[i];
        const k = (i + 1) / a.trail.length;
        ctx.strokeStyle = 'rgba(255,220,170,' + (0.06 * k) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x + a.dx * 10, t.y + a.dy * 10);
        ctx.stroke();
      }
      const len = 0.5 * U;
      const tipX = a.x, tipY = a.y;
      const bx = a.x - a.dx * len, by = a.y - a.dy * len;
      ctx.strokeStyle = '#d9c9a8';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      // 箭羽
      const px = -a.dy, py = a.dx;
      ctx.strokeStyle = '#a8563a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx + px * 4, by + py * 4);
      ctx.lineTo(bx - px * 4, by - py * 4);
      ctx.stroke();
      // 箭头亮点
      ctx.fillStyle = '#fff2cf';
      ctx.beginPath();
      ctx.arc(tipX, tipY, 2.4, 0, TAU);
      ctx.fill();
    }
  };

  Game.prototype.drawExit = function (ctx) {
    const m = this.maze;
    const ex = m.exitPos;
    if (ex.x + 120 < this.viewL || ex.x - 120 > this.viewR2 || ex.y + 120 < this.viewT || ex.y - 120 > this.viewB) return;
    const t = this.tGlobal;
    const side = m.exitSide;
    const w = 2.4 * U, h = 2.4 * U;
    let x = ex.x, y = ex.y, rot = 0;
    if (side === 3) { rot = -Math.PI / 2; }
    else if (side === 1) { rot = Math.PI / 2; }
    else if (side === 0) { rot = Math.PI; }
    else { rot = 0; }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    // 门洞光
    const pulse = 0.55 + 0.45 * Math.sin(t * 2.2);
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, w * 0.95);
    g.addColorStop(0, 'rgba(150,230,255,' + (0.30 + 0.12 * pulse) + ')');
    g.addColorStop(0.55, 'rgba(90,180,240,0.12)');
    g.addColorStop(1, 'rgba(60,140,220,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, w * 0.95, 0, TAU); ctx.fill();
    // 门框
    ctx.fillStyle = '#0a1220';
    ctx.beginPath();
    ctx.moveTo(-w / 2, h / 2);
    ctx.lineTo(-w / 2, -h / 2 + w * 0.45);
    ctx.quadraticCurveTo(-w / 2, -h / 2, 0, -h / 2);
    ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + w * 0.45);
    ctx.lineTo(w / 2, h / 2);
    ctx.closePath();
    ctx.fill();
    // 内部光墙
    ctx.save();
    ctx.clip();
    const g2 = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g2.addColorStop(0, 'rgba(170,240,255,' + (0.55 + 0.2 * pulse) + ')');
    g2.addColorStop(1, 'rgba(70,150,220,' + (0.28 + 0.12 * pulse) + ')');
    ctx.fillStyle = g2;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
    // 门框描边
    ctx.strokeStyle = 'rgba(190,235,255,' + (0.5 + 0.2 * pulse) + ')';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-w / 2, h / 2);
    ctx.lineTo(-w / 2, -h / 2 + w * 0.45);
    ctx.quadraticCurveTo(-w / 2, -h / 2, 0, -h / 2);
    ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + w * 0.45);
    ctx.lineTo(w / 2, h / 2);
    ctx.stroke();
    ctx.restore();
  };

  Game.prototype.drawPlayer = function (ctx) {
    const p = this.player;
    const deathK = this.state === 'dying' && this.deathType === 'fall' ? (p.fallK || 0) : 0;
    const alpha = 1 - deathK;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (deathK > 0) {
      ctx.translate(p.x, p.y);
      ctx.scale(1 - deathK * 0.7, 1 - deathK * 0.7);
      ctx.rotate(deathK * 1.6);
      ctx.translate(-p.x, -p.y);
    }
    const bobY = p.bob;
    const bodyY = p.y + bobY * 0.5;
    const t = this.tGlobal;

    // 提灯位置（右手偏前），随步伐轻摆
    const la = p.facing + 1.15;
    const sway = Math.sin(p.walkT * 9.5) * 0.035 * U;
    const lx = p.x + Math.cos(la) * (0.60 * U) + Math.cos(la + Math.PI / 2) * sway;
    const ly = bodyY + Math.sin(la) * (0.60 * U) + Math.sin(la + Math.PI / 2) * sway;

    // ---- 地面光斑（提灯洒在地上的暖光）----
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pool = ctx.createRadialGradient(lx, ly, 0, lx, ly, 1.5 * U);
    pool.addColorStop(0, 'rgba(255,190,105,0.20)');
    pool.addColorStop(0.45, 'rgba(255,165,75,0.08)');
    pool.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(lx, ly + 0.15 * U, 1.5 * U, 1.15 * U, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 0.36 * U, 0.46 * U, 0.19 * U, 0, 0, TAU);
    ctx.fill();

    // ---- 人物（朝向前方）----
    ctx.save();
    ctx.translate(p.x, bodyY);
    ctx.rotate(p.facing);

    const BW = 0.48 * U, BH = 0.36 * U;
    const HOOD = 0.23 * U, HX = 0.24 * U;

    // 斗篷：深色，前窄后阔，形成清晰的剪影
    const cg = ctx.createRadialGradient(-0.10 * U, -0.08 * U, 0.04 * U, -0.04 * U, 0, 0.62 * U);
    cg.addColorStop(0, '#2f3958');
    cg.addColorStop(0.55, '#1c2237');
    cg.addColorStop(1, '#0c101d');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(-0.08 * U, 0, BW, BH, 0, 0, TAU);
    ctx.fill();

    // 兜帽（比斗篷亮，读作"头"）
    const hg = ctx.createRadialGradient(HX - 0.06 * U, -0.10 * U, 0.02 * U, HX, 0, HOOD);
    hg.addColorStop(0, '#5a689a');
    hg.addColorStop(0.55, '#39456b');
    hg.addColorStop(1, '#20273f');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(HX, 0, HOOD, 0, TAU);
    ctx.fill();
    // 帽檐下的暗影（脸在阴影里）
    ctx.fillStyle = 'rgba(3,5,11,0.78)';
    ctx.beginPath();
    ctx.ellipse(HX + 0.115 * U, 0, 0.075 * U, 0.125 * U, 0, 0, TAU);
    ctx.fill();
    // 帽顶高光
    ctx.fillStyle = 'rgba(200,218,255,0.28)';
    ctx.beginPath();
    ctx.ellipse(HX - 0.06 * U, -0.115 * U, 0.080 * U, 0.048 * U, -0.55, 0, TAU);
    ctx.fill();

    // 手臂
    const ax = Math.cos(la - p.facing) * 0.60 * U;
    const ay = Math.sin(la - p.facing) * 0.60 * U;
    ctx.strokeStyle = '#1e2740';
    ctx.lineWidth = 0.14 * U;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(Math.cos(la - p.facing) * 0.26 * U, Math.sin(la - p.facing) * 0.26 * U);
    ctx.lineTo(ax, ay);
    ctx.stroke();

    ctx.restore();

    // ---- 提灯 ----
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(p.facing * 0.15 + Math.sin(t * 2.2) * 0.05);  // 轻微摆动
    const LW = 0.17 * U, LH = 0.24 * U;   // 灯体半宽/半高
    // 大光晕
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.95 * U);
    halo.addColorStop(0, 'rgba(255,222,165,0.55)');
    halo.addColorStop(0.30, 'rgba(255,185,95,0.22)');
    halo.addColorStop(1, 'rgba(255,160,70,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, 0.95 * U, 0, TAU); ctx.fill();
    ctx.restore();
    // 提梁
    ctx.strokeStyle = '#8a7444';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, -LH - 0.015 * U, 0.085 * U, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    // 灯框
    ctx.fillStyle = '#6e5a35';
    ctx.beginPath(); ctx.roundRect(-LW, -LH, LW * 2, LH * 2, 0.05 * U); ctx.fill();
    ctx.fillStyle = '#a98d52';
    ctx.fillRect(-LW - 1, -LH, LW * 2 + 2, 0.045 * U);
    ctx.fillRect(-LW - 1, LH - 0.045 * U, LW * 2 + 2, 0.045 * U);
    // 灯芯玻璃
    const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, LH * 0.95);
    fg.addColorStop(0, '#fffdf2');
    fg.addColorStop(0.35, '#ffe3a6');
    fg.addColorStop(0.75, '#ffb04a');
    fg.addColorStop(1, 'rgba(255,140,50,0.55)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.roundRect(-LW + 0.04 * U, -LH + 0.055 * U, LW * 2 - 0.08 * U, LH * 2 - 0.11 * U, 0.035 * U);
    ctx.fill();
    // 灯芯亮点
    ctx.fillStyle = '#fffdf0';
    ctx.beginPath(); ctx.arc(0, 0.01 * U, 0.055 * U, 0, TAU); ctx.fill();
    ctx.restore();

    ctx.restore();
  };

  // 宝箱的信标：画在黑暗层之上，所以能穿过墙和黑暗被看见
  Game.prototype.drawChestBeacons = function (ctx) {
    const t = this.tGlobal;
    const pad = 3 * U;
    for (const c of this.maze.chests) {
      if (c.opened) continue;
      if (c.x < this.viewL - pad || c.x > this.viewR2 + pad ||
          c.y < this.viewT - pad || c.y > this.viewB + pad) continue;
      const pulse = 0.72 + 0.28 * Math.sin(t * 1.9 + c.id * 2.1);
      const cy = c.y - 0.35 * U;
      const R = 2.5 * U;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(c.x, cy, 0, c.x, cy, R);
      g.addColorStop(0, 'rgba(255,216,150,' + (0.34 * pulse) + ')');
      g.addColorStop(0.22, 'rgba(255,186,96,' + (0.16 * pulse) + ')');
      g.addColorStop(0.60, 'rgba(255,160,70,' + (0.05 * pulse) + ')');
      g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, cy, R, 0, TAU);
      ctx.fill();
      // 一点星芒，隔着墙也能看出"那边有东西"
      ctx.globalAlpha = 0.50 + 0.30 * pulse;
      ctx.fillStyle = 'rgba(255,232,180,0.9)';
      starPath(ctx, c.x, cy - 0.15 * U, 0.20 * U, 0.085 * U, t * 0.5 + c.id);
      ctx.fill();
      ctx.restore();
    }
  };

  Game.prototype.drawParticles = function (ctx) {
    for (const q of this.particles) {
      const k = 1 - q.life / q.maxLife;
      ctx.globalAlpha = Math.max(0, k);
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * (0.4 + k * 0.8), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  Game.prototype.drawTexts = function (ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      const k = t.life / t.maxLife;
      ctx.globalAlpha = 1 - k;
      ctx.font = 'bold ' + Math.round(0.42 * U) + 'px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y - k * 0.9 * U);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  // ---------------- 光照 ----------------
  Game.prototype.renderLighting = function () {
    const lc = this.lightCanvas;
    const lctx = lc.getContext('2d');
    const dpr = this.dpr;
    const scale = this.scale;
    const px = (this.player.x * scale + this.tx) * dpr;
    const py = (this.player.y * scale + this.ty) * dpr;
    const R = this.level.lanternR * U * scale * dpr;

    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = 'source-over';
    lctx.globalAlpha = 1;
    lctx.fillStyle = '#03050a';
    lctx.fillRect(0, 0, lc.width, lc.height);

    lctx.globalCompositeOperation = 'destination-out';

    // 已探索记忆（很暗的一层"余影"）
    const ec = this.exploredCanvas;
    const es = this.exScale;
    const mem = this.level.memory;
    if (mem > 0) {
      const wl = this.cam.x - this.cw / (2 * scale);
      const wt = this.cam.y - this.ch / (2 * scale);
      let sx = Math.max(0, wl * es);
      let sy = Math.max(0, wt * es);
      let sw = Math.min(ec.width - sx, (this.cw / scale) * es);
      let sh = Math.min(ec.height - sy, (this.ch / scale) * es);
      if (sw > 0 && sh > 0) {
        const dx = (sx / es) * scale + this.tx;
        const dy = (sy / es) * scale + this.ty;
        lctx.globalAlpha = mem;
        lctx.drawImage(ec, sx, sy, sw, sh, dx * dpr, dy * dpr,
          (sw / es) * scale * dpr, (sh / es) * scale * dpr);
        lctx.globalAlpha = 1;
      }
    }

    // 提灯：0 ~ 4 身位亮度从 100% 线性衰减到 40%，4 身位以外完全无光
    const flicker = 1 + Math.sin(this.tGlobal * 11) * 0.008 + Math.sin(this.tGlobal * 3.7) * 0.014;
    const LIGHT_R = this.level.lightR * U * scale * dpr * flicker;
    const g = lctx.createRadialGradient(px, py, 0, px, py, LIGHT_R);
    g.addColorStop(0.000, 'rgba(0,0,0,1.00)');   // 0.0 身位 100%
    g.addColorStop(0.125, 'rgba(0,0,0,0.92)');   // 0.5 身位
    g.addColorStop(0.250, 'rgba(0,0,0,0.85)');   // 1.0 身位
    g.addColorStop(0.375, 'rgba(0,0,0,0.77)');   // 1.5 身位
    g.addColorStop(0.500, 'rgba(0,0,0,0.70)');   // 2.0 身位
    g.addColorStop(0.625, 'rgba(0,0,0,0.62)');   // 2.5 身位
    g.addColorStop(0.750, 'rgba(0,0,0,0.55)');   // 3.0 身位
    g.addColorStop(0.875, 'rgba(0,0,0,0.47)');   // 3.5 身位
    g.addColorStop(0.940, 'rgba(0,0,0,0.43)');   // 3.76 身位
    g.addColorStop(0.985, 'rgba(0,0,0,0.16)');   // 3.94 身位
    g.addColorStop(1.000, 'rgba(0,0,0,0)');      // 4.0 身位 -> 全黑
    lctx.fillStyle = g;
    lctx.beginPath();
    lctx.arc(px, py, LIGHT_R, 0, TAU);
    lctx.fill();
    lctx.globalCompositeOperation = 'source-over';

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(lc, 0, 0);
  };

  Game.prototype.renderGlow = function () {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const px = this.player.x * this.scale + this.tx;
    const py = this.player.y * this.scale + this.ty;
    // 暖色光晕必须收在 2 身位灯圈之内，否则会在"无光区"上加亮
    const R = this.level.lightR * U * this.scale * 0.94;
    const g = ctx.createRadialGradient(px, py, 0, px, py, R);
    g.addColorStop(0, 'rgba(255,196,110,0.16)');
    g.addColorStop(0.35, 'rgba(255,172,80,0.09)');
    g.addColorStop(0.70, 'rgba(230,140,60,0.04)');
    g.addColorStop(1, 'rgba(150,80,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, R, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  };

  Game.prototype.renderVignette = function () {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = this.cw / 2, cy = this.ch / 2;
    const r0 = Math.min(this.cw, this.ch) * 0.40;
    const r1 = Math.max(this.cw, this.ch) * 0.78;
    const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.cw, this.ch);
  };

  // 世界坐标下的交互提示
  Game.prototype.renderOverlayUI = function () {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.hint && this.state === 'playing') {
      const sx = this.hint.x * this.scale + this.tx;
      const sy = this.hint.y * this.scale + this.ty - 1.15 * U * this.scale;
      const label = '空格';
      ctx.font = '600 15px "Microsoft YaHei", sans-serif';
      const tw = ctx.measureText(label).width;
      const pad = 12;
      const w = tw + pad * 2, h = 28;
      const pulse = 0.75 + 0.25 * Math.sin(this.tGlobal * 4);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = 'rgba(12,16,26,0.92)';
      ctx.strokeStyle = 'rgba(255,205,120,' + (0.55 * pulse) + ')';
      ctx.lineWidth = 1.5;
      const rx = sx - w / 2, ry = sy - h / 2;
      const rr = 8;
      ctx.beginPath();
      ctx.moveTo(rx + rr, ry);
      ctx.lineTo(rx + w - rr, ry);
      ctx.quadraticCurveTo(rx + w, ry, rx + w, ry + rr);
      ctx.lineTo(rx + w, ry + h - rr);
      ctx.quadraticCurveTo(rx + w, ry + h, rx + w - rr, ry + h);
      ctx.lineTo(rx + rr, ry + h);
      ctx.quadraticCurveTo(rx, ry + h, rx, ry + h - rr);
      ctx.lineTo(rx, ry + rr);
      ctx.quadraticCurveTo(rx, ry, rx + rr, ry);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd98a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, sx, sy + 1);
      ctx.globalAlpha = 1;
    }
  };

  // 测试辅助：直接放到某点
  Game.prototype.teleport = function (x, y) {
    this.player.x = x;
    this.player.y = y;
    this.player.vx = this.player.vy = 0;
    this.updateCamera(1);
    this.stampExplored();
  };

  LL.Game = Game;
})(window.LL);
