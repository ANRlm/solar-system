// 画面一致性：两个版本在同一时刻、同一镜头位姿下冻结时间截图，逐像素比较（用于验证“只优化性能、画面不变”）
// 用法：A=旧.html B=新.html node test/same.mjs [overview,earth,saturn,sun]；PRE=两边都执行的 JS，PATCH=只在 B 执行的 JS
// 星星闪烁、小行星、轨道线采样与运行时长有关，比较时隐藏；差异图输出到 /tmp/diff-视角.png
import { launch } from './open.mjs';
import sharp from 'sharp';
const browser = await launch(['--window-size=1280,800']);
const shoot = async (file, view) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  if (process.env.PATCH && file === process.env.B) await page.evaluateOnNewDocument((p) => { window.__patch = p; }, process.env.PATCH);
  if (process.env.PRE) await page.evaluateOnNewDocument((p) => { window.__pre = p; }, process.env.PRE);
  await page.goto('file://' + file);
  await page.waitForSelector('#loader.done', { timeout: 120000 });
  await page.evaluate((v) => { solar.sim.paused = true; solar.sim.t = Date.parse('2026-09-26T12:00Z'); v === 'overview' ? document.getElementById('bOverview').click() : solar.focusOn(v, { dur: 0.2 }); }, view);
  await page.waitForFunction(() => !solar.busy && !solar.nav.flight, { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 6000));
  // 镜头位姿直接给定（关闭阻尼），排除飞行与阻尼收敛带来的亚像素差异
  await page.evaluate((v) => {
    const { camera, controls, nav, THREE } = solar, b = nav.focus;
    const dist = v === 'overview' ? 760 : b.id === 'sun' ? 52 : b.r * 4.4;
    controls.enableDamping = false;
    for (const o of [solar.starsObj, solar.belt, solar.kuiper]) o.layers.set(31); // 星星闪烁、轨道线采样随运行时长变化，两次运行不一致，不参与比较
    solar.setSetting({ orbits: false }, false);
    controls.target.copy(b.pos);
    camera.position.copy(b.pos).add(new THREE.Vector3(v === 'overview' ? -0.25 : 0.6, v === 'overview' ? 0.55 : 0.25, 1).normalize().multiplyScalar(dist));
    camera.lookAt(b.pos);
    controls.update();
    if (window.__patch) eval(window.__patch);
    if (window.__pre) eval(window.__pre);
  }, view);
  // 冻结在固定时间戳（之后 dt = 0，与时间相关的动画两次运行一致），并隐藏界面，只比较画布
  await page.evaluate(() => new Promise((res) => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf(() => cb(1e6));
    const cv = document.querySelector('canvas');
    for (const el of document.body.querySelectorAll('*')) if (!el.contains(cv)) el.style.visibility = 'hidden';
    setTimeout(res, 800);
  }));
  const buf = await page.screenshot({ type: 'png' });
  await page.close();
  return sharp(buf).removeAlpha().raw().toBuffer();
};
let bad = 0;
for (const v of (process.argv[2] || 'overview,earth,saturn,sun').split(',')) {
  const [a, b] = [await shoot(process.env.A || '/tmp/before.html', v), await shoot(process.env.B || '/tmp/after.html', v)];
  let max = 0, sum = 0, n1 = 0;
  const d = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) { const x = Math.abs(a[i] - b[i]); max = Math.max(max, x); sum += x; if (x > 2) n1++; d[i] = Math.min(255, x * 16); }
  await sharp(d, { raw: { width: 1280, height: 800, channels: 3 } }).png().toFile(`/tmp/diff-${v}.png`);
  console.log(`${v.padEnd(9)} 平均差 ${(sum / a.length).toFixed(3)}  最大差 ${max}  差>2 的通道数 ${n1}`);
  if (max > 8) bad++;
}
await browser.close();
process.exit(bad ? 1 : 0);
