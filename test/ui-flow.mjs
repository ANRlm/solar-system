// 界面流程：全景状态、中英文切换、设置抽屉音频页、快捷键面板、漫游时自动隐藏与恢复
import { launch, open } from './open.mjs';
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = await open(page);
await new Promise((r) => setTimeout(r, 7000));
// 全景：不选中任何天体，信息卡显示太阳系；再点太阳才是聚焦太阳
const state = () => page.evaluate(() => [document.getElementById('iName').textContent, document.querySelector('#nav .active')?.textContent.trim() || '', document.getElementById('bOverview').classList.contains('on')].join('|'));
await page.keyboard.press('o');
const ov = await state();
await page.evaluate(() => solar.byId.sun.navBtn.click());
const sun = await state();
console.log('全景:', ov, ' 点太阳后:', sun);
if (ov !== '太阳系||true' || sun !== '太阳|太阳|false') { console.error('FAIL 全景状态'); process.exitCode = 1; }
// 中英文切换：原地重绘，聚焦不变；再切回中文
await page.keyboard.press('l');
const en = await page.evaluate(() => [document.getElementById('iName').textContent, document.querySelector('#bTour span:last-child').textContent, document.documentElement.lang].join('|'));
await page.keyboard.press('l');
const zh = await page.evaluate(() => [document.getElementById('iName').textContent, document.querySelector('#bTour span:last-child').textContent, document.documentElement.lang].join('|'));
console.log('英文:', en, ' 切回:', zh);
if (en !== 'Sun|Tour|en' || zh !== '太阳|漫游|zh-CN') { console.error('FAIL 中英文切换'); process.exitCode = 1; }
await page.evaluate(() => { document.getElementById('bSettings').click(); document.querySelector('[data-tab=audio]').click(); });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: '/tmp/ui-audio.png' });
await page.keyboard.press('Escape');
await page.keyboard.press('?');
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: '/tmp/ui-help.png' });
await page.keyboard.press('Escape');
await page.keyboard.press('t');
await new Promise((r) => setTimeout(r, 9000));
console.log('漫游中 idle:', await page.evaluate(() => document.body.classList.contains('idle')));
await page.screenshot({ path: '/tmp/ui-idle.png' });
await page.mouse.move(400, 400);
await new Promise((r) => setTimeout(r, 600));
console.log('移动鼠标后 idle:', await page.evaluate(() => document.body.classList.contains('idle')));
console.log(errors.join('\n') || 'no errors');
await browser.close();
