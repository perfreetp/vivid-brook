import { BaseElement, fallbackStyleEl } from './base.js';
import { exportSingleFrame, exportSequence } from '../core/export.js';

export class TransportElement extends BaseElement {
  protected render(): void {
    this.root.innerHTML = /* html */ `
      ${fallbackStyleEl().outerHTML}
      <style>
        :host { display: block; flex-shrink: 0; background: var(--panel); border-bottom: 1px solid var(--border); }
        .bar { display: flex; align-items: center; gap: 8px; padding: 7px 12px; flex-wrap: wrap; }
        .sep { width: 1px; height: 22px; background: var(--border); margin: 0 4px; }
        .duration { font-size: 12px; color: var(--muted); }
        .duration b { color: var(--accent2); }
        .progress { color: var(--gold); font-size: 12px; }
        label.chk { display: flex; align-items: center; gap: 4px; margin: 0; color: var(--text); font-size: 12px; }
        label.chk input { width: auto; }
      </style>
      <div class="bar">
        <button id="first" title="回到首帧">⏮</button>
        <button id="prev" title="上一帧">◀</button>
        <button id="play" class="primary">▶ 播放</button>
        <button id="next" title="下一帧">▶</button>
        <button id="last" title="末帧">⏭</button>
        <label class="chk"><input type="checkbox" id="loop" checked> 循环</label>
        <span class="sep"></span>
        <span class="duration" id="duration"></span>
        <span class="sep"></span>
        <button id="pngOne">导出当前帧 PNG</button>
        <button id="pngSeq">导出序列帧 ZIP…</button>
        <span class="progress" id="progress"></span>
        <span style="flex:1"></span>
        <button id="undo" title="Ctrl+Z">↶ 撤销</button>
        <button id="redo" title="Ctrl+Y">↷ 重做</button>
        <span class="sep"></span>
        <button id="resetCam">复位视图</button>
      </div>
    `;
  }

  protected bind(): void {
    this.listen('playhead', () => this.updateDuration());
    this.listen('project', () => this.updateDuration());
    this.listen('playing', () => {
      this.el<HTMLButtonElement>('#play').textContent = this.store.playing ? '⏸ 暂停' : '▶ 播放';
    });

    this.el('#play').addEventListener('click', () => this.store.setPlaying(!this.store.playing));
    this.el('#first').addEventListener('click', () => this.store.setFrame(0));
    this.el('#last').addEventListener('click', () => this.store.setFrame((this.store.project?.frameCount ?? 1) - 1));
    this.el('#prev').addEventListener('click', () => this.store.setFrame(this.store.frame - 1));
    this.el('#next').addEventListener('click', () => this.store.setFrame(this.store.frame + 1));
    this.el<HTMLInputElement>('#loop').addEventListener('change', (e) => {
      this.store.loop = (e.target as HTMLInputElement).checked;
    });
    this.el('#undo').addEventListener('click', () => this.store.undo());
    this.el('#redo').addEventListener('click', () => this.store.redo());
    this.el('#resetCam').addEventListener('click', () => this.store.setCamera({ panX: 0, panY: 0, zoom: 1 }));

    this.el('#pngOne').addEventListener('click', async () => {
      const p = this.store.project;
      if (!p) return;
      await exportSingleFrame(p, Math.round(this.store.frame));
    });

    this.el('#pngSeq').addEventListener('click', () => this.exportDialog());
    this.updateDuration();
  }

  private updateDuration(): void {
    const p = this.store.project;
    const el = this.el('#duration');
    if (!p) { el.textContent = '无工程'; return; }
    const total = (p.frameCount / p.fps).toFixed(2);
    const cur = (Math.round(this.store.frame) / p.fps).toFixed(2);
    el.innerHTML = `当前 <b>${cur}s</b> / 整段时长 <b>${total}s</b>　${p.frameCount} 帧 @ ${p.fps}fps`;
  }

  private exportDialog(): void {
    const p = this.store.project;
    if (!p) return;
    // 简单弹出选择：整段 / 展开段 / 收拢段
    const seg = p.segments;
    const choice = window.prompt(
      `导出范围：\n1 = 整段 (0-${p.frameCount - 1})\n2 = 展开段 (${seg[0]?.startFrame ?? 0}-${seg[0]?.endFrame ?? 60})\n3 = 收拢段 (${seg[1]?.startFrame ?? 60}-${seg[1]?.endFrame ?? p.frameCount - 1})\n请输入 1/2/3`,
      '1',
    );
    let s = 0;
    let e = p.frameCount - 1;
    if (choice === '2' && seg[0]) { s = seg[0].startFrame; e = seg[0].endFrame; }
    else if (choice === '3' && seg[1]) { s = seg[1].startFrame; e = seg[1].endFrame; }
    else if (choice !== '1' && choice !== null) return;
    if (choice === null) return;

    const prog = this.el('#progress');
    prog.textContent = '导出中 0%';
    exportSequence(p, s, e, (done, total) => {
      prog.textContent = `导出中 ${Math.round((done / total) * 100)}% (${done}/${total})`;
      if (done === total) setTimeout(() => (prog.textContent = '✓ 已打包下载'), 300);
    }).catch((err) => {
      prog.textContent = '导出失败';
      alert('导出失败：' + err.message);
    });
  }
}
