// 交互流程测试: 画建筑 -> 放灯 -> 送审 -> 退回 -> 再送审 -> 公示 -> 批注 -> 导出CSV
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1500,950'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 5000));
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 5000));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const canvasBox = async () => (await (await page.$('canvas')).boundingBox());

// 1. 画建筑轮廓(在画布空白处点画四边形)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.tool-grid button')];
  btns.find(b => b.textContent.includes('画建筑轮廓')).click();
});
const box = await canvasBox();
const pts = [[80, 700], [200, 700], [200, 780], [80, 780]];
for (const [x, y] of pts) { await page.mouse.click(box.x + x, box.y + y); await sleep(150); }
await page.keyboard.press('Enter');
await sleep(600);
const bCount = await page.evaluate(() => document.querySelector('.panel').textContent.includes('建筑: 建筑'));
console.log('画建筑后选中面板出现:', bCount);

// 2. 放一个路灯
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.tool-grid button')];
  btns.find(b => b.textContent.includes('＋路灯')).click();
});
await page.mouse.click(box.x + 300, box.y + 720);
await sleep(600);
const lightPanel = await page.evaluate(() => document.querySelector('.panel').textContent.includes('挂高'));
console.log('放灯后参数面板出现:', lightPanel);

// 3. 提交送审
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === '提交送审').click());
await sleep(400);
let status = await page.evaluate(() => document.querySelector('.badge').textContent);
console.log('提交送审后状态(应送审中):', status);

// 4. 切审查人, 填意见退回
await page.select('.panel select', 'reviewer');
await sleep(300);
await page.type('.panel textarea', '庭院照度不足, 请补充庭院灯');
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === '退回修改').click());
await sleep(400);
status = await page.evaluate(() => document.querySelector('.badge').textContent);
console.log('退回后状态(应草稿):', status);
const hasComment = await page.evaluate(() => document.querySelector('.panel').textContent.includes('庭院照度不足'));
console.log('退回意见已记录:', hasComment);

// 5. 规划员再送审 -> 审查人通过并公示
await page.select('.panel select', 'planner');
await sleep(200);
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === '提交送审').click());
await sleep(300);
await page.select('.panel select', 'reviewer');
await sleep(200);
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === '通过并公示').click());
await sleep(400);
status = await page.evaluate(() => document.querySelector('.badge').textContent);
console.log('公示状态:', status);

// 6. 公示下编辑工具应禁用
const toolsDisabled = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.tool-grid button')];
  return btns.find(b => b.textContent.includes('画建筑轮廓')).disabled;
});
console.log('公示下画建筑按钮禁用:', toolsDisabled);

// 7. 公众放批注
await page.select('.panel select', 'public');
await sleep(200);
await page.type('.annot-box input', '此处建议增加座椅照明');
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === '放置批注').click());
await page.mouse.click(box.x + 400, box.y + 400);
await sleep(500);
const annotOk = await page.evaluate(() => document.querySelector('.panel').textContent.includes('此处建议增加座椅照明'));
console.log('批注已添加:', annotOk);
await page.screenshot({ path: 'test/shot-published.png' });

// 8. 放大看格值与标签(滚轮放大到灯附近)
await page.mouse.move(box.x + 500, box.y + 400);
for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: -240 }); await sleep(120); }
await sleep(800);
await page.screenshot({ path: 'test/shot-zoom.png' });

// 9. 导出 CSV 不应报错(拦截下载)
const client = await page.createCDPSession();
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: 'D:/ccfb/runs/1000073/workspace/test/dl' });
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('导出照度统计')).click());
await sleep(1200);

console.log(errors.length ? '控制台错误:\n' + errors.join('\n') : '无控制台错误');
await browser.close();
