// 测试共用：启动无头 Chrome，打开页面，等待加载完成直接进入
import puppeteer from 'puppeteer-core';

export async function launch(args = []) {
  return puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', ...args] });
}
export async function open(page, errors = []) {
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => ['error', 'warning', 'warn'].includes(m.type()) && errors.push(`[${m.type()}] ${m.text().slice(0, 600)}`));
  await page.goto('file://' + (process.env.HTML || process.cwd() + '/solar-system.html'));
  await page.waitForSelector('#loader.done', { timeout: 120000 });
  await page.waitForFunction(() => /^\d+$/.test(solar.fps), { timeout: 60000 });
  return errors;
}
