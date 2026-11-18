import { BasePanel } from './base';
import { store } from '../state/store';
import {
  appendVersion,
  createProject,
  deleteProject,
  getProject,
  nextProjectCode,
  searchProjects,
  diffStats,
  type VersionDiff
} from '../data/archive';
import { buildReport, buildSnapshot, diffForVersion } from '../data/report';
import { ctx } from './context';
import type { ProjectRecord, ProjectSnapshot, ProjectVersion } from '../state/types';

/** 档案加工面板：建档编号 → 加工归档 → 历史版本比对 → 报告 → 检索 */
export class ArchivePanel extends BasePanel {
  private records: ProjectRecord[] = [];

  constructor() {
    super('⑦ 档案加工与版本管理', 'archive');
  }

  protected mount(): void {
    this.bindStoreRerender();
    this.reload();
  }

  private async reload(): Promise<void> {
    this.records = await searchProjects({});
    this.render();
  }

  render(): void {
    const s = store.get();
    const b = this.body();
    b.innerHTML = '';

    // 建档区
    const createBtn = this.el('button', {}, '新建项目建档（自动编号）');
    createBtn.addEventListener('click', async () => {
      const code = await nextProjectCode();
      const now = new Date().toISOString();
      await createProject({
        code,
        name: s.projectName || '未命名河道工程',
        river: s.river || '未填写',
        reach: s.reach || '未填写',
        createdAt: now,
        updatedAt: now
      });
      store.update({ projectCode: code });
      alert(`建档成功，项目编号：${code}`);
      this.reload();
    });

    const note = this.el('textarea', { rows: '2', placeholder: '本次加工备注（可选），将写入成果报告' }) as HTMLTextAreaElement;

    const archiveBtn = this.el('button', { class: 'ghost' }, '加工并归档当前成果（生成新版本）');
    archiveBtn.addEventListener('click', async () => {
      if (!s.projectCode) {
        alert('请先新建项目建档，获取项目编号后再归档。');
        return;
      }
      if (s.points.length < 3) {
        alert('成果数据不足：请先导入断面高程点。');
        return;
      }
      const grid = ctx.scene?.getGrid() ?? null;
      const snapshot = buildSnapshot(store.get(), grid, note.value);
      const record = await getProject(s.projectCode);
      const prev = record && record.versions.length ? record.versions[record.versions.length - 1].snapshot : null;
      const diff = diffForVersion(prev, snapshot);
      const report = buildReport(record!.meta, (record?.versions.length ?? 0) + 1, snapshot, store.get().unfoldResults, diff);
      const v = await appendVersion(s.projectCode, snapshot, report);
      alert(`归档成功：${s.projectCode} V${v.version}`);
      note.value = '';
      this.reload();
    });

    b.append(
      this.el('div', { class: 'row-flex' },
        createBtn,
        s.projectCode
          ? this.el('span', { class: 'tag green' }, `当前项目 ${s.projectCode}`)
          : this.el('span', { class: 'tag warn' }, '未建档')
      ),
      note,
      archiveBtn,
      this.el('div', { class: 'sep' })
    );

    // 检索区
    const fCode = this.el('input', { type: 'text', placeholder: '项目编号' }) as HTMLInputElement;
    const fReach = this.el('input', { type: 'text', placeholder: '河段关键字' }) as HTMLInputElement;
    const fFrom = this.el('input', { type: 'date' }) as HTMLInputElement;
    const fTo = this.el('input', { type: 'date' }) as HTMLInputElement;
    const searchBtn = this.el('button', { class: 'small' }, '检索');
    searchBtn.addEventListener('click', async () => {
      this.records = await searchProjects({
        code: fCode.value || undefined,
        reach: fReach.value || undefined,
        dateFrom: fFrom.value || undefined,
        dateTo: fTo.value || undefined
      });
      this.renderList();
    });
    const resetBtn = this.el('button', { class: 'small ghost' }, '重置');
    resetBtn.addEventListener('click', () => this.reload());

    b.append(
      this.el('div', { class: 'grid2' }, fCode, fReach),
      this.el('div', { class: 'grid2' }, fFrom, fTo),
      this.el('div', { class: 'row-flex' }, searchBtn, resetBtn),
      this.el('div', { class: 'sep' }),
      this.el('div', { id: 'list-wrap' })
    );
    this.renderList();
  }

  private renderList(): void {
    const wrap = this.body().querySelector('#list-wrap') as HTMLElement | null;
    if (!wrap) return;
    wrap.innerHTML = '';
    if (this.records.length === 0) {
      wrap.append(this.el('div', { class: 'muted' }, '没有匹配的项目档案。'));
      return;
    }
    const scroll = this.el('div', { class: 'scroll' });
    this.records.forEach((rec) => {
      const card = this.el('div', { style: 'border:1px solid #e2e8f0;border-radius:6px;padding:8px;margin-bottom:8px;background:#f8fafc' });
      const head = this.el('div', { class: 'row-flex', style: 'justify-content:space-between' });
      head.append(
        this.el('strong', {}, `${rec.meta.code} · ${rec.meta.name}`),
        this.el('span', { class: 'tag' }, `${rec.versions.length} 个版本`)
      );
      const sub = this.el('div', { class: 'muted', style: 'font-size:11px;margin:3px 0' },
        `${rec.meta.river} / ${rec.meta.reach} · 更新于 ${new Date(rec.meta.updatedAt).toLocaleString('zh-CN')}`);
      const actions = this.el('div', { class: 'row-flex' });

      const openBtn = this.el('button', { class: 'small ghost' }, '打开项目');
      openBtn.addEventListener('click', () => this.openProject(rec));
      const verBtn = this.el('button', { class: 'small ghost' }, `版本比对`);
      verBtn.addEventListener('click', () => this.showVersions(rec));
      const delBtn = this.el('button', { class: 'small danger' }, '删除');
      delBtn.addEventListener('click', async () => {
        if (confirm(`确认删除项目 ${rec.meta.code} 及其全部版本？此操作不可恢复。`)) {
          await deleteProject(rec.meta.code);
          if (store.get().projectCode === rec.meta.code) store.update({ projectCode: '' });
          this.reload();
        }
      });
      actions.append(openBtn, verBtn, delBtn);
      card.append(head, sub, actions);
      scroll.append(card);
    });
    wrap.append(scroll);
  }

  private openProject(rec: ProjectRecord): void {
    const latest = rec.versions[rec.versions.length - 1];
    if (!latest) {
      alert('该项目尚无归档版本。');
      return;
    }
    const snap = latest.snapshot;
    store.update({
      projectCode: rec.meta.code,
      projectName: rec.meta.name,
      river: rec.meta.river,
      reach: rec.meta.reach,
      colorMode: snap.colorMode,
      offset: { ...snap.offset },
      terrain: { ...snap.terrainSettings },
      curvature: { ...snap.curvatureSettings }
    });
    store.setLinePoints('center', snap.center);
    store.setLinePoints('leftCrest', snap.leftCrest);
    store.setLinePoints('rightCrest', snap.rightCrest);
    const g = ctx.rebuildTerrain();
    ctx.scene?.setTerrainGrid(g);
    ctx.scene?.refreshTerrainColor(store.get().colorMode);
    ctx.scene?.showBoundaries();
    ctx.refreshScene();
    alert(`已载入 ${rec.meta.code} 的最新版本 V${latest.version}（高程点原始数据需重新导入 CSV）。`);
  }

  private showVersions(rec: ProjectRecord): void {
    if (rec.versions.length === 0) {
      alert('该项目尚无版本。');
      return;
    }
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:999;display:flex;align-items:center;justify-content:center';
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#fff;border-radius:10px;width:min(860px,92vw);max-height:86vh;overflow:auto;padding:18px';
    overlay.append(dialog);
    overlay.addEventListener('click', (e) => e.target === overlay && overlay.remove());

    const title = document.createElement('h3');
    title.textContent = `${rec.meta.code} 历史版本（共 ${rec.versions.length} 版）`;
    title.style.cssText = 'margin:0 0 10px;color:#1e3a8a';
    dialog.append(title);

    // 版本选择与比对
    const selA = document.createElement('select');
    const selB = document.createElement('select');
    rec.versions.forEach((v: ProjectVersion) => {
      selA.append(new Option(`V${v.version} · ${new Date(v.createdAt).toLocaleString('zh-CN')}`, String(v.version - 1)));
      selB.append(new Option(`V${v.version} · ${new Date(v.createdAt).toLocaleString('zh-CN')}`, String(v.version - 1)));
    });
    selB.value = String(rec.versions.length - 1);
    if (rec.versions.length >= 2) selA.value = String(rec.versions.length - 2);
    const diffBox = document.createElement('div');
    const runDiff = () => {
      const a: ProjectSnapshot = rec.versions[Number(selA.value)].snapshot;
      const bSnap: ProjectSnapshot = rec.versions[Number(selB.value)].snapshot;
      const diff: VersionDiff = diffStats(a.stats, bSnap.stats);
      diffBox.innerHTML = `<table><tr><th>指标</th><th>V${Number(selA.value) + 1}</th><th>V${Number(selB.value) + 1}</th><th>状态</th></tr>` +
        diff.fields
          .map((f) => `<tr style="${f.changed ? 'background:#fef3c7' : ''}"><td>${f.label}</td><td>${f.from}</td><td>${f.to}</td><td>${f.changed ? '变化' : '一致'}</td></tr>`)
          .join('') +
        `</table>`;
    };
    const diffBtn = document.createElement('button');
    diffBtn.textContent = '比对所选版本';
    diffBtn.onclick = runDiff;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px';
    row.append(selA, document.createTextNode('⇄'), selB, diffBtn);
    dialog.append(row, diffBox);
    runDiff();

    // 报告列表
    const repTitle = document.createElement('h4');
    repTitle.textContent = '成果报告';
    repTitle.style.margin = '14px 0 6px';
    dialog.append(repTitle);
    rec.versions.forEach((v: ProjectVersion) => {
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;gap:8px;align-items:center;margin:4px 0';
      const info = document.createElement('span');
      info.textContent = `V${v.version} · ${new Date(v.createdAt).toLocaleString('zh-CN')} · ${v.snapshot.note || '无备注'}`;
      info.className = 'muted';
      const view = document.createElement('button');
      view.textContent = '查看报告';
      view.className = 'small';
      view.onclick = () => {
        const w = window.open('', '_blank');
        w?.document.write(v.report);
        w?.document.close();
      };
      const dl = document.createElement('button');
      dl.textContent = '下载 HTML';
      dl.className = 'small ghost';
      dl.onclick = () => {
        const blob = new Blob([v.report], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${rec.meta.code}-V${v.version}-报告.html`;
        a.click();
        URL.revokeObjectURL(a.href);
      };
      line.append(info, view, dl);
      dialog.append(line);
    });

    const close = document.createElement('button');
    close.textContent = '关闭';
    close.style.marginTop = '14px';
    close.onclick = () => overlay.remove();
    dialog.append(close);
    document.body.append(overlay);
  }
}
