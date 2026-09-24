// 天文校验：用已知天象验证轨道与自转计算（在页面内对运行中的模拟取样）
import { launch, open } from './open.mjs';
const browser = await launch();
const page = await browser.newPage();
await open(page);
const at = (iso) => page.evaluate(async (iso) => {
  solar.sim.paused = true; solar.sim.t = Date.parse(iso);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const b = solar.byId, ang = (a, c) => Math.acos(Math.max(-1, Math.min(1, a.clone().normalize().dot(c.clone().normalize())))) * 180 / Math.PI;
  const toSunE = b.earth.au.clone().negate();
  const lon = (v) => Math.atan2(-v.z, v.x) * 180 / Math.PI, dl = (a, c) => ((lon(a) - lon(c)) % 360 + 540) % 360 - 180;
  return {
    mars: Math.abs(dl(b.mars.au, b.earth.au)), jupiter: Math.abs(dl(b.jupiter.au, b.earth.au)), saturn: Math.abs(dl(b.saturn.au, b.earth.au)),
    venusInf: Math.abs(dl(b.venus.au, b.earth.au)),
    moonSun: Math.abs(dl(b.moon.au.clone().sub(b.earth.au), toSunE)),
    greenwichSun: ang(b.earth.M, toSunE),
    halleyR: b.halley.au.length(), halebopR: b.halebopp.au.length(),
  };
}, iso);
const cases = [
  ['2025-01-16T02:00Z', 'mars', 0, 0.5, '火星冲日'],
  ['2026-01-10T08:00Z', 'jupiter', 0, 0.5, '木星冲日'],
  ['2025-09-21T04:00Z', 'saturn', 0, 0.5, '土星冲日'],
  ['2025-03-23T01:00Z', 'venusInf', 0, 0.5, '金星下合'],
  ['2026-08-12T17:46Z', 'moonSun', 0, 0.6, '2026-08-12 日全食：日月黄经差'],
  ['2026-09-26T16:49Z', 'moonSun', 180, 0.6, '2026-09-26 满月：日月黄经差'],
  ['2026-09-23T12:00Z', 'greenwichSun', 0, 3, '12:00 UTC 格林尼治正午'],
  ['1986-02-09T11:00Z', 'halleyR', 0.5749, 0.002, '哈雷彗星 1986 过近日点 (AU)'],
  ['2061-07-28T12:00Z', 'halleyR', 0.5749, 0.002, '哈雷彗星 2061 过近日点 (AU)'],
  ['1997-03-30T15:00Z', 'halebopR', 0.8905, 0.002, '海尔-波普 1997 过近日点 (AU)'],
  // 高偏心率开普勒方程：旧解法在这里不收敛，彗星会闪现到 1 AU 附近（2022 年实测约 46 AU）
  ['2026-09-26T16:49Z', 'halebopR', 50, 3, '海尔-波普 2026 日距 (AU)'],
];
let fail = 0;
for (const [iso, k, want, tol, name] of cases) {
  const v = (await at(iso))[k], err = Math.abs(v - want), ok = err <= tol;
  if (!ok) fail++;
  const u = k.endsWith('R') ? '' : '°';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} ${k}=${v.toFixed(u ? 2 : 4)}${u}  (期望 ${want}${u} ±${tol})`);
}
await browser.close();
process.exit(fail ? 1 : 0);
