// 漫游截图：逐站截取并拼成总览（参数为站数）
// 漫游抽查：从指定站开始逐站截图
import { launch, open } from './open.mjs';
import sharp from 'sharp';
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 750 });
const errors = await open(page);
await new Promise((r) => setTimeout(r, 7000));
await page.keyboard.press('t');
const tiles = [];
for (let k = 0; k < +(process.argv[2] || 19); k++) {
  await new Promise((r) => setTimeout(r, 6500));
  tiles.push(await sharp(await page.screenshot()).resize(600, 375).toBuffer());
  await page.keyboard.press('ArrowRight');
}
const cols = 3, rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: 600 * cols, height: 375 * rows, channels: 3, background: '#000' } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * 600, top: Math.floor(i / cols) * 375 }))).png().toFile('/tmp/tour.png');
console.log(errors.join('\n') || 'no errors');
await browser.close();
