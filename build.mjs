// 构建：栅格化真实数据（海陆 / 银河 / 星表）→ esbuild 打包 → 内联成单个离线 HTML
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { build } from 'esbuild';
import { feature } from 'topojson-client';

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const b64 = (u8) => Buffer.from(deflateRawSync(u8, { level: 9 })).toString('base64');

// 偶奇规则扫描线填充，坐标为 [lon, lat]（度），输出等距圆柱投影 W×H，v=0 为北极
// 跨 ±180° 的环先展开经度；绕极一圈的环（南极洲、银河带）经南极闭合；再按 -360/0/+360 各画一次
function rasterize(rings, W, H, out, value) {
  const edges = [];
  for (const ring of rings) {
    const pts = [];
    let off = 0;
    ring.forEach(([lon, lat], i) => {
      if (i && Math.abs(lon + off - pts[i - 1][0]) > 180) off -= Math.sign(lon + off - pts[i - 1][0]) * 360;
      pts.push([lon + off, lat]);
    });
    const drift = pts[pts.length - 1][0] - pts[0][0];
    if (Math.abs(drift) > 180) pts.push([pts[pts.length - 1][0], -90], [pts[0][0], -90]);
    for (const shift of [-360, 0, 360])
      for (let i = 0, n = pts.length; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const x0 = (a[0] + shift + 180) / 360 * W, y0 = (90 - a[1]) / 180 * H;
        const x1 = (b[0] + shift + 180) / 360 * W, y1 = (90 - b[1]) / 180 * H;
        if (y0 !== y1) edges.push([x0, y0, x1, y1]);
      }
  }
  const xs = [];
  for (let y = 0; y < H; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges)
      if ((y0 <= sy) !== (y1 <= sy)) xs.push(x0 + (sy - y0) / (y1 - y0) * (x1 - x0));
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.max(0, Math.round(xs[k])); x < Math.min(W, Math.round(xs[k + 1])); x++)
        out[y * W + x] ^= value;
  }
}

// 地球海陆掩膜 2048×1024，按位打包
const LW = 2048, LH = 1024;
const land = new Uint8Array(LW * LH);
const topo = json('./node_modules/world-atlas/land-50m.json');
for (const f of feature(topo, topo.objects.land).features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const p of polys) rasterize(p, LW, LH, land, 1);
}
const landBits = new Uint8Array(LW * LH / 8);
land.forEach((v, i) => v && (landBits[i >> 3] |= 1 << (i & 7)));

// 银河亮度分层 1024×512（赤道坐标），ol1..ol5 叠加
const MW = 1024, MH = 512;
const milky = new Uint8Array(MW * MH);
for (const f of json('./node_modules/d3-celestial/data/milkyway.json').features) {
  const layer = new Uint8Array(MW * MH);
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const p of polys) rasterize(p, MW, MH, layer, 1);
  layer.forEach((v, i) => (milky[i] += v * 50));
}

// 真实星表（到 8 等）：ra u16, dec i16, mag u8, bv i8
const stars = json('./node_modules/d3-celestial/data/stars.8.json').features;
const sv = new DataView(new ArrayBuffer(stars.length * 6));
stars.forEach((s, i) => {
  const [ra, dec] = s.geometry.coordinates;
  const bv = parseFloat(s.properties.bv);
  sv.setUint16(i * 6, Math.round(((ra + 360) % 360) / 360 * 65535), true);
  sv.setInt16(i * 6 + 2, Math.round(dec / 90 * 32767), true);
  sv.setUint8(i * 6 + 4, Math.max(0, Math.min(255, Math.round((s.properties.mag + 2) * 25))));
  sv.setInt8(i * 6 + 5, Math.round((isNaN(bv) ? 0.6 : Math.max(-0.4, Math.min(2.2, bv))) * 50));
});

// 真实行星贴图（由 tools/fetch-textures.mjs 生成）
const tex = Object.fromEntries(readdirSync('assets').filter((f) => f.endsWith('.webp')).map((f) => [f.slice(0, -5), readFileSync(`assets/${f}`).toString('base64')]));

const res = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'esm', write: false,
  define: {
    __LAND__: JSON.stringify(b64(landBits)),
    __MILKY__: JSON.stringify(b64(milky)),
    __STARS__: JSON.stringify(b64(new Uint8Array(sv.buffer))),
    __TEX__: JSON.stringify(tex),
  },
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/index.html', 'utf8').replace('<!--APP-->', () => `<script type="module">${js}</script>`);
writeFileSync('solar-system.html', html);
console.log(`solar-system.html  ${(html.length / 1048576).toFixed(1)} MB  (${stars.length} stars, ${Object.keys(tex).length} textures)`);

