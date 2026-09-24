// 冒烟测试：无头 Chrome 打开页面，收集控制台错误并截图
import { launch, open } from './open.mjs';
const shots = process.argv.slice(2);
const browser = await launch(['--window-size=1600,1000']);
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
const t0 = Date.now();
const errors = await open(page);
console.log('ready in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await new Promise((r) => setTimeout(r, 7500));
await page.screenshot({ path: '/tmp/ss-intro.png' });
for (const s of shots) {
  const [id, wait = 3500, js = ''] = s.split(':');
  await page.evaluate((id, js) => { if (js) eval(js); if (id !== '-') solar.focusOn(id, { dur: 0.3 }); }, id, js);
  await new Promise((r) => setTimeout(r, +wait));
  await page.screenshot({ path: `/tmp/ss-${id}.png` });
}
console.log('fps', await page.evaluate(() => solar.fps), 'gpu', await page.evaluate(() => document.getElementById('gpu').textContent));
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
