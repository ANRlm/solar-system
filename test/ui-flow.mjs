// 界面流程：隐形元素挡点击、全景状态、中英文切换、搜索、距离工具、星座连线、真实比例、设置抽屉音频页、快捷键面板、漫游时自动隐藏与恢复
import { launch, open } from './open.mjs';
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = await open(page);
await new Promise((r) => setTimeout(r, 7000));
// 看不见（透明）却会接收点击的元素：关闭的弹出层、搜索框、距离工具、漫游字幕若仍接收点击，会挡住下面的设置标签或画面
// （设置里开关下的透明复选框是自定义开关的正常结构，打开设置前不在检查范围内）
const ghosts = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.pointerEvents === 'none' || cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    let o = 1;
    for (let e = el; e && e !== document.body; e = e.parentElement) o *= +getComputedStyle(e).opacity;
    if (o < 0.02 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el) out.push(el.id || el.className || el.tagName);
  }
  return out;
});
console.log('隐形却挡点击的元素:', ghosts.length ? ghosts : '无');
if (ghosts.length) { console.error('FAIL 隐形元素挡点击'); process.exitCode = 1; }
// 设置抽屉的四个标签都能切换
await page.evaluate(() => document.getElementById('bSettings').click());
await new Promise((r) => setTimeout(r, 600));
const tabs = [];
for (const t of ['display', 'audio', 'about', 'quality']) { await page.click(`[data-tab=${t}]`); tabs.push(await page.evaluate(() => document.querySelector('[data-pane].on').dataset.pane)); }
console.log('设置标签:', tabs.join(','));
if (tabs.join() !== 'display,audio,about,quality') { console.error('FAIL 设置标签'); process.exitCode = 1; }
await page.keyboard.press('Escape');
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
// 搜索：/ 打开，输入后回车飞过去；英文类型按词首匹配（io 不应匹配到 Periodic comet）
const find = async (q) => { await page.keyboard.press('/'); await page.keyboard.type(q); await new Promise((r) => setTimeout(r, 200)); const r = await page.evaluate(() => [...document.querySelectorAll('#sres b')].map((b) => b.textContent).join(',')); return r; };
const io = await find('io');
await page.keyboard.press('Escape');
const tit = await find('titan');
await page.keyboard.press('Enter');
await page.waitForFunction(() => solar.nav.focus?.id === 'titan' && !solar.nav.flight, { timeout: 20000 });
console.log('搜 io:', io, ' 搜 titan 回车后聚焦:', await page.evaluate(() => solar.nav.focus.id));
if (io !== '木卫一,土卫四' || !tit.startsWith('土卫六')) { console.error('FAIL 搜索'); process.exitCode = 1; }
// 距离工具：D 打开（起点 = 当前天体），点画面中的天体选终点；地月距离应在 35.6 万 ~ 40.7 万 km
await page.evaluate(() => solar.focusOn('earth', { dur: 0.2 }));
await new Promise((r) => setTimeout(r, 1500));
await page.keyboard.press('d');
await page.evaluate(() => solar.ui.pickTarget(solar.byId.moon));
const em = await page.evaluate(() => document.getElementById('distOut').innerText.match(/([\d,]+) km/)?.[1].replace(/,/g, ''));
console.log('地月距离 km:', em);
if (!(em > 356000 && em < 407000)) { console.error('FAIL 距离工具'); process.exitCode = 1; }
await page.keyboard.press('Escape');
// 星座：C 切换
await page.keyboard.press('c');
await new Promise((r) => setTimeout(r, 300));
const cOn = await page.evaluate(() => solar.settings.constellations);
await page.keyboard.press('c');
console.log('星座开关:', cOn, '→', await page.evaluate(() => solar.settings.constellations));
if (!cOn) { console.error('FAIL 星座开关'); process.exitCode = 1; }
// 真实比例：P 切换，过渡约 2.2 秒；地球半径两种比例下都是 1.5，日地距离从约 60 变为约 35,222 单位；再按 P 切回
const geo = () => page.evaluate(() => [+solar.byId.earth.r.toFixed(3), Math.round(solar.byId.earth.pos.length())]);
await page.keyboard.press('p');
await new Promise((r) => setTimeout(r, 3200));
const real = await geo();
await page.keyboard.press('p');
await new Promise((r) => setTimeout(r, 3200));
const disp = await geo();
console.log('真实比例 [地球半径, 日地距离]:', real, ' 切回:', disp);
if (real[0] !== 1.5 || Math.abs(real[1] - 35222) > 700 || disp[0] !== 1.5 || Math.abs(disp[1] - 60) > 2) { console.error('FAIL 真实比例'); process.exitCode = 1; }
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
