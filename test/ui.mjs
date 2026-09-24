// 界面截图：桌面（默认 / 设置抽屉 / 日期弹层 / 性能弹层）、窄屏、手机、入场页
import { launch, open } from './open.mjs';
const browser = await launch();
const errors = [];
const shot = async (name, w, h, dpr, mobile, fn) => {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  if (name === 'entry') {
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('file://' + process.cwd() + '/solar-system.html');
    await page.waitForSelector('#loader.ready', { timeout: 120000 });
    await new Promise((r) => setTimeout(r, 1500));
  } else {
    await open(page, errors);
    await new Promise((r) => setTimeout(r, 7500));
    if (fn) { await page.evaluate(fn); await new Promise((r) => setTimeout(r, 1500)); }
  }
  await page.screenshot({ path: `/tmp/ui-${name}.png` });
  await page.close();
};
await shot('desk', 1600, 1000, 1, false);
await shot('drawer', 1600, 1000, 1, false, () => document.getElementById('bSettings').click());
await shot('date', 1600, 1000, 1, false, () => { solar.focusOn('jupiter', { dur: 0.3 }); document.getElementById('clock').click(); document.getElementById('fpsPill').click(); document.getElementById('clock').click(); });
await shot('narrow', 1100, 800, 1, false, () => solar.focusOn('saturn', { dur: 0.3 }));
await shot('mobile', 390, 844, 3, true, () => solar.focusOn('jupiter', { dur: 0.3 }));
console.log(errors.join('\n') || 'no errors');
await browser.close();
