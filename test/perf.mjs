// 性能测试：关闭垂直同步，逐个画质预设测量帧率
import { launch, open } from './open.mjs';
const [w, h, dpr] = (process.argv[2] || '1920x1080x2').split('x').map(Number);
const browser = await launch(['--disable-gpu-vsync', '--disable-frame-rate-limit', `--window-size=${w},${h}`]);
const page = await browser.newPage();
await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
const errors = await open(page);
for (const p of ['low', 'medium', 'high', 'ultra']) {
  for (const view of ['earth', 'saturn']) {
    await page.evaluate((p, v) => { if (solar.settings.preset !== p) document.querySelector(`[data-p="${p}"]`).click(); solar.focusOn(v, { dur: 0.2 }); }, p, view);
    await page.waitForFunction(() => !solar.busy, { timeout: 120000 });
    await new Promise((r) => setTimeout(r, 3500));
    const [fps, s] = await page.evaluate(() => [solar.fps, solar.stats()]);
    console.log(`${p.padEnd(7)} ${view.padEnd(7)} fps=${fps.padStart(4)}  ${(1000 / fps).toFixed(1).padStart(5)} ms  ${s.w}×${s.h}${s.aa ? ` · ${s.aa}×AA` : ''}`);
  }
}
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
