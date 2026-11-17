/**
 * views/dashboard.js — 界面④：统计看板
 * 完成量 / 返工率 / 待办与质检队列 / 设计师绩效，Canvas2D 绘制柱状图与环形图
 */
import html from 'solid-js/html';
import { For, createEffect, onMount } from 'solid-js';
import { state, dashboardStats, resetAll, STATUS_LABEL } from '../store.js';

function BarChart(canvas, data) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = rect.width, H = rect.height;
  ctx.clearRect(0, 0, W, H);
  const pad = { l: 34, r: 12, t: 14, b: 30 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const max = Math.max(2, ...data.map(d => d.a + d.b));
  const bw = Math.min(58, cw / data.length - 18);
  ctx.strokeStyle = 'rgba(120,140,160,0.35)';
  ctx.fillStyle = '#8595a5';
  ctx.font = '10px Consolas, monospace';
  for (let g = 0; g <= max; g++) {
    const y = pad.t + ch - (g / max) * ch;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillText(String(g), 8, y + 3);
  }
  data.forEach((d, i) => {
    const x = pad.l + (cw / data.length) * i + (cw / data.length - bw) / 2;
    const hA = (d.a / max) * ch, hB = (d.b / max) * ch;
    ctx.fillStyle = '#1f9d57';
    ctx.fillRect(x, pad.t + ch - hA, bw, hA);
    ctx.fillStyle = '#d9382e';
    ctx.fillRect(x, pad.t + ch - hA - hB, bw, hB);
    ctx.fillStyle = '#5b6b7c';
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.label, x + bw / 2, H - 10);
    ctx.fillStyle = '#1c2733';
    ctx.font = '600 11px Consolas, monospace';
    if (d.a) ctx.fillText(String(d.a), x + bw / 2, pad.t + ch - hA - 3);
    if (d.b) ctx.fillText(String(d.b), x + bw / 2, pad.t + ch - hA - hB - 3);
    ctx.textAlign = 'left';
  });
}

function Donut(canvas, rate) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = rect.width / 2, cy = rect.height / 2, R = Math.min(cx, cy) - 12, r = R - 22;
  ctx.clearRect(0, 0, rect.width, rect.height);
  const seg = (a0, a1, color) => {
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0, a1); ctx.arc(cx, cy, r, a1, a0, true); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  };
  const start = -Math.PI / 2;
  seg(start, start + Math.PI * 2 * (1 - rate), '#1f9d57');
  seg(start + Math.PI * 2 * (1 - rate), start + Math.PI * 2, '#d9382e');
  ctx.fillStyle = '#1c2733';
  ctx.textAlign = 'center';
  ctx.font = '700 22px Consolas, monospace';
  ctx.fillText((rate * 100).toFixed(1) + '%', cx, cy + 2);
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.fillStyle = '#8595a5';
  ctx.fillText('返工率', cx, cy + 20);
  ctx.textAlign = 'left';
}

export default function DashboardView() {
  let barCanvas, donutCanvas;
  const stats = dashboardStats;

  const statusBreakdown = () => {
    const keys = ['new', 'assigned', 'submitted', 'rework', 'passed'];
    return keys.map(k => ({ key: k, label: STATUS_LABEL[k], n: state.orders.filter(o => o.status === k).length }));
  };

  onMount(() => {
    createEffect(() => {
      const s = stats();
      state.orders.length; // 订阅工单变化，操作后图表重绘
      BarChart(barCanvas, s.byDesigner.map(d => ({ label: d.designer.replace('设计师', ''), a: d.done, b: d.rework })));
      Donut(donutCanvas, s.reworkRate);
    });
  });

  return html`
    <div class="page-title">
      <h2>统计看板</h2>
      <span class="sub">数据随工单流转实时更新，持久化于本地</span>
      <button class="btn sm ghost" style="margin-left:auto"
        onClick=${() => confirm('恢复内置演示数据？当前本地数据将被覆盖。') && resetAll()}>↺ 重置演示数据</button>
    </div>

    <div class="stat-cards" style="margin-bottom:16px">
      <div class="card stat-card">
        <div class="k">工单总量</div>
        <div class="v">${() => stats().total}</div>
        <div class="d">含全部状态工单</div>
      </div>
      <div class="card stat-card">
        <div class="k">合格入库完成量</div>
        <div class="v" style="color:var(--green)">${() => stats().passed}</div>
        <div class="d">完成率 ${() => (stats().total ? ((stats().passed / stats().total) * 100).toFixed(0) : 0)}%</div>
      </div>
      <div class="card stat-card">
        <div class="k">返工率</div>
        <div class="v" style="color:var(--red)">${() => (stats().reworkRate * 100).toFixed(1)}%</div>
        <div class="d">返工 ${() => stats().reworkEvents} 次 / 送检 ${() =>
          state.orders.reduce((s, o) => s + o.events.filter(e => e.action === 'submit').length, 0)} 次</div>
      </div>
      <div class="card stat-card">
        <div class="k">待办 / 待质检</div>
        <div class="v" style="color:var(--primary)">${() => stats().pending}<span style="font-size:16px;color:var(--fg-3)"> / ${() => stats().qcQueue}</span></div>
        <div class="d">设计待办 / 质检队列</div>
      </div>
    </div>

    <div class="grid layout-2" style="align-items:start">
      <section class="card">
        <div class="card-hd"><h3>设计师绩效（绿=合格完成量，红=返工次数）</h3></div>
        <div class="card-bd">
          <canvas ref=${el => (barCanvas = el)} style="width:100%;height:250px"></canvas>
          <div class="table-wrap" style="margin-top:10px;max-height:200px">
            <table class="table">
              <thead><tr><th>设计师</th><th>承接</th><th>完成</th><th>返工</th><th>个人返工率</th></tr></thead>
              <tbody>
                <${For} each=${() => stats().byDesigner}>${d => html`
                  <tr>
                    <td>${d.designer}</td>
                    <td class="num">${() => d.total}</td>
                    <td class="num ok-text">${() => d.done}</td>
                    <td class=${() => 'num' + (d.rework ? ' danger-text' : '')}>${() => d.rework}</td>
                    <td>
                      <div class="progress" style="width:120px;display:inline-block;vertical-align:middle;margin-right:8px">
                        <i style=${() => ({ width: (d.total ? Math.min(100, (d.rework / Math.max(1, d.total)) * 100) : 0) + '%', background: 'var(--red)' })}></i>
                      </div>
                      <span class="mono">${d.total ? ((d.rework / d.total) * 100).toFixed(0) : 0}%</span>
                    </td>
                  </tr>`}<//>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div class="stack">
        <section class="card">
          <div class="card-hd"><h3>返工率环形图</h3></div>
          <div class="card-bd" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
            <canvas ref=${el => (donutCanvas = el)} style="width:200px;height:200px"></canvas>
            <div class="legend" style="flex-direction:column;display:flex;gap:8px">
              <span><i style="background:#1f9d57"></i>一次送检合格</span>
              <span><i style="background:#d9382e"></i>返工送检</span>
              <span class="muted" style="font-size:12px">返工率 = 累计打回次数 ÷ 累计提交次数</span>
            </div>
          </div>
        </section>
        <section class="card">
          <div class="card-hd"><h3>工单状态分布</h3></div>
          <div class="card-bd">
            <div class="stack">
              <${For} each=${() => statusBreakdown()}>${s => html`
                <div>
                  <div class="row spread" style="margin-bottom:4px">
                    <span class=${() => 'badge ' + s.key}>${s.label}</span>
                    <b class="mono">${() => s.n}</b>
                  </div>
                  <div class="progress">
                    <i style=${() => ({ width: (stats().total ? (s.n / stats().total) * 100 : 0) + '%' })}></i>
                  </div>
                </div>`}<//>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
}
