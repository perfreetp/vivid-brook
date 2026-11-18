// UI 冒烟测试: 打开页面, 收集控制台错误, 截图, 简单交互
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1500,950'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 5000));

// 基本结构
const checks = await page.evaluate(() => ({
  hasCanvas: !!document.querySelector('canvas'),
  sections: [...document.querySelectorAll('.panel h2')].map(h => h.textContent.trim()),
  status: document.querySelector('.badge')?.textContent,
}));
console.log('canvas:', checks.hasCanvas, ' 状态:', checks.status);
console.log('面板栏目:', checks.sections.join(' | '));

await page.screenshot({ path: 'test/shot-night.png' });

// 切到热力图
await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.layer-grid .chk')];
  const heat = labels.find(l => l.textContent.includes('热力图'));
  heat.querySelector('input').click();
});
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: 'test/shot-heat.png' });

// 切到夏至正午(白天日照)
await page.evaluate(() => {
  const sliders = [...document.querySelectorAll('input[type=range]')];
  const time = sliders[0]; // 第一个滑块是时间
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(time, '12');
  time.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: 'test/shot-day.png' });

// 暗区统计读数
const stats = await page.evaluate(() => {
  const sec = [...document.querySelectorAll('.panel section')].find(s => s.textContent.includes('暗区分析'));
  return sec ? sec.textContent.replace(/\s+/g, ' ').slice(0, 160) : 'N/A';
});
console.log('暗区分析:', stats);

console.log(errors.length ? '控制台错误:\n' + errors.join('\n') : '无控制台错误');
await browser.close();
