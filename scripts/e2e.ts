import { chromium } from 'playwright-core';

const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-win64/chrome-headless-shell.exe';
const URL = 'http://127.0.0.1:4173/';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const results: string[] = [];
const check = (cond: boolean, msg: string) => {
  const line = `${cond ? 'PASS' : 'FAIL'}: ${msg}`;
  results.push(line);
  console.log(line);
  if (!cond) process.exitCode = 1;
};

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors: string[] = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await sleep(2500);

// 1. 基础渲染
const canvasInfo = await page.evaluate(() => {
  const c = document.querySelector('.map-canvas') as HTMLCanvasElement;
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  return { w: c.clientWidth, h: c.clientHeight, hasGL: !!gl };
});
check(canvasInfo.hasGL && canvasInfo.w > 1000, `WebGL canvas 渲染 ${canvasInfo.w}x${canvasInfo.h}`);
await page.screenshot({ path: 'scripts/shots/01-building-level.png' });

// 2. 初始楼栋级聚合
const badgeText = await page.locator('.zoom-badge').textContent();
check(badgeText!.includes('楼栋级'), `初始为楼栋级聚合视图：${badgeText}`);
const clusterCount = await page.evaluate(
  () => [...document.querySelectorAll('.map-overlay > div')].filter(d => (d as HTMLElement).style.display !== 'none').length
);
check(clusterCount > 10, `聚合块数量标签渲染 ${clusterCount} 个`);

// 3. 放大到房间级
await page.mouse.move(800, 470);
for (let i = 0; i < 14; i++) {
  await page.mouse.wheel(0, -300);
  await sleep(60);
}
await sleep(800);
const badge2 = await page.locator('.zoom-badge').textContent();
check(badge2!.includes('房间级'), `放大后进入房间级：${badge2}`);
await page.screenshot({ path: 'scripts/shots/02-room-level.png' });

// 4. 点选设施 -> 信息卡
const canvas = page.locator('.map-canvas');
const box = await canvas.boundingBox();
await page.waitForFunction(
  () => [...document.querySelectorAll('.map-overlay > div')].some(d => (d as HTMLElement).style.display !== 'none'),
  null, { timeout: 8000 }
);
const firstLabel = page.locator('.map-overlay > div:visible').first();
const labelBox = await firstLabel.boundingBox();
check(!!labelBox, '存在可见编号标签');
await page.mouse.click(labelBox!.x + labelBox!.width / 2, labelBox!.y + labelBox!.height + 24);
await sleep(500);
check((await page.locator('.info-card').count()) === 1, '点选弹出设施信息卡');
const codeInCard = await page.locator('.info-card h3').textContent();
check(/气瓶柜|通风橱|洗眼器|管线/.test(codeInCard!), `信息卡显示设施类型与编号：${codeInCard}`);
await page.screenshot({ path: 'scripts/shots/03-info-card.png' });

// 5. 图层开关
await page.locator('.layer-row', { hasText: '气防' }).locator('input').uncheck();
await sleep(500);
check((await page.locator('.zoom-badge').count()) === 1, '关闭图层后视口正常无崩溃');
await page.screenshot({ path: 'scripts/shots/04-layer-off.png' });
await page.locator('.layer-row', { hasText: '气防' }).locator('input').check();
await sleep(300);

// 6. 楼层切换
await page.locator('.floor-grid button', { hasText: '5F' }).click();
await sleep(500);
check((await page.locator('.zoom-badge').textContent())!.startsWith('5F'), '切换到 5F');

// 7. 搜索定位
await page.locator('.search-box input').fill('F5-GC-0001');
await page.locator('.search-box button').click();
await sleep(1200);
const searchMsg = await page.locator('.panel-section .hint', { hasText: '定位到' }).first().textContent().catch(() => '');
check(!!searchMsg && searchMsg.includes('定位到'), `搜索定位：${searchMsg}`);
await page.screenshot({ path: 'scripts/shots/05-search-locate.png' });

// 8. 框选统计（大拖选覆盖画布）
await page.locator('button', { hasText: '框选统计' }).click();
await sleep(200);
await page.mouse.move(box!.x + 80, box!.y + 80);
await page.mouse.down();
await page.mouse.move(box!.x + box!.width - 80, box!.y + box!.height - 80, { steps: 8 });
await page.mouse.up();
await sleep(600);
const boxStat = await page.locator('.box-stat .num').textContent();
check(!!boxStat && parseInt(boxStat!) > 0, `框选统计到设施：${boxStat}`);
await page.screenshot({ path: 'scripts/shots/06-box-select.png' });

// 9. 老师出题
page.once('dialog', d => d.accept());
await page.locator('button.primary', { hasText: '生成试卷' }).click();
await sleep(500);
check((await page.locator('.right-panel select option').count()) >= 2, '试卷生成并出现在复核下拉中');

// 10. 学员作答
await page.locator('.role-switch button', { hasText: '学员端' }).click();
await sleep(300);
await page.locator('.right-panel button.primary', { hasText: '开始识图作答' }).first().click();
await sleep(1000);
check((await page.locator('.quiz-bar').count()) === 1, '学员进入识图考核浮条');
const quizFloor = await page.locator('.zoom-badge').textContent();
check(quizFloor!.startsWith('1F'), `题目自动切到对应楼层：${quizFloor}`);
const qLabels = page.locator('.map-overlay > div:visible');
let n = await qLabels.count();
check(n >= 1, `视口内可见标签 ${n} 个`);
let picked = 0;
for (let attempt = 0; attempt < 12 && picked < 3; attempt++) {
  n = await qLabels.count();
  const idx = picked % Math.max(1, n);
  const lb = await qLabels.nth(idx).boundingBox();
  if (lb) {
    await page.mouse.click(lb.x + lb.width / 2, lb.y + lb.height + 24);
    await sleep(200);
  }
  const t = await page.locator('.quiz-bar').textContent();
  const m = t?.match(/已选 (\d+)/);
  picked = m ? +m[1] : picked;
  if (picked < 3) {
    // 平移视口露出更多设施后再点
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 - 180, box!.y + box!.height / 2, { steps: 4 });
    await page.mouse.up();
    await sleep(400);
  }
}
const pickedText = await page.locator('.quiz-bar').textContent();
check(/已选 3/.test(pickedText!), `点选计入答案：${pickedText?.match(/已选 \d+/)?.[0]}`);
await page.screenshot({ path: 'scripts/shots/07-quiz-answering.png' });
await page.locator('.quiz-bar button.primary', { hasText: '提交本题' }).click();
await sleep(500);
const persisted = await page.evaluate(() => {
  const ps = JSON.parse(localStorage.getItem('lsmp-papers-v1') || '[]');
  const p = ps[0];
  return p ? { classes: Object.keys(p.submissions), detail: JSON.stringify(p.submissions).slice(0, 300) } : { none: true };
});
check(!!persisted && !('none' in persisted), `作答已持久化：${JSON.stringify(persisted).slice(0, 120)}`);

// 第二题同样作答并提交，然后退出考核
const barText2 = await page.locator('.quiz-bar').textContent();
if (barText2?.includes('第 2/2 题')) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const lbs = page.locator('.map-overlay > div:visible');
    const cnt = await lbs.count();
    if (cnt > 0) {
      const lb = await lbs.first().boundingBox();
      if (lb) await page.mouse.click(lb.x + lb.width / 2, lb.y + lb.height + 24);
      await sleep(150);
    }
    const t = await page.locator('.quiz-bar').textContent();
    if (/已选 5/.test(t ?? '')) break;
  }
  await page.locator('.quiz-bar button.primary', { hasText: '提交本题' }).click();
  await sleep(400);
}
await page.locator('.quiz-bar button', { hasText: '退出考核' }).click();
await sleep(300);
check((await page.locator('.quiz-bar').count()) === 0, '退出考核后浮条消失');

// 11. 老师复核与班级汇总
await page.locator('.role-switch button', { hasText: '老师端' }).click();
await sleep(300);
await page.locator('[data-testid="review-paper"]').selectOption({ index: 1 });
await sleep(500);
const summaryRows = page.locator('.right-panel table tbody tr');
await summaryRows.first().waitFor({ timeout: 8000 });
check((await summaryRows.count()) >= 1, `班级成绩汇总出现 ${await summaryRows.count()} 行`);
const autoScore = await summaryRows.first().locator('td').nth(1).textContent();
check(/\d+\/\d+/.test(autoScore!), `系统自动判分：${autoScore}`);

// 老师逐题复核打分（两题全部复核后汇总表出现终评总分）
await summaryRows.first().click();
await sleep(400);
const reviewCards = page.locator('.right-panel .card .card');
await reviewCards.first().waitFor({ timeout: 8000 });
const cardCount = await reviewCards.count();
for (let i = 0; i < cardCount; i++) {
  const card = reviewCards.nth(i);
  await card.locator('input[type="number"]').fill('2');
  await card.locator('button.primary', { hasText: '保存复核' }).click();
  await sleep(300);
}
const statusPill = await page.locator('.right-panel table tbody tr td').nth(4).textContent();
const finalScore = await page.locator('.right-panel table tbody tr td').nth(2).textContent();
check(statusPill?.includes('已复核') && /\d+\/8/.test(finalScore ?? ''),
  `复核完成：状态=${statusPill}，终评=${finalScore}`);
await page.screenshot({ path: 'scripts/shots/08-teacher-review.png' });

// 12. 控制台无错误
check(errors.length === 0, `浏览器控制台无错误（${errors.length} 条）${errors[0] ? '：' + errors[0].slice(0, 160) : ''}`);

console.log(results.join('\n'));
await browser.close();
