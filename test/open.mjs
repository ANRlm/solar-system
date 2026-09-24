// 测试共用：启动无头 Chrome，打开页面，等待加载完成直接进入
import puppeteer from 'puppeteer-core';

export async function launch(args = []) {
  return puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', ...args] });
}
export async function open(page, errors = []) {
  // 测试默认中文界面（无头浏览器的系统语言是英文）；TEST_LANG=en 可测英文
  await page.evaluateOnNewDocument((l) => localStorage.getItem('solar.lang') || localStorage.setItem('solar.lang', l), process.env.TEST_LANG || 'zh');
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => ['error', 'warning', 'warn'].includes(m.type()) && errors.push(`[${m.type()}] ${m.text().slice(0, 600)}`));
  await page.goto('file://' + (process.env.HTML || process.cwd() + '/solar-system.html'));
  await page.waitForSelector('#loader.done', { timeout: 120000 });
  await page.waitForFunction(() => /^\d+$/.test(solar.fps), { timeout: 60000 });
  return errors;
}
