import type { Bone, Part, PartType, EasingKind } from '../types.js';
import { BaseElement, fallbackStyleEl } from './base.js';
import { uid } from '../core/math.js';
import { EASINGS } from './timeline.js';
import { evaluateScene } from '../core/evaluator.js';

export class InspectorElement extends BaseElement {
  protected render(): void {
    this.root.innerHTML = /* html */ `
      ${fallbackStyleEl().outerHTML}
      <style>
        :host { display: block; flex: 1 1 0; min-height: 0; background: var(--panel); overflow: auto; }
        .wrap { padding: 12px; }
        .tree-item { padding: 5px 7px; border-radius: 5px; cursor: pointer; display: flex; gap: 6px; align-items: center; font-size: 12px; }
        .tree-item:hover { background: var(--panel2); }
        .tree-item.sel { background: #243444; outline: 1px solid var(--accent); }
        .tree-item.over .dot { background: var(--danger) !important; }
        .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
        .part-item { display: flex; justify-content: space-between; align-items: center; padding: 5px 7px; border-radius: 5px; font-size: 12px; cursor: pointer; }
        .part-item:hover { background: var(--panel2); }
        .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; margin-right: 6px; vertical-align: middle; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .danger-text { color: #ff8a80; }
        .ok-text { color: var(--accent2); }
        button.wide { width: 100%; margin-top: 6px; }
        .tabs { display: flex; border-bottom: 1px solid var(--border); }
        .tab { flex: 1; padding: 8px; text-align: center; cursor: pointer; color: var(--muted); font-size: 12px; }
        .tab.on { color: var(--text); border-bottom: 2px solid var(--accent); }
        .tabpane { display: none; }
        .tabpane.on { display: block; }
      </style>
      <div class="wrap" id="wrap"></div>
    `;
  }

  protected bind(): void {
    this.listen('project', () => this.draw());
    this.listen('selection', () => this.draw());
    this.listen('playhead', () => this.drawKeyframePane());
    this.draw();
  }

  private draw(): void {
    const p = this.store.project;
    const wrap = this.el('#wrap');
    if (!p) { wrap.innerHTML = '<p class="muted">请选择一个镜头</p>'; return; }

    wrap.innerHTML = /* html */ `
      <div class="tabs">
        <div class="tab on" data-tab="bone">骨架</div>
        <div class="tab" data-tab="part">部件</div>
        <div class="tab" data-tab="kf">关键帧</div>
      </div>
      <div class="tabpane on" id="pane-bone"></div>
      <div class="tabpane" id="pane-part"></div>
      <div class="tabpane" id="pane-kf"></div>
    `;
    this.root.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
      t.addEventListener('click', () => {
        this.root.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
        this.root.querySelectorAll('.tabpane').forEach((x) => x.classList.remove('on'));
        t.classList.add('on');
        this.el(`#pane-${t.dataset.tab}`).classList.add('on');
      });
    });
    this.drawBonePane();
    this.drawPartPane();
    this.drawKeyframePane();
  }

  // ---------------- 骨架树 + 限位 ----------------

  private drawBonePane(): void {
    const p = this.store.project!;
    const scene = evaluateScene(p, Math.round(this.store.frame));
    const childrenOf = (id: string | null): Bone[] => p.bones.filter((b) => b.parentId === id);

    const renderNode = (bone: Bone, depth: number): string => {
      const bw = scene.byId.get(bone.id);
      const sel = bone.id === this.store.selectedBoneId;
      const over = bw?.overLimit;
      return `
        <div class="tree-item ${sel ? 'sel' : ''} ${over ? 'over' : ''}" data-bone="${bone.id}" style="padding-left:${7 + depth * 16}px">
          <span class="dot" style="background:${over ? 'var(--danger)' : 'var(--accent)'}"></span>
          <span style="flex:1">${bone.name}</span>
          <span class="muted">${bw ? bw.localAngle.toFixed(0) + '°' : ''}</span>
        </div>
        ${childrenOf(bone.id).map((c) => renderNode(c, depth + 1)).join('')}
      `;
    };

    const roots = childrenOf(null);
    this.el('#pane-bone').innerHTML = `
      <h4>骨架层级（父子关系）</h4>
      ${roots.map((r) => renderNode(r, 0)).join('')}
      <h4>骨骼 / 铰点属性</h4>
      <div id="boneProps"></div>
    `;
    this.root.querySelectorAll<HTMLElement>('.tree-item').forEach((item) => {
      item.addEventListener('click', () => this.store.selectBone(item.dataset.bone!));
    });
    this.drawBoneProps();
  }

  private drawBoneProps(): void {
    const p = this.store.project!;
    const host = this.el('#boneProps');
    const bone = p.bones.find((b) => b.id === this.store.selectedBoneId);
    if (!bone) { host.innerHTML = '<p class="muted">未选中骨骼</p>'; return; }
    const scene = evaluateScene(p, Math.round(this.store.frame));
    const bw = scene.byId.get(bone.id)!;
    host.innerHTML = /* html */ `
      <div class="field"><label>名称</label><input id="bName" value="${bone.name}"></div>
      <div class="grid2">
        <div class="field"><label>长度 (px)</label><input id="bLen" type="number" value="${bone.length}"></div>
        <div class="field"><label>装配角 (°)</label><input id="bRest" type="number" value="${bone.restAngle}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>限位最小角 (°，留空不限)</label><input id="bMin" type="number" value="${bone.limit.min ?? ''}"></div>
        <div class="field"><label>限位最大角 (°，留空不限)</label><input id="bMax" type="number" value="${bone.limit.max ?? ''}"></div>
      </div>
      <div class="field"><label>父骨骼</label>
        <select id="bParent">
          <option value="">（根）</option>
          ${p.bones.filter((b) => b.id !== bone.id).map((b) => `<option value="${b.id}" ${b.id === bone.parentId ? 'selected' : ''}>${b.name}</option>`).join('')}
        </select>
      </div>
      <p class="${bw.overLimit ? 'danger-text' : 'ok-text'}">
        当前局部角 ${bw.localAngle.toFixed(1)}° — ${bw.overLimit ? '⚠ 已超出塑料件限位，关节红色提示' : '在限位范围内'}
      </p>
      <button class="wide danger" id="delBone">删除骨骼（含子骨骼与部件绑定）</button>
    `;
    const commit = (fn: (b: Bone) => void) => {
      this.store.mutateProject((proj) => {
        const b = proj.bones.find((x) => x.id === bone.id);
        if (b) fn(b);
      });
    };
    this.el<HTMLInputElement>('#bName').onchange = (e) => commit((b) => (b.name = (e.target as HTMLInputElement).value));
    this.el<HTMLInputElement>('#bLen').onchange = (e) => commit((b) => (b.length = Number((e.target as HTMLInputElement).value)));
    this.el<HTMLInputElement>('#bRest').onchange = (e) => commit((b) => (b.restAngle = Number((e.target as HTMLInputElement).value)));
    this.el<HTMLInputElement>('#bMin').onchange = (e) => {
      const v = (e.target as HTMLInputElement).value;
      commit((b) => (b.limit.min = v === '' ? null : Number(v)));
    };
    this.el<HTMLInputElement>('#bMax').onchange = (e) => {
      const v = (e.target as HTMLInputElement).value;
      commit((b) => (b.limit.max = v === '' ? null : Number(v)));
    };
    this.el<HTMLSelectElement>('#bParent').onchange = (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.store.mutateProject((proj) => {
        const b = proj.bones.find((x) => x.id === bone.id)!;
        b.parentId = v || null;
      });
    };
    this.el('#delBone').onclick = () => {
      if (!confirm(`删除骨骼「${bone.name}」及其全部子骨骼？`)) return;
      this.store.mutateProject((proj) => {
        const doomed = new Set<string>([bone.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const b of proj.bones) {
            if (b.parentId && doomed.has(b.parentId) && !doomed.has(b.id)) { doomed.add(b.id); grew = true; }
          }
        }
        proj.bones = proj.bones.filter((b) => !doomed.has(b.id));
        proj.parts = proj.parts.filter((pt) => !doomed.has(pt.boneId));
        for (const id of doomed) delete proj.tracks[id];
        this.store.selectedBoneId = proj.bones[0]?.id ?? null;
      });
    };
  }

  // ---------------- 部件 ----------------

  private drawPartPane(): void {
    const p = this.store.project!;
    const typeLabel: Record<PartType, string> = { panel: '床板', link: '连杆', joint: '铰点' };
    this.el('#pane-part').innerHTML = /* html */ `
      <h4>独立部件（绑定到骨骼）</h4>
      ${p.parts.map((pt) => `
        <div class="part-item" data-part="${pt.id}">
          <span><span class="swatch" style="background:${pt.color}"></span>${pt.name} <span class="muted">[${typeLabel[pt.type]}]</span></span>
          <span class="muted">→ ${p.bones.find((b) => b.id === pt.boneId)?.name ?? '未绑定'}</span>
        </div>
      `).join('')}
      <h4>新增部件</h4>
      <div class="field"><label>部件类型</label>
        <select id="newPartType">
          <option value="panel">床板</option><option value="link">连杆</option><option value="joint">铰点</option>
        </select>
      </div>
      <button class="wide primary" id="addPart">＋ 添加并绑定到选中骨骼</button>
      <div id="partProps"></div>
    `;
    this.el('#addPart').onclick = () => this.addPart();
    this.root.querySelectorAll<HTMLElement>('.part-item').forEach((item) => {
      item.addEventListener('click', () => this.editPart(item.dataset.part!));
    });
  }

  private addPart(): void {
    const p = this.store.project!;
    const boneId = this.store.selectedBoneId;
    if (!boneId) { alert('请先在骨架页选中一根骨骼'); return; }
    const type = this.el<HTMLSelectElement>('#newPartType').value as PartType;
    this.store.mutateProject((proj) => {
      const part: Part = {
        id: uid('part'),
        name: type === 'panel' ? '新床板' : type === 'link' ? '新连杆' : '新铰点',
        type,
        boneId,
        color: type === 'panel' ? '#7fb2e5' : type === 'link' ? '#8d6e63' : '#f0964b',
        length: type === 'joint' ? 0 : 80,
        thickness: type === 'joint' ? 0 : 16,
        offsetX: 0,
        offsetY: -8,
        radius: type === 'joint' ? 12 : undefined,
      };
      proj.parts.push(part);
    });
  }

  private editPart(partId: string): void {
    const p = this.store.project!;
    const part = p.parts.find((x) => x.id === partId);
    const host = this.el('#partProps');
    if (!part) return;
    host.innerHTML = /* html */ `
      <h4>部件属性</h4>
      <div class="field"><label>名称</label><input id="pName" value="${part.name}"></div>
      <div class="field"><label>绑定骨骼</label>
        <select id="pBone">${p.bones.map((b) => `<option value="${b.id}" ${b.id === part.boneId ? 'selected' : ''}>${b.name}</option>`).join('')}</select>
      </div>
      <div class="field"><label>颜色</label><input type="color" id="pColor" value="${part.color}"></div>
      ${part.type === 'joint' ? `
        <div class="field"><label>半径 (px)</label><input id="pRadius" type="number" value="${part.radius ?? 10}"></div>
      ` : `
        <div class="grid2">
          <div class="field"><label>长度</label><input id="pLen" type="number" value="${part.length}"></div>
          <div class="field"><label>厚度</label><input id="pThick" type="number" value="${part.thickness}"></div>
          <div class="field"><label>X 偏移</label><input id="pOx" type="number" value="${part.offsetX}"></div>
          <div class="field"><label>Y 偏移</label><input id="pOy" type="number" value="${part.offsetY}"></div>
        </div>
      `}
      <button class="wide danger" id="delPart">删除部件</button>
    `;
    const commit = (fn: (pt: Part) => void) =>
      this.store.mutateProject((proj) => { const x = proj.parts.find((z) => z.id === partId); if (x) fn(x); });
    this.el<HTMLInputElement>('#pName').onchange = (e) => commit((x) => (x.name = (e.target as HTMLInputElement).value));
    this.el<HTMLSelectElement>('#pBone').onchange = (e) => commit((x) => (x.boneId = (e.target as HTMLSelectElement).value));
    this.el<HTMLInputElement>('#pColor').onchange = (e) => commit((x) => (x.color = (e.target as HTMLInputElement).value));
    if (part.type === 'joint') {
      this.el<HTMLInputElement>('#pRadius').onchange = (e) => commit((x) => (x.radius = Number((e.target as HTMLInputElement).value)));
    } else {
      this.el<HTMLInputElement>('#pLen').onchange = (e) => commit((x) => (x.length = Number((e.target as HTMLInputElement).value)));
      this.el<HTMLInputElement>('#pThick').onchange = (e) => commit((x) => (x.thickness = Number((e.target as HTMLInputElement).value)));
      this.el<HTMLInputElement>('#pOx').onchange = (e) => commit((x) => (x.offsetX = Number((e.target as HTMLInputElement).value)));
      this.el<HTMLInputElement>('#pOy').onchange = (e) => commit((x) => (x.offsetY = Number((e.target as HTMLInputElement).value)));
    }
    this.el('#delPart').onclick = () =>
      this.store.mutateProject((proj) => (proj.parts = proj.parts.filter((x) => x.id !== partId)));
  }

  // ---------------- 关键帧属性（缓动与切线） ----------------

  private drawKeyframePane(): void {
    const p = this.store.project;
    const host = this.el('#pane-kf');
    if (!host) return;
    if (!p) { host.innerHTML = ''; return; }
    const boneId = this.store.selectedBoneId;
    const frame = Math.round(this.store.frame);
    if (!boneId) { host.innerHTML = '<p class="muted">选中骨骼后可编辑该帧的插值方式</p>'; return; }
    const kf = (p.tracks[boneId] ?? []).find((k) => k.frame === frame);
    if (!kf) {
      host.innerHTML = `<p class="muted">当前帧 ${frame} 上「${p.bones.find((b) => b.id === boneId)?.name}」没有关键帧。<br>点击工具条的「打关键帧」或在视口拖拽关节自动生成。</p>`;
      return;
    }
    host.innerHTML = /* html */ `
      <h4>帧 ${frame} 关键帧</h4>
      <div class="field"><label>角度 (°)</label><input id="kAngle" type="number" step="0.5" value="${kf.angle}"></div>
      <div class="field"><label>帧间插值</label>
        <select id="kEasing">${EASINGS.map((e) => `<option value="${e.value}" ${e.value === kf.easing ? 'selected' : ''}>${e.label}</option>`).join('')}</select>
      </div>
      <div id="tangentFields" style="display:${kf.easing === 'custom' ? 'block' : 'none'}">
        <p class="muted">自定义三次 Hermite 切线（角度/帧），也可在底部曲线编辑器拖动手柄：</p>
        <div class="grid2">
          <div class="field"><label>入切线</label><input id="kIn" type="number" step="0.1" value="${kf.inTangent}"></div>
          <div class="field"><label>出切线</label><input id="kOut" type="number" step="0.1" value="${kf.outTangent}"></div>
        </div>
      </div>
    `;
    this.el<HTMLInputElement>('#kAngle').onchange = (e) =>
      this.store.mutateProject((proj) => { const k = proj.tracks[boneId].find((z) => z.frame === frame); if (k) k.angle = Number((e.target as HTMLInputElement).value); });
    this.el<HTMLSelectElement>('#kEasing').onchange = (e) =>
      this.store.mutateProject((proj) => { const k = proj.tracks[boneId].find((z) => z.frame === frame); if (k) k.easing = (e.target as HTMLSelectElement).value as EasingKind; });
    const tHost = this.el<HTMLInputElement>('#kIn');
    if (tHost) {
      this.el<HTMLInputElement>('#kIn').onchange = (e) =>
        this.store.mutateProject((proj) => { const k = proj.tracks[boneId].find((z) => z.frame === frame); if (k) k.inTangent = Number((e.target as HTMLInputElement).value); });
      this.el<HTMLInputElement>('#kOut').onchange = (e) =>
        this.store.mutateProject((proj) => { const k = proj.tracks[boneId].find((z) => z.frame === frame); if (k) k.outTangent = Number((e.target as HTMLInputElement).value); });
    }
  }
}
