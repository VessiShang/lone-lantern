// 基础工具
window.LL = window.LL || {};
(function (LL) {
  'use strict';
  LL.TAU = Math.PI * 2;
  LL.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  LL.lerp = function (a, b, t) { return a + (b - a) * t; };
  LL.smoothstep = function (t) {
    t = LL.clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  };
  LL.dist = function (ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  };
  LL.dist2 = function (ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };
  // 确定性随机
  LL.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  LL.pick = function (rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; };
  LL.shuffle = function (rnd, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  LL.fmtTime = function (sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };
  LL.b64ToArrayBuffer = function (b64) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  };
})(window.LL);
