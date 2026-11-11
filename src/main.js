// 入口
(function () {
  'use strict';
  const canvas = document.getElementById('game');
  const game = new LL.Game(canvas);
  window.LL_GAME = game;

  LL.Input.init();
  LL.UI.init(game);
  game.resize();
  window.addEventListener('resize', () => game.resize());
  if (window.ResizeObserver) {
    new ResizeObserver(() => game.resize()).observe(document.getElementById('app'));
  }

  // 音频需要用户手势解锁
  let unlocked = false;
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    LL.Audio.init();
    LL.Audio.resume();
    setTimeout(() => LL.Audio.startAmbient(), 120);
  }
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  // 全局按键
  function globalKeys() {
    if (LL.Input.consumeBack()) {
      const s = game.state;
      if (s === 'playing') game.pause();
      else if (s === 'paused') game.resume();
      else if (LL.UI.current === 'help') LL.UI.show(LL.UI.prev === 'help' ? 'title' : LL.UI.prev);
      else if (LL.UI.current === 'select') LL.UI.show('title');
    }
    if (LL.Input.consumeAny()) {
      if (LL.UI.current === 'title') LL.UI.show('select');
      else if (game.state === 'dead') game.retry();
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && game.state === 'playing') game.pause();
  });

  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.05);
    if (!game.testMode) {
      globalKeys();
      game.update(dt);
    }
    game.render();
    LL.UI.frame();
    LL.Input.endFrame();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------------- 自动化测试接口 ----------------
  window.__LL_TEST__ = {
    game: game,
    startLevel: function (i) { game.startLevel(i); },
    advance: function (seconds, step) {
      step = step || 1 / 60;
      const n = Math.round(seconds / step);
      for (let i = 0; i < n; i++) {
        game.update(step);
        LL.Input.endFrame();
      }
    },
    teleport: function (x, y) { game.teleport(x, y); },
    info: function () {
      const m = game.maze;
      return {
        state: game.state,
        stars: game.stars,
        level: game.level ? game.level.name : null,
        mazeSize: m ? [m.cols, m.rows] : null,
        world: m ? [m.W, m.H] : null,
        player: [Math.round(game.player.x), Math.round(game.player.y)],
        start: m ? [Math.round(m.start.x), Math.round(m.start.y)] : null,
        exit: m ? [Math.round(m.exitPos.x), Math.round(m.exitPos.y)] : null,
        chests: m ? m.chests.map((c) => [Math.round(c.x), Math.round(c.y), c.opened]) : [],
        pits: m ? m.pits.length : 0,
        emitters: m ? m.emitters.length : 0,
        arrows: game.arrows.length
      };
    }
  };
})();
