// 验证 CSV 导出内容(拦截 blob URL)
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 5000));

const csv = await page.evaluate(async () => {
  let captured = null;
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { captured = b; return orig(b); };
  [...document.querySelectorAll('button')].find(b => b.textContent.includes('导出照度统计')).click();
  return captured ? await captured.text() : 'NO-BLOB';
});
console.log(csv.split('\n').slice(0, 14).join('\n'));
await browser.close();
