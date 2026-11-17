/**
 * reactive-flow.mjs — 验证核心响应链：
 *  A. 拖拽控制点 → 轮廓体积自动重算（profile-editor → store → 指标）
 *  B. 曲率超阈值 → 标红计数与提交按钮禁用联动
 *  C. 展开基准半径调整 → 展开宽度自动重算（Worker OffscreenCanvas）
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const PORT = 8794;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/favicon')) { res.writeHead(204); return res.end(); }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(await readFile(join(ROOT, p)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(PORT, r));

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9261', '--disable-gpu', '--no-first-run',
  '--window-size=1280,900', '--user-data-dir=' + join(ROOT, '.chrome-flow2'), 'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 40; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:9261/json/list')).json();
    if (list.some(t => t.type === 'page')) break;
  } catch { /* 等待 */ }
  await sleep(250);
}
const list = await (await fetch('http://127.0.0.1:9261/json/list')).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown')
    errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise(res => {
  const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params }));
});
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.result.value;

let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log('PASS', n, x)) : (fail++, console.log('FAIL', n, x)); };

// 通过编辑器坐标变换，把某个控制点的屏幕坐标算出来并派发拖拽
const dragHandle = async (handleIndex, dxPx, dyPx) => ev(`(async () => {
  const ed = window.__workbench.editor;
  const c = document.getElementById('profile-canvas');
  const rect = c.getBoundingClientRect();
  const cp = ed.getState().controlPoints[${handleIndex}];
  const s0 = ed.toScreen(cp.r, cp.y);
  const fire = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {
    bubbles: true, clientX: rect.left + x, clientY: rect.top + y,
    button: 0, pointerId: 1, isPrimary: true }));
  fire('pointerdown', s0.x, s0.y);
  for (let k = 1; k <= 8; k++) fire('pointermove', s0.x + ${dxPx} * k / 8, s0.y + ${dyPx} * k / 8);
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  await new Promise(r => setTimeout(r, 250));
  const cp2 = ed.getState().controlPoints[${handleIndex}];
  return JSON.stringify({ r0: cp.r.toFixed(2), r1: cp2.r.toFixed(2), y0: cp.y.toFixed(2), y1: cp2.y.toFixed(2) });
})()`);

// 可见阶段容器作用域，避免 hidden 阶段的指标卡干扰
const visibleStage = () =>
  ev(`document.querySelector('.card-bd > div:not([hidden])') ? 'ok' : 'none'`);
const visibleGrid = () =>
  `[...document.querySelectorAll('.metrics-grid')].find(g => !g.closest('div[hidden]'))`;
const metricVal = async idx =>
  ev(`parseFloat(${visibleGrid()}.querySelectorAll('.metric')[${idx}].querySelector('.v').textContent)`);

try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1600);

  const vol0 = await metricVal(0);
  console.log('初始体积:', vol0);

  // A. 拖拽瓶身直壁控制点（索引 4）水平放大半径
  const drag = JSON.parse(await dragHandle(4, 60, 0));
  console.log('控制点 4 拖拽:', drag);
  check('拖拽确实移动了控制点半径', drag.r0 !== drag.r1, `r: ${drag.r0}→${drag.r1}`);
  const vol1 = await metricVal(0);
  check('体积随拖拽自动重算且增大', vol1 > vol0, `体积 ${vol0}→${vol1}`);

  // B. 曲率阈值联动：先放宽到 0.2（消除超限），再收紧到 0.001（制造超限）
  const setThreshold = async val => ev(`(async () => {
    const inp = [...document.querySelectorAll('input[type=number]')].find(i=>!i.closest('div[hidden]'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '${val}'); inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
  })()`);
  const overCount = async () => ev(`parseInt(${visibleGrid()}.querySelectorAll('.metric')[3].querySelector('.v').textContent)`);
  const submitDisabled = async () => ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('提交质检'));
    return b ? b.disabled : 'no-btn';
  })()`);

  await setThreshold(0.2);
  // 以当前峰值曲率为基准：阈值取峰值的 2 倍必无超限，取 1/10 必有超限
  const peak = await ev(`parseFloat(${visibleGrid()}.querySelectorAll('.metric')[2].querySelector('.v').textContent)`);
  const highThreshold = (peak * 2).toFixed(4);
  const lowThreshold = (peak * 0.1).toFixed(4);
  await setThreshold(highThreshold);
  check('阈值高于峰值后无超限点', await overCount() === 0, `阈值=${highThreshold} 峰值=${peak} 超限=${await overCount()}`);
  check('无超限时提交按钮可用', await submitDisabled() === false);
  await setThreshold(lowThreshold);
  check('阈值远低于峰值后出现超限点', await overCount() > 0, `阈值=${lowThreshold} 超限=${await overCount()}`);
  check('超限时提交按钮禁用', await submitDisabled() === true);

  // C. 切到展开页，改基准半径 → 展开宽度重算
  await ev(`[...document.querySelectorAll('.stage-tab')].find(b=>b.textContent.includes('标签展开'))?.click()`);
  await sleep(400);
  await ev(`window.__workbench?.remeasure()`);
  await sleep(700);
  const unwrapWidth = async () =>
    ev(`parseFloat(${visibleGrid()}.querySelectorAll('.metric')[0].querySelector('.v').textContent)`);
  const w0 = await unwrapWidth();
  await ev(`(async () => {
    // 找到展开阶段可见的「基准模式」select 并切到 fixed
    const refSel = [...document.querySelectorAll('select')]
      .find(s => !s.closest('div[hidden]') && [...s.options].some(o => o.textContent.includes('手动')));
    window.__diag1 = { selFound: !!refSel, selVal: refSel?.value };
    refSel.value = 'fixed'; refSel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    // fixed 后固定 r₀ 输入框才会渲染；它是可见区里默认值为 35 的 number 输入
    const r0 = [...document.querySelectorAll('input[type=number]')]
      .find(i => !i.closest('div[hidden]') && parseFloat(i.value) === 35);
    window.__diag1.r0Found = !!r0;
    if (r0) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(r0, '55'); r0.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 200));
  })()`);
  // worker 离屏重算为异步，轮询等待展开宽度更新（2π×55≈345.6）
  let w1 = w0;
  for (let k = 0; k < 20; k++) {
    await sleep(150);
    w1 = await unwrapWidth();
    if (Math.abs(w1 - w0) > 1) break;
  }
  check('基准半径改变后展开宽度自动重算', Math.abs(w1 - w0) > 1, `${w0}→${w1} mm`);
  check('展开宽度≈2π×55', Math.abs(w1 - 2 * Math.PI * 55) < 1, `got ${w1}`);
  check('Worker 离屏渲染模式', await ev(`window.__workbench?.unwrapMode`) === 'worker-offscreen');

  check('全程无未捕获异常', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  fail++; console.log('FAIL 中断:', e.message);
} finally {
  chrome.kill(); server.close(); ws.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
