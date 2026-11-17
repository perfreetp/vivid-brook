/**
 * views/workbench.js — 界面②：设计师工作台
 * 阶段1 二维半剖样条轮廓（曲率/切向角实时标注，超限标红）
 * 阶段2 绕轴旋转曲面预览（OffscreenCanvas）
 * 阶段3 等距偏移安全区/出血 + 柱面展开标签稿（Worker + OffscreenCanvas，改轮廓自动重算）
 */
import html from 'solid-js/html';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import {
  state, currentOrder, selectOrder, setCurrentDesigner, updateControlPoints, updateDesign, updateLabel,
  submitDesign, resumeWork, DESIGNERS, STATUS_LABEL,
} from '../store.js';
import {
  profileMetrics, maxCurvature, revolveVolume, scaleToCapacity,
  DEFAULT_PROFILE, arcLength, sampleProfile,
} from '../geometry.js';
import { ProfileEditor } from '../profile-editor.js';
import { RevolveRenderer } from '../revolve-renderer.js';
import { UnwrapController } from '../unwrap-controller.js';

const STAGES = [
  { key: 'profile', name: '轮廓建模' },
  { key: 'revolve', name: '旋转曲面' },
  { key: 'unwrap', name: '标签展开' },
];

export default function WorkbenchView({ go }) {
  const [stage, setStage] = createSignal('profile');
  const [wireframe, setWireframe] = createSignal(false);
  const [unwrapStats, setUnwrapStats] = createSignal(null);
  let profileCanvas, revolveCanvas, unwrapCanvas;
  let editor, renderer, unwrap;

  const order = currentOrder;
  const design = createMemo(() => order()?.design);
  const readonly = createMemo(() => {
    const o = order();
    return !o || o.status === 'submitted' || o.status === 'passed';
  });

  // 切换阶段：隐藏画布重新获得尺寸后需要主动测量并重绘
  const switchStage = key => {
    setStage(key);
    queueMicrotask(() => {
      if (key === 'revolve') renderer?.remeasure();
      if (key === 'unwrap') unwrap?.remeasure();
    });
  };

  /* ---------- 画布初始化 ---------- */
  onMount(() => {
    editor = new ProfileEditor(profileCanvas, () => {
      const d = design();
      return d
        ? { controlPoints: d.controlPoints, threshold: d.threshold, readonly: readonly() }
        : { controlPoints: DEFAULT_PROFILE, threshold: 0.03, readonly: true };
    }, pts => {
      const o = order();
      if (o && !readonly()) updateControlPoints(o.id, pts);
    });

    renderer = new RevolveRenderer(revolveCanvas);
    renderer.setWire(wireframe());

    unwrap = new UnwrapController(unwrapCanvas);
    unwrap.onStats = s => setUnwrapStats(s);

    // 调试/自动化钩子
    window.__workbench = {
      remeasure: () => { renderer?.remeasure(); unwrap?.remeasure(); },
      get unwrapMode() { return unwrapCanvas?.dataset.renderMode; },
      get revolvePainted() { return !!renderer?.painted; },
      get unwrapPainted() { return !!unwrap?.painted; },
      get editor() { return editor; },
    };
  });

  onCleanup(() => {
    editor?.destroy(); renderer?.destroy(); unwrap?.destroy();
  });

  // 数据变化 → 重绘画布（显式订阅控制点坐标/阈值，保证 produce 细粒度更新也能触发）
  createEffect(() => {
    const d = design();
    if (d) {
      d.controlPoints.forEach(p => p.r + p.y); // 订阅每个控制点坐标
      void d.threshold;
      editor?.draw();
    }
  });
  createEffect(() => {
    const d = design();
    if (d && renderer) {
      d.controlPoints.forEach(p => p.r + p.y);
      void d.material;
      renderer.setProfile(d.controlPoints, d.material);
    }
  });
  createEffect(() => {
    const d = design();
    if (!d || !unwrap) return;
    // 显式读取 label 各字段与控制点，建立细粒度订阅：
    // 任一偏移量/基准/轮廓变化都触发展开稿自动重算（控制器内部 120ms 防抖）
    const { yMin, yMax, safeMm, bleedMm, refMode, refRadius } = d.label;
    void yMin; void yMax; void safeMm; void bleedMm; void refMode; void refRadius;
    d.controlPoints.forEach(p => p.r + p.y); // 订阅每个控制点坐标
    unwrap.request({ controlPoints: d.controlPoints, label: d.label });
  });
  createEffect(() => renderer?.setWire(wireframe()));

  /* ---------- 派生指标 ---------- */
  const metrics = createMemo(() => {
    const d = design();
    return d ? profileMetrics(d.controlPoints, d.threshold) : [];
  });
  const peak = createMemo(() => {
    const d = design();
    return d ? maxCurvature(d.controlPoints, d.threshold) : { curvature: 0, overThreshold: false };
  });
  const overCount = createMemo(() => metrics().filter(m => m.overThreshold).length);
  const profileLen = createMemo(() => {
    const d = design();
    return d ? arcLength(sampleProfile(d.controlPoints)) : 0;
  });
  const capDelta = createMemo(() => {
    const o = order(), d = design();
    if (!o || !d) return 0;
    return d.volumeMl - o.capacityMl;
  });

  const autoScale = () => {
    const o = order(), d = design();
    if (!o || !d || readonly()) return;
    updateControlPoints(o.id, scaleToCapacity(d.controlPoints, o.capacityMl));
  };
  const resetProfile = () => {
    const o = order();
    if (!o || readonly()) return;
    if (!confirm('恢复为默认瓶型轮廓？当前调整将丢失。')) return;
    updateControlPoints(o.id, scaleToCapacity(DEFAULT_PROFILE.map(p => ({ ...p })), o.capacityMl));
  };

  return html`
    <div class="page-title">
      <h2>设计工作台</h2>
      <span class="sub">当前设计师：<b>${() => state.currentDesigner}</b>（可在右侧切换）</span>
    </div>

    <${Show} when=${() => order()} fallback=${html`
      <div class="card"><div class="empty">
        <div class="big">🗒️</div><p>暂无可选工单，请先到「前台接单」创建并分派工单。</p>
        <button class="btn primary" onClick=${() => go('orders')}>去接单</button>
      </div></div>`}>
      <div class="grid layout-workbench">
        <!-- 左侧工单栏 -->
        <aside class="card">
          <div class="card-hd"><h3>我的工单</h3>
            <select class="select" style="width:104px;padding:4px 6px"
              value=${() => state.currentDesigner}
              onChange=${e => setCurrentDesigner(e.target.value)}>
              <${For} each=${DESIGNERS}>${d => html`<option value=${d}>${d}</option>`}<//>
            </select>
          </div>
          <div class="card-bd flush">
            <${For} each=${() => state.orders}>${o => html`
              <div class=${() => 'order-item' + (o.id === order()?.id ? ' sel' : '')}
                onClick=${() => selectOrder(o.id)}>
                <div class="oid">${o.id}</div>
                <h4>${o.title}</h4>
                <div class="meta">
                  <span class=${() => 'badge ' + o.status}>${() => STATUS_LABEL[o.status]}</span>
                  <span class="muted mono">${o.capacityMl}ml · ${o.material}</span>
                </div>
                <${Show} when=${() => o.reworkCount > 0}>
                  <div class="danger-text" style="font-size:12px;margin-top:6px">↩ 已返工 ${() => o.reworkCount} 次</div>
                <//>
              </div>`}<//>
          </div>
        </aside>

        <!-- 右侧主工作区 -->
        <section class="card">
          <div class="card-hd">
            <div>
              <h3>${() => order().title} <span class="muted mono" style="font-weight:400;font-size:12px">${() => order().id}</span></h3>
              <div class="muted" style="font-size:12px;margin-top:2px">
                目标 ${() => order().capacityMl}ml · ${() => order().material}
                <${Show} when=${() => order().status === 'rework'}>
                  · <span class="danger-text">质检打回：${() => order().qcOpinion || '见质检记录'}</span>
                <//>
              </div>
            </div>
            <div class="toolbar">
              <${Show} when=${() => readonly()}>
                <span class=${'badge ' + order().status}>${() => STATUS_LABEL[order().status]}（只读）</span>
              <//>
              <${Show} when=${() => order().status === 'rework'}>
                <button class="btn sm" onClick=${() => resumeWork(order().id)}>接收返工</button>
              <//>
              <${Show} when=${() => order().status === 'assigned'}>
                <button class="btn sm primary"
                  disabled=${() => overCount() > 0}
                  title=${() => overCount() > 0 ? '存在曲率超限控制点，修正后才能提交' : '提交质检员抽查'}
                  onClick=${() => submitDesign(order().id)}>提交质检</button>
              <//>
            </div>
          </div>

          <div class="card-bd">
            <div class="stage-tabs">
              <${For} each=${STAGES}>${(s, i) => html`
                <button class=${() => 'stage-tab' + (stage() === s.key ? ' active' : '')}
                  onClick=${() => switchStage(s.key)}>
                  <span class="n">${i() + 1}</span>${s.name}
                </button>`}<//>
            </div>

            <!-- 阶段 1：轮廓建模 -->
            <div hidden=${() => stage() !== 'profile'}>
              <div class="metrics-grid">
                <div class="metric">
                  <div class="k">实测容量（旋转体积分）</div>
                  <div class=${() => 'v ' + (Math.abs(capDelta()) <= order().capacityMl * 0.05 ? 'good' : 'bad')}>
                    ${() => design()?.volumeMl.toFixed(1)}<span style="font-size:12px"> ml</span>
                  </div>
                </div>
                <div class="metric">
                  <div class="k">容量偏差</div>
                  <div class=${() => 'v ' + (Math.abs(capDelta()) <= order().capacityMl * 0.05 ? 'good' : 'bad')}>
                    ${() => (capDelta() >= 0 ? '+' : '') + capDelta().toFixed(1)} ml
                  </div>
                </div>
                <div class="metric">
                  <div class="k">峰值曲率 κ（阈值 ${() => design()?.threshold.toFixed(3)}）</div>
                  <div class=${() => 'v ' + (peak().overThreshold ? 'bad' : '')}>${() => peak().curvature.toFixed(4)}</div>
                </div>
                <div class="metric">
                  <div class="k">超限控制点 / 轮廓弧长</div>
                  <div class=${() => 'v ' + (overCount() ? 'bad' : 'good')}>
                    ${() => overCount()}<span style="font-size:12px"> 点 · </span>${() => profileLen().toFixed(0)}<span style="font-size:12px"> mm</span>
                  </div>
                </div>
              </div>

              <div class="canvas-wrap">
                <canvas id="profile-canvas" ref=${el => (profileCanvas = el)}></canvas>
                <div class="canvas-overlay">
                  <span class="chip">曲率梳（紫=正常 / 红=超阈值）</span>
                  <span class="chip">双击空白加点 · 双击或右键控制点删除 · 滚轮缩放</span>
                </div>
                <div class="canvas-hint">半剖轮廓，左侧虚线为回转轴</div>
              </div>

              <div class="row spread" style="margin-top:12px">
                <div class="inline-field">
                  <label>曲率报警阈值 κ（1/mm）</label>
                  <input class="input" type="number" step="0.005" min="0.005" max="0.2"
                    value=${() => design()?.threshold ?? 0.03}
                    disabled=${() => readonly()}
                    onInput=${e => updateDesign(order().id, { threshold: Math.max(0.001, Number(e.target.value)) })} />
                </div>
                <div class="toolbar">
                  <button class="btn sm" disabled=${() => readonly()} onClick=${autoScale}>按目标容量自动缩放半径</button>
                  <button class="btn sm" disabled=${() => readonly()} onClick=${resetProfile}>恢复默认瓶型</button>
                  <button class="btn sm primary" onClick=${() => switchStage('revolve')}>下一步：旋转曲面 →</button>
                </div>
              </div>

              <!-- 控制点明细表 -->
              <div class="table-wrap" style="margin-top:12px;max-height:230px">
                <table class="table">
                  <thead><tr>
                    <th>#</th><th>半径 r (mm)</th><th>高度 y (mm)</th>
                    <th>曲率 κ (1/mm)</th><th>切向角 θ</th><th>判定</th>
                  </tr></thead>
                  <tbody>
                    <${For} each=${metrics}>${(m, i) => html`
                      <tr>
                        <td class="num">${i()}</td>
                        <td class="num">${() => design().controlPoints[i()].r.toFixed(2)}</td>
                        <td class="num">${() => design().controlPoints[i()].y.toFixed(2)}</td>
                        <td class=${() => 'num' + (m.overThreshold ? ' danger-text' : '')}>${() => m.curvature.toFixed(4)}</td>
                        <td class="num">${() => m.angle.toFixed(1)}°</td>
                        <td><${Show} when=${() => m.overThreshold}
                          fallback=${html`<span class="badge passed">正常</span>`}>
                          <span class="badge rework">超阈值</span>
                        <//></td>
                      </tr>`}<//>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- 阶段 2：旋转曲面 -->
            <div hidden=${() => stage() !== 'revolve'}>
              <div class="canvas-wrap">
                <canvas id="revolve-canvas" ref=${el => (revolveCanvas = el)}></canvas>
                <div class="canvas-overlay">
                  <span class="chip">材质基色：${() => design()?.material}</span>
                  <span class="chip">拖拽旋转视角 · 自动环绕</span>
                </div>
              </div>
              <div class="row spread" style="margin-top:12px">
                <label class="inline-field" style="gap:6px">
                  <input type="checkbox" checked=${() => wireframe()} onChange=${e => setWireframe(e.target.checked)} />
                  显示网格线框
                </label>
                <div class="toolbar">
                  <button class="btn sm" onClick=${() => switchStage('profile')}>← 返回轮廓</button>
                  <button class="btn sm primary" onClick=${() => switchStage('unwrap')}>下一步：标签展开 →</button>
                </div>
              </div>
            </div>

            <!-- 阶段 3：标签展开 -->
            <div hidden=${() => stage() !== 'unwrap'}>
              <div class="metrics-grid">
                <div class="metric">
                  <div class="k">展开宽度 2πr₀</div>
                  <div class="v">${() => unwrapStats()?.trimWidth.toFixed(1) ?? '—'}<span style="font-size:12px"> mm</span></div>
                </div>
                <div class="metric">
                  <div class="k">标签高度</div>
                  <div class="v">${() => unwrapStats()?.trimHeight.toFixed(1) ?? '—'}<span style="font-size:12px"> mm</span></div>
                </div>
                <div class="metric">
                  <div class="k">最大伸长率 ε_max</div>
                  <div class=${() => 'v ' + ((unwrapStats()?.maxE ?? 0) > 0.08 ? 'bad' : 'good')}>
                    ${() => (unwrapStats() ? (unwrapStats().maxE * 100).toFixed(2) : '—')}%
                  </div>
                </div>
                <div class="metric">
                  <div class="k">最小伸长率 ε_min</div>
                  <div class="v">${() => (unwrapStats() ? (unwrapStats().minE * 100).toFixed(2) : '—')}%</div>
                </div>
              </div>

              <div class="canvas-wrap">
                <canvas id="unwrap-canvas" ref=${el => (unwrapCanvas = el)}></canvas>
                <div class="canvas-overlay">
                  <span class="chip">黑=刀版线 绿=安全区 红=出血 紫=接缝</span>
                  <span class="chip">轮廓/参数修改后自动重算</span>
                </div>
              </div>

              <div class="grid layout-2" style="margin-top:12px">
                <div class="card" style="box-shadow:none">
                  <div class="card-hd"><h3 style="font-size:13px">等距偏移参数</h3></div>
                  <div class="card-bd">
                    <div class="form-row">
                      <div class="field">
                        <label>安全区内缩（mm）</label>
                        <input class="input" type="number" min="1" max="20" step="0.5"
                          disabled=${() => readonly()}
                          value=${() => design()?.label.safeMm}
                          onInput=${e => updateLabel(order().id, { safeMm: Math.max(0, Number(e.target.value)) })} />
                      </div>
                      <div class="field">
                        <label>出血外扩（mm）</label>
                        <input class="input" type="number" min="1" max="20" step="0.5"
                          disabled=${() => readonly()}
                          value=${() => design()?.label.bleedMm}
                          onInput=${e => updateLabel(order().id, { bleedMm: Math.max(0, Number(e.target.value)) })} />
                      </div>
                    </div>
                    <div class="form-row">
                      <div class="field">
                        <label>标签下沿 yMin（mm）</label>
                        <input class="input" type="number" min="0" step="2"
                          disabled=${() => readonly()}
                          value=${() => design()?.label.yMin}
                          onInput=${e => updateLabel(order().id, { yMin: Number(e.target.value) })} />
                      </div>
                      <div class="field">
                        <label>标签上沿 yMax（mm）</label>
                        <input class="input" type="number" min="0" step="2"
                          disabled=${() => readonly()}
                          value=${() => design()?.label.yMax}
                          onInput=${e => updateLabel(order().id, { yMax: Number(e.target.value) })} />
                      </div>
                    </div>
                  </div>
                </div>
                <div class="card" style="box-shadow:none">
                  <div class="card-hd"><h3 style="font-size:13px">展开基准半径 r₀</h3></div>
                  <div class="card-bd">
                    <div class="field">
                      <label>基准模式</label>
                      <select class="select" disabled=${() => readonly()}
                        value=${() => design()?.label.refMode}
                        onChange=${e => updateLabel(order().id, { refMode: e.target.value })}>
                        <option value="auto">自动（标签区间平均半径）</option>
                        <option value="fixed">手动指定半径</option>
                      </select>
                    </div>
                    <${Show} when=${() => design()?.label.refMode === 'fixed'}>
                      <div class="field">
                        <label>固定 r₀（mm）</label>
                        <input class="input" type="number" min="1" step="0.5"
                          disabled=${() => readonly()}
                          value=${() => design()?.label.refRadius}
                          onInput=${e => updateLabel(order().id, { refRadius: Math.max(1, Number(e.target.value)) })} />
                      </div>
                    <//>
                    <div class="legend">
                      <span><i style="background:rgb(37,120,205)"></i>收缩区 ε&lt;0</span>
                      <span><i style="background:rgb(214,62,48)"></i>拉伸区 ε&gt;0</span>
                      <span><i style="background:rgb(122,79,208)"></i>接缝搭接翼 8mm</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="row" style="margin-top:12px">
                <button class="btn sm" onClick=${() => switchStage('revolve')}>← 返回曲面</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    <//>
  `;
}
