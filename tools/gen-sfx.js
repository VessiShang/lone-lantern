// 程序化合成游戏音效（CC0 / 自制），输出 src/sfx-data.js（base64 data URI）
// 只用 node 内置模块，无第三方依赖。
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'src', 'sfx-data.js');

// ---------------- 基础 DSP ----------------
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

class Synth {
  constructor(sr, dur) {
    this.sr = sr;
    this.n = Math.floor(sr * dur);
    this.buf = new Float32Array(this.n);
  }
  t(i) { return i / this.sr; }
  add(i, v) { if (i >= 0 && i < this.n) this.buf[i] += v; }
  // 指数衰减包络
  static env(t, atk, dec, sus = 0) {
    if (t < 0) return 0;
    if (t < atk) return t / Math.max(1e-6, atk);
    const d = (t - atk) / Math.max(1e-6, dec);
    return sus + (1 - sus) * Math.exp(-d * 4);
  }
  apply(fn) {
    for (let i = 0; i < this.n; i++) this.buf[i] = fn(this.buf[i], i);
    return this;
  }
  softClip(k) {
    return this.apply((v) => {
      const x = v * k;
      return (x / (1 + Math.abs(x)));
    });
  }
  fadeOut(startT, dur) {
    const s = Math.floor(startT * this.sr);
    const d = Math.floor(dur * this.sr);
    for (let i = 0; i < d; i++) {
      const g = 1 - i / d;
      if (s + i < this.n) this.buf[s + i] *= g;
    }
    return this;
  }
  fadeIn(dur) {
    const d = Math.floor(dur * this.sr);
    for (let i = 0; i < d && i < this.n; i++) this.buf[i] *= i / d;
    return this;
  }
  normalize(peak = 0.85) {
    let m = 0;
    for (let i = 0; i < this.n; i++) m = Math.max(m, Math.abs(this.buf[i]));
    if (m < 1e-9) return this;
    const g = peak / m;
    for (let i = 0; i < this.n; i++) this.buf[i] *= g;
    return this;
  }
}

// 一阶低通
function lowpass(src, cutoffFn) {
  const out = new Float32Array(src.length);
  let y = 0;
  for (let i = 0; i < src.length; i++) {
    const fc = cutoffFn ? cutoffFn(i / 44100) : 2000;
    const a = clamp(1 - Math.exp(-TAU * fc / 44100), 0.0001, 1);
    y += a * (src[i] - y);
    out[i] = y;
  }
  return out;
}

// ---------------- 各音效 ----------------
function sStep() {
  const s = new Synth(22050, 0.13);
  const r = rng(7);
  let lp = 0;
  for (let i = 0; i < s.n; i++) {
    const t = s.t(i);
    const e = Math.exp(-t * 55);
    const nz = (r() * 2 - 1);
    lp += 0.06 * (nz - lp);
    const thump = Math.sin(TAU * (95 - t * 120) * t) * Math.exp(-t * 30) * 0.5;
    s.add(i, (lp * 1.5 + thump) * e * 0.55);
  }
  return s.fadeIn(0.004).normalize(0.35);
}

function sChest() {
  const s = new Synth(22050, 0.9);
  const r = rng(11);
  // 木头吱呀：锯齿波 + 抖动音高
  let ph = 0;
  for (let i = 0; i < s.n; i++) {
    const t = s.t(i);
    if (t > 0.42) continue;
    const wob = 1 + Math.sin(t * 46) * 0.06 + Math.sin(t * 13) * 0.04;
    const f = (170 + t * 90) * wob;
    ph += (TAU * f) / 22050;
    const saw = ((ph % TAU) / TAU) * 2 - 1;
    const e = Synth.env(t, 0.02, 0.20);
    // 摩擦噪声
    const nz = (r() * 2 - 1) * 0.12 * (0.5 + 0.5 * Math.sin(t * 90));
    s.add(i, (saw * 0.16 + nz) * e);
  }
  // 木头闷响
  for (let i = 0; i < s.n; i++) {
    const t = s.t(i) - 0.36;
    if (t < 0) continue;
    s.add(i, Math.sin(TAU * 130 * t) * Math.exp(-t * 22) * 0.35);
  }
  // 打开后的清脆泛音
  const notes = [523.25, 783.99, 1046.5];
  notes.forEach((f, k) => {
    const t0 = 0.40 + k * 0.075;
    for (let i = 0; i < s.n; i++) {
      const t = s.t(i) - t0;
      if (t < 0) continue;
      const e = Math.exp(-t * 5.5) * Synth.env(t, 0.005, 0.5);
      s.add(i, (Math.sin(TAU * f * t) * 0.5 + Math.sin(TAU * f * 2 * t) * 0.16) * e * 0.22);
    }
  });
  return s.fadeOut(0.80, 0.10).normalize(0.75);
}

function bell(s, f, t0, amp, dec) {
  for (let i = 0; i < s.n; i++) {
    const t = s.t(i) - t0;
    if (t < 0) continue;
    const e = Math.exp(-t * dec) * Synth.env(t, 0.004, 0.9);
    // 简单 FM 钟声
    const mod = Math.sin(TAU * f * 3.01 * t) * 1.4 * Math.exp(-t * 9);
    s.add(i, Math.sin(TAU * f * t + mod) * e * amp);
    s.add(i, Math.sin(TAU * f * 2 * t) * e * amp * 0.18);
  }
}

function sStar() {
  const s = new Synth(22050, 1.3);
  bell(s, 1046.5, 0.00, 0.26, 3.4);
  bell(s, 1318.5, 0.085, 0.22, 3.2);
  bell(s, 1567.98, 0.17, 0.20, 3.0);
  bell(s, 2093.0, 0.255, 0.17, 2.6);
  return s.fadeOut(1.15, 0.15).normalize(0.7);
}

function sDeath() {
  const s = new Synth(22050, 1.5);
  const r = rng(23);
  // 下坠的低频
  let ph = 0;
  for (let i = 0; i < s.n; i++) {
    const t = s.t(i);
    const f = 210 * Math.pow(0.30, t / 0.75); // 指数下滑
    ph += (TAU * f) / 22050;
    const e = Synth.env(t, 0.01, 0.55) * (t < 0.05 ? t / 0.05 : 1);
    s.add(i, Math.sin(ph) * e * 0.55);
    s.add(i, (Math.sin(ph * 2.01) * 0.3) * e * 0.4);
  }
  // 落地的闷撞 + 碎响
  for (let i = 0; i < s.n; i++) {
    const t = s.t(i) - 0.55;
    if (t < 0) continue;
    const nz = (r() * 2 - 1) * Math.exp(-t * 9) * 0.30;
    const thud = Math.sin(TAU * 62 * t) * Math.exp(-t * 12) * 0.5;
    s.add(i, nz + thud);
  }
  return s.fadeOut(1.3, 0.18).normalize(0.8);
}

function sArrow() {
  const s = new Synth(22050, 0.42);
  const r = rng(31);
  let y = 0;
  let y2 = 0;
  for (let i = 0; i < s.n; i++) {
    const t = s.t(i);
    // 带通扫频的噪声 = 嗖
    const fc = 3200 * Math.pow(0.28, t / 0.30);
    const a = clamp(1 - Math.exp(-TAU * fc / 22050), 0.001, 1);
    y += a * ((r() * 2 - 1) - y);
    y2 += a * (y - y2);
    const band = y - y2;
    const env = Synth.env(t, 0.008, 0.13);
    s.add(i, band * env * 2.6);
  }
  return s.fadeOut(0.36, 0.06).normalize(0.5);
}

function sWin() {
  const s = new Synth(22050, 2.4);
  // 上行琶音
  const seq = [392.0, 523.25, 659.25, 783.99, 1046.5];
  seq.forEach((f, k) => {
    const t0 = k * 0.11;
    const t0b = Math.floor(t0 * 22050);
    for (let i = 0; i < s.n; i++) {
      const t = s.t(i) - t0;
      if (t < 0) continue;
      const e = Math.exp(-t * 3.2) * Synth.env(t, 0.006, 0.8);
      const ph = TAU * f * t + Math.sin(TAU * f * 2 * t) * 0.3;
      s.add(i, Math.sin(ph) * e * 0.24);
    }
  });
  // 铺底和声
  [196.0, 261.63, 329.63].forEach((f) => {
    for (let i = 0; i < s.n; i++) {
      const t = s.t(i);
      const e = Synth.env(t, 0.25, 1.4, 0.15) * Math.exp(-t * 0.9);
      s.add(i, Math.sin(TAU * f * t) * e * 0.10);
    }
  });
  // 高频闪光
  const r = rng(41);
  for (let i = 0; i < s.n; i++) {
    const t = s.t(i) - 0.62;
    if (t < 0) continue;
    const e = Math.exp(-t * 7) * 0.12;
    s.add(i, Math.sin(TAU * 2637 * t) * e * 0.5);
    s.add(i, (r() * 2 - 1) * e * 0.12);
  }
  return s.fadeOut(2.1, 0.3).normalize(0.72);
}

function sUi() {
  const s = new Synth(22050, 0.14);
  for (let i = 0; i < s.n; i++) {
    const t = s.t(i);
    const e = Math.exp(-t * 42);
    s.add(i, (Math.sin(TAU * 880 * t) * 0.5 + Math.sin(TAU * 1320 * t) * 0.25) * e * 0.4);
  }
  return s.fadeIn(0.002).normalize(0.4);
}

function sInteractFail() {
  const s = new Synth(22050, 0.22);
  for (let i = 0; i < s.n; i++) {
    const t = s.t(i);
    const e = Math.exp(-t * 26);
    const f = 240 - t * 300;
    s.add(i, Math.sin(TAU * Math.max(60, f) * t) * e * 0.4);
  }
  return s.normalize(0.3);
}

// 循环环境音：所有调制频率取 1/dur 的整数倍，保证无缝
function sAmbient() {
  const sr = 11025;
  const dur = 4.0;
  const n = Math.floor(sr * dur);
  const buf = new Float32Array(n);
  const r = rng(97);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = TAU / dur;
    // 低频嗡鸣
    const d1 = Math.sin(TAU * 55 * t) * 0.30;
    const d2 = Math.sin(TAU * 82.5 * t + 0.7) * 0.17;
    const d3 = Math.sin(TAU * 110 * t + 1.9) * 0.10;
    // 缓慢起伏（整周期）
    const lfo = 0.62 + 0.38 * Math.sin(w * t * 1) * Math.sin(w * t * 2 + 1.1);
    // 洞穴空气声（噪声经低通 + 缓慢起伏）
    const nz = (r() * 2 - 1);
    buf[i] = (d1 + d2 + d3) * lfo + nz * 0.02 * (0.5 + 0.5 * Math.sin(w * t * 1 + 2.2));
  }
  // 低通温柔一点
  let y = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    y += 0.10 * (buf[i] - y);
    y2 += 0.10 * (y - y2);
    buf[i] = y2;
  }
  // 首尾交叉淡化，保证 loop 无缝
  const xf = Math.floor(sr * 0.35);
  for (let i = 0; i < xf; i++) {
    const g = i / xf;
    const a = buf[i];
    const b = buf[n - xf + i];
    buf[n - xf + i] = b * (1 - g) + a * g;
  }
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(buf[i]));
  const g = m > 0 ? 0.55 / m : 0;
  for (let i = 0; i < n; i++) buf[i] *= g;
  return { buf, sr };
}

// ---------------- WAV 编码 ----------------
function toWav(buf, sr) {
  const n = buf.length;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = clamp(Math.round(buf[i] * 32767), -32768, 32767);
    data.writeInt16LE(v, i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);          // PCM
  head.writeUInt16LE(1, 22);          // mono
  head.writeUInt32LE(sr, 24);
  head.writeUInt32LE(sr * 2, 28);     // byte rate
  head.writeUInt16LE(2, 32);          // block align
  head.writeUInt16LE(16, 34);         // bits
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// ---------------- 生成 ----------------
const sounds = {
  step: sStep(),
  chest: sChest(),
  star: sStar(),
  death: sDeath(),
  arrow: sArrow(),
  win: sWin(),
  ui: sUi(),
  fail: sInteractFail()
};

const parts = [];
let totalRaw = 0;
for (const [name, s] of Object.entries(sounds)) {
  const wav = toWav(s.buf, s.sr);
  totalRaw += wav.length;
  parts.push(`  ${name}: "${wav.toString('base64')}"`);
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'sfx', name + '.wav'), wav);
}
const amb = sAmbient();
const ambWav = toWav(amb.buf, amb.sr);
totalRaw += ambWav.length;
parts.push(`  ambient: "${ambWav.toString('base64')}"`);
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'sfx', 'ambient.wav'), ambWav);

const js = `// 自动生成，请勿手改。运行 node tools/gen-sfx.js 重新生成。
// 全部音效为本项目程序化合成，CC0 公共领域。
window.LL_SFX = {
${parts.join(',\n')}
};
window.LL_SFX_SR = { ambient: ${amb.sr} };
`;
fs.writeFileSync(OUT, js);
console.log('sfx ->', OUT, (js.length / 1024).toFixed(1), 'KB (wav raw', (totalRaw / 1024).toFixed(1), 'KB)');
