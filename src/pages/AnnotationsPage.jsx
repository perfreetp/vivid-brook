import { createMemo, createSignal, For, Show } from 'solid-js';
import { ui } from '../store';

const STATUS = [
  { id: 'all', name: '全部' },
  { id: 'open', name: '待处理' },
  { id: 'replied', name: '已回复' },
  { id: 'closed', name: '已关闭' },
];

export default function AnnotationsPage() {
  const [filter, setFilter] = createSignal('all');
  const [vidFilter, setVidFilter] = createSignal('all');
  const [draft, setDraft] = createSignal({});

  const list = createMemo(() =>
    ui.annotations
      .filter((a) => filter() === 'all' || a.status === filter())
      .filter((a) => vidFilter() === 'all' || a.vid === +vidFilter())
      .sort((a, b) => (a.status === 'open' ? -1 : 1)),
  );

  const counts = createMemo(() => ({
    open: ui.annotations.filter((a) => a.status === 'open').length,
    replied: ui.annotations.filter((a) => a.status === 'replied').length,
    closed: ui.annotations.filter((a) => a.status === 'closed').length,
  }));

  const reply = (id) => {
    const t = draft()[id]?.trim();
    if (!t) return;
    ui.replyAnnotation(id, t);
    setDraft((d) => ({ ...d, [id]: '' }));
  };

  const statusName = (s) => ({ open: '待处理', replied: '已回复', closed: '已关闭' }[s]);

  return (
    <div class="page">
      <div class="page-head">
        <h2>批注管理</h2>
        <span class="sub">审核人打点批注，制作方逐条回复处理，状态可跟踪闭环</span>
        <div style={{ flex: 1 }} />
        <select value={vidFilter()} onChange={(e) => setVidFilter(e.target.value)}>
          <option value="all">全部版本</option>
          <For each={ui.versions}>{(v) => <option value={v.vid}>{v.name}</option>}</For>
        </select>
        <For each={STATUS}>
          {(s) => (
            <button class={filter() === s.id ? 'primary' : ''} onClick={() => setFilter(s.id)}>
              {s.name}{s.id !== 'all' ? ` ${counts()[s.id]}` : ''}
            </button>
          )}
        </For>
      </div>

      <Show when={list().length === 0}>
        <div class="diff-empty">当前筛选条件下没有批注</div>
      </Show>

      <For each={list()}>
        {(a) => {
          const v = ui.versions.find((x) => x.vid === a.vid);
          return (
            <div class={`thread ${a.status === 'open' ? 'selected' : ''}`}>
              <div class="head">
                <span class={`tag ${a.status}`}>{statusName(a.status)}</span>
                <span class="author">{a.author}</span>
                <span class="time">{a.createdAt}</span>
                <span class="tag">{v?.name}</span>
                <div style={{ flex: 1 }} />
                <span class="loc">打点 X={a.x} / Y={a.y} / Z={a.z}</span>
                <Show when={a.status !== 'closed'}>
                  <button class="ghost" onClick={() => ui.setAnnotationStatus(a.id, 'closed')}>标记关闭</button>
                </Show>
              </div>
              <div class="body">{a.text}</div>
              <For each={a.replies}>
                {(r) => (
                  <div class="reply">
                    <div class="rhead">{r.author} · {r.at}</div>
                    <div>{r.text}</div>
                  </div>
                )}
              </For>
              <Show when={a.status !== 'closed'}>
                <div class="reply-form">
                  <input
                    placeholder="制作方逐条回复处理意见…"
                    value={draft()[a.id] ?? ''}
                    onInput={(e) => setDraft((d) => ({ ...d, [a.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && reply(a.id)}
                  />
                  <button class="primary" onClick={() => reply(a.id)}>回复</button>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}
