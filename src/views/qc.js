/**
 * views/qc.js — 界面③：质检抽查
 * 待检队列 → 随机抽查（曲率/容量/伸长率自动校核）→ 合格入库 / 不合格打回（返工次数 +1）
 */
import html from 'solid-js/html';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { state, currentOrder, selectOrder, passOrder, rejectOrder, STATUS_LABEL } from '../store.js';
import { profileMetrics, maxCurvature } from '../geometry.js';
import { ProfileEditor } from '../profile-editor.js';

export default function QcView() {
  const [opinion, setOpinion] = createSignal('');
  const [sampleResult, setSampleResult] = createSignal(null);
  let roCanvas, editor;

  const queue = createMemo(() => state.orders.filter(o => o.status === 'submitted'));
  const history = createMemo(() =>
    state.orders.filter(o => o.status === 'passed' || o.status === 'rework' || o.status === 'assigned')
  );
  const order = currentOrder;

  onMount(() => {
    editor = new ProfileEditor(roCanvas, () => {
      const d = order()?.design;
      return d
        ? { controlPoints: d.controlPoints, threshold: d.threshold, readonly: true }
        : { controlPoints: [], threshold: 0.03, readonly: true };
    }, () => {});
  });
  onCleanup(() => editor?.destroy());

  createEffect(() => {
    const d = order()?.design;
    if (d) editor?.draw();
  });

  // 切换选中工单时重置抽查结论
  createEffect(() => {
    order()?.id;
    setSampleResult(null);
    setOpinion('');
  });

  const runSample = () => {
    const o = order();
    if (!o?.design) return;
    const d = o.design;
    const ms = profileMetrics(d.controlPoints, d.threshold);
    const over = ms.filter(m => m.overThreshold);
    const capErr = Math.abs(d.volumeMl - o.capacityMl) / o.capacityMl;
    // 模拟抽查随机性：客观指标 + 批次抽样项
    const roll = Math.random();
    const checks = [
      { name: '曲率控制点校核', pass: over.length === 0, detail: over.length ? `${over.length} 个点超 κ=${d.threshold}` : '全部达标' },
      { name: '容量偏差校核（±5%）', pass: capErr <= 0.05, detail: `实测 ${d.volumeMl.toFixed(1)}ml，偏差 ${(capErr * 100).toFixed(2)}%` },
      { name: '标签参数完整性', pass: d.label.yMax > d.label.yMin && d.label.safeMm > 0 && d.label.bleedMm > 0,
        detail: `安全区 ${d.label.safeMm}mm / 出血 ${d.label.bleedMm}mm` },
      { name: '抽样复核（随机批次 ' + (roll * 100).toFixed(0) + '%）', pass: roll > 0.12, detail: roll > 0.12 ? '批次样品外观/尺寸合格' : '抽检发现批次一致性偏差' },
    ];
    const allPass = checks.every(c => c.pass);
    setSampleResult({ allPass, checks, peak: maxCurvature(d.controlPoints, d.threshold) });
  };

  const doPass = () => {
    const o = order();
    if (o) passOrder(o.id, opinion());
  };
  const doReject = () => {
    const o = order();
    if (!o) return;
    if (!opinion().trim()) { alert('打回必须填写不合格原因，便于设计师返工'); return; }
    rejectOrder(o.id, opinion());
  };

  return html`
    <div class="page-title">
      <h2>质检抽查</h2>
      <span class="sub">待检 ${() => queue().length} 单 · 打回自动记录返工次数并退回设计师</span>
    </div>

    <div class="grid layout-2" style="align-items:start">
      <!-- 左：队列与历史 -->
      <div class="stack">
        <section class="card">
          <div class="card-hd"><h3>待质检队列</h3></div>
          <div class="card-bd flush">
            <${Show} when=${() => queue().length > 0} fallback=${html`<div class="empty"><p>暂无待检工单</p></div>`}>
              <${For} each=${queue}>${o => html`
                <div class=${() => 'order-item' + (o.id === order()?.id ? ' sel' : '')} onClick=${() => selectOrder(o.id)}>
                  <div class="oid">${o.id}</div>
                  <h4>${o.title}</h4>
                  <div class="meta">
                    <span class="badge submitted">待质检</span>
                    <span class="muted mono">${o.designer} · ${o.capacityMl}ml</span>
                    <${Show} when=${() => o.reworkCount > 0}><span class="danger-text">第 ${() => o.reworkCount + 1} 次送检</span><//>
                  </div>
                </div>`}<//>
            <//>
          </div>
        </section>
        <section class="card">
          <div class="card-hd"><h3>近期质检记录</h3></div>
          <div class="card-bd flush">
            <div class="table-wrap" style="max-height:260px">
              <table class="table">
                <thead><tr><th>工单</th><th>状态</th><th>返工次数</th><th>结论</th></tr></thead>
                <tbody>
                  <${For} each=${history}>${o => html`
                    <tr class="clickable" onClick=${() => selectOrder(o.id)}>
                      <td class="mono">${o.id.slice(-6)}</td>
                      <td><span class=${() => 'badge ' + o.status}>${() => STATUS_LABEL[o.status]}</span></td>
                      <td class="num">${() => o.reworkCount}</td>
                      <td style="max-width:220px"><${Show} when=${() => o.qcOpinion} fallback=${html`<span class="muted">—</span>`}>${() => o.qcOpinion}<//></td>
                    </tr>`}<//>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <!-- 右：抽检详情 -->
      <section class="card">
        <div class="card-hd"><h3>质检详情</h3>
          <${Show} when=${() => order()?.status === 'submitted'}>
            <button class="btn sm primary" onClick=${runSample}>🎲 随机抽查校核</button>
          <//>
        </div>
        <div class="card-bd">
          <${Show} when=${() => order()} fallback=${html`<div class="empty"><p>从左侧队列选择工单</p></div>`}>
            <div class="row spread" style="margin-bottom:12px">
              <div>
                <h4>${() => order().title}</h4>
                <div class="muted mono" style="font-size:12px">${() => order().id} · ${() => order().designer}</div>
              </div>
              <span class=${'badge ' + order().status}>${() => STATUS_LABEL[order().status]}</span>
            </div>

            <${Show} when=${() => order().design} fallback=${html`<div class="empty"><p>该工单尚未开始设计</p></div>`}>
              <div class="canvas-wrap" style="margin-bottom:12px">
                <canvas ref=${el => (roCanvas = el)} style="height:300px"></canvas>
                <div class="canvas-overlay"><span class="chip">只读轮廓复核</span></div>
              </div>

              <div class="metrics-grid">
                <div class="metric"><div class="k">实测容量</div>
                  <div class="v" style="font-size:16px">${() => order().design.volumeMl.toFixed(1)} ml</div></div>
                <div class="metric"><div class="k">目标容量</div>
                  <div class="v" style="font-size:16px">${() => order().capacityMl} ml</div></div>
                <div class="metric"><div class="k">峰值曲率</div>
                  <div class="v" style="font-size:16px">${() => maxCurvature(order().design.controlPoints, order().design.threshold).curvature.toFixed(4)}</div></div>
                <div class="metric"><div class="k">累计返工</div>
                  <div class=${'v ' + (order().reworkCount ? 'bad' : '')} style="font-size:16px">${() => order().reworkCount} 次</div></div>
              </div>

              <${Show} when=${() => sampleResult()}>
                <div class=${() => 'qc-result ' + (sampleResult()?.allPass ? 'pass' : 'fail')} style="margin-bottom:12px">
                  <strong>${() => sampleResult()?.allPass ? '✔ 抽查通过，可入库' : '✘ 抽查发现不合格项，建议打回'}</strong>
                  <div class="stack" style="margin-top:8px">
                    <${For} each=${() => sampleResult()?.checks ?? []}>${c => html`
                      <div>${c.pass ? '✔' : '✘'} ${c.name}：<span class="mono">${c.detail}</span></div>`}<//>
                  </div>
                </div>
              <//>

              <div class="field">
                <label>质检意见（打回时必填）</label>
                <textarea class="textarea" placeholder="例：肩部曲率超限、容量偏差超标、出血不足 3mm…"
                  value=${() => opinion()} onInput=${e => setOpinion(e.target.value)}></textarea>
              </div>

              <${Show} when=${() => order().status === 'submitted'}>
                <div class="toolbar">
                  <button class="btn primary"
                    disabled=${() => (sampleResult() ? !sampleResult().allPass : false)}
                    onClick=${doPass}>✔ 合格入库</button>
                  <button class="btn danger" onClick=${doReject}>✘ 不合格打回（返工 +1）</button>
                  <${Show} when=${() => !sampleResult()}>
                    <span class="muted" style="font-size:12px">建议先执行随机抽查校核</span>
                  <//>
                </div>
              <//>

              <h4 style="margin:16px 0 8px;font-size:13px">流转记录</h4>
              <div class="timeline">
                <${For} each=${() => order().events}>${ev => html`
                  <div class="ev">
                    <time>${ev.at}</time>
                    <span><b>${ev.actor}</b> · ${ev.text}</span>
                  </div>`}<//>
              </div>
            <//>
          <//>
        </div>
      </section>
    </div>
  `;
}
