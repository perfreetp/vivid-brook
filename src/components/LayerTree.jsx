import { createMemo, createSignal, For, Show } from 'solid-js';
import { PROFESSION_LIST, CHAMBERS, CHAMBER_LIST, LEVELS, LAYER_BITS, PROFESSION_LAYOUT } from '../lib/constants';
import { ui } from '../store';

const layoutMap = PROFESSION_LAYOUT;
const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

function Checkbox({ checked, indeterminate, onChange }) {
  let ref;
  return (
    <input
      type="checkbox"
      ref={(el) => {
        ref = el;
        el.checked = checked;
        el.indeterminate = !!indeterminate;
      }}
      onChange={onChange}
    />
  );
}

export default function LayerTree() {
  const mask = ui.layerMask;
  const [openProf, setOpenProf] = createSignal(new Set(PROFESSION_LIST.map((p) => p.id)));
  const model = () => ui.currentModel();

  // 统计各节点下的实例数量
  const counts = createMemo(() => {
    const c = { prof: {}, chamber: {}, level: {} };
    if (!model()) return c;
    for (const list of Object.values(model().groups)) {
      for (const el of list) {
        if (el.prof) c.prof[el.prof] = (c.prof[el.prof] || 0) + 1;
        if (el.chamber) c.chamber[el.chamber] = (c.chamber[el.chamber] || 0) + 1;
        if (el.level) c.level[el.level] = (c.level[el.level] || 0) + 1;
      }
    }
    return c;
  });

  const on = (bit) => (mask() & bit) !== 0;
  const toggle = (bit) => ui.toggleBits(bit);
  const profChildrenOn = (p) => {
    const chamber = PROF_LAYOUT(p).chamber;
    const level = PROF_LAYOUT(p).level;
    const a = on(LAYER_BITS.chamber[chamber]);
    const b = on(LAYER_BITS.level[level]);
    return { a, b };
  };
  const PROF_LAYOUT = (p) => {
    // 从 constants 间接取（避免循环依赖，直接 import）
    return layoutMap[p.id];
  };

  const profState = (p) => {
    const self = on(LAYER_BITS.profession[p.id]);
    const { a, b } = profChildrenOn(p);
    const all = self && a && b;
    const some = self || a || b;
    return { checked: all, indeterminate: !all && some };
  };

  const toggleProf = (p) => {
    const { checked } = profState(p);
    const layout = layoutMap[p.id];
    const bits = LAYER_BITS.profession[p.id] | LAYER_BITS.chamber[layout.chamber] | LAYER_BITS.level[layout.level];
    if (checked) ui.toggleBits(bits); // 关
    else {
      const m = mask();
      if ((m & bits) !== bits) ui.toggleBits(bits & ~m); // 只开没开的
    }
  };

  const chamberState = (ch) => {
    const self = on(LAYER_BITS.chamber[ch.id]);
    const profs = ch.professions;
    const profOn = profs.filter((pid) => on(LAYER_BITS.profession[pid]));
    const levelsInChamber = new Set(profs.map((pid) => layoutMap[pid].level));
    const lvlOn = [...levelsInChamber].filter((lid) => on(LAYER_BITS.level[lid]));
    const all = self && profOn.length === profs.length && lvlOn.length === levelsInChamber.size;
    const some = self || profOn.length > 0 || lvlOn.length > 0;
    return { checked: all, indeterminate: !all && some };
  };

  const toggleChamber = (ch) => {
    const { checked } = chamberState(ch);
    let bits = LAYER_BITS.chamber[ch.id];
    for (const pid of ch.professions) bits |= LAYER_BITS.profession[pid];
    const lids = new Set(ch.professions.map((pid) => layoutMap[pid].level));
    for (const lid of lids) bits |= LAYER_BITS.level[lid];
    if (checked) ui.toggleBits(bits);
    else {
      const m = mask();
      if ((m & bits) !== bits) ui.toggleBits(bits & ~m);
    }
  };

  const levelState = (lv) => {
    const self = on(LAYER_BITS.level[lv.id]);
    const profs = PROFESSION_LIST.filter((p) => layoutMap[p.id].level === lv.id);
    const profOn = profs.filter((p) => on(LAYER_BITS.profession[p.id]));
    const chambers = new Set(profs.map((p) => layoutMap[p.id].chamber));
    const chOn = [...chambers].filter((cid) => on(LAYER_BITS.chamber[cid]));
    const all = self && profOn.length === profs.length && chOn.length === chambers.size;
    const some = self || profOn.length > 0 || chOn.length > 0;
    return { checked: all, indeterminate: !all && some };
  };

  const toggleLevel = (lv) => {
    const { checked } = levelState(lv);
    let bits = LAYER_BITS.level[lv.id];
    const profs = PROFESSION_LIST.filter((p) => layoutMap[p.id].level === lv.id);
    for (const p of profs) bits |= LAYER_BITS.profession[p.id];
    const chambers = new Set(profs.map((p) => layoutMap[p.id].chamber));
    for (const cid of chambers) bits |= LAYER_BITS.chamber[cid];
    if (checked) ui.toggleBits(bits);
    else {
      const m = mask();
      if ((m & bits) !== bits) ui.toggleBits(bits & ~m);
    }
  };

  const toggleOpen = (id) => {
    setOpenProf((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  return (
    <div>
      <div class="panel-title">图层树（专业 / 舱室 / 标高）</div>
      <For each={PROFESSION_LIST}>
        {(p) => {
          const layout = layoutMap[p.id];
          const chamber = CHAMBERS[layout.chamber];
          const level = LEVELS.find((l) => l.id === layout.level);
          return (
            <div>
              <div class="tree-node">
                <span class="tree-toggle" onClick={() => toggleOpen(p.id)}>
                  {openProf().has(p.id) ? '▼' : '▶'}
                </span>
                <span class="swatch" style={{ background: rgb(p.color) }} />
                <span class="label" onClick={() => toggleProf(p)}>
                  {p.name} <span class="cnt">({counts().prof[p.id] || 0})</span>
                </span>
                <Checkbox {...profState(p)} onChange={() => toggleProf(p)} />
              </div>
              <Show when={openProf().has(p.id)}>
                <div class="tree-node child">
                  <span class="label" onClick={() => toggleChamber(chamber)}>
                    舱室 · {chamber.name} <span class="cnt">({counts().chamber[chamber.id] || 0})</span>
                  </span>
                  <Checkbox {...chamberState(chamber)} onChange={() => toggleChamber(chamber)} />
                </div>
                <div class="tree-node grandchild">
                  <span class="label" onClick={() => toggleLevel(level)}>
                    标高 · {level.elev.toFixed(2)}m <span class="cnt">({counts().level[level.id] || 0})</span>
                  </span>
                  <Checkbox {...levelState(level)} onChange={() => toggleLevel(level)} />
                </div>
              </Show>
            </div>
          );
        }}
      </For>

      <div class="panel-title">舱室汇总</div>
      <For each={CHAMBER_LIST}>
        {(ch) => (
          <div class="tree-node">
            <span class="label" onClick={() => toggleChamber(ch)}>
              {ch.name} <span class="cnt">{ch.width}m × {ch.height}m</span>
            </span>
            <Checkbox {...chamberState(ch)} onChange={() => toggleChamber(ch)} />
          </div>
        )}
      </For>

      <div class="panel-title">标高层汇总</div>
      <For each={LEVELS}>
        {(lv) => (
          <div class="tree-node">
            <span class="label" onClick={() => toggleLevel(lv)}>{lv.name}</span>
            <Checkbox {...levelState(lv)} onChange={() => toggleLevel(lv)} />
          </div>
        )}
      </For>

      <div class="panel-title">LOD 细节级别</div>
      <div class="hint">
        滚轮缩放自动切换：<br />
        · 远（&gt;90m）：主廊结构 + 干管<br />
        · 中（45–90m）：追加支管<br />
        · 近（&lt;45m）：追加支架、接头、阀门
      </div>
      <div class="panel-title">操作说明</div>
      <div class="hint">
        左键拖动：旋转视角<br />
        Shift/右键拖动：平移<br />
        滚轮：缩放（联动 LOD）<br />
        左键单击：拾取管线<br />
        悬停：半透明高亮预览
      </div>
    </div>
  );
}
