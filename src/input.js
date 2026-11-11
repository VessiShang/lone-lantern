// 输入：键盘（本作只发行电脑版，无触屏操作）
window.LL = window.LL || {};
(function (LL) {
  'use strict';
  const I = {
    down: Object.create(null),
    just: Object.create(null),
    anyKeyHandler: null
  };

  const WATCH = [
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'Space', 'Escape', 'Enter',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
  ];

  I.init = function () {
    window.addEventListener('keydown', function (e) {
      if (WATCH.indexOf(e.code) >= 0) e.preventDefault();
      if (!I.down[e.code]) I.just[e.code] = true;
      I.down[e.code] = true;
      if (I.anyKeyHandler) I.anyKeyHandler(e);
    }, { passive: false });
    window.addEventListener('keyup', function (e) {
      if (WATCH.indexOf(e.code) >= 0) e.preventDefault();
      I.down[e.code] = false;
    }, { passive: false });
    window.addEventListener('blur', function () {
      I.down = Object.create(null);
    });
  };

  // 归一化移动轴
  I.axis = function () {
    let x = 0, y = 0;
    if (I.down.KeyA || I.down.ArrowLeft) x -= 1;
    if (I.down.KeyD || I.down.ArrowRight) x += 1;
    if (I.down.KeyW || I.down.ArrowUp) y -= 1;
    if (I.down.KeyS || I.down.ArrowDown) y += 1;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y, mag: Math.min(1, m) };
  };

  I.actionDown = function () { return !!I.down.Space; };
  I.consumeAction = function () {
    const a = !!I.just.Space;
    I.just.Space = false;
    return a;
  };
  I.consumeBack = function () {
    const b = !!I.just.Escape;
    I.just.Escape = false;
    return b;
  };
  I.consumeAny = function () {
    const a = !!I.just.Enter;
    I.just.Enter = false;
    return a;
  };
  I.endFrame = function () {
    I.just = Object.create(null);
  };

  // 供自动化测试注入
  I.inject = function (code, isDown) {
    if (isDown && !I.down[code]) I.just[code] = true;
    I.down[code] = !!isDown;
  };

  LL.Input = I;
})(window.LL);
