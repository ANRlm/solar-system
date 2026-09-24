// 实时配乐：首次点击画面后确认音频在播放、情绪随天体切换、开关音乐能挂起/恢复音频上下文
import { launch } from './open.mjs';
const browser = await launch(['--autoplay-policy=user-gesture-required']);
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + process.cwd() + '/solar-system.html');
await page.waitForSelector('#loader.done', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));
console.log('交互前音频已解锁:', await page.evaluate(() => solar.player.unlocked));
await page.mouse.click(700, 300); // 第一次交互开启音乐
const level = () => page.evaluate(async () => {
  const p = solar.player, a = p.ctx.createAnalyser();
  a.fftSize = 8192;
  p.m.out.connect(a);
  await new Promise((r) => setTimeout(r, 400));
  const d = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(d);
  p.m.out.disconnect(a);
  return { state: p.ctx.state, rms: (20 * Math.log10(Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length) + 1e-9)).toFixed(1), voices: p.m.voices.length };
});
await new Promise((r) => setTimeout(r, 9000));
console.log('进入 9 秒后     ', await level());
await page.evaluate(() => solar.focusOn('jupiter', { dur: 0.5 }));
await new Promise((r) => setTimeout(r, 6000));
console.log('聚焦木星后     ', await level(), '情绪', await page.evaluate(() => solar.player.moodName));
await page.keyboard.press('m');
await new Promise((r) => setTimeout(r, 2500));
console.log('按 M 关闭后    ', await page.evaluate(() => solar.player.ctx.state));
await page.keyboard.press('m');
await new Promise((r) => setTimeout(r, 3000));
console.log('再按 M 开启后  ', await level());
console.log(errors.join('\n') || 'no errors');
await browser.close();
