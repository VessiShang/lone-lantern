// 音频：程序化合成音效（内联 data），WebAudio 播放
window.LL = window.LL || {};
(function (LL) {
  'use strict';
  const A = {
    ctx: null,
    master: null,
    buffers: {},
    ready: false,
    muted: false,
    ambient: null,
    ambientGain: null,
    stepGain: 1,
    _lastStep: 0
  };

  A.init = function () {
    if (A.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      A.ctx = new AC();
      A.master = A.ctx.createGain();
      A.master.gain.value = A.muted ? 0 : 0.85;
      A.master.connect(A.ctx.destination);
    } catch (e) {
      A.ctx = null;
      return;
    }

    const src = window.LL_SFX || {};
    for (const name in src) {
      try {
        const ab = LL.b64ToArrayBuffer(src[name]);
        const p = A.ctx.decodeAudioData(ab);
        if (p && p.then) {
          p.then((buf) => { A.buffers[name] = buf; A.ready = true; })
            .catch(() => {});
        }
      } catch (e) { /* 忽略解码失败 */ }
    }
  };

  A.resume = function () {
    if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  };

  A.play = function (name, vol, rate) {
    if (!A.ctx || A.muted) return;
    const buf = A.buffers[name];
    if (!buf) return;
    const s = A.ctx.createBufferSource();
    s.buffer = buf;
    if (rate) s.playbackRate.value = rate;
    const g = A.ctx.createGain();
    g.gain.value = (vol == null ? 0.8 : vol);
    s.connect(g);
    g.connect(A.master);
    s.start();
    return s;
  };

  // 按距离衰减
  A.playAt = function (name, px, py, lx, ly, baseVol) {
    const d = LL.dist(px, py, lx, ly);
    const maxD = 9 * LL.UNITS.U;
    if (d > maxD) return;
    const v = (baseVol == null ? 0.9 : baseVol) * Math.pow(1 - d / maxD, 1.6);
    if (v > 0.02) A.play(name, v);
  };

  A.startAmbient = function () {
    if (!A.ctx || A.ambient) return;
    const buf = A.buffers.ambient;
    if (!buf) { setTimeout(A.startAmbient, 300); return; }
    const s = A.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    const g = A.ctx.createGain();
    g.gain.value = 0;
    s.connect(g);
    g.connect(A.master);
    s.start();
    g.gain.linearRampToValueAtTime(0.30, A.ctx.currentTime + 2.0);
    A.ambient = s;
    A.ambientGain = g;
  };

  A.setMuted = function (m) {
    A.muted = !!m;
    if (A.master) A.master.gain.value = A.muted ? 0 : 0.85;
  };

  A.toggleMuted = function () {
    A.setMuted(!A.muted);
    return A.muted;
  };

  LL.Audio = A;
})(window.LL);
