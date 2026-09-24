// 一次性下载真实行星贴图并转成 WebP，输出到 assets/（构建时内联进 HTML，此后构建无需联网）
// 色彩贴图：Solar System Scope（CC BY 4.0，基于 NASA 数据）；月球高程：NASA SVS CGI Moon Kit（公有领域）
import { mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
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
