import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { GalleryRenderer } from '../lib/renderer';
import { buildModel, diffModels } from '../lib/model';
import { ui } from '../store';
import { PROFESSIONS, CHAMBERS } from '../lib/constants';

function readQuery() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  return {
    a: +(q.get('a') || ui.versions[0].vid),
    b: +(q.get('b') || ui.versions[ui.versions.length - 1].vid),
  };
}

export default function ComparePage() {
  let canvasA, canvasB;
  let ra, rb;
  const init = readQuery();
  const [va, setVa] = createSignal(init.a);
  const [vb, setVb] = createSignal(init.b);
  const [diffPickA, setDiffPickA] = createSignal(0);
  const [diffPickB, setDiffPickB] = createSignal(0);
  const [filter, setFilter] = createSignal('all');

  const modelA = createMemo(() => buildModel(ui.versions.find((v) => v.vid === va())));
  const modelB = createMemo(() => buildModel(ui.versions.find((v) => v.vid === vb())));
  const diff = createMemo(() => diffModels(modelA(), modelB()));

  // 差异 id 集合，用于着色器高亮（通过拾取 id 反查）
  const diffIndex = createMemo(() => {
    const d = diff();
    const mapA = new Map(), mapB = new Map();
    d.removed.forEach((el) => mapA.set(el.id, 'del'));
    d.added.forEach((el) => mapB.set(el.id, 'add'));
    d.changed.forEach((c) => { mapA.set(c.id, 'chg'); mapB.set(c.id, 'chg'); });
    return { mapA, mapB };
  });

  onMount(() => {
    ra = new GalleryRenderer(canvasA, {
      onPick: (el, pid) => { ra.setHighlight(pid, 0); setDiffPickA(pid); },
      onHover: (el, pid) => ra.setHighlight(diffPickA(), pid),
    });
    rb = new GalleryRenderer(canvasB, {
      onPick: (el, pid) => { rb.setHighlight(pid, 0); setDiffPickB(pid); },
      onHover: (el, pid) => rb.setHighlight(diffPickB(), pid),
    });
    // 相机联动：任一视口旋转/缩放，同步另一视口
    const sync = (src, dst) => {
      let last = JSON.stringify(src.cam);
      const tick = () => {
        const cur = JSON.stringify(src.cam);
        if (cur !== last) { dst.cam = { ...src.cam, target: [...src.cam.target] }; last = cur; }
        requestAnimationFrame(tick);
      };
      tick();
    };
    sync(ra, rb); sync(rb, ra);
    onCleanup(() => { ra.dispose(); rb.dispose(); });
  });

  createEffect(() => { ra?.setModel(modelA()); });
  createEffect(() => { rb?.setModel(modelB()); });

  const filtered = createMemo(() => {
    const d = diff();
    const rows = [
      ...d.added.map((el) => ({ type: 'add', el, side: 'B' })),
      ...d.removed.map((el) => ({ type: 'del', el, side: 'A' })),
      ...d.changed.map((c) => ({ type: 'chg', el: c.after, before: c.before, after: c.after, side: 'A/B' })),
    ];
    return filter() === 'all' ? rows : rows.filter((r) => r.type === filter());
  });

  const focusRow = (row) => {
    const target = [row.el.pos[0], row.el.pos[1], row.el.pos[2]];
    for (const r of [ra, rb]) {
      if (!r) continue;
      r.cam.target = [...target];
      r.cam.dist = 35;
      r.cam.pitch = 0.6;
    }
  };

  const profName = (el) => (el.prof ? PROFESSIONS[el.prof]?.name : CHAMBERS[el.chamber]?.name || '结构');

  return (
    <div class="page">
      <div class="page-head">
        <h2>版本比对</h2>
        <span class="sub">双视口并排，相机联动；绿=新增，红=删除，黄=变更</span>
        <div style={{ flex: 1 }} />
        <select value={va()} onChange={(e) => setVa(+e.target.value)}>
          <For each={ui.versions}>{(v) => <option value={v.vid}>{v.name}</option>}</For>
        </select>
        <span style={{ color: 'var(--fg-dim)' }}>对比</span>
        <select value={vb()} onChange={(e) => setVb(+e.target.value)}>
          <For each={ui.versions}>{(v) => <option value={v.vid}>{v.name}</option>}</For>
        </select>
      </div>

      <div class="diff-summary">
        <div class="stat-tile add"><b>{diff().added.length}</b><span>新增构件</span></div>
        <div class="stat-tile del"><b>{diff().removed.length}</b><span>删除构件</span></div>
        <div class="stat-tile chg"><b>{diff().changed.length}</b><span>参数变更</span></div>
        <div class="stat-tile"><b>{modelA().stats.total} → {modelB().stats.total}</b><span>构件总数</span></div>
      </div>

      <div class="compare-grid">
        <div class="compare-view">
          <div class="vlabel">A · {ui.versions.find((v) => v.vid === va())?.name}</div>
          <canvas ref={canvasA} />
        </div>
        <div class="compare-view">
          <div class="vlabel">B · {ui.versions.find((v) => v.vid === vb())?.name}</div>
          <canvas ref={canvasB} />
        </div>
      </div>

      <div class="page-head" style={{ margin: '18px 0 10px' }}>
        <h2 style={{ 'font-size': 15 }}>差异明细（{filtered().length}）</h2>
        <div style={{ flex: 1 }} />
        <For each={['all', 'add', 'del', 'chg']}>
          {(t) => (
            <button class={filter() === t ? 'primary' : ''} onClick={() => setFilter(t)}>
              {({ all: '全部', add: '新增', del: '删除', chg: '变更' })[t]}
            </button>
          )}
        </For>
      </div>

      <div class="diff-list" style={{ background: 'var(--panel)', 'border-radius': 10, 'border': '1px solid var(--border)' }}>
        <div class="diff-row head">
          <span>类型</span><span>构件 / 专业</span><span>变更内容</span><span>位置</span>
        </div>
        <Show when={filtered().length === 0}><div class="diff-empty">无差异</div></Show>
        <For each={filtered().slice(0, 200)}>
          {(row) => (
            <div class="diff-row" style={{ cursor: 'pointer' }} onClick={() => focusRow(row)}>
              <span class={`diff-type ${row.type}`}>
                {({ add: '新增', del: '删除', chg: '变更' })[row.type]}
              </span>
              <span>{row.el.name} <span class="cnt">({profName(row.el)})</span></span>
              <span>
                <Show when={row.type === 'chg'} fallback={row.el.spec || '—'}>
                  管径 r {row.before.radius.toFixed(3)} → {row.after.radius.toFixed(3)} m
                  <Show when={row.before.pos.join(',') !== row.after.pos.join(',')}>
                    ；位置 {fmt(row.before.pos)} → {fmt(row.after.pos)}
                  </Show>
                </Show>
              </span>
              <span class="cnt">X={row.el.pos[0].toFixed(1)} / 标高 {row.el.elev.toFixed(2)}m</span>
            </div>
          )}
        </For>
        <Show when={filtered().length > 200}>
          <div class="diff-empty">仅展示前 200 条，共 {filtered().length} 条差异</div>
        </Show>
      </div>
    </div>
  );
}

const fmt = (p) => `(${p.map((v) => v.toFixed(1)).join(',')})`;
