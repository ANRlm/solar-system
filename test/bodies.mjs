// 新增天体截图：逐个聚焦并拼成总览图（隐藏界面，只看天体）
import { launch, open } from './open.mjs';
import sharp from 'sharp';
const ids = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 600 });
const errors = await open(page);
await page.evaluate(() => { document.body.classList.add('hide-ui'); });
const tiles = [];
for (const id of ids) {
  await page.evaluate((id) => solar.focusOn(id, { dur: 0.3 }), id);
  await new Promise((r) => setTimeout(r, 2200));
  tiles.push(await sharp(await page.screenshot()).resize(450, 300).toBuffer());
}
const cols = 4, rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: 450 * cols, height: 300 * rows, channels: 3, background: '#000' } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * 450, top: Math.floor(i / cols) * 300 }))).png().toFile('/tmp/bodies.png');
console.log(errors.join('\n') || 'no errors');
await browser.close();
