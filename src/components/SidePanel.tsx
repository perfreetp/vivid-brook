// ---------- 侧栏: 工具 / 参数 / 图层 / 统计 / 流程 / 导出 ----------

import { Show, For, createMemo } from 'solid-js';
import {
  store, setStore, tool, setTool, role, setRole, selectedId, selectedKind, setSelectedId, setSelectedKind,
  env, setEnv, exposure, setExposure, gamma, setGamma, layers, setLayers, result,
  annotText, setAnnotText, reviewText, setReviewText, editable, persist, addComment, resetDemo, computing,
} from '../model/store';
import { STATUS_LABEL, ROLE_LABEL, LIGHT_TYPE_LABEL, uid, nowStr } from '../model/types';
import type { Role, Status } from '../model/types';
import { DARK_LUX } from '../engine/lighting';

function Row(props: { label: string; children: any }) {
  return (
    <div class="row">
      <span class="row-label">{props.label}</span>
      <div class="row-body">{props.children}</div>
    </div>
  );
}

function Slider(props: { min: number; max: number; step: number; value: number; onInput: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div class="slider-wrap">
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value}
        onInput={(e) => props.onInput(parseFloat(e.currentTarget.value))} />
      <span class="slider-val">{props.fmt ? props.fmt(props.value) : props.value}</span>
    </div>
  );
}

export function SidePanel() {
  const selBuilding = createMemo(() => store.scene.buildings.find(b => b.id === selectedId()));
  const selLight = createMemo(() => store.scene.lights.find(l => l.id === selectedId()));
  const selBlock = createMemo(() => store.scene.blocks.find(b => b.id === selectedId()));

  const canAnnotate = createMemo(() => store.status === 'published');

  function doSubmit() {
    setStore('status', 'review');
    addComment('方案提交送审', '提交送审');
    persist();
  }
  function doApprove() {
    setStore('status', 'published');
    addComment(reviewText().trim() || '审查通过, 进入公示', '通过并公示');
    setReviewText('');
    persist();
  }
  function doReturn() {
    const t = reviewText().trim();
    if (!t) { alert('退回必须填写审查意见'); return; }
    setStore('status', 'draft');
    addComment(t, '退回修改');
    setReviewText('');
    persist();
  }

  function exportPNG() {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `效果图_${store.status}_${Date.now()}.png`;
    a.click();
  }

  function exportCSV() {
    const res = result();
    if (!res) return;
    const lines: string[] = [];
    lines.push('项目,数值');
    lines.push(`太阳高度角(度),${res.sunAltDeg.toFixed(1)}`);
    lines.push(`太阳方位角(度),${res.sunAzDeg.toFixed(1)}`);
    lines.push(`暗区阈值(lx),${DARK_LUX}`);
    lines.push(`暗区块数,${res.zones.length}`);
    lines.push(`暗区总面积(m2),${res.darkArea}`);
    lines.push('');
    lines.push('街坊,面积(m2),平均照度(lx),暗区面积(m2),暗区占比(%)');
    for (const b of res.blockStats) {
      lines.push(`${b.name},${b.cells},${b.avgLux.toFixed(1)},${b.darkCells},${(b.darkRatio * 100).toFixed(1)}`);
    }
    lines.push('');
    lines.push('暗区编号,面积(m2),中心X(m),中心Y(m)');
    for (const z of res.zones) {
      lines.push(`${z.id},${z.area},${z.cx.toFixed(1)},${z.cy.toFixed(1)}`);
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `照度统计_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify({ scene: store.scene }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `方案_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJSON(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const s = data.scene ?? data;
        if (!Array.isArray(s.buildings) || !Array.isArray(s.lights)) throw new Error('bad');
        setStore('scene', {
          buildings: s.buildings, lights: s.lights,
          blocks: Array.isArray(s.blocks) ? s.blocks : [],
          annotations: Array.isArray(s.annotations) ? s.annotations : [],
        });
        persist();
      } catch {
        alert('导入失败: 文件格式不正确');
      }
    };
    reader.readAsText(file);
    (e.currentTarget as HTMLInputElement).value = '';
  }

  const toolBtn = (id: typeof tool extends () => infer T ? T : never, label: string, needEdit = true) => (
    <button
      class={`tool-btn ${tool() === id ? 'active' : ''}`}
      disabled={needEdit && !editable() && !(id === 'annotate' && canAnnotate())}
      onClick={() => setTool(tool() === id ? 'select' : id)}
    >{label}</button>
  );

  return (
    <div class="panel">
      <h1>历史街区日照与夜间照明校核</h1>

      {/* ---- 方案状态 ---- */}
      <section>
        <h2>方案流程 <span class={`badge st-${store.status}`}>{STATUS_LABEL[store.status]}</span></h2>
        <Row label="当前角色">
          <select value={role()} onChange={(e) => setRole(e.currentTarget.value as Role)}>
            <For each={Object.entries(ROLE_LABEL) as [Role, string][]}>
              {([v, l]) => <option value={v}>{l}</option>}
            </For>
          </select>
        </Row>
        <Show when={store.status === 'draft' && role() === 'planner'}>
          <button class="primary" onClick={doSubmit}>提交送审</button>
        </Show>
        <Show when={store.status === 'review' && role() === 'reviewer'}>
          <textarea placeholder="审查意见(退回必填)…" value={reviewText()} onInput={(e) => setReviewText(e.currentTarget.value)} />
          <div class="btn-row">
            <button class="primary" onClick={doApprove}>通过并公示</button>
            <button class="danger" onClick={doReturn}>退回修改</button>
          </div>
        </Show>
        <Show when={store.status === 'review' && role() !== 'reviewer'}>
          <p class="hint">方案送审中, 等待审查人处理(切换到审查人角色操作)。</p>
        </Show>
        <Show when={store.status === 'published'}>
          <p class="hint">方案公示中: 场景只读, 可在地图上放置批注。</p>
        </Show>
        <Show when={store.comments.length > 0}>
          <div class="comments">
            <For each={store.comments}>
              {(c) => (
                <div class="comment">
                  <b>[{c.action}]</b> {c.text}
                  <span class="comment-meta">{c.author} · {c.time}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>

      {/* ---- 工具 ---- */}
      <section>
        <h2>绘制与布光</h2>
        <div class="tool-grid">
          {toolBtn('select', '选择/拖动', false)}
          {toolBtn('draw-building', '画建筑轮廓')}
          {toolBtn('draw-block', '画街坊边界')}
          {toolBtn('add-street', '＋路灯')}
          {toolBtn('add-courtyard', '＋庭院灯')}
          {toolBtn('add-wall', '＋洗墙灯')}
        </div>
        <Show when={tool() === 'draw-building' || tool() === 'draw-block'}>
          <p class="hint">单击加点, Enter 或双击闭合, Esc 取消。</p>
        </Show>
        <Show when={!editable() && store.status !== 'published'}>
          <p class="hint">当前状态/角色为只读, 仅可查看。</p>
        </Show>
        <Show when={canAnnotate()}>
          <div class="annot-box">
            <input type="text" placeholder="批注内容…" value={annotText()} onInput={(e) => setAnnotText(e.currentTarget.value)} />
            {toolBtn('annotate', '放置批注', false)}
          </div>
        </Show>
        <Show when={store.scene.annotations.length > 0}>
          <div class="comments">
            <For each={store.scene.annotations}>
              {(a, i) => (
                <div class="comment">
                  <b>#{i() + 1}</b> {a.text}
                  <span class="comment-meta">{a.author} · {a.time}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>

      {/* ---- 时间与太阳 ---- */}
      <section>
        <h2>日照条件</h2>
        <Row label="日期">
          <div class="btn-row">
            <button class={env().date === 'summer' ? 'active-btn' : ''} onClick={() => setEnv({ ...env(), date: 'summer' })}>夏至</button>
            <button class={env().date === 'winter' ? 'active-btn' : ''} onClick={() => setEnv({ ...env(), date: 'winter' })}>冬至</button>
          </div>
        </Row>
        <Row label="时间">
          <Slider min={9} max={21} step={0.25} value={env().hour}
            onInput={(v) => setEnv({ ...env(), hour: v })}
            fmt={(v) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`} />
        </Row>
        <Row label="纬度">
          <Slider min={20} max={45} step={0.1} value={env().latitude}
            onInput={(v) => setEnv({ ...env(), latitude: v })} fmt={(v) => `${v.toFixed(1)}°N`} />
        </Row>
        <Show when={result()}>
          {(r) => (
            <p class="hint">
              {r().night ? '🌙 夜间(太阳落山)' : `☀ 太阳高度角 ${r().sunAltDeg.toFixed(1)}°, 方位角 ${r().sunAzDeg.toFixed(1)}°, 直射照度约 ${(r().sunLux / 1000).toFixed(0)}k lx`}
            </p>
          )}
        </Show>
      </section>

      {/* ---- 选中对象 ---- */}
      <Show when={selBuilding()}>
        {(b) => (
          <section>
            <h2>建筑: {b().name}</h2>
            <Row label="名称">
              <input type="text" value={b().name} disabled={!editable()}
                onInput={(e) => { const i = store.scene.buildings.findIndex(x => x.id === b().id); setStore('scene', 'buildings', i, 'name', e.currentTarget.value); persist(); }} />
            </Row>
            <Row label="层数">
              <Slider min={1} max={9} step={1} value={b().floors}
                onInput={(v) => { if (!editable()) return; const i = store.scene.buildings.findIndex(x => x.id === b().id); setStore('scene', 'buildings', i, 'floors', v); persist(); }}
                fmt={(v) => `${v} 层(${v * 3}m)`} />
            </Row>
            <Show when={editable()}>
              <button class="danger" onClick={() => { setStore('scene', 'buildings', store.scene.buildings.filter(x => x.id !== b().id)); setSelectedId(null); persist(); }}>删除建筑</button>
            </Show>
          </section>
        )}
      </Show>

      <Show when={selLight()}>
        {(l) => (
          <section>
            <h2>{LIGHT_TYPE_LABEL[l().type]}: {l().name}</h2>
            <Row label="开关">
              <label class="chk"><input type="checkbox" checked={l().on} disabled={!editable()}
                onChange={(e) => { const i = store.scene.lights.findIndex(x => x.id === l().id); setStore('scene', 'lights', i, 'on', e.currentTarget.checked); persist(); }} /> 点亮</label>
            </Row>
            <Row label="挂高">
              <Slider min={1} max={12} step={0.5} value={l().height}
                onInput={(v) => { if (!editable()) return; const i = store.scene.lights.findIndex(x => x.id === l().id); setStore('scene', 'lights', i, 'height', v); persist(); }}
                fmt={(v) => `${v} m`} />
            </Row>
            <Row label="半径">
              <Slider min={3} max={30} step={0.5} value={l().radius}
                onInput={(v) => { if (!editable()) return; const i = store.scene.lights.findIndex(x => x.id === l().id); setStore('scene', 'lights', i, 'radius', v); persist(); }}
                fmt={(v) => `${v} m`} />
            </Row>
            <Row label="色温">
              <Slider min={1800} max={6500} step={100} value={l().kelvin}
                onInput={(v) => { if (!editable()) return; const i = store.scene.lights.findIndex(x => x.id === l().id); setStore('scene', 'lights', i, 'kelvin', v); persist(); }}
                fmt={(v) => `${v} K`} />
            </Row>
            <Row label="强度">
              <Slider min={0} max={5000} step={50} value={l().intensity}
                onInput={(v) => { if (!editable()) return; const i = store.scene.lights.findIndex(x => x.id === l().id); setStore('scene', 'lights', i, 'intensity', v); persist(); }}
                fmt={(v) => `${v}`} />
            </Row>
            <Show when={editable()}>
              <button class="danger" onClick={() => { setStore('scene', 'lights', store.scene.lights.filter(x => x.id !== l().id)); setSelectedId(null); persist(); }}>删除光源</button>
            </Show>
          </section>
        )}
      </Show>

      <Show when={selBlock()}>
        {(b) => (
          <section>
            <h2>街坊: {b().name}</h2>
            <Row label="名称">
              <input type="text" value={b().name} disabled={!editable()}
                onInput={(e) => { const i = store.scene.blocks.findIndex(x => x.id === b().id); setStore('scene', 'blocks', i, 'name', e.currentTarget.value); persist(); }} />
            </Row>
            <Show when={editable()}>
              <button class="danger" onClick={() => { setStore('scene', 'blocks', store.scene.blocks.filter(x => x.id !== b().id)); setSelectedId(null); persist(); }}>删除街坊</button>
            </Show>
          </section>
        )}
      </Show>

      {/* ---- 图层 ---- */}
      <section>
        <h2>图层</h2>
        <div class="layer-grid">
          <label class="chk"><input type="checkbox" checked={layers.buildings} onChange={(e) => setLayers('buildings', e.currentTarget.checked)} /> 建筑</label>
          <label class="chk"><input type="checkbox" checked={layers.spots} onChange={(e) => setLayers('spots', e.currentTarget.checked)} /> 光斑</label>
          <label class="chk"><input type="checkbox" checked={layers.heat} onChange={(e) => setLayers('heat', e.currentTarget.checked)} /> 热力图</label>
          <label class="chk"><input type="checkbox" checked={layers.grid} onChange={(e) => setLayers('grid', e.currentTarget.checked)} /> 1m网格</label>
          <label class="chk"><input type="checkbox" checked={layers.blocks} onChange={(e) => setLayers('blocks', e.currentTarget.checked)} /> 街坊边界</label>
          <label class="chk"><input type="checkbox" checked={layers.annotations} onChange={(e) => setLayers('annotations', e.currentTarget.checked)} /> 批注</label>
          <label class="chk"><input type="checkbox" checked={layers.values} onChange={(e) => setLayers('values', e.currentTarget.checked)} /> 格值(放大)</label>
        </div>
        <Row label="曝光">
          <Slider min={0.1} max={4} step={0.05} value={exposure()} onInput={setExposure} fmt={(v) => v.toFixed(2)} />
        </Row>
        <Row label="伽马">
          <Slider min={1} max={3} step={0.05} value={gamma()} onInput={setGamma} fmt={(v) => v.toFixed(2)} />
        </Row>
      </section>

      {/* ---- 暗区分析 ---- */}
      <Show when={result()}>
        {(r) => (
          <section>
            <h2>暗区分析(阈值 {DARK_LUX}lx) {computing() ? '…' : ''}</h2>
            <p>
              暗区块数: <b class="dark-num">{r().zones.length}</b> 处,
              暗区总面积: <b class="dark-num">{r().darkArea}</b> m²
            </p>
            <Show when={r().zones.length > 0}>
              <table>
                <thead><tr><th>#</th><th>面积(m²)</th><th>中心位置</th></tr></thead>
                <tbody>
                  <For each={r().zones.slice(0, 8)}>
                    {(z) => <tr><td>{z.id}</td><td>{z.area}</td><td>({z.cx.toFixed(0)}, {z.cy.toFixed(0)})</td></tr>}
                  </For>
                </tbody>
              </table>
              <Show when={r().zones.length > 8}><p class="hint">…共 {r().zones.length} 处, 详见导出 CSV</p></Show>
            </Show>
          </section>
        )}
      </Show>

      {/* ---- 街坊统计 ---- */}
      <Show when={result() && result()!.blockStats.length > 0}>
        <section>
          <h2>街坊照度统计</h2>
          <table>
            <thead><tr><th>街坊</th><th>平均照度</th><th>暗区占比</th></tr></thead>
            <tbody>
              <For each={result()!.blockStats}>
                {(b) => (
                  <tr>
                    <td>{b.name}</td>
                    <td>{b.avgLux >= 1000 ? (b.avgLux / 1000).toFixed(1) + 'k' : b.avgLux.toFixed(1)} lx</td>
                    <td class={b.darkRatio > 0.2 ? 'dark-num' : ''}>{(b.darkRatio * 100).toFixed(1)}%</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </section>
      </Show>

      {/* ---- 数据 ---- */}
      <section>
        <h2>数据与导出</h2>
        <div class="btn-row wrap">
          <button onClick={exportPNG}>导出效果图 PNG</button>
          <button onClick={exportCSV}>导出照度统计 CSV</button>
          <button onClick={exportJSON}>导出方案 JSON</button>
          <label class="import-label">
            导入方案 JSON
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={importJSON} />
          </label>
          <button class="danger" onClick={() => { if (confirm('重置为示例方案?')) resetDemo(); }}>重置示例</button>
        </div>
      </section>
    </div>
  );
}
