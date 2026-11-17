import type { Keyframe, EasingKind } from '../types.js';
import { BaseElement, fallbackStyleEl } from './base.js';
import { upsertKeyframe, sampleTrack } from '../core/easing.js';
import { evaluateScene } from '../core/evaluator.js';

const EASINGS: { value: EasingKind; label: string }[] = [
  { value: 'linear', label: '线性' },
  { value: 'ease-in', label: '缓入' },
  { value: 'ease-out', label: '缓出' },
  { value: 'ease-in-out', label: '缓入缓出' },
  { value: 'custom', label: '自定义切线' },
];

export class TimelineElement extends BaseElement {
  private trackBody!: HTMLDivElement;
  private ruler!: HTMLDivElement;
  private drag:
    | { kind: 'playhead' }
    | { kind: 'key'; boneId: string; fromFrame: number; kf: Keyframe }
    | { kind: 'tangent'; boneId: string; kf: Keyframe; field: 'inTangent' | 'outTangent'; startY: number; startVal: number }
    | null = null;

  protected render(): void {
    this.root.innerHTML = /* html */ `
      ${fallbackStyleEl().outerHTML}
      <style>
        :host { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; background: var(--panel); border-top: 1px solid var(--border); }
        .tl-head { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
        .tl-body { flex: 1; display: flex; min-height: 0; }
        .tl-left { width: 210px; border-right: 1px solid var(--border); overflow: auto; flex-shrink: 0; }
        .tl-right { flex: 1; overflow: auto; position: relative; min-width: 0; }
        .ruler { position: sticky; top: 0; height: 26px; background: var(--panel2); z-index: 3; border-bottom: 1px solid var(--border); }
        .tick { position: absolute; top: 0; height: 100%; border-left: 1px solid var(--border); font-size: 10px; color: var(--muted); padding-left: 3px; line-height: 26px; }
        .bone-row { height: 34px; display: flex; align-items: center; padding: 0 10px; border-bottom: 1px solid var(--border); cursor: pointer; gap: 6px; }
        .bone-row.sel { background: #243444; }
        .lane { position: relative; height: 34px; border-bottom: 1px solid var(--border); }
        .seg-band { position: absolute; top: 2px; height: 6px; border-radius: 3px; opacity: .85; }
        .seg-label { position: absolute; top: 8px; font-size: 9px; opacity: .8; }
        .kf { position: absolute; top: 50%; width: 12px; height: 12px; transform: translate(-50%, -50%) rotate(45deg);
          background: var(--accent); border: 1px solid #0b141c; cursor: grab; z-index: 2; }
        .kf.sel { background: var(--gold); }
        .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--danger); z-index: 4; pointer-events: none; }
        .playhead::before { content: ''; position: absolute; top: 0; left: -5px; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid var(--danger); }
        .curve-editor { height: 120px; border-top: 1px solid var(--border); background: #0d141b; position: relative; }
        .curve-editor canvas { position: absolute; inset: 0; }
        .ce-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 12px; }
        .mini { font-size: 11px; }
      </style>
      <div class="tl-head">
        <span class="muted mini">时间轴</span>
        <button id="addKf" title="在当前帧为选中骨骼打关键帧 (K)">◆ 打关键帧</button>
        <button id="delKf" class="danger">删除选中帧关键帧</button>
        <span class="muted mini" id="hint">选中骨骼后点击轨道或拖拽菱形调帧</span>
      </div>
      <div class="tl-body">
        <div class="tl-left" id="left"></div>
        <div class="tl-right" id="right">
          <div class="ruler" id="ruler"></div>
          <div id="trackBody"></div>
          <div class="playhead" id="playhead"></div>
        </div>
      </div>
      <div class="curve-editor" id="curveHost"></div>
    `;
    this.trackBody = this.el('#trackBody');
    this.ruler = this.el('#ruler');
  }

  protected bind(): void {
    this.listen('project', () => this.drawAll());
    this.listen('selection', () => this.drawAll());
    this.listen('playhead', () => this.updatePlayhead());
    this.drawAll();

    this.el('#addKf').addEventListener('click', () => this.addKeyframe());
    this.el('#delKf').addEventListener('click', () => this.deleteSelectedKeyframe());

    const right = this.el('#right');
    right.addEventListener('pointerdown', this.onRightDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.unsubs.push(() => {
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
    });
  }

  private get frameWidth(): number { return 14; }

  private widthFor(frameCount: number): number {
    return Math.max(this.el('#right').clientWidth - 20, frameCount * this.frameWidth + 40);
  }

  private frameFromX(x: number): number {
    return Math.round(x / this.frameWidth);
  }

  private drawAll(): void {
    const p = this.store.project;
    if (!p) return;
    const w = this.widthFor(p.frameCount);

    // 标尺
    this.ruler.style.width = `${w}px`;
    let ticks = '';
    const step = p.fps; // 每秒一格
    for (let f = 0; f < p.frameCount; f += step) {
      ticks += `<div class="tick" style="left:${f * this.frameWidth}px">${f} (${(f / p.fps).toFixed(0)}s)</div>`;
    }
    this.ruler.innerHTML = ticks;

    // 左侧骨骼列表 + 右侧轨道
    let left = '';
    let lanes = '';
    for (const bone of p.bones) {
      const sel = bone.id === this.store.selectedBoneId;
      left += `<div class="bone-row ${sel ? 'sel' : ''}" data-bone="${bone.id}">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${bone.name}</span>
        <span class="muted mini">${bone.limit.min ?? '∅'}°~${bone.limit.max ?? '∅'}°</span>
      </div>`;
      let inner = '';
      // 动作段色带
      for (const seg of p.segments) {
        inner += `<div class="seg-band" style="left:${seg.startFrame * this.frameWidth}px;width:${(seg.endFrame - seg.startFrame) * this.frameWidth}px;background:${seg.color}"></div>`;
        inner += `<div class="seg-label muted" style="left:${seg.startFrame * this.frameWidth + 4}px">${seg.name}</div>`;
      }
      const track = p.tracks[bone.id] ?? [];
      const curFrame = Math.round(this.store.frame);
      for (const kf of track) {
        const kSel = sel && kf.frame === curFrame;
        inner += `<div class="kf ${kSel ? 'sel' : ''}" data-bone="${bone.id}" data-frame="${kf.frame}" style="left:${kf.frame * this.frameWidth}px"></div>`;
      }
      lanes += `<div class="lane" style="width:${w}px" data-bone="${bone.id}">${inner}</div>`;
    }
    this.el('#left').innerHTML = left;
    this.trackBody.style.width = `${w}px`;
    this.trackBody.innerHTML = lanes;

    this.el('#left').querySelectorAll<HTMLElement>('.bone-row').forEach((row) => {
      row.addEventListener('click', () => this.store.selectBone(row.dataset.bone!));
    });
    this.updatePlayhead();
    this.drawCurveEditor();
  }

  private updatePlayhead(): void {
    const p = this.store.project;
    if (!p) return;
    const ph = this.el<HTMLDivElement>('#playhead');
    ph.style.left = `${Math.round(this.store.frame) * this.frameWidth}px`;
  }

  private addKeyframe(): void {
    const p = this.store.project;
    const boneId = this.store.selectedBoneId;
    if (!p || !boneId) return;
    const frame = Math.round(this.store.frame);
    const scene = evaluateScene(p, frame);
    const angle = scene.byId.get(boneId)?.localAngle ?? 0;
    this.store.mutateProject((proj) => {
      const track = proj.tracks[boneId] ?? (proj.tracks[boneId] = []);
      proj.tracks[boneId] = upsertKeyframe(track, {
        frame, angle, easing: 'ease-in-out', inTangent: 0, outTangent: 0,
      });
    });
  }

  private deleteSelectedKeyframe(): void {
    const p = this.store.project;
    const boneId = this.store.selectedBoneId;
    if (!p || !boneId) return;
    const frame = Math.round(this.store.frame);
    this.store.mutateProject((proj) => {
      proj.tracks[boneId] = (proj.tracks[boneId] ?? []).filter((k) => k.frame !== frame);
    });
  }

  private onRightDown = (e: PointerEvent): void => {
    const target = e.target as HTMLElement;
    const rect = this.el('#right').getBoundingClientRect();
    const x = e.clientX - rect.left + this.el('#right').scrollLeft;

    if (target.classList.contains('kf')) {
      const boneId = target.dataset.bone!;
      const fromFrame = Number(target.dataset.frame);
      const kf = this.store.project!.tracks[boneId].find((k) => k.frame === fromFrame)!;
      this.store.selectBone(boneId);
      this.drag = { kind: 'key', boneId, fromFrame, kf };
      return;
    }
    // 点击空白：移动播放头
    this.drag = { kind: 'playhead' };
    this.store.setFrame(this.frameFromX(x));
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drag) return;
    const rect = this.el('#right').getBoundingClientRect();
    const x = e.clientX - rect.left + this.el('#right').scrollLeft;
    const p = this.store.project!;

    if (this.drag.kind === 'playhead') {
      this.store.setFrame(this.frameFromX(x));
    } else if (this.drag.kind === 'key') {
      const d = this.drag;
      const newFrame = Math.max(0, Math.min(p.frameCount - 1, this.frameFromX(x)));
      if (newFrame !== d.fromFrame) {
        this.store.mutateProject((proj) => {
          const track = proj.tracks[d.boneId].filter((k) => k.frame !== d.fromFrame);
          proj.tracks[d.boneId] = upsertKeyframe(track, { ...d.kf, frame: newFrame });
        });
        d.fromFrame = newFrame;
      }
    } else if (this.drag.kind === 'tangent') {
      const d = this.drag;
      const delta = (d.startY - e.clientY) * 0.05; // 像素 -> 角度/帧
      this.store.mutateProject((proj) => {
        const k = proj.tracks[d.boneId].find((k) => k.frame === d.kf.frame);
        if (k) { k.easing = 'custom'; k[d.field] = d.startVal + delta; }
      });
    }
  };

  private onPointerUp = (): void => { this.drag = null; };

  // ---------------- 曲线编辑器（自定义切线） ----------------

  private drawCurveEditor(): void {
    const host = this.el<HTMLDivElement>('#curveHost');
    const p = this.store.project;
    const boneId = this.store.selectedBoneId;
    if (!p || !boneId) {
      host.innerHTML = `<div class="ce-empty">未选中骨骼 — 在左侧选择一根骨骼以编辑动画曲线</div>`;
      return;
    }
    const track = p.tracks[boneId] ?? [];
    if (track.length < 2) {
      host.innerHTML = `<div class="ce-empty">该骨骼关键帧不足 2 个，至少两个关键帧才能形成插值曲线</div>`;
      return;
    }
    host.innerHTML = `<canvas id="ceCanvas"></canvas>`;
    const canvas = host.querySelector<HTMLCanvasElement>('#ceCanvas')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = host.clientWidth;
    const H = host.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const sorted = [...track].sort((a, b) => a.frame - b.frame);
    const f0 = sorted[0].frame;
    const f1 = sorted[sorted.length - 1].frame;
    const angles = sorted.map((k) => k.angle);
    const aMin = Math.min(...angles) - 10;
    const aMax = Math.max(...angles) + 10;
    const pad = 26;
    const mx = (f: number) => pad + ((f - f0) / Math.max(1, f1 - f0)) * (W - pad * 2);
    const my = (a: number) => H - pad - ((a - aMin) / Math.max(1, aMax - aMin)) * (H - pad * 2);

    // 坐标轴
    ctx.strokeStyle = '#2c3c4a';
    ctx.beginPath();
    ctx.moveTo(pad, pad); ctx.lineTo(pad, H - pad); ctx.lineTo(W - pad, H - pad);
    ctx.stroke();
    ctx.fillStyle = '#8aa0b0';
    ctx.font = '10px sans-serif';
    ctx.fillText(`${aMax.toFixed(0)}°`, 2, pad + 4);
    ctx.fillText(`${aMin.toFixed(0)}°`, 2, H - pad);
    ctx.fillText(`帧 ${f0}`, pad, H - 8);
    ctx.fillText(`帧 ${f1}`, W - pad - 30, H - 8);

    // 曲线
    ctx.strokeStyle = '#4fa3e3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const N = 160;
    for (let i = 0; i <= N; i++) {
      const frame = f0 + ((f1 - f0) * i) / N;
      const a = sampleTrack(track, frame, sorted[0].angle);
      const x = mx(frame);
      const y = my(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 关键帧点 + 切线手柄（custom 模式可拖）
    const curFrame = Math.round(this.store.frame);
    for (const k of sorted) {
      const x = mx(k.frame);
      const y = my(k.angle);
      ctx.fillStyle = k.frame === curFrame ? '#ffd54f' : '#4fa3e3';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8aa0b0';
      ctx.fillText(`${k.frame}`, x + 7, y - 6);

      if (k.easing === 'custom') {
        this.drawHandle(ctx, x, y, k, 'inTangent', mx, my, f0, f1);
        this.drawHandle(ctx, x, y, k, 'outTangent', mx, my, f0, f1);
      }
    }

    // 当前缓动选择器
    const selKf = sorted.find((k) => k.frame === curFrame);
    ctx.fillStyle = '#dce6ee';
    ctx.font = '11px sans-serif';
    const easingText = selKf
      ? `帧 ${selKf.frame} 插值：${EASINGS.find((e) => e.value === selKf.easing)?.label}（切线手柄可上下拖动）`
      : '移动播放头到某关键帧可修改其插值方式';
    ctx.fillText(easingText, pad + 8, 16);

    // 手柄拖拽
    canvas.onpointerdown = (ev) => {
      if (!selKf || selKf.easing !== 'custom') return;
      const r = canvas.getBoundingClientRect();
      const px = ev.clientX - r.left;
      const py = ev.clientY - r.top;
      const hx = mx(selKf.frame);
      const hy = my(selKf.angle);
      if (Math.hypot(px - (hx - 16), py - hy) < 8) {
        this.drag = { kind: 'tangent', boneId, kf: selKf, field: 'inTangent', startY: ev.clientY, startVal: selKf.inTangent };
      } else if (Math.hypot(px - (hx + 16), py - hy) < 8) {
        this.drag = { kind: 'tangent', boneId, kf: selKf, field: 'outTangent', startY: ev.clientY, startVal: selKf.outTangent };
      }
    };
  }

  private drawHandle(
    ctx: CanvasRenderingContext2D, x: number, y: number, k: Keyframe,
    field: 'inTangent' | 'outTangent',
    mx: (f: number) => number, my: (a: number) => number,
    f0: number, f1: number,
  ): void {
    const dir = field === 'inTangent' ? -1 : 1;
    // 用切线斜率画一段示意手柄
    const span = Math.max(1, f1 - f0);
    const dFrame = span * 0.06 * dir;
    const dAngle = k[field] * dFrame;
    const hx = mx(k.frame + dFrame);
    const hy = my(k.angle + dAngle);
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export { EASINGS };
