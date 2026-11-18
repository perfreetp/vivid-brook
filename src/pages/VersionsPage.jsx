import { createMemo, createSignal, For, Show } from 'solid-js';
import { ui } from '../store';
import { buildModel, diffModels } from '../lib/model';

export default function VersionsPage() {
  const [showSubmit, setShowSubmit] = createSignal(false);
  const [note, setNote] = createSignal('');

  const rows = createMemo(() => {
    return [...ui.versions].reverse().map((v) => {
      const m = buildModel(v);
      return { v, stats: m.stats };
    });
  });

  const diffWithPrev = (v) => {
    const idx = ui.versions.findIndex((x) => x.vid === v.vid);
    if (idx <= 0) return null;
    return diffModels(buildModel(ui.versions[idx - 1]), buildModel(v));
  };

  const submit = () => {
    const v = ui.submitVersion(note().trim());
    setShowSubmit(false); setNote('');
    location.hash = '#/review';
    return v;
  };

  return (
    <div class="page">
      <div class="page-head">
        <h2>版本管理</h2>
        <span class="sub">每次出图提交生成一个新版本，修订可复现、可追溯、可比对</span>
        <div style={{ flex: 1 }} />
        <button class="primary" onClick={() => setShowSubmit(true)}>+ 提交出图新版本</button>
        <button class="ghost" onClick={() => { if (confirm('确认清空本地版本与批注数据并恢复演示数据？')) ui.resetData(); }}>重置数据</button>
      </div>

      <div class="cards">
        <For each={rows()}>
          {({ v, stats }) => {
            const d = diffWithPrev(v);
            return (
              <div class={`card ${v.vid === ui.currentVid() ? 'current' : ''}`}>
                <h3>
                  {v.name}
                  {v.vid === ui.currentVid() && <span class="tag" style={{ color: 'var(--accent)' }}>当前版本</span>}
                </h3>
                <div class="meta">出图时间：{v.createdAt}</div>
                <div class="meta">出图说明：{v.note}</div>
                <div class="meta">
                  构件总数：<b style={{ color: 'var(--accent-2)' }}>{stats.total}</b>
                  （干管 {stats.byGroup.main} · 支管 {stats.byGroup.branch} · 支架 {stats.byGroup.support} · 结构 {stats.byGroup.structure}）
                </div>
                <Show when={d}>
                  <div class="meta" style={{ margin: '8px 0 0' }}>
                    较上一版：
                    <span style={{ color: 'var(--ok)' }}>新增 {d.added.length}</span> ·{' '}
                    <span style={{ color: 'var(--danger)' }}>删除 {d.removed.length}</span> ·{' '}
                    <span style={{ color: 'var(--warn)' }}>变更 {d.changed.length}</span>
                  </div>
                </Show>
                <div class="actions">
                  <button onClick={() => { ui.switchVersion(v.vid); location.hash = '#/review'; }}>切换查看</button>
                  <button onClick={() => { location.hash = `#/compare?a=${ui.versions[0].vid}&b=${v.vid}`; location.reload(); }}
                    disabled={!d}>与上版比对</button>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      <Show when={showSubmit()}>
        <div class="modal-mask" onClick={() => setShowSubmit(false)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <h3>提交出图新版本</h3>
            <div class="meta" style={{ color: 'var(--fg-dim)', margin: '6px 0 10px' }}>
              系统将基于当前版本（{ui.versions.find((x) => x.vid === ui.currentVid())?.name}）记录一批模型修订，
              生成确定性的新版本，供审核与并排比对。
            </div>
            <textarea placeholder="本版修订说明，如：给水干管局部管径调整、新增两处闸阀…"
              value={note()} onInput={(e) => setNote(e.target.value)} />
            <div class="actions">
              <button class="ghost" onClick={() => setShowSubmit(false)}>取消</button>
              <button class="primary" onClick={submit}>确认提交</button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
