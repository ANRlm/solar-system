// 一次性下载真实行星贴图并转成 WebP，输出到 assets/（构建时内联进 HTML，此后构建无需联网）
// 色彩贴图：Solar System Scope（CC BY 4.0，基于 NASA 数据）；月球高程：NASA SVS CGI Moon Kit（公有领域）；银河：NASA SVS Deep Star Maps 2020
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import sharp from 'sharp';

const SSS = 'https://www.solarsystemscope.com/textures/download/';
const MOON = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/';
// [输出名, 源地址, 输出宽度, 选项]
const JOBS = [
  ['earth_day', SSS + '8k_earth_daymap.jpg', 4096],
  ['earth_night', SSS + '8k_earth_nightmap.jpg', 4096, { grey: false, q: 70 }],
  ['earth_clouds', SSS + '8k_earth_clouds.jpg', 4096, { grey: true, q: 72 }],
  ['moon', SSS + '8k_moon.jpg', 4096, { q: 72 }],
  ['moon_height', MOON + 'ldem_4_uint.tif', 1440, { grey: true, lossless: true, normalize: true }],
  ['mars', SSS + '8k_mars.jpg', 4096, { q: 76 }],
  ['mercury', SSS + '8k_mercury.jpg', 4096, { q: 72 }],
  ['jupiter', SSS + '8k_jupiter.jpg', 4096, { q: 86 }],
  ['saturn', SSS + '8k_saturn.jpg', 2048, { q: 86 }],
  ['venus', SSS + '4k_venus_atmosphere.jpg', 2048, { q: 86 }],
  ['uranus', SSS + '2k_uranus.jpg', 1024, { q: 88 }],
  ['neptune', SSS + '2k_neptune.jpg', 1024, { q: 88 }],
];

mkdirSync('assets/src', { recursive: true });
for (const [name, url, w, o = {}] of JOBS) {
  const src = `assets/src/${url.split('/').pop()}`;
  if (!existsSync(src)) {
    process.stdout.write(`下载 ${url} … `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(src, Buffer.from(await res.arrayBuffer()));
    console.log(`${(statSync(src).size / 1e6).toFixed(1)} MB`);
  }
  let img = sharp(src, { limitInputPixels: false }).resize(w, w / 2, { fit: 'fill', kernel: 'lanczos3' });
  if (o.normalize) img = img.normalise();
  if (o.grey) img = img.greyscale().toColourspace('b-w');
  const out = `assets/${name}.webp`;
  await img.webp(o.lossless ? { lossless: true } : { quality: o.q || 82, effort: 6 }).toFile(out);
  console.log(`${out.padEnd(26)} ${w}×${w / 2}  ${(statSync(out).size / 1024).toFixed(0)} KB`);
}

// 银河背景：NASA SVS Deep Star Maps 2020 的 milkyway_2020_8k.exr（赤道坐标，已去掉依巴谷 / 第谷亮星——亮星由星表单独绘制）
// 线性辐亮度 → 除以 LMAX 后取立方根存成 8 位（暗部层次更多，着色器里再立方还原）；
{
  const { EXRLoader } = await import('three/examples/jsm/loaders/EXRLoader.js');
  const THREE = await import('three');
  const src = 'assets/src/milkyway_2020_8k.exr', url = 'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_8k.exr';
  if (!existsSync(src)) {
    process.stdout.write(`下载 ${url} … `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(src, Buffer.from(await res.arrayBuffer()));
    console.log(`${(statSync(src).size / 1e6).toFixed(1)} MB`);
  }
  const LMAX = 0.25; // 与 shaders.js 的 SKY_FRAG 一致
  const exr = new EXRLoader().setDataType(THREE.FloatType).parse(readFileSync(src).buffer);
  const { width: W, height: H, data } = exr, ch = data.length / (W * H), rgb = new Uint8Array(W * H * 3);
  // EXR 行序自下而上，写图时翻转成自上而下
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = ((H - 1 - y) * W + x) * ch, o = (y * W + x) * 3;
    for (let k = 0; k < 3; k++) rgb[o + k] = Math.round(Math.cbrt(Math.min(1, Math.max(0, data[i + k] / LMAX))) * 255);
  }
  // 去颗粒：暗弱恒星形成的逐像素颗粒在 Retina 屏上放大后显脏。只用高斯低通（中值滤波在噪声上会产生油画笔触状的纹理，放大后像一道道刷痕），
  // 且按局部亮度自适应：暗弱的外围用强平滑，变成干净的渐变；明亮的银河主体只轻微平滑，保留尘埃带细节
  const raw = { raw: { width: W, height: H, channels: 3 }, limitInputPixels: false };
  const fine = await sharp(rgb, raw).blur(1.1).raw().toBuffer(), soft = await sharp(rgb, raw).blur(5).raw().toBuffer();
  const clean = Buffer.alloc(W * H * 3);
  for (let p = 0; p < W * H; p++) {
    const o = p * 3, l = (0.2126 * soft[o] + 0.7152 * soft[o + 1] + 0.0722 * soft[o + 2]) / 255;
    let t = Math.min(1, Math.max(0, (l - 0.22) / 0.2));
    t = t * t * (3 - 2 * t); // 立方根编码 0.22–0.42，约为辐亮度 0.003–0.018
    for (let k = 0; k < 3; k++) clean[o + k] = Math.round(soft[o + k] + (fine[o + k] - soft[o + k]) * t);
  }
  const out = 'assets/milkyway.webp';
  await sharp(clean, raw).webp({ quality: 82, effort: 6, smartSubsample: true }).toFile(out);
  console.log(`${out.padEnd(26)} ${W}×${H}  ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
