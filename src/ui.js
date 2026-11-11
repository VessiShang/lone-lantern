// 界面与交互
window.LL = window.LL || {};
(function (LL) {
  'use strict';
  const el = (id) => document.getElementById(id);

  const UI = {
    game: null,
    current: 'title',
    prev: 'title',
    lockedTip: 0
  };

  // ---------------- 进度存档（localStorage） ----------------
  const SAVE_KEY = 'lone-lantern-progress-v1';
  UI.progress = { stars: {} };
  UI.loadProgress = function () {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') UI.progress = { stars: p.stars || {} };
      }
    } catch (e) { /* 忽略 */ }
  };
  UI.saveProgress = function (levelIndex, stars) {
    const id = LL.LEVELS[levelIndex].id;
    const old = UI.progress.stars[id] || 0;
    if (stars > old) UI.progress.stars[id] = stars;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(UI.progress)); } catch (e) { /* 忽略 */ }
  };

  UI.screens = ['title', 'select', 'help', 'pause', 'result'];

  UI.show = function (name) {
    if (name === UI.current) return;
    if (name !== 'help') UI.prev = UI.current;
    UI.current = name;
    for (const s of UI.screens) {
      const node = el('screen-' + s);
      if (node) node.classList.toggle('active', s === name);
    }
    const playing = name === 'playing';
    el('hud').classList.toggle('hidden', !(playing || name === 'pause'));
    if (name === 'select') UI.renderCards();
  };

  UI.renderCards = function () {
    const box = el('level-cards');
    box.innerHTML = '';
    LL.LEVELS.forEach((lv, i) => {
      const card = document.createElement('div');
      card.className = 'card' + (lv.unlocked ? '' : ' locked');
      const diffCls = lv.difficulty === '简单' ? 'easy' : lv.difficulty === '困难' ? 'hard' : 'hell';
      const got = UI.progress.stars[lv.id] || 0;
      let starsHtml = '';
      for (let k = 0; k < 3; k++) {
        starsHtml += '<span class="c-star' + (k < got ? ' on' : '') + '">★</span>';
      }
      card.innerHTML =
        '<div class="c-chapter">' + lv.chapter + '</div>' +
        '<div class="c-name">' + lv.name + '</div>' +
        '<div class="c-diff ' + diffCls + '">' + lv.difficulty + '</div>' +
        '<div class="c-desc" style="margin-top:10px">' + lv.desc + '</div>' +
        (got > 0 ? '<div class="c-stars">' + starsHtml + '</div>' : '') +
        (lv.unlocked ? '' : '<div class="c-lock">🔒 敬请期待</div>');
      if (lv.unlocked) {
        card.addEventListener('click', () => {
          LL.Audio.play('ui', 0.7);
          UI.game.startLevel(i);
        });
      } else {
        card.addEventListener('click', () => {
          card.animate(
            [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' },
             { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }],
            { duration: 240 }
          );
        });
      }
      box.appendChild(card);
    });
  };

  // ---------------- 状态同步 ----------------
  UI.onState = function (state) {
    if (state === 'playing') {
      UI.show('playing');
      UI.syncHud();
    } else if (state === 'paused') {
      UI.show('pause');
    } else if (state === 'dead') {
      UI.showResult('dead');
    } else if (state === 'win') {
      UI.showResult('win');
    } else if (state === 'title') {
      UI.show('title');
    }
  };

  UI.syncHud = function () {
    const g = UI.game;
    if (!g || !g.level) return;
    el('hud-chapter').textContent = g.level.chapter;
    el('hud-name').textContent = g.level.name;
    el('hud-time').textContent = LL.fmtTime(g.timeSec);
    const stars = document.querySelectorAll('#hud-stars .star');
    stars.forEach((s, i) => s.classList.toggle('on', i < g.stars));
  };

  UI.showResult = function (kind) {
    const g = UI.game;
    const title = el('result-title');
    const sub = el('result-sub');
    const starsBox = el('result-stars');
    const btns = el('result-btns');
    title.classList.remove('result-title-perfect');
    starsBox.innerHTML = '';
    btns.innerHTML = '';

    for (let i = 0; i < 3; i++) {
      const s = document.createElement('i');
      s.className = 'star';
      s.textContent = '★';
      starsBox.appendChild(s);
    }

    const addBtn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (cls || '');
      b.textContent = label;
      b.addEventListener('click', () => { LL.Audio.play('ui', 0.6); fn(); });
      btns.appendChild(b);
    };

    if (kind === 'dead') {
      title.textContent = '灯火灭了';
      sub.textContent = g.deathType === 'fall'
        ? '你掉进了无底的坑洞。'
        : '一支暗箭穿透了黑暗。';
      UI.show('result');
      // 只点亮已获得的星
      const stars = starsBox.querySelectorAll('.star');
      stars.forEach((s, i) => { if (i < g.stars) setTimeout(() => s.classList.add('on'), 120 + i * 140); });
      addBtn('再来一次', 'primary', () => g.retry());
      addBtn('返回标题', '', () => g.toTitle());
    } else {
      const perfect = g.stars >= 3;
      const isFinal = g.levelIndex >= LL.LEVELS.length - 1;
      const nextIdx = g.levelIndex + 1;
      const hasNext = !isFinal && LL.LEVELS[nextIdx] && LL.LEVELS[nextIdx].unlocked;
      UI.saveProgress(g.levelIndex, g.stars);

      if (isFinal && perfect) title.textContent = '全剧终 · 完美通关';
      else title.textContent = perfect ? '完美通关' : '逃出生天';
      if (perfect) title.classList.add('result-title-perfect');
      sub.textContent = perfect
        ? '三颗星辰随你走出了黑暗。'
        : '你逃了出来，但只带走 ' + g.stars + ' 颗星辰。';
      UI.show('result');
      const stars = starsBox.querySelectorAll('.star');
      stars.forEach((s, i) => { if (i < g.stars) setTimeout(() => s.classList.add('on'), 200 + i * 180); });

      if (hasNext) {
        addBtn('进入' + LL.LEVELS[nextIdx].chapter + '「' + LL.LEVELS[nextIdx].name + '」', 'primary',
          () => g.startLevel(nextIdx));
      } else if (!perfect) {
        addBtn('继续探索', 'primary', () => g.continueExploring());
      }
      if (!perfect && hasNext) {
        addBtn('继续探索', '', () => g.continueExploring());
      }
      addBtn(isFinal ? '重玩本章' : '重玩本章', '', () => g.retry());
      addBtn('返回标题', '', () => g.toTitle());
    }
  };

  // ---------------- 绑定 ----------------
  UI.bind = function () {
    el('btn-start').addEventListener('click', () => {
      LL.Audio.play('ui', 0.7);
      UI.show('select');
    });
    el('btn-help').addEventListener('click', () => { LL.Audio.play('ui', 0.7); UI.show('help'); });
    el('btn-help-close').addEventListener('click', () => {
      LL.Audio.play('ui', 0.7);
      UI.show(UI.prev === 'help' ? 'title' : UI.prev);
    });
    el('btn-back-title').addEventListener('click', () => {
      LL.Audio.play('ui', 0.6);
      UI.show('title');
    });
    el('btn-resume').addEventListener('click', () => { LL.Audio.play('ui', 0.6); UI.game.resume(); });
    el('btn-restart-pause').addEventListener('click', () => { LL.Audio.play('ui', 0.6); UI.game.retry(); });
    el('btn-quit').addEventListener('click', () => { LL.Audio.play('ui', 0.6); UI.game.toTitle(); });
    el('btn-pause').addEventListener('click', () => { LL.Audio.play('ui', 0.6); UI.game.pause(); });
    const muteBtn = el('btn-mute');
    muteBtn.addEventListener('click', () => {
      const m = LL.Audio.toggleMuted();
      muteBtn.classList.toggle('muted', m);
      muteBtn.textContent = m ? '✕' : '♪';
      if (!m) LL.Audio.play('ui', 0.6);
    });

  };

  UI.init = function (game) {
    UI.game = game;
    UI.bind();
    UI.loadProgress();
    game.onStateChange = (s) => UI.onState(s);
    UI.current = null;          // 强制首次真正显示
    UI.prev = 'title';
    UI.show('title');
    UI.syncHud();
  };

  UI.frame = function () {
    if (UI.current === 'playing' || UI.current === 'pause') UI.syncHud();
  };

  LL.UI = UI;
})(window.LL);
