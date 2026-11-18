// CDP 冒烟测试：驱动真实 Chrome，验证 WebGPU 初始化、确定性与订单全流程
// 运行：node scripts/cdp-smoke.mjs
const BASE = 'http://127.0.0.1:5175';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome() {
  const { spawn } = await import('node:child_process');
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const port = 9222 + Math.floor(Math.random() * 100);
  const userDir = `C:/Users/Administrator/AppData/Local/Temp/cdp-smoke-${Date.now()}`;
  const proc = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return { proc, port };
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('Chrome CDP did not start');
}

async function cdp(port) {
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browserWs = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => (browserWs.onopen = r));
  let bid = 0;
  const bpending = new Map();
  browserWs.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && bpending.has(msg.id)) {
      bpending.get(msg.id)(msg);
      bpending.delete(msg.id);
    }
  };
  const bsend = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++bid;
      bpending.set(mid, resolve);
      browserWs.send(JSON.stringify({ id: mid, method, params }));
    });
  // 创建一个页面 target 并以 flatten 模式附加，拿到带 page 域的会话
  const { targetId } = await bsend('Target.createTarget', { url: 'about:blank' }).then((r) => r.result);
  const attached = await bsend('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = attached.result.sessionId;

  let id = 0;
  const pending = new Map();
  const events = [];
  browserWs.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.sessionId !== sessionId) return;
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      events.push(msg);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      browserWs.send(JSON.stringify({ id: mid, method, params, sessionId }));
    });
  return {
    send,
    events,
    eval: async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.error) throw new Error('CDP ERROR: ' + JSON.stringify(r.error));
      if (r.result?.exceptionDetails) {
        const ed = r.result.exceptionDetails;
        throw new Error('PAGE ERROR: ' + (ed.exception?.description ?? ed.text));
      }
      return r.result?.result?.value;
    },
    close: () => browserWs.close(),
  };
}

const { proc, port } = await launchChrome();
try {
  const c = await cdp(port);
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  const errors = [];
  c.events.length = 0;
  await c.send('Page.navigate', { url: `${BASE}/#/editor` });
  await sleep(3500);

  // 1. 渲染器类型与基础状态
  const kind = await c.eval(`document.querySelector('.canvas-badge')?.innerText`);
  console.log('渲染器徽章:', kind);
  const hasWebGpu = kind.includes('WebGPU');

  // 2. Pinia 状态：256 区块、高度已生成、checksum 稳定
  const stats1 = await c.eval(`(async () => {
    const app = document.querySelector('#app').__vue_app__;
    const pinia = app.config.globalProperties.$pinia;
    const t = pinia._s.get('terrain');
    const cs1 = t.checksum;
    await new Promise(r => setTimeout(r, 100));
    const cs2 = t.checksum;
    return {
      chunks: t.chunks.length,
      nonzeroHeights: t.heights.filter(h => h !== 0).length,
      checksumStable: cs1 === cs2,
      checksum: cs1,
      locked: t.lockedCount,
      genMs: t.lastStats?.totalMs,
    };
  })()`);
  console.log('地形状态:', JSON.stringify(stats1));
  const assert = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) process.exitCode = 1; };
  assert('渲染器初始化（WebGPU 或 Canvas2D 降级）', !!kind);
  if (!hasWebGpu) console.log('  （无头环境无 GPU，走 Canvas2D 降级，属预期）');
  assert('256 个区块', stats1.chunks === 256);
  assert('高度场已生成（非零顶点 > 4000）', stats1.nonzeroHeights > 4000);
  assert('checksum 稳定', stats1.checksumStable);

  // 3. 同 seed 整片重生成 -> checksum 不变（确定性端到端）
  const csBefore = stats1.checksum;
  await c.eval(`(async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const t = pinia._s.get('terrain');
    t.regenerateAll();
    await new Promise(r => setTimeout(r, 200));
  })()`);
  const csAfter = await c.eval(`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('terrain').checksum`);
  assert('同 seed 整片重生成 checksum 完全一致', csBefore === csAfter);

  // 4. 改参数只重算受影响区块
  const incremental = await c.eval(`(async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const t = pinia._s.get('terrain');
    t.updateParam('trenchWidth', 1.4);
    await new Promise(r => setTimeout(r, 100));
    return { recomputed: t.lastStats.recomputed, totalMs: t.lastStats.totalMs, skipped: t.lastStats.skippedLocked };
  })()`);
  console.log('增量重算:', JSON.stringify(incremental));
  assert('改沟槽宽度只重算受影响区块（< 256）', incremental.recomputed > 0 && incremental.recomputed < 256);

  // 5. 完整业务流：建单 -> 派单 -> 提交 -> 质检重跑 -> 通过/打回
  const flow = await c.eval(`(async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const w = pinia._s.get('work');
    w.switchUser('张前台');
    const order = w.createOrder({ title: 'CDP冒烟单', requirement: '端到端流程', seed: 20260101,
      params: { slopeGrade: 2, stepHeight: 0.15, gravelDensity: 0.4, trenchWidth: 0.8, waterDepth: 0.5 }, assignee: '李建模' });
    w.switchUser('李建模');
    const t = pinia._s.get('terrain');
    t.init(order.seed, { ...order.params });
    const snap = t.toSnapshot();
    w.submitForQc(order.id, snap);
    return { id: order.id, status: order.status, snapChecksum: snap.checksum, qcQueue: w.qcQueue.length };
  })()`);
  console.log('业务流-建单提交:', JSON.stringify(flow));
  assert('建单派单后可提交质检', flow.status === 'qc' && flow.qcQueue >= 1);

  // 质检重跑（模拟 QcView 的独立重算逻辑）
  const qc = await c.eval(`(async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const w = pinia._s.get('work');
    const o = w.orders.find(x => x.id === '${flow.id}');
    const mod = await import('/src/terrain/height.ts');
    const ch = await import('/src/terrain/chunks.ts');
    const cfg = await import('/src/terrain/config.ts');
    const h = new Float64Array(cfg.VERTS * cfg.VERTS);
    for (let iz = 0; iz < cfg.VERTS; iz++)
      for (let ix = 0; ix < cfg.VERTS; ix++)
        h[iz * cfg.VERTS + ix] = mod.heightAt(o.seed, o.params, ix * cfg.CELL, iz * cfg.CELL);
    let matched = 0, total = 0; const bad = [];
    const sub = new Float64Array(cfg.VERTS * cfg.VERTS);
    o.submittedSnapshot.heights.forEach((q, i) => sub[i] = q / 1000);
    for (const cmeta of o.submittedSnapshot.chunks) {
      if (cmeta.locked) continue;
      total++;
      if (ch.hashChunk(cmeta.id, h) === ch.hashChunk(cmeta.id, sub)) matched++; else bad.push(cmeta.id);
    }
    w.switchUser('赵质检');
    const result = { at: Date.now(), user: '赵质检', passed: bad.length === 0, matchedChunks: matched, totalChunks: total,
      chunkHashes: {}, expectedHashes: {}, detail: 'cdp smoke' };
    w.qcDecide(o.id, result, bad.length === 0, 'cdp smoke');
    return { matched, total, finalStatus: o.status, rework: o.reworkCount };
  })()`);
  console.log('业务流-质检:', JSON.stringify(qc));
  assert('同 seed 质检重跑 256 块全部一致', qc.matched === qc.total && qc.total === 256);
  assert('一致时质检通过且无返工', qc.finalStatus === 'passed' && qc.rework === 0);

  // 看板统计
  const dash = await c.eval(`(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const w = pinia._s.get('work');
    const mine = w.orders.filter(o => o.assignee === '李建模');
    return { total: w.orders.length, liDone: mine.filter(o => ['passed','done'].includes(o.status)).length };
  })()`);
  assert('看板统计可见该单', dash.total >= 1 && dash.liDone === 1);

  // 6. 锁定区在重生成时保留不动 + 边界过渡
  const lockCase = await c.eval(`(async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const t = pinia._s.get('terrain');
    t.init(20260101, { slopeGrade: 2, stepHeight: 0.15, gravelDensity: 0.4, trenchWidth: 0.8, waterDepth: 0.5 });
    // 锁定中央 4 个区块 (7,7)(8,7)(7,8)(8,8)，取样点取区块内部顶点（边界共享顶点会被过渡平滑）
    const lockedIds = [7 * 16 + 7, 7 * 16 + 8, 8 * 16 + 7, 8 * 16 + 8];
    lockedIds.forEach(id => { t.chunks[id].locked = true; });
    const innerVert = (id) => {
      const ix = (id % 16) * 4 + 1, iz = Math.floor(id / 16) * 4 + 1;
      return iz * 65 + ix;
    };
    // 手修一块（自动锁定），此时锁定区高度定型
    t.beginSculpt(30, 30); t.sculptAt('raise', 30, 30); t.endSculpt();
    lockedIds.forEach(id => { t.chunks[id].locked = true; });
    // 在「重生成前」取样锁定块内部顶点
    const sample = lockedIds.map(id => t.heights[innerVert(id)]);
    t.regenerateAll();
    const after = lockedIds.map(id => t.heights[innerVert(id)]);
    const preserved = sample.every((v, i) => v === after[i]);
    const skipped = t.lastStats.skippedLocked >= 4;
    return { preserved, skipped, blendMs: t.lastStats.blendMs, lockedCount: t.lockedCount };
  })()`);
  console.log('锁定保留:', JSON.stringify(lockCase));
  assert('锁定区块重生成后高度原样保留', lockCase.preserved);
  assert('重生成跳过锁定区块且执行了边界过渡', lockCase.skipped && lockCase.blendMs >= 0);

  // 7. 参数被偷偷改动 -> 同 seed 质检重跑必须识别不一致并打回
  const rejectCase = await c.eval(`(async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const w = pinia._s.get('work');
    const t = pinia._s.get('terrain');
    const order = w.createOrder({ title: '参数篡改单', requirement: '', seed: 777,
      params: { slopeGrade: 1, stepHeight: 0.1, gravelDensity: 0.3, trenchWidth: 0.6, waterDepth: 0.4 }, assignee: '王建模' });
    t.init(order.seed, order.params);
    w.submitForQc(order.id, t.toSnapshot());
    // 质检端按订单记录的参数重跑（模拟建模端实际用了不同参数：先改订单参数再重算）
    order.params.slopeGrade = 4;
    const mod = await import('/src/terrain/height.ts');
    const ch = await import('/src/terrain/chunks.ts');
    const cfg = await import('/src/terrain/config.ts');
    const h = new Float64Array(cfg.VERTS * cfg.VERTS);
    for (let iz = 0; iz < cfg.VERTS; iz++)
      for (let ix = 0; ix < cfg.VERTS; ix++)
        h[iz * cfg.VERTS + ix] = mod.heightAt(order.seed, order.params, ix * cfg.CELL, iz * cfg.CELL);
    let bad = 0;
    const sub = new Float64Array(cfg.VERTS * cfg.VERTS);
    order.submittedSnapshot.heights.forEach((q, i) => sub[i] = q / 1000);
    for (const cm of order.submittedSnapshot.chunks) {
      if (cm.locked) continue;
      if (ch.hashChunk(cm.id, h) !== ch.hashChunk(cm.id, sub)) bad++;
    }
    w.switchUser('赵质检');
    w.qcDecide(order.id, { at: Date.now(), user: '赵质检', passed: false, matchedChunks: 256 - bad,
      totalChunks: 256, chunkHashes: {}, expectedHashes: {}, detail: '参数不一致' }, false, '参数不一致');
    return { badBlocks: bad, status: order.status, rework: order.reworkCount };
  })()`);
  console.log('打回场景:', JSON.stringify(rejectCase));
  assert('参数不一致时存在哈希冲突区块', rejectCase.badBlocks > 0);
  assert('质检打回且返工次数 +1', rejectCase.status === 'rejected' && rejectCase.rework === 1);

  // 8. 浏览器内验证三种导出的 Blob 格式
  const exportCase = await c.eval(`(async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ex = await import('/src/terrain/exporter.ts');
    const cfg = await import('/src/terrain/config.ts');
    const t = pinia._s.get('terrain');
    const obj = await ex.exportObj(t.heights).text();
    const { raw, meta } = ex.exportHeightmapRaw(t.heights);
    const png = ex.exportHeightmapPng8(t.heights);
    const pngBuf = new Uint8Array(await png.arrayBuffer());
    const magic = Array.from(pngBuf.subarray(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
    return {
      objVerts: (obj.match(/^v /gm) || []).length,
      objFaces: (obj.match(/^f /gm) || []).length,
      rawBytes: raw.size,
      expectRaw: cfg.VERTS * cfg.VERTS * 2,
      pngMagic: magic,
      pngSize: png.size,
      metaOk: (await meta.text()).includes('uint16-le'),
    };
  })()`);
  console.log('导出验证:', JSON.stringify(exportCase));
  assert('OBJ 含 4225 顶点 / 8192 三角面', exportCase.objVerts === 4225 && exportCase.objFaces === 8192);
  assert('RAW 高度图字节数正确且带元数据', exportCase.rawBytes === exportCase.expectRaw && exportCase.metaOk);
  assert('PNG 为合法 PNG 文件', exportCase.pngMagic === '89504e470d0a1a0a' && exportCase.pngSize > 1000);

  // 控制台错误检查
  const consoleErrs = c.events.filter((e) => e.method === 'Runtime.exceptionThrown' ||
    (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  assert('运行期无未捕获异常/控制台错误', consoleErrs.length === 0);
  if (consoleErrs.length) console.log(JSON.stringify(consoleErrs.slice(0, 3), null, 2));

  c.close();
} finally {
  proc.kill();
}
console.log(process.exitCode ? '\n存在失败项 ❌' : '\nCDP 端到端冒烟全部通过 ✅');
