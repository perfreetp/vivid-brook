// 浏览器 E2E：WebGL2 渲染、拾取、图层、LOD、剖切、批注、版本、比对
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

mkdirSync('scripts/shots', { recursive: true });
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5174';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ✅ ${name}`);
  else { failures++; console.log(`  ❌ ${name} ${extra}`); }
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--disable-gpu', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--window-size=1600,1000', '--no-sandbox',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

// ---------- 1. 审图台 ----------
console.log('\n[1/5] 三维审图台');
await page.goto(`${BASE}/#/review`, { waitUntil: 'load' });
await sleep(2500);
const benign = (e) => e.includes('createRoot') || e.includes('favicon') || e.includes('404') || e.includes('Failed to load resource');
check('无运行时异常', pageErrors.filter((e) => !benign(e)).length === 0, JSON.stringify(pageErrors));

const gl = await page.evaluate(() => {
  const c = document.querySelector('.viewport-wrap canvas');
  return { hasCanvas: !!c, w: c?.width, h: c?.height, webgl2: !!c?.getContext('webgl2') };
});
check('WebGL2 画布就绪', gl.hasCanvas && gl.webgl2 && gl.w > 0, JSON.stringify(gl));

const stats0 = await page.evaluate(() => {
  const r = window.__renderer;
  return { meshes: Object.keys(r?.meshes || {}), cube: r?.meshes.cube?.count, cyl: r?.meshes.cyl?.count, markers: r?.markers?.length };
});
check('实例缓冲已上传（万级）', stats0.cube + stats0.cyl > 18000, JSON.stringify(stats0));
check('批注标记已挂载', stats0.markers === 3, JSON.stringify(stats0));

// HUD 渲染统计
const hud = await page.$$eval('.hud .item b', (els) => els.map((e) => e.textContent));
check('HUD 有 FPS/实例/Cell/LOD 数据', hud.length === 4 && +hud[1] > 18000, JSON.stringify(hud));
check('可见 Cell 数小于总 Cell（视口外已裁剪）', +hud[2] < 120 && +hud[2] > 0, `visible=${hud[2]}`);

// 截图：全景
await page.screenshot({ path: 'scripts/shots/01-overview.png' });

// ---------- 2. 拾取 / 悬停 ----------
console.log('\n[2/5] 拾取与信息卡');
const box = await page.evaluate(() => {
  const c = document.querySelector('.viewport-wrap canvas');
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.5);
await sleep(400);
let card = await page.evaluate(() => {
  const c = document.querySelector('.info-card');
  return c ? c.innerText.replace(/\n/g, ' | ') : null;
});
// 未命中则在视口中心区域做网格扫描，直到命中管线
if (!card) {
  const offsets = [];
  for (const dx of [-160, -100, -40, 40, 100, 160])
    for (const dy of [-110, -55, 0, 55, 110]) offsets.push([dx, dy]);
  for (const [dx, dy] of offsets) {
    await page.mouse.click(box.x + box.w * 0.5 + dx, box.y + box.h * 0.5 + dy);
    await sleep(180);
    card = await page.evaluate(() => document.querySelector('.info-card')?.innerText.replace(/\n/g, ' | ') || null);
    if (card) break;
  }
}
check('点选后出现信息卡并带标高/舱室', !!card && /标高/.test(card) && /舱室/.test(card), card || '无信息卡');
await page.screenshot({ path: 'scripts/shots/02-picked.png' });

// ---------- 3. LOD 缩放切换 ----------
console.log('\n[3/5] LOD 分级');
const lodBefore = await page.evaluate(() => window.__ui.lodLevel());
await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
for (let i = 0; i < 24; i++) await page.mouse.wheel({ deltaY: -120 });
await sleep(600);
const lodAfter = await page.evaluate(() => window.__ui.lodLevel());
check('滚轮放大后 LOD 提升（细节增多）', lodAfter > lodBefore, `${lodBefore} -> ${lodAfter}`);
await page.screenshot({ path: 'scripts/shots/03-near-lod2.png' });
for (let i = 0; i < 30; i++) await page.mouse.wheel({ deltaY: 120 });
await sleep(400);
const lodFar = await page.evaluate(() => window.__ui.lodLevel());
check('滚轮拉远后回到 LOD0（仅主廊+干管）', lodFar === 0, `lod=${lodFar}`);

// ---------- 4. 图层开关 + 剖切 ----------
console.log('\n[4/5] 图层掩码与剖切');
const maskBefore = await page.evaluate(() => window.__ui.layerMask());
const cb = await page.$$('.tree-node input[type=checkbox]');
await cb[0].click(); // 关掉第一个专业（给水）
await sleep(300);
const maskAfter = await page.evaluate(() => ({
  mask: window.__ui.layerMask(),
  rendererMask: window.__renderer.layerMask,
}));
check('图层开关写入掩码且同步渲染器', maskAfter.mask < maskBefore && maskAfter.rendererMask === maskAfter.mask,
  `${maskBefore} -> ${maskAfter.mask}`);
await cb[0].click(); // 还原
await sleep(200);

// 剖切
await page.evaluate(() => {
  const input = document.querySelector('.slice-bar input[type=range]');
  input.value = 500; input.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(300);
const slice = await page.evaluate(() => ({ sig: window.__ui.sliceX(), gl: window.__renderer.sliceX }));
check('剖切位置同步到渲染器', slice.sig === 500 && slice.gl === 500, JSON.stringify(slice));
await page.screenshot({ path: 'scripts/shots/04-sliced.png' });
await page.evaluate(() => window.__ui.setSliceX(null));
await sleep(200);

// ---------- 5. 批注打点 + 回复 ----------
console.log('\n[5/5] 批注流程 / 版本 / 比对');
const annBefore = await page.evaluate(() => window.__ui.currentAnnotations().length);
await page.click('.toolbar-top button');
await sleep(200);
await page.mouse.click(box.x + box.w * 0.55, box.y + box.h * 0.45);
await sleep(300);
const modalOpen = await page.evaluate(() => !!document.querySelector('.modal textarea'));
check('批注模式下点击弹出打点对话框', modalOpen);
if (modalOpen) {
  await page.type('.modal textarea', 'E2E 测试批注：此处请复核管线净距');
  await page.click('.modal button.primary');
  await sleep(300);
}
const annAfter = await page.evaluate(() => window.__ui.currentAnnotations().length);
check('批注已新增', annAfter === annBefore + 1, `${annBefore} -> ${annAfter}`);

// 版本提交
await page.goto(`${BASE}/#/versions`, { waitUntil: 'load' });
await sleep(800);
const vBefore = await page.$$eval('.card', (els) => els.length);
await page.click('button.primary');
await sleep(300);
await page.type('.modal textarea', 'E2E 自动提交版本');
await page.click('.modal button.primary');
await sleep(1200);
const hashAfterSubmit = await page.evaluate(() => location.hash);
await page.goto(`${BASE}/#/versions`, { waitUntil: 'load' });
await sleep(600);
const vAfter = await page.$$eval('.card', (els) => els.length);
check('提交后跳回审图台且版本数 +1', hashAfterSubmit === '#/review' && vAfter === vBefore + 1,
  `before=${vBefore} after=${vAfter} hash=${hashAfterSubmit}`);
await page.screenshot({ path: 'scripts/shots/05-versions.png' });

// 批注管理页
await page.goto(`${BASE}/#/annotations`, { waitUntil: 'load' });
await sleep(600);
const threads = await page.$$('.thread');
check('批注管理页列出线程', threads.length >= 4);
const firstInput = await page.$('.thread .reply-form input');
check('待处理批注可回复', !!firstInput);
if (firstInput) {
  await firstInput.type('E2E 回复：已按意见调整');
  await page.keyboard.press('Enter');
  await sleep(300);
}
const repliedTag = await page.$$eval('.tag.replied', (els) => els.length);
check('回复后状态变为已回复', repliedTag >= 1);
await page.screenshot({ path: 'scripts/shots/06-annotations.png' });

// 比对页
await page.goto(`${BASE}/#/compare`, { waitUntil: 'load' });
await sleep(2500);
const cmp = await page.evaluate(() => {
  const canvases = document.querySelectorAll('.compare-view canvas');
  const tiles = [...document.querySelectorAll('.stat-tile b')].map((e) => e.textContent);
  const rows = document.querySelectorAll('.diff-row:not(.head)').length;
  return { canvases: canvases.length, tiles, rows,
    ra: !!window.__renderer, errs: 0 };
});
check('比对页双视口 + 差异统计 + 明细行', cmp.canvases === 2 && cmp.tiles.length === 4 && cmp.rows > 0, JSON.stringify(cmp));
await page.screenshot({ path: 'scripts/shots/07-compare.png' });

const finalErrors = pageErrors.filter((e) => !benign(e));
check('全程无未捕获错误', finalErrors.length === 0, JSON.stringify(finalErrors.slice(0, 5)));

await browser.close();
console.log(`\n${failures === 0 ? '🎉 全部 E2E 检查通过' : `⚠️ ${failures} 项失败`}`);
process.exit(failures ? 1 : 0);
