// 审核对比:版本提交 / 批注回复 / 双版本并排差异
import { For, Show, createSignal, createEffect, createMemo } from 'solid-js';
import {
  state, setState, commitVersion, replyAnnotation, toggleAnnotationStatus, diffVersions,
} from './store';
import { KINDS, decorate } from './entities';

function drawDoc(canvas, doc, highlight = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#15181d';
  ctx.fillRect(0, 0, W, H);
  const list = doc.order.map((id) => doc.entities[id]).filter(Boolean).map(decorate);
  if (!list.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of list) {
    x0 = Math.min(x0, e.bounds.x0); y0 = Math.min(y0, e.bounds.y0);
    x1 = Math.max(x1, e.bounds.x1); y1 = Math.max(y1, e.bounds.y1);
  }
  const s = Math.min((W - 20) / Math.max(1, x1 - x0), (H - 20) / Math.max(1, y1 - y0));
  const ox = W / 2 - ((x0 + x1) / 2) * s, oy = H / 2 - ((y0 + y1) / 2) * s;
  for (const e of list) {
    const hl = highlight[e.id];
    for (const poly of e.geomWorld) {
      ctx.beginPath();
      for (const ring of poly) {
        ring.forEach(([x, y], i) => {
          i === 0 ? ctx.moveTo(x * s + ox, y * s + oy) : ctx.lineTo(x * s + ox, y * s + oy);
        });
        ctx.closePath();
      }
      ctx.fillStyle = (hl === 'added' ? '#4caf50' : hl === 'removed' ? '#f44336' : hl === 'modified' ? '#ff9800' : KINDS[e.kind].color) + '55';
      ctx.strokeStyle = hl ? ctx.fillStyle.slice(0, 7) : KINDS[e.kind].color;
      ctx.lineWidth = hl ? 2 : 1;
      ctx.fill('evenodd');
      ctx.stroke();
    }
  }
}

function CompareView(props) {
  let ca, cb;
  const diff = createMemo(() => diffVersions(props.a, props.b));
  createEffect(() => {
    const d = diff();
    if (!d) return;
    const hlA = {}, hlB = {};
    for (const e of d.removed) hlA[e.id] = 'removed';
    for (const e of d.modified) { hlA[e.id] = 'modified'; hlB[e.id] = 'modified'; }
    for (const e of d.added) hlB[e.id] = 'added';
    drawDoc(ca, d.a.doc, hlA);
    drawDoc(cb, d.b.doc, hlB);
  });
  return (
    <div class="compare">
      <div class="compare-row">
        <div class="compare-cell">
          <div class="compare-title">{diff()?.a.name} <span class="muted">{diff()?.a.time}</span></div>
          <canvas ref={ca} width="300" height="220" />
        </div>
        <div class="compare-cell">
          <div class="compare-title">{diff()?.b.name} <span class="muted">{diff()?.b.time}</span></div>
          <canvas ref={cb} width="300" height="220" />
        </div>
      </div>
      <div class="diff-list">
        <Show when={diff()}>
          {(d) => (
            <>
              <div class="diff-line added">新增 {d().added.length} 个图元</div>
              <div class="diff-line removed">删除 {d().removed.length} 个图元</div>
              <div class="diff-line modified">修改 {d().modified.length} 个图元</div>
              <For each={[...d().added, ...d().modified]}>
                {(e) => <div class="diff-item">{KINDS[e.kind]?.name ?? e.kind} · {e.id}</div>}
              </For>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}

export default function ReviewPanel() {
  const [cmpA, setCmpA] = createSignal('');
  const [cmpB, setCmpB] = createSignal('');
  const [replyText, setReplyText] = createSignal({});

  return (
    <div class="review-panel">
      <div class="panel-section">
        <div class="section-title">版本</div>
        <button class="primary" onClick={() => {
          const name = prompt('版本名称:', `V${state.versions.length + 1}`);
          if (name !== null) commitVersion(name);
        }}>提交当前方案为新版本</button>
        <For each={state.versions}>
          {(v) => (
            <div class="version-item">
              <b>{v.name}</b>
              <span class="muted">{v.time}</span>
              <span class="muted">{v.doc.order.length} 图元</span>
            </div>
          )}
        </For>
        <Show when={state.versions.length >= 2}>
          <div class="compare-picker">
            <select value={cmpA()} onChange={(e) => setCmpA(e.target.value)}>
              <option value="">版本A…</option>
              <For each={state.versions}>{(v) => <option value={v.id}>{v.name}</option>}</For>
            </select>
            <select value={cmpB()} onChange={(e) => setCmpB(e.target.value)}>
              <option value="">版本B…</option>
              <For each={state.versions}>{(v) => <option value={v.id}>{v.name}</option>}</For>
            </select>
          </div>
        </Show>
        <Show when={cmpA() && cmpB() && cmpA() !== cmpB()}>
          <CompareView a={cmpA()} b={cmpB()} />
        </Show>
      </div>

      <div class="panel-section">
        <div class="section-title">批注 ({state.annotations.filter((a) => a.status === 'open').length} 待处理)</div>
        <div class="hint">在画布工具栏切到「批注」模式后,点击画布打点</div>
        <For each={state.annotations}>
          {(a, i) => (
            <div class={`annotation ${a.status}`}>
              <div class="ann-head">
                <span class="ann-no" style={{ background: a.status === 'done' ? '#4caf50' : '#ff9800' }}>{i() + 1}</span>
                <b>{a.author}</b>
                <span class="muted">{a.time}</span>
                <button class="mini" onClick={() => toggleAnnotationStatus(a.id)}>
                  {a.status === 'open' ? '标记已处理' : '重开'}
                </button>
              </div>
              <div class="ann-text">{a.text}</div>
              <For each={a.replies}>
                {(r) => <div class="ann-reply"><b>{r.author}:</b> {r.text} <span class="muted">{r.time}</span></div>}
              </For>
              <div class="ann-reply-box">
                <input
                  placeholder="制作方回复…"
                  value={replyText()[a.id] ?? ''}
                  onInput={(e) => setReplyText((t) => ({ ...t, [a.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target.value.trim()) {
                      replyAnnotation(a.id, e.target.value.trim());
                      setReplyText((t) => ({ ...t, [a.id]: '' }));
                    }
                  }}
                />
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
