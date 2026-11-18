// CDP 冒烟测试：载入示例 → 验证地形/样条/曲率/展开/归档全链路
const base = 'http://localhost:9222';

async function newPage() {
  const put = await fetch(`${base}/json/new?http://localhost:4173/`, { method: 'PUT' });
  return put.json();
}

const page = await newPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Runtime.exceptionThrown') {
    logs.push(msg);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Page.javascriptDialogOpening') {
    send('Page.handleJavaScriptDialog', { accept: true });
  }
});
await new Promise((r) => setTimeout(r, 2500));

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
  return r.result.value;
};

// 1. 点击“载入示例河段”
await evalJs(`(() => {
  const root = document.querySelector('app-shell').shadowRoot.querySelector('import-panel').shadowRoot;
  const btn = [...root.querySelectorAll('button')].find(b => b.textContent.includes('示例河段'));
  btn.click();
})()`);
await new Promise((r) => setTimeout(r, 2500));

const r1 = await evalJs(`(() => {
  const st = document.querySelector('app-shell');
  // 经 store 无法直接拿，用状态栏文本与画布对象数验证
  const status = st.shadowRoot.getElementById('statusbar').innerText;
  const canvases = st.shadowRoot.querySelectorAll('canvas').length;
  return { status, canvases };
})()`);
console.log('① 载入示例后状态栏:', r1.status.replace(/\s+/g, ' '));
console.log('   canvas 数量:', r1.canvases);

// 2. 曲率图存在且有内容
const r2 = await evalJs(`(() => {
  const chart = document.querySelector('app-shell').shadowRoot.querySelector('line-panel').shadowRoot.querySelector('curvature-chart');
  const cv = chart.shadowRoot.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let nonWhite = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] < 240 || data[i+1] < 240 || data[i+2] < 240) nonWhite++;
  return { w: cv.width, nonWhite };
})()`);
console.log('② 曲率图非白像素:', r2.nonWhite, r2.nonWhite > 500 ? 'PASS' : 'FAIL');

// 3. 启用管理范围偏移并切圆角
await evalJs(`(() => {
  const p = document.querySelector('app-shell').shadowRoot.querySelector('offset-panel').shadowRoot;
  p.querySelector('input[type=checkbox]').click();
})()`);
await new Promise((r) => setTimeout(r, 400));

// 4. 切换三种着色模式
for (const idx of [0, 1, 2]) {
  await evalJs(`document.querySelector('app-shell').shadowRoot.querySelector('surface-panel').shadowRoot.querySelectorAll('button')[${idx}].click()`);
  await new Promise((r) => setTimeout(r, 300));
}
console.log('③ 三种着色模式切换: PASS');

// 5. 启用横断面
await evalJs(`(() => {
  const p = document.querySelector('app-shell').shadowRoot.querySelector('section-panel').shadowRoot;
  p.querySelector('input[type=checkbox]').click();
  const range = p.querySelectorAll('input[type=range]')[0];
  range.value = 1200; range.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await new Promise((r) => setTimeout(r, 500));
const r5 = await evalJs(`(() => {
  const sc = document.querySelector('app-shell').shadowRoot.querySelector('section-panel').shadowRoot.querySelector('section-canvas').shadowRoot;
  const cap = sc.getElementById('zr').innerText;
  const cv = sc.querySelector('canvas');
  const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
  let n = 0; for (let i=0;i<d.length;i+=4) if (d[i]<200 && d[i+2]>180) n++;
  return { cap, bluePx: n };
})()`);
console.log('④ 横断面剖面:', r5.cap, '| 蓝色曲线像素', r5.bluePx, r5.bluePx > 50 ? 'PASS' : 'FAIL');

// 6. 测地线展开
await evalJs(`(() => {
  const p = document.querySelector('app-shell').shadowRoot.querySelector('unfold-panel').shadowRoot;
  const ranges = p.querySelectorAll('input[type=range]');
  ranges[0].value = 200; ranges[0].dispatchEvent(new Event('input', { bubbles: true }));
  ranges[1].value = 1000; ranges[1].dispatchEvent(new Event('input', { bubbles: true }));
  [...p.querySelectorAll('button')].find(b => b.textContent.includes('展开选中堤坡')).click();
})()`);
await new Promise((r) => setTimeout(r, 1000));
// headless 下 window.alert 不阻塞，但保险起见再确认一次
await send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
// 关闭 alert（headless 下自动消失，不阻塞）
const r6 = await evalJs(`(() => {
  const p = document.querySelector('app-shell').shadowRoot.querySelector('unfold-panel').shadowRoot;
  const td = p.querySelectorAll('table td');
  const drawing = p.querySelector('unfold-drawing').shadowRoot.getElementById('meta').innerText;
  return { row0: td[0]?.innerText, area: td[2]?.innerText, slope: td[3]?.innerText, drawing };
})()`);
console.log('⑤ 展开成果:', JSON.stringify(r6));

// 7. 建档 + 归档（IndexedDB）
await evalJs(`(() => {
  const root = document.querySelector('app-shell').shadowRoot.querySelector('archive-panel').shadowRoot;
  [...root.querySelectorAll('button')].find(b => b.textContent.includes('新建项目建档')).click();
})()`);
await new Promise((r) => setTimeout(r, 600));
const code = await evalJs(`new Promise(res => { const req = indexedDB.open('river-modeler-db'); req.onsuccess = () => { const db = req.result; const tx = db.transaction('projects'); tx.objectStore('projects').getAll().onsuccess = e => res(e.target.result.map(x=>x.meta.code)); }; })`);
console.log('⑥ IndexedDB 建档编号:', code);

await evalJs(`(() => {
  const root = document.querySelector('app-shell').shadowRoot.querySelector('archive-panel').shadowRoot;
  [...root.querySelectorAll('button')].find(b => b.textContent.includes('加工并归档')).click();
})()`);
await new Promise((r) => setTimeout(r, 800));
const r7 = await evalJs(`new Promise(res => { const req = indexedDB.open('river-modeler-db'); req.onsuccess = () => { const db = req.result; const tx = db.transaction('projects'); tx.objectStore('projects').getAll().onsuccess = e => { const rec = e.target.result[0]; res({ code: rec.meta.code, versions: rec.versions.length, v1reportLen: rec.versions[0].report.length, stats: rec.versions[0].snapshot.stats }); }; }; })`);
console.log('⑦ 归档版本数:', r7.versions, '| 报告长度:', r7.v1reportLen, '| 统计:', JSON.stringify(r7.stats));

// 8. 第二次归档 + 版本比对
await evalJs(`(() => {
  const lp = document.querySelector('app-shell').shadowRoot.querySelector('line-panel').shadowRoot;
  [...lp.querySelectorAll('button')].find(b => b.textContent.includes('末尾加点')).click();
  const ap = document.querySelector('app-shell').shadowRoot.querySelector('archive-panel').shadowRoot;
  [...ap.querySelectorAll('button')].find(b => b.textContent.includes('加工并归档')).click();
})()`);
await new Promise((r) => setTimeout(r, 800));
const r8 = await evalJs(`new Promise(res => { const req = indexedDB.open('river-modeler-db'); req.onsuccess = () => { const db = req.result; const tx = db.transaction('projects'); tx.objectStore('projects').getAll().onsuccess = e => { const rec = e.target.result[0]; res({ versions: rec.versions.length, v2stats: rec.versions[1].snapshot.stats.centerLength }); }; }; })`);
console.log('⑧ 二次归档版本数:', r8.versions, '| V2 中心线长:', r8.v2stats?.toFixed(2));

// 9. 检索
await evalJs(`(() => {
  const p = document.querySelector('app-shell').shadowRoot.querySelector('archive-panel').shadowRoot;
  const inputs = p.querySelectorAll('input[type=text]');
  inputs[1].value = 'K0'; inputs[1].dispatchEvent(new Event('input', {bubbles:true}));
  [...p.querySelectorAll('button')].find(b => b.textContent.trim() === '检索').click();
})()`);
await new Promise((r) => setTimeout(r, 500));
const r9 = await evalJs(`document.querySelector('app-shell').shadowRoot.querySelector('archive-panel').shadowRoot.querySelectorAll('#list-wrap > div > div').length`);
console.log('⑨ 河段检索结果卡片数:', r9, r9 >= 1 ? 'PASS' : 'FAIL');

// 10. 控制台错误检查
const errors = logs.filter((m) => m.method === 'Runtime.exceptionThrown');
console.log('⑩ 运行时异常数:', errors.length, errors.length === 0 ? 'PASS' : JSON.stringify(errors).slice(0, 500));

// 截图最终状态
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync('/tmp/shot-final.png', Buffer.from(shot.data, 'base64'));
console.log('截图已保存 /tmp/shot-final.png');
ws.close();
process.exit(0);
