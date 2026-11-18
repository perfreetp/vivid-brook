// 四个界面最终效果截图
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
mkdirSync('scripts/shots', { recursive: true });
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--disable-gpu', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1600,1000', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:5174';

// 1. 审图台（拉近看支管/支架）
await page.goto(`${BASE}/#/review`, { waitUntil: 'load' });
await sleep(2800);
const box = await page.evaluate(() => {
  const c = document.querySelector('.viewport-wrap canvas').getBoundingClientRect();
  return { x: c.x, y: c.y, w: c.width, h: c.height };
});
await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
for (let i = 0; i < 8; i++) await page.mouse.wheel({ deltaY: -120 });
await sleep(800);
await page.screenshot({ path: 'scripts/shots/final-1-review.png' });

// 点选一根管线看信息卡
for (const [dx, dy] of [[0, 0], [-80, 40], [80, -40], [0, 80]]) {
  await page.mouse.click(box.x + box.w / 2 + dx, box.y + box.h / 2 + dy);
  await sleep(300);
  const has = await page.evaluate(() => !!document.querySelector('.info-card'));
  if (has) break;
}
await sleep(400);
await page.screenshot({ path: 'scripts/shots/final-2-picked.png' });

// 2. 版本管理
await page.goto(`${BASE}/#/versions`, { waitUntil: 'load' });
await sleep(900);
await page.screenshot({ path: 'scripts/shots/final-3-versions.png' });

// 3. 批注管理
await page.goto(`${BASE}/#/annotations`, { waitUntil: 'load' });
await sleep(900);
await page.screenshot({ path: 'scripts/shots/final-4-annotations.png' });

// 4. 版本比对
await page.goto(`${BASE}/#/compare`, { waitUntil: 'load' });
await sleep(3000);
await page.screenshot({ path: 'scripts/shots/final-5-compare.png' });

console.log('截图完成');
await browser.close();
