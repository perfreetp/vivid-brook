import type { AppState } from '../lib/store';
import { store } from '../lib/store';
import { BaseElement } from '../lib/base';
import { cctToColor, suggestPoleHeight } from '../lib/photometry';
import { DIM_THRESHOLD } from '../lib/engine';
import type { Lamp, PlanVersion } from '../types';
import { exportLedgerCsv, importJsonFile } from '../lib/exporter';

export class SidePanel extends BaseElement {
  template(): string {
    return `
      <style>
        :host { display:flex; flex-direction:column; height:100%; background:var(--panel); }
        .tabs { display:flex; border-bottom:1px solid var(--line); }
        .tabs button { flex:1; border:none; border-radius:0; background:transparent;
          padding:10px 4px; color:var(--muted); border-bottom:2px solid transparent; }
        .tabs button.active { color:var(--text); border-bottom-color:var(--accent); }
        .body { flex:1; overflow:auto; padding:10px; }
        .toolbar { display:flex; gap:6px; flex-wrap:wrap; padding:8px 10px; border-bottom:1px solid var(--line); }
        .card { background:var(--panel-2); border:1px solid var(--line); border-radius:8px;
          padding:10px; margin-bottom:10px; }
        .row { display:grid; grid-template-columns:88px 1fr; gap:6px 8px; align-items:center; margin:6px 0; }
        .row.check { grid-template-columns:88px repeat(3,1fr); }
        .row.check label { display:flex; align-items:center; gap:4px; }
        .row.range span { font-size:11px; color:var(--accent-2); }
        .lamp-item { display:flex; justify-content:space-between; align-items:center;
          padding:7px 8px; border:1px solid var(--line); border-radius:7px; margin-bottom:6px; cursor:pointer; }
        .lamp-item.sel { border-color:var(--accent); background:rgba(77,163,255,.08); }
        .lamp-item.off { opacity:.5; }
        .dot { width:10px; height:10px; border-radius:50%; display:inline-block; margin-right:6px; }
        .dim-row { cursor:pointer; }
        .dim-row:hover { background:rgba(255,93,93,.08); }
        h4 { margin:4px 0 8px; font-size:13px; }
        .hint { color:var(--muted); font-size:11px; line-height:1.6; }
        .ver { border-left:3px solid var(--line); padding-left:10px; margin-bottom:12px; }
        .ver.approved { border-left-color:var(--ok); }
        .ver.rejected { border-left-color:var(--danger); }
        .comment { background:var(--bg); border-radius:6px; padding:6px 8px; margin:6px 0; font-size:12px; }
        .mini { font-size:11px; padding:2px 7px; }
      </style>
      <div class="tabs">
        <button data-tab="lamps">灯具</button>
        <button data-tab="dim">低照度</button>
        <button data-tab="ledger">台账</button>
        <button data-tab="review">审核</button>
      </div>
      <div id="content" class="body"></div>
    `;
  }

  mount(): void {
    this.$all('.tabs button').forEach((b) =>
      b.addEventListener('click', () => store.setPanel((b as HTMLElement).dataset.tab as AppState['activePanel'])),
    );
  }

  onState(state: AppState): void {
    this.$all('.tabs button').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.tab === state.activePanel);
    });
    const host = this.$('#content')!;
    if (state.activePanel === 'lamps') host.innerHTML = this.lampsTab(state);
    else if (state.activePanel === 'dim') host.innerHTML = this.dimTab(state);
    else if (state.activePanel === 'ledger') host.innerHTML = this.ledgerTab(state);
    else host.innerHTML = this.reviewTab(state);
    this.bind(state);
  }

  // ---------- 灯具 ----------
  private lampsTab(state: AppState): string {
    const { project, schedule } = state;
    const items = project.lamps
      .map((l) => {
        const model = project.lampModels.find((m) => m.id === l.modelId);
        const on = l.schedule[schedule];
        const sel = state.selectedLampId === l.id ? 'sel' : '';
        return `
        <div class="lamp-item ${sel} ${on ? '' : 'off'}" data-pick="${l.id}">
          <div><span class="dot" style="background:${on ? cctToColor(l.cct) : '#55606e'}"></span>
            <b>${l.id.replace('lamp-', '灯具 L')}</b>
            <div class="hint">${model?.name ?? l.modelId} · ${l.power.toFixed(0)}W · ${l.cct}K · 光束${l.beamAngle}°</div>
          </div>
          <button class="mini danger" data-del="${l.id}">删</button>
        </div>`;
      })
      .join('');
    return `
      <div class="card">
        <div class="hint">双击地图空白处可新增灯具；拖动灯位自动吸附步道中线。当前策略：<b>${scheduleName(schedule)}</b></div>
      </div>
      ${items || '<div class="hint">暂无灯具，双击地图添加。</div>'}
      <div id="editor"></div>
    `;
  }

  private editorHtml(state: AppState, lamp: Lamp): string {
    const model = state.project.lampModels.find((m) => m.id === lamp.modelId);
    const suggested = suggestPoleHeight(lamp, state.project);
    const actual = lamp.poleHeightOverride ?? suggested;
    const auto = lamp.poleHeightOverride === null;
    return `
    <div class="card">
      <h4>灯具参数 · ${lamp.id.replace('lamp-', 'L')}</h4>
      <div class="row"><label>型号</label>
        <select data-f="model">
          ${state.project.lampModels.map((m) => `<option value="${m.id}" ${m.id === lamp.modelId ? 'selected' : ''}>${m.name}（${m.ratedPower}W）</option>`).join('')}
        </select></div>
      <div class="row range"><label>功率 W</label>
        <div><input type="range" min="5" max="${model?.ratedPower ?? 100}" step="1" data-f="power" value="${lamp.power}">
        <span id="power-val">${lamp.power.toFixed(0)} / ${model?.ratedPower ?? '-'}</span></div></div>
      <div class="row"><label>色温 K</label>
        <select data-f="cct">${(model?.cctOptions ?? [lamp.cct]).map((c) => `<option ${c === lamp.cct ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="row"><label>光束角 °</label>
        <select data-f="beam">${(model?.beamOptions ?? [lamp.beamAngle]).map((c) => `<option ${c === lamp.beamAngle ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="row range"><label>遮光角 °</label>
        <div><input type="range" min="20" max="89" step="1" data-f="shield" value="${lamp.shieldAngle}">
        <span id="shield-val">${lamp.shieldAngle}°（与下垂线夹角上限）</span></div></div>
      <div class="row"><label>投射方向</label>
        <div>
          <label style="display:flex;gap:4px;align-items:center;margin-bottom:4px">
            <input type="checkbox" data-f="vertical" ${lamp.aimAzimuth === null ? 'checked' : ''}> 垂直向下
          </label>
          <input type="range" min="0" max="359" step="1" data-f="azimuth" value="${lamp.aimAzimuth ?? 0}" ${lamp.aimAzimuth === null ? 'disabled' : ''}>
          <span class="hint">方位角 ${lamp.aimAzimuth ?? 0}°（0=东，逆时针）</span>
        </div></div>
      <div class="row range"><label>俯角 °</label>
        <div><input type="range" min="10" max="90" step="1" data-f="tilt" value="${lamp.aimTilt}" ${lamp.aimAzimuth === null ? 'disabled' : ''}>
        <span id="tilt-val">${lamp.aimTilt}°（90=垂直）</span></div></div>
      <div class="row range"><label>灯杆高度 m</label>
        <div><input type="range" min="4" max="10" step="0.1" data-f="pole" value="${actual}" ${auto ? 'disabled' : ''}>
        <span id="pole-val">${actual.toFixed(1)}${auto ? `（按台阶高差自动：${suggested.toFixed(1)}）` : '（手动）'}</span></div></div>
      <div class="row"><label>高度模式</label>
        <label style="display:flex;gap:4px;align-items:center">
          <input type="checkbox" data-f="auto" ${auto ? 'checked' : ''}> 自动建议（台阶高差联动）
        </label></div>
      <div class="row check"><label>开关策略</label>
        <label><input type="checkbox" data-f="sch-weekday" ${lamp.schedule.weekday ? 'checked' : ''}>平日</label>
        <label><input type="checkbox" data-f="sch-festival" ${lamp.schedule.festival ? 'checked' : ''}>节日</label>
        <label><input type="checkbox" data-f="sch-lateNight" ${lamp.schedule.lateNight ? 'checked' : ''}>深夜</label>
      </div>
      <div class="hint">桩号 ${(lamp.station * 100).toFixed(1)}% · 地面高程 ${lamp.groundZ.toFixed(2)}m ·
        光源尺寸 ${model?.sourceSize ? `${model.sourceSize}m（多采样半影）` : '点光源'}</div>
    </div>`;
  }

  // ---------- 低照度 ----------
  private dimTab(state: AppState): string {
    const r = state.result;
    if (!r) return '<div class="hint">计算中…</div>';
    const rows = r.dimZones
      .map(
        (z) => `
      <tr class="dim-row" data-locate="${z.id}">
        <td>${z.id.replace('dim-', '区')}</td>
        <td class="danger-text">${z.areaM2.toFixed(1)} ㎡</td>
        <td>${z.minLux.toFixed(2)}</td>
        <td>${z.meanLux.toFixed(2)}</td>
        <td>(${z.centroid[0].toFixed(1)}, ${z.centroid[1].toFixed(1)})</td>
      </tr>`,
      )
      .join('');
    return `
      <div class="card">
        <h4>步道照度评价（当前：${scheduleName(state.schedule)}）</h4>
        <table>
          <tr><th>指标</th><th>数值</th></tr>
          <tr><td>评价网格数（1㎡）</td><td>${r.stats.trailCells}</td></tr>
          <tr><td>平均照度</td><td>${r.stats.meanTrailLux.toFixed(2)} lx</td></tr>
          <tr><td>最小照度</td><td class="${r.stats.minTrailLux < DIM_THRESHOLD ? 'danger-text' : 'ok-text'}">${r.stats.minTrailLux.toFixed(2)} lx</td></tr>
          <tr><td>均匀度（均/最小）</td><td>${Number.isFinite(r.stats.uniformity) ? r.stats.uniformity.toFixed(2) : '—'}</td></tr>
          <tr><td>低于${DIM_THRESHOLD}lx 面积</td><td class="danger-text">${r.stats.dimCells.toFixed(1)} ㎡</td></tr>
          <tr><td>点亮灯具 / 总功率</td><td>${r.stats.activeLamps} 盏 / ${r.stats.totalPower.toFixed(0)} W</td></tr>
        </table>
      </div>
      <h4>低于 ${DIM_THRESHOLD} lx 区域（点击定位）</h4>
      <table><thead><tr><th>编号</th><th>面积</th><th>最低 lx</th><th>均值 lx</th><th>中心坐标</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="ok-text">全部区域达标</td></tr>'}</tbody></table>
    `;
  }

  // ---------- 台账 ----------
  private ledgerTab(state: AppState): string {
    const rows = state.project.lampModels
      .map((m) => {
        const used = state.project.lamps.filter((l) => l.modelId === m.id);
        const totalP = used.reduce((s, l) => s + l.power, 0);
        return `
        <tr>
          <td>${m.id}</td><td>${m.manufacturer}</td><td>${m.name}</td>
          <td>${m.ratedPower}</td><td>${m.efficacy}</td><td>${m.ip}</td>
          <td>${m.sourceSize ? `${m.sourceSize}m` : '点光源'}</td>
          <td><b>${used.length}</b></td><td>${totalP.toFixed(0)}</td>
        </tr>`;
      })
      .join('');
    return `
      <div class="card">
        <h4>灯具型号库与台账</h4>
        <div class="toolbar" style="padding:0 0 8px;border:none">
          <button id="export-ledger">导出台账 CSV</button>
          <button id="import-models">导入型号库 JSON</button>
          <input type="file" id="model-file" accept=".json,application/json" hidden>
        </div>
        <table><thead><tr>
          <th>编号</th><th>厂商</th><th>名称</th><th>额定W</th><th>lm/W</th><th>防护</th><th>光源</th><th>数量</th><th>实际总功率W</th>
        </tr></thead><tbody>${rows}</tbody></table>
        <div class="hint" style="margin-top:8px">型号库字段：id, manufacturer, name, ratedPower, efficacy, cctOptions, beamOptions, defaultCct, defaultBeam, sourceSize, ip</div>
      </div>
      <div class="card">
        <h4>逐灯安装台账</h4>
        <table><thead><tr><th>灯具</th><th>型号</th><th>杆高m</th><th>功率W</th><th>色温</th><th>光束/遮光</th><th>桩号</th></tr></thead>
        <tbody>${state.project.lamps
          .map((l) => {
            const h = l.poleHeightOverride ?? suggestPoleHeight(l, state.project);
            return `<tr data-pick2="${l.id}" style="cursor:pointer">
              <td>${l.id.replace('lamp-', 'L')}</td><td>${l.modelId}</td><td>${h.toFixed(1)}</td>
              <td>${l.power.toFixed(0)}</td><td>${l.cct}</td><td>${l.beamAngle}°/${l.shieldAngle}°</td>
              <td>${(l.station * 100).toFixed(1)}%</td></tr>`;
          })
          .join('')}</tbody></table>
      </div>`;
  }

  // ---------- 审核 ----------
  private reviewTab(state: AppState): string {
    const versions = state.versions
      .map((v) => this.versionCard(v))
      .join('');
    return `
      <div class="card">
        <h4>方案提交与审核</h4>
        <div class="hint">提交后锁定当前灯具布置为一个版本，照明审核人可通过或退回，审核意见挂在版本上。</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="primary" id="submit-plan">提交方案审核</button>
        </div>
      </div>
      ${versions || '<div class="hint">尚无版本记录。</div>'}
    `;
  }

  private versionCard(v: PlanVersion): string {
    const tag =
      v.status === 'approved'
        ? '<span class="tag ok">已通过</span>'
        : v.status === 'rejected'
          ? '<span class="tag reject">已退回</span>'
          : '<span class="tag wait">待审核</span>';
    const comments = v.comments
      .map(
        (c) => `<div class="comment"><b>${c.author}</b>（${c.role === 'reviewer' ? '审核人' : '设计师'}）
          <span class="muted">${new Date(c.at).toLocaleString('zh-CN')}</span><br>${c.text}</div>`,
      )
      .join('');
    return `
    <div class="ver ${v.status}">
      <div><b>${v.label}</b> ${tag} <span class="muted">${new Date(v.at).toLocaleString('zh-CN')} · ${v.author} · ${v.lamps.length} 盏灯</span></div>
      ${comments}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        ${v.status === 'submitted' ? `
          <button class="mini primary" data-approve="${v.id}">审核通过</button>
          <button class="mini danger" data-reject="${v.id}">退回修改</button>` : ''}
        <button class="mini" data-restore="${v.id}">恢复此版本布置</button>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <input placeholder="审核/设计意见…" data-comment-input="${v.id}">
        <button class="mini" data-comment-add="${v.id}">留言</button>
      </div>
    </div>`;
  }

  // ---------- 事件绑定 ----------
  private bind(state: AppState): void {
    this.$all('[data-pick]').forEach((n) =>
      n.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).dataset.del) return;
        store.selectLamp((n as HTMLElement).dataset.pick!);
      }),
    );
    this.$all('[data-del]').forEach((n) =>
      n.addEventListener('click', (ev) => {
        ev.stopPropagation();
        store.removeLamp((n as HTMLElement).dataset.del!);
      }),
    );
    this.$all('[data-pick2]').forEach((n) =>
      n.addEventListener('click', () => {
        const id = (n as HTMLElement).dataset.pick2!;
        const lamp = state.project.lamps.find((l) => l.id === id);
        if (lamp) {
          store.selectLamp(id);
          store.locate(lamp.x, lamp.y);
          store.setPanel('lamps');
        }
      }),
    );
    this.$all('[data-locate]').forEach((n) =>
      n.addEventListener('click', () => {
        const z = state.result?.dimZones.find((x) => x.id === (n as HTMLElement).dataset.locate);
        if (z) store.locate(z.centroid[0], z.centroid[1]);
      }),
    );

    // 编辑器
    const lamp = state.project.lamps.find((l) => l.id === state.selectedLampId);
    const editorHost = this.$('#editor');
    if (lamp && editorHost) {
      editorHost.innerHTML = this.editorHtml(state, lamp);
      this.bindEditor(state, lamp);
    }

    const exportBtn = this.$('#export-ledger');
    if (exportBtn) exportBtn.addEventListener('click', () => exportLedgerCsv(state.project));
    const importBtn = this.$('#import-models');
    const fileInput = this.$('#model-file') as HTMLInputElement | null;
    if (importBtn && fileInput) {
      importBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => importJsonFile(fileInput, 'models', store));
    }

    this.$('#submit-plan')?.addEventListener('click', () => store.submitPlan());
    this.$all('[data-approve]').forEach((n) =>
      n.addEventListener('click', () => {
        const text = prompt('审核通过意见（可留空）', '照度满足步道夜间通行要求，同意通过。') ?? '';
        store.reviewVersion((n as HTMLElement).dataset.approve!, true, text);
      }),
    );
    this.$all('[data-reject]').forEach((n) =>
      n.addEventListener('click', () => {
        const text = prompt('退回原因') ?? '';
        if (text.trim()) store.reviewVersion((n as HTMLElement).dataset.reject!, false, text);
      }),
    );
    this.$all('[data-restore]').forEach((n) =>
      n.addEventListener('click', () => store.restoreVersion((n as HTMLElement).dataset.restore!)),
    );
    this.$all('[data-comment-add]').forEach((n) =>
      n.addEventListener('click', () => {
        const id = (n as HTMLElement).dataset.commentAdd!;
        const input = this.$(`[data-comment-input="${id}"]`) as HTMLInputElement;
        if (input?.value.trim()) {
          store.addVersionComment(id, input.value.trim(), '设计师', 'designer');
        }
      }),
    );
  }

  private bindEditor(state: AppState, lamp: Lamp): void {
    const id = lamp.id;
    this.$('[data-f="model"]')?.addEventListener('change', (ev) =>
      store.changeModel(id, (ev.target as HTMLSelectElement).value),
    );
    this.$('[data-f="power"]')?.addEventListener('input', (ev) => {
      const v = Number((ev.target as HTMLInputElement).value);
      this.$('#power-val')!.textContent = `${v.toFixed(0)} W`;
      store.updateLamp(id, { power: v });
    });
    this.$('[data-f="cct"]')?.addEventListener('change', (ev) =>
      store.updateLamp(id, { cct: Number((ev.target as HTMLSelectElement).value) }),
    );
    this.$('[data-f="beam"]')?.addEventListener('change', (ev) =>
      store.updateLamp(id, { beamAngle: Number((ev.target as HTMLSelectElement).value) }),
    );
    this.$('[data-f="shield"]')?.addEventListener('input', (ev) => {
      const v = Number((ev.target as HTMLInputElement).value);
      this.$('#shield-val')!.textContent = `${v}°（与下垂线夹角上限）`;
      store.updateLamp(id, { shieldAngle: v });
    });
    this.$('[data-f="tilt"]')?.addEventListener('input', (ev) => {
      const v = Number((ev.target as HTMLInputElement).value);
      this.$('#tilt-val')!.textContent = `${v}°（90=垂直）`;
      store.updateLamp(id, { aimTilt: v });
    });
    this.$('[data-f="azimuth"]')?.addEventListener('input', (ev) =>
      store.updateLamp(id, { aimAzimuth: Number((ev.target as HTMLInputElement).value) }),
    );
    this.$('[data-f="vertical"]')?.addEventListener('change', (ev) => {
      const checked = (ev.target as HTMLInputElement).checked;
      store.updateLamp(id, { aimAzimuth: checked ? null : lamp.aimAzimuth ?? 0 });
    });
    this.$('[data-f="pole"]')?.addEventListener('input', (ev) => {
      store.updateLamp(id, { poleHeightOverride: Number((ev.target as HTMLInputElement).value) });
    });
    this.$('[data-f="auto"]')?.addEventListener('change', (ev) => {
      const checked = (ev.target as HTMLInputElement).checked;
      store.updateLamp(id, { poleHeightOverride: checked ? null : suggestPoleHeight(lamp, state.project) });
    });
    const sch = (key: keyof Lamp['schedule'], sel: string) =>
      this.$(sel)?.addEventListener('change', (ev) =>
        store.updateLamp(id, { schedule: { ...lamp.schedule, [key]: (ev.target as HTMLInputElement).checked } }),
      );
    sch('weekday', '[data-f="sch-weekday"]');
    sch('festival', '[data-f="sch-festival"]');
    sch('lateNight', '[data-f="sch-lateNight"]');
  }
}

export function scheduleName(key: AppState['schedule']): string {
  return key === 'weekday' ? '平日策略' : key === 'festival' ? '节日策略' : '深夜策略（半功率）';
}
