// GPU 耗时剖析：同一帧同步重复渲染 K 次，再用 1 像素 readPixels 等 GPU 完成，墙钟时间 / K 即单帧 GPU 耗时
// 消融：逐项隐藏某类物体 / 关闭某个后期效果，看单帧耗时减少多少
// 用法：node test/prof.mjs [宽x高xDPR] [预设]
import { launch, open } from './open.mjs';
const [w, h, dpr] = (process.argv[2] || '1920x1080x2').split('x').map(Number), preset = process.argv[3] || 'high';
const browser = await launch([`--window-size=${w},${h}`]);
const page = await browser.newPage();
await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
const errors = await open(page);
await page.evaluate((p) => {
  if (solar.settings.preset !== p) solar.setSetting({ ...solar.PRESETS[p], preset: p }, false);
  const scene = solar.composer().passes[0].scene, B = Object.values(solar.byId);
  const cat = {
    行星卫星球面: B.filter((b) => b.id !== 'sun').map((b) => b.mesh), 太阳: [solar.byId.sun.mesh, solar.byId.sun.corona], 大气: B.map((b) => b.atm), 光环: B.map((b) => b.ring),
    轨道线: B.map((b) => b.orbit), 彗星: B.flatMap((b) => [b.coma, ...(b.tails || [])]), 小行星带: [solar.belt], 柯伊伯带: [solar.kuiper], 星空: [solar.starsObj],
  };
  const known = new Set(Object.values(cat).flat().filter(Boolean));
  cat.其他 = []; scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && !known.has(o)) cat.其他.push(o); });
  window.__cat = Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, v.filter(Boolean)]));
  window.__hideCat = (k, on) => { for (const o of __cat[k] || []) on ? o.layers.set(31) : o.layers.set(0); };
  const gl = solar.renderer.getContext(), px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // 取 3 轮中位数
  window.__bench = (K = 30) => {
    const c = solar.composer(), r = [];
    for (let k = 0; k < 3; k++) { sync(); const t0 = performance.now(); for (let i = 0; i < K; i++) c.render(0); sync(); r.push((performance.now() - t0) / K); }
    return r.sort((a, b) => a - b)[1];
  };
}, preset);
const views = { 全景: "document.getElementById('bOverview').click()", 地球: "solar.focusOn('earth', { dur: 0.2 })", 土星: "solar.focusOn('saturn', { dur: 0.2 })", 太阳: "solar.focusOn('sun', { dur: 0.2 })" };
const fx = { 泛光: 'bloom', 体积光: 'rays', 镜头光晕: 'flare', 胶片: 'film' };
const res = (await page.evaluate(() => solar.stats())), size = `${res.w}×${res.h}${res.aa ? ` ${res.aa}×AA` : ''}`;
for (const [v, js] of Object.entries(views)) {
  await page.evaluate(js);
  await page.waitForFunction(() => !solar.busy && !solar.nav.flight, { timeout: 120000 });
  await page.evaluate(() => { solar.sim.paused = true; solar.controls.autoRotate = false; });
  await new Promise((r) => setTimeout(r, 1200));
  const base = await page.evaluate(() => __bench());
  const rows = [];
  if (!process.env.QUICK) for (const k of await page.evaluate(() => Object.keys(__cat))) rows.push([k, base - (await page.evaluate((k) => { __hideCat(k, true); const t = __bench(); __hideCat(k, false); return t; }, k))]);
  if (!process.env.QUICK) for (const [k, s] of Object.entries(fx)) {
    if (!(await page.evaluate((s) => solar.settings[s], s))) continue;
    await page.evaluate((s) => solar.setSetting({ [s]: false }, false), s);
    await new Promise((r) => setTimeout(r, 200));
    rows.push([k, base - (await page.evaluate(() => __bench()))]);
    await page.evaluate((s) => solar.setSetting({ [s]: true }, false), s);
    await new Promise((r) => setTimeout(r, 200));
  }
  const cpu = await page.evaluate(() => { const t0 = performance.now(); for (let i = 0; i < 30; i++) solar.composer().render(0); return (performance.now() - t0) / 30; });
  console.log(`\n== ${v}  ${size}  GPU ${base.toFixed(2)} ms/帧，提交渲染命令的 JS ${cpu.toFixed(2)} ms`);
  for (const [k, d] of rows.sort((a, b) => b[1] - a[1])) console.log(`  ${d.toFixed(2).padStart(6)} ms  ${k}`);
}
console.log(errors.join('\n') || 'no errors');
await browser.close();
