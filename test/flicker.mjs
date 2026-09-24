// 闪光检测：逐帧回读画面，找出“只亮一帧”的大块区域——亮度比前后两帧邻域（膨胀 3 像素，排除正常运动）都高出很多
// 场景：天体间来回飞行 + 完整漫游。输出闪光事件统计，并保存面积最大的几次（洋红色标出）
import { launch, open } from './open.mjs';
import sharp from 'sharp';
const W = 960, H = 600, MIN = +(process.argv.find((a) => /^\d+$/.test(a)) || 40);
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
const errors = await open(page);
await page.evaluate((MIN, WHITE, STILL) => {
  const gl = solar.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, R = 3;
  let ring = [];
  window.__ev = []; window.__frames = 0;
  const dil = (L) => { const t = new Float32Array(w * h), o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = -R; k <= R; k++) m = Math.max(m, L[y * w + Math.min(w - 1, Math.max(0, x + k))]); t[y * w + x] = m; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = -R; k <= R; k++) m = Math.max(m, t[Math.min(h - 1, Math.max(0, y + k)) * w + x]); o[y * w + x] = m; }
    return o; };
  window.__afterRender = () => {
    window.__frames++;
    const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) / 255;
    ring.push({ L, D: dil(L), px, info: { scene: window.__scene, focus: solar.nav.focus?.id, flight: !!solar.nav.flight, sunVis: +solar.composer().passes[3].uniforms.uSunVis.value.toFixed(2),
      cam: solar.camera.position.toArray().map((v) => +v.toFixed(1)), t: solar.sim.t,
      comets: Object.values(solar.byId).filter((o) => o.def.kind === 'comet').map((o) => { const p = o.pos.clone().project(solar.camera); return [o.id, +o.act.toFixed(3), +((p.x * 0.5 + 0.5) * w).toFixed(0), +((0.5 - p.y * 0.5) * h).toFixed(0), +p.z.toFixed(5), o.tails[0].visible]; }) } });
    if (ring.length > 3) ring.shift(); if (ring.length < 3) return;
    const [a, b, c] = ring;
    let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    const flag = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (b.L[i] - Math.max(a.D[i], c.D[i]) > 0.3 && b.L[i] > 0.55) { n++; flag[i] = 1; const x = i % w, y = (i / w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (n < MIN) return;
    // 闪光区域的平均颜色与饱和度（白色 = 高亮度、低饱和）
    let r = 0, g = 0, bl = 0;
    for (let i = 0; i < w * h; i++) if (flag[i]) { r += b.px[i * 4]; g += b.px[i * 4 + 1]; bl += b.px[i * 4 + 2]; }
    r /= n; g /= n; bl /= n;
    const sat = (Math.max(r, g, bl) - Math.min(r, g, bl)) / Math.max(1, Math.max(r, g, bl));
    if (window.__white && !(sat < 0.25 && (r + g + bl) / 3 > 170)) return;
    if (window.__still && b.info.flight) return;
    const ev = { ...b.info, n, bbox: [x0, h - y1, x1, h - y0], rgb: [r | 0, g | 0, bl | 0] };
    const top = window.__ev.filter((e) => e.png).sort((p, q) => p.n - q.n);
    if (top.length < 4 || n > top[0].n) {
      const m = new Uint8Array(b.px);
      for (let i = 0; i < w * h; i++) if (flag[i]) m.set([255, 0, 255, 255], i * 4);
      ev.png = Array.from(m); ev.pa = Array.from(a.px); ev.pc = Array.from(c.px); ev.pb = Array.from(b.px);
      if (top.length >= 4) { delete top[0].png; delete top[0].pa; delete top[0].pc; delete top[0].pb; }
    }
    window.__ev.push(ev);
  };
  window.__white = WHITE;
  window.__still = STILL;
}, MIN, process.argv.includes('--white'), process.argv.includes('--still'));
const scene = async (name, js, ms) => { await page.evaluate((name, js) => { window.__scene = name; eval(js); }, name, js); await new Promise((r) => setTimeout(r, ms)); };
const hops = process.argv.includes('--tour') ? [] : process.argv.includes('--saturn') ? ['saturn', 'jupiter', 'saturn'] : ['mars', 'jupiter', 'saturn', 'earth', 'venus', 'sun', 'neptune', 'moon', 'uranus', 'mercury', 'pluto', 'encke', 'earth'];
await page.evaluate(() => (solar.sim.ri = 4));
for (const id of hops) await scene(`飞往 ${id}`, `solar.focusOn('${id}')`, 6000);
if (!process.argv.includes('--saturn')) {
  await page.evaluate(() => { solar.sim.ri = 4; });
  await scene('全景', "document.getElementById('bOverview').click()", 7000);
  await scene('漫游', "document.getElementById('bTour').click()", 1000);
  for (let k = 0; k < 18; k++) await scene('漫游', "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))", 5000);
}
const ev = await page.evaluate(() => __ev.map(({ png, pa, pb, pc, ...e }) => e));
const frames = await page.evaluate(() => __frames);
console.log(`检测帧数 ${frames}，闪光事件（≥${MIN} 像素）${ev.length}`);
const by = {};
for (const e of ev) { const k = `${e.scene}${e.flight ? ' 飞行中' : ''}`; by[k] = (by[k] || 0) + 1; }
console.log(JSON.stringify(by));
ev.sort((a, b) => b.n - a.n).slice(0, 8).forEach((e) => console.log(JSON.stringify(e)));
const dump = await page.evaluate(() => __ev.filter((e) => e.png).sort((a, b) => b.n - a.n).map((e) => [e.png, e.pa, e.pb, e.pc]));
for (let i = 0; i < dump.length; i++) for (const [j, k] of ['', '-a', '-b', '-c'].entries()) await sharp(Buffer.from(dump[i][j]), { raw: { width: W, height: H, channels: 4 } }).flip().png().toFile(`/tmp/flash-${i}${k}.png`);
console.log(errors.join('\n') || 'no errors');
await browser.close();
