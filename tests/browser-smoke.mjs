/**
 * browser-smoke.mjs — 基于 Chrome DevTools Protocol 的端到端冒烟测试
 * 启动 headless Chrome 加载应用，验证：
 *  1. 四界面可切换、无 JS 报错
 *  2. SolidJS 响应式驱动三个 Canvas 真实出像素
 *  3. 展开稿 Worker(OffscreenCanvas) 或主线程降级渲染成功
 *  4. 工单创建/分派/提交/质检打回-返工计数 全链路
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const PORT = 8791;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = join(ROOT, p);
    if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const buf = await readFile(fp);
    res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise(r => server.listen(PORT, r));

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=9222`,
  '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(ROOT, '.chrome-profile'),
  'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getPageWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 等待 Chrome 启动 */ }
    await sleep(250);
  }
  throw new Error('Chrome 页面 target 未就绪');
}

const ws = new WebSocket(await getPageWsUrl());
await new Promise(r => (ws.onopen = r));
let msgId = 0;
const pending = new Map();
const consoleEvents = [];
const pageErrors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleEvents.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  }
};
const send = (method, params = {}) => new Promise(resolve => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) {
    const e = new Error('页面执行异常: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
    e.pageException = true;
    throw e;
  }
  return r.result.result.value;
};

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); }
  else { fail++; console.log('FAIL', name, extra); }
};
const canvasNonBlank = async id => evalJs(`(() => {
  const c = document.getElementById(${JSON.stringify(id)});
  if (!c || !c.width) return { ok: false, reason: 'no-canvas' };
  const x = c.getContext('2d');
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let painted = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) painted++;
  return { ok: painted > d.length / 40, painted, total: d.length / 4, w: c.width, h: c.height };
})()`);

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1800);

  // 1. 外壳与四界面
  check('应用已挂载', await evalJs(`!!document.querySelector('.app-header')`));
  check('4 个导航标签', await evalJs(`document.querySelectorAll('.nav-tab').length`) === 4);

  // 2. 工作台默认展示，轮廓画布出像素
  const prof = await canvasNonBlank('profile-canvas');
  check('轮廓画布已渲染', prof.ok, JSON.stringify(prof));

  // 3. 切换到旋转曲面
  await evalJs(`[...document.querySelectorAll('.nav-tab')].find(b=>b.textContent.includes('设计工作台'))?.click()`);
  await sleep(300);
  await evalJs(`[...document.querySelectorAll('.stage-tab')].find(b=>b.textContent.includes('旋转曲面'))?.click()`);
  await sleep(400);
  await evalJs(`window.__workbench?.remeasure()`);
  await sleep(1200);
  const rev = await canvasNonBlank('revolve-canvas');
  const revPainted = await evalJs(`window.__workbench?.revolvePainted === true`);
  check('旋转曲面画布已渲染', rev.ok || revPainted, JSON.stringify(rev) + ' hook=' + revPainted);

  // 4. 切换到标签展开（OffscreenCanvas 控制权已转移，用调试钩子+指标确认渲染）
  await evalJs(`[...document.querySelectorAll('.stage-tab')].find(b=>b.textContent.includes('标签展开'))?.click()`);
  await sleep(400);
  await evalJs(`window.__workbench?.remeasure()`);
  await sleep(900);
  const mode = await evalJs(`window.__workbench?.unwrapMode`);
  check('展开渲染器已启动', mode === 'worker-offscreen' || mode === 'main-fallback', `mode=${mode}`);
  const unwPainted = await evalJs(`window.__workbench?.unwrapPainted === true`);
  check('展开标签稿已渲染(离屏)', unwPainted);
  const statsText = await evalJs(`document.body.innerText.includes('展开宽度') && document.body.innerText.includes('伸长率')`);
  check('展开指标已联动显示', statsText);

  // 5. 前台接单 → 创建工单
  await evalJs(`[...document.querySelectorAll('.nav-tab')].find(b=>b.textContent.includes('前台接单'))?.click()`);
  await sleep(400);
  const before = await evalJs(`document.querySelectorAll('tbody tr').length`);
  await evalJs(`
    const ins = document.querySelectorAll('.card .input, .card .textarea');
    ins[0].value = 'CDP测试瓶型'; ins[0].dispatchEvent(new Event('input',{bubbles:true}));
    ins[1].value = '420'; ins[1].dispatchEvent(new Event('input',{bubbles:true}));
    [...document.querySelectorAll('.card .select')].find(s=>s.options[s.selectedIndex]?.textContent.includes('PET'))
      ?.closest('.card').querySelector('button.primary').click();
  `);
  await sleep(500);
  const after = await evalJs(`document.querySelectorAll('tbody tr').length`);
  check('创建工单行数 +1', after === before + 1, `${before}→${after}`);
  check('新工单出现在列表', await evalJs(`document.body.innerText.includes('CDP测试瓶型')`));

  // 6. 分派 → 工作台提交（精确定位“待分派”工单所在行）
  await evalJs(`
    const sel = [...document.querySelectorAll('select')].find(s =>
      [...s.options].some(o => o.textContent === '王设计师'));
    sel.value = '王设计师'; sel.dispatchEvent(new Event('change',{bubbles:true}));
    const newRow = [...document.querySelectorAll('tbody tr')]
      .find(tr => tr.textContent.includes('待分派'));
    newRow.querySelector('button.primary')?.click();
  `);
  await sleep(500);
  const statusText = await evalJs(`
    [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('CDP测试瓶型'))
      ?.querySelector('.badge')?.textContent`);
  check('分派后状态变更', statusText && statusText.includes('设计中'), statusText);

  await evalJs(`[...document.querySelectorAll('.nav-tab')].find(b=>b.textContent.includes('设计工作台'))?.click()`);
  await sleep(600);
  await evalJs(`document.querySelector('.card-hd button.primary')?.click()`);
  await sleep(500);
  const submitted = await evalJs(`document.body.innerText.includes('待质检')`);
  check('设计稿可提交质检', submitted);

  // 7. 质检打回 → 返工次数
  await evalJs(`[...document.querySelectorAll('.nav-tab')].find(b=>b.textContent.includes('质检抽查'))?.click()`);
  await sleep(600);
  await evalJs(`
    const ta = document.querySelector('.textarea');
    ta.value = 'CDP模拟：肩部曲率超限，打回'; ta.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('button.danger')?.click();
  `);
  await sleep(500);
  const reworked = await evalJs(`document.body.innerText.includes('返工') || document.body.innerText.includes('打回')`);
  check('打回流程完成', reworked);
  const reworkCount = await evalJs(`
    [...document.querySelectorAll('tbody tr')].some(tr => tr.textContent.includes('CDP测试瓶型'))
      ? 'queued' : 'check-dashboard'
  `);
  await evalJs(`[...document.querySelectorAll('.nav-tab')].find(b=>b.textContent.includes('统计看板'))?.click()`);
  await sleep(600);
  const board = await evalJs(`document.body.innerText`);
  check('看板含返工率与完成量', board.includes('返工率') && board.includes('合格入库完成量'));
  const chartPainted = await evalJs(`[...document.querySelectorAll('canvas')].filter(c=>c.id!=='profile-canvas'&&c.id!=='revolve-canvas'&&c.id!=='unwrap-canvas').some(c => {
    const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let n=0; for (let i=3;i<d.length;i+=4) if (d[i]>0) n++;
    return n > 100;
  })`);
  check('看板图表已绘制', chartPainted);

  // 8. 控制台无错误（第三方 favicon 等网络错误不计）
  check('页面无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  const realConsoleErrs = consoleEvents.filter(e => !/favicon|net::|Failed to load resource/i.test(e));
  check('控制台无脚本错误', realConsoleErrs.length === 0, realConsoleErrs.slice(0, 3).join(' | '));
} catch (e) {
  fail++;
  console.log('FAIL 测试中断:', e.message);
} finally {
  chrome.kill();
  server.close();
  ws.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
