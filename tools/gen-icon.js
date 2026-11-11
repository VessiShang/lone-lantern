// 程序化生成游戏图标：SDF 光栅化 -> PNG + ICO
// 无任何第三方依赖，只用 node 内置 zlib。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_PNG = path.join(__dirname, '..', 'assets', 'icon.png');
const OUT_ICO = path.join(__dirname, '..', 'assets', 'icon.ico');

// ---------- 光栅缓冲（预乘 alpha） ----------
const SS = 1024; // 超采样边长
const buf = new Float32Array(SS * SS * 4);

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function over(x, y, r, g, b, a) {
  if (a <= 0) return;
  const i = (y * SS + x) * 4;
  const ia = 1 - a;
  buf[i] = r * a + buf[i] * ia;
  buf[i + 1] = g * a + buf[i + 1] * ia;
  buf[i + 2] = b * a + buf[i + 2] * ia;
  buf[i + 3] = a + buf[i + 3] * ia;
}
function add(x, y, r, g, b, a) {
  if (a <= 0) return;
  const i = (y * SS + x) * 4;
  buf[i] = Math.min(2, buf[i] + r * a);
  buf[i + 1] = Math.min(2, buf[i + 1] + g * a);
  buf[i + 2] = Math.min(2, buf[i + 2] + b * a);
  buf[i + 3] = Math.min(1, buf[i + 3] + a);
}

// 归一化坐标 0..1 的 SDF 工具
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdCircle(px, py, cx, cy, r) {
  const dx = px - cx, dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy) - r;
}
function sdRing(px, py, cx, cy, rr, t) {
  const dx = px - cx, dy = py - cy;
  return Math.abs(Math.sqrt(dx * dx + dy * dy) - rr) - t;
}

const PX = 1 / SS; // 一个亚像素的世界单位

function fillShape(sdf, color, alpha = 1) {
  for (let y = 0; y < SS; y++) {
    for (let x = 0; x < SS; x++) {
      const px = (x + 0.5) / SS, py = (y + 0.5) / SS;
      const d = sdf(px, py);
      if (d > PX * 1.5) continue;
      const cov = clamp01(0.5 - d / PX);
      if (cov > 0) over(x, y, color[0], color[1], color[2], alpha * cov);
    }
  }
}
function fillGradient(sdf, colorAt, alpha = 1) {
  for (let y = 0; y < SS; y++) {
    for (let x = 0; x < SS; x++) {
      const px = (x + 0.5) / SS, py = (y + 0.5) / SS;
      const d = sdf(px, py);
      if (d > PX * 1.5) continue;
      const cov = clamp01(0.5 - d / PX);
      if (cov <= 0) continue;
      const c = colorAt(px, py);
      over(x, y, c[0], c[1], c[2], alpha * cov);
    }
  }
}
// 在形状内部做加色光晕
function addGlow(sdf, color, strength, falloff) {
  for (let y = 0; y < SS; y++) {
    for (let x = 0; x < SS; x++) {
      const px = (x + 0.5) / SS, py = (y + 0.5) / SS;
      const d = sdf(px, py);
      if (d > 0.0001) continue;
      const k = Math.pow(clamp01(1 + d / falloff), 2) * strength;
      if (k > 0.001) add(x, y, color[0], color[1], color[2], k);
    }
  }
}

// ---------- 绘制图标 ----------
// 1) 底板：深色圆角方块 + 竖向渐变
const RAD = 0.225;
const bgSdf = (px, py) => sdRoundRect(px, py, 0.5, 0.5, 0.5, 0.5, RAD);
fillGradient(bgSdf, (px, py) => {
  const t = py;
  const top = [0.086, 0.106, 0.176];
  const bot = [0.027, 0.035, 0.063];
  return [
    top[0] + (bot[0] - top[0]) * t,
    top[1] + (bot[1] - top[1]) * t,
    top[2] + (bot[2] - top[2]) * t
  ];
}, 1);

// 2) 背景中若隐若现的迷宫墙线（带缺口的回路，读起来像迷宫而非划痕）
const wallColor = [0.58, 0.66, 0.86];
const T = 0.016;          // 墙线粗细
const INSET = 0.145;      // 回路内缩
function wallSeg(x0, y0, x1, y1) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  const sdf = (px, py) => sdRoundRect(px, py, cx, cy, Math.max(w, T) / 2, Math.max(h, T) / 2, T / 2);
  fillShape(sdf, wallColor, 0.085);
}
const L = INSET, R = 1 - INSET;
// 外圈（上方留口、右侧留口）
wallSeg(L, L, 0.34, L);
wallSeg(0.48, L, R, L);
wallSeg(R, L, R, 0.50);
wallSeg(R, 0.62, R, 1 - L);
wallSeg(L, 1 - L, 0.56, 1 - L);
wallSeg(0.70, 1 - L, R, 1 - L);
wallSeg(L, L, L, 0.44);
wallSeg(L, 0.58, L, 1 - L);
// 两个内部短墙，制造"分岔"感
wallSeg(L, 0.58, 0.30, 0.58);
wallSeg(0.74, 0.50, R, 0.50);
wallSeg(0.30, 0.20, 0.30, 0.42);

// 3) 暖光晕（灯周围）
{
  const gx = 0.5, gy = 0.575;
  for (let y = 0; y < SS; y++) {
    for (let x = 0; x < SS; x++) {
      const px = (x + 0.5) / SS, py = (y + 0.5) / SS;
      const dx = px - gx, dy = py - gy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const t = clamp01(1 - d / 0.46);
      const k = Math.pow(t, 2.4) * 0.42;
      if (k > 0.002) add(x, y, 1.0, 0.62, 0.24, k);
    }
  }
}

// 4) 提灯
const METAL = [0.42, 0.34, 0.22];
const METAL_HI = [0.66, 0.55, 0.36];
const GLASS_TOP = [1.0, 0.88, 0.55];
const GLASS_BOT = [1.0, 0.52, 0.14];

// 提灯主体（玻璃罩）
const glassSdf = (px, py) => sdRoundRect(px, py, 0.5, 0.545, 0.105, 0.175, 0.045);
fillGradient(glassSdf, (px, py) => {
  const t = clamp01((py - 0.37) / 0.35);
  return [
    GLASS_TOP[0] + (GLASS_BOT[0] - GLASS_TOP[0]) * t,
    GLASS_TOP[1] + (GLASS_BOT[1] - GLASS_TOP[1]) * t,
    GLASS_TOP[2] + (GLASS_BOT[2] - GLASS_TOP[2]) * t
  ];
}, 1);
addGlow(glassSdf, [1.0, 0.72, 0.32], 0.55, 0.10);

// 火焰（竖长的水滴形 + 亮核）
fillShape((px, py) => {
  // 竖椭圆
  const ex = (px - 0.5) / 0.030;
  const ey = (py - 0.572) / 0.058;
  const dEllipse = (Math.sqrt(ex * ex + ey * ey) - 1) * 0.030;
  // 圆头（下胖上尖）
  const dHead = sdCircle(px, py, 0.5, 0.594, 0.033);
  return Math.min(dEllipse, dHead);
}, [1.0, 0.86, 0.50], 0.96);
fillShape((px, py) => {
  const ex = (px - 0.5) / 0.015;
  const ey = (py - 0.590) / 0.032;
  return (Math.sqrt(ex * ex + ey * ey) - 1) * 0.020;
}, [1.0, 1.0, 0.96], 1);
addGlow((px, py) => sdCircle(px, py, 0.5, 0.580, 0.048), [1.0, 0.88, 0.52], 1.0, 0.045);

// 玻璃罩内的竖条灯骨
for (const bx of [0.43, 0.5, 0.57]) {
  fillShape((px, py) => sdRoundRect(px, py, bx, 0.545, 0.006, 0.155, 0.006), METAL, 0.55);
}

// 顶盖
fillShape((px, py) => sdRoundRect(px, py, 0.5, 0.352, 0.125, 0.030, 0.020), METAL, 1);
fillShape((px, py) => sdRoundRect(px, py, 0.5, 0.344, 0.115, 0.010, 0.008), METAL_HI, 0.7);

// 底座
fillShape((px, py) => sdRoundRect(px, py, 0.5, 0.742, 0.115, 0.032, 0.018), METAL, 1);
fillShape((px, py) => sdRoundRect(px, py, 0.5, 0.732, 0.115, 0.010, 0.010), METAL_HI, 0.55);

// 提梁（上方半圆环）
fillShape((px, py) => {
  if (py > 0.345) return 1;
  return sdRing(px, py, 0.5, 0.262, 0.098, 0.0155);
}, METAL, 1);
fillShape((px, py) => {
  if (py > 0.300 || py < 0.150) return 1;
  return Math.abs(sdRing(px, py, 0.5, 0.262, 0.098 - 0.006, 0.0045));
}, METAL_HI, 0.75);

// 5) 顶部内侧细高光（沿圆角轮廓，只取上半）
{
  const outer = (px, py) => sdRoundRect(px, py, 0.5, 0.5, 0.5 - 0.008, 0.5 - 0.008, RAD - 0.006);
  const inner = (px, py) => sdRoundRect(px, py, 0.5, 0.5, 0.5 - 0.024, 0.5 - 0.024, RAD - 0.016);
  const ring = (px, py) => Math.max(outer(px, py), -inner(px, py));
  for (let y = 0; y < SS; y++) {
    for (let x = 0; x < SS; x++) {
      const px = (x + 0.5) / SS, py = (y + 0.5) / SS;
      const d = ring(px, py);
      if (d > PX * 1.5) continue;
      const cov = clamp01(0.5 - d / PX);
      // 只在上半部分渐隐
      const fade = clamp01((0.62 - py) / 0.5) * 0.28;
      if (cov > 0 && fade > 0) over(x, y, 0.85, 0.90, 1.0, cov * fade);
    }
  }
}

// ---------- 降采样 ----------
function downsample(size) {
  const out = new Uint8ClampedArray(size * size * 4);
  const f = SS / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let pr = 0, pg = 0, pb = 0, pa = 0, n = 0;
      const y0 = Math.floor(y * f), y1 = Math.floor((y + 1) * f);
      const x0 = Math.floor(x * f), x1 = Math.floor((x + 1) * f);
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * SS + sx) * 4;
          pr += buf[i]; pg += buf[i + 1]; pb += buf[i + 2]; pa += buf[i + 3];
          n++;
        }
      }
      pr /= n; pg /= n; pb /= n; pa /= n;
      const o = (y * size + x) * 4;
      if (pa > 1e-6) {
        out[o] = Math.round(clamp01(pr / pa) * 255);
        out[o + 1] = Math.round(clamp01(pg / pa) * 255);
        out[o + 2] = Math.round(clamp01(pb / pa) * 255);
        out[o + 3] = Math.round(clamp01(pa) * 255);
      }
    }
  }
  return out;
}

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(b) {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size * 4; x++) raw[p++] = rgba[y * size * 4 + x];
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- ICO 封装 ----------
// 小尺寸用 32bit BMP(DIB) 条目（兼容性最好），256 用 PNG 压缩
function encodeDIB(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);           // biSize
  header.writeInt32LE(size, 4);          // biWidth
  header.writeInt32LE(size * 2, 8);      // biHeight (XOR + AND)
  header.writeUInt16LE(1, 12);           // biPlanes
  header.writeUInt16LE(32, 14);          // biBitCount
  header.writeUInt32LE(0, 16);           // BI_RGB
  header.writeUInt32LE(size * size * 4, 20);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = size - 1 - y; // 自下而上
    for (let x = 0; x < size; x++) {
      const si = (sy * size + x) * 4;
      const di = (y * size + x) * 4;
      xor[di] = rgba[si + 2];     // B
      xor[di + 1] = rgba[si + 1]; // G
      xor[di + 2] = rgba[si];     // R
      xor[di + 3] = rgba[si + 3]; // A
    }
  }
  const rowBytes = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    const sy = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const a = rgba[(sy * size + x) * 4 + 3];
      if (a === 0) and[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, and]);
}

function encodeICO(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  const parts = [];
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0; dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
    parts.push(e.data);
  });
  return Buffer.concat([head, dir, ...parts]);
}

// ---------- 输出 ----------
fs.mkdirSync(path.dirname(OUT_PNG), { recursive: true });
const size256 = downsample(256);
fs.writeFileSync(OUT_PNG, encodePNG(size256, 256));

const sizes = [16, 24, 32, 48, 64, 128, 256];
const entries = sizes.map((s) => {
  const px = downsample(s);
  // 256 用 PNG 压缩（体积小），更小的用 BMP 保证兼容
  return s >= 128
    ? { size: s, data: encodePNG(px, s) }
    : { size: s, data: encodeDIB(px, s) };
});
fs.writeFileSync(OUT_ICO, encodeICO(entries));

// 额外导出 512 的单图，供打包/商店用
const size512 = downsample(512);
fs.writeFileSync(path.join(path.dirname(OUT_PNG), 'icon-512.png'), encodePNG(size512, 512));

console.log('icon.png ->', OUT_PNG, fs.statSync(OUT_PNG).size, 'bytes');
console.log('icon.ico ->', OUT_ICO, fs.statSync(OUT_ICO).size, 'bytes');
