import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { GalleryRenderer } from '../lib/renderer';
import { CHAMBERS, LEVELS, PROFESSIONS, GALLERY_LENGTH } from '../lib/constants';
import { ui } from '../store';
import LayerTree from '../components/LayerTree';

// 元素 -> pickId 的反查由渲染器内部维护，这里通过回调拿到 id
export default function ReviewPage() {
  let canvasRef, markerLayerRef, renderer;
  const [selected, setSelected] = createSignal(null);
  const [hovered, setHovered] = createSignal(null);
  const [pickMap, setPickMap] = createSignal(new Map());
  const [annOpen, setAnnOpen] = createSignal(false);
  const [annPoint, setAnnPoint] = createSignal(null);
  const [annText, setAnnText] = createSignal('');
  const [toast, setToast] = createSignal('');
  const [selectedAnn, setSelectedAnn] = createSignal(null);

  const model = ui.currentModel;

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  };

  onMount(() => {
    renderer = new GalleryRenderer(canvasRef, {
      onPick: (el, pickId) => {
        setSelected(el);
        ui.setSelectedId(el?.id ?? null);
        const h = selectedPick();
        renderer.setHighlight(pickId || 0, hoveredPick());
        selectedPickSet(pickId || 0);
      },
      onHover: (el, pickId) => {
        setHovered(el);
        ui.setHoveredId(el?.id ?? null);
        renderer.setHighlight(selectedPick(), pickId || 0);
        hoveredPickSet(pickId || 0);
        canvasRef.style.cursor = el ? 'pointer' : 'grab';
      },
      onLOD: (lod) => ui.setLodLevel(lod),
      onStats: (s) => ui.setStats(s),
      onAnnotate: (world) => {
        setAnnPoint(world);
        setAnnOpen(true);
      },
    });
    renderer.annotateMode = false;
    window.__renderer = renderer;
    onCleanup(() => { renderer.dispose(); window.__renderer = null; });
  });

  let _selPick = 0, _hovPick = 0;
  const selectedPick = () => _selPick;
  const selectedPickSet = (v) => { _selPick = v; };
  const hoveredPick = () => _hovPick;
  const hoveredPickSet = (v) => { _hovPick = v; };

  // 模型切换 -> 重建缓冲
  createEffect(() => {
    const m = model();
    if (renderer && m) {
      renderer.setModel(m);
      setSelected(null);
      ui.setSelectedId(null);
      _selPick = 0; _hovPick = 0;
      rebuildMarkers();
    }
  });

  // 图层掩码 -> 着色器 uniform + cell 可见性（关闭图层不参与拾取/裁剪）
  createEffect(() => {
    renderer?.setLayerMask(ui.layerMask());
  });

  // 剖切位置
  createEffect(() => {
    renderer?.setSlice(ui.sliceX());
  });

  // 批注标记 DOM
  const markerEls = new Map();
  function rebuildMarkers() {
    if (!markerLayerRef) return;
    markerLayerRef.innerHTML = '';
    markerEls.clear();
    const anns = ui.currentAnnotations();
    const markers = [];
    anns.forEach((a, i) => {
      const el = document.createElement('div');
      el.className = `marker ${a.status}`;
      el.innerHTML = `<span>${i + 1}</span>`;
      el.title = `${a.author}: ${a.text}`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedAnn(a.id);
      });
      markerLayerRef.appendChild(el);
      markerEls.set(a.id, el);
      markers.push({ world: [a.x, a.y, a.z], el });
    });
    renderer?.setMarkers(markers);
  }
  createEffect(() => { ui.currentAnnotations(); rebuildMarkers(); });
  createEffect(() => {
    const id = selectedAnn();
    for (const [aid, el] of markerEls) el.classList.toggle('selected', aid === id);
  });

  const toggleAnnotate = () => {
    const next = !ui.annotateMode();
    ui.setAnnotateMode(next);
    renderer.annotateMode = next;
    showToast(next ? '批注模式：在模型上点击打点' : '已退出批注模式');
  };

  const submitAnnotation = () => {
    if (!annText().trim() || !annPoint()) return;
    ui.addAnnotation(annPoint(), annText().trim());
    setAnnOpen(false); setAnnText(''); setAnnPoint(null);
    showToast('批注已提交');
    setTimeout(rebuildMarkers, 0);
  };

  const onSliceInput = (e) => {
    const v = +e.target.value;
    ui.setSliceX(v >= GALLERY_LENGTH - 1 ? null : v);
  };

  const resetView = () => {
    renderer.cam = { yaw: 0.55, pitch: 0.42, dist: 70, target: [GALLERY_LENGTH / 2, -5.4, 0] };
  };

  const selectedAnnObj = createMemo(() => ui.annotations.find((a) => a.id === selectedAnn()));

  const kindName = { main: '干管', branch: '支管', support: '支架', fitting: '附件', structure: '结构', collar: '接头' };
  const lodName = ['远景 · 主廊+干管', '中景 · +支管', '近景 · +支架/附件'];

  return (
    <div class="review-layout">
      <aside class="sidebar">
        <LayerTree />
      </aside>

      <div class="viewport-wrap">
        <canvas ref={canvasRef} />
        <div ref={markerLayerRef} style={{ position: 'absolute', inset: 0, 'pointer-events': 'none' }} />

        <div class="toolbar-top">
          <button class={ui.annotateMode() ? 'active' : ''} onClick={toggleAnnotate}>
            {ui.annotateMode() ? '● 批注打点中' : '批注打点'}
          </button>
          <button onClick={resetView}>复位视角</button>
          <button onClick={() => ui.setSliceX(null)}>清除剖切</button>
        </div>

        <Show when={selected()}>
          <div class="info-card">
            <h3>
              <span class="swatch" style={{
                width: 12, height: 12, display: 'inline-block',
                background: rgbOf(selected().color),
              }} />
              {selected().name}
            </h3>
            <div class="kv"><span class="k">构件类型</span><span class="v">{kindName[selected().kind] || selected().kind}</span></div>
            <Show when={selected().prof}>
              <div class="kv"><span class="k">所属专业</span><span class="v">{PROFESSIONS[selected().prof]?.name}</span></div>
            </Show>
            <Show when={selected().chamber}>
              <div class="kv"><span class="k">所属舱室</span><span class="v">{CHAMBERS[selected().chamber]?.name}</span></div>
            </Show>
            <div class="kv"><span class="k">标高</span><span class="v">{selected().elev.toFixed(2)} m</span></div>
            <Show when={selected().radius}>
              <div class="kv"><span class="k">管径 / 半径</span><span class="v">DN{Math.round(selected().radius * 2000)}（r={selected().radius.toFixed(3)}m）</span></div>
            </Show>
            <div class="kv"><span class="k">轴线位置</span><span class="v">X={selected().pos[0].toFixed(1)} Z={selected().pos[2].toFixed(1)}</span></div>
            <Show when={selected().spec}><div class="kv"><span class="k">规格</span><span class="v">{selected().spec}</span></div></Show>
            <div class="kv"><span class="k">图层状态</span><span class="v">{(selected().layerMask & ui.layerMask()) ? '可见' : '已关闭'}</span></div>
          </div>
        </Show>

        <Show when={hovered() && !selected()}>
          <div class="info-card" style={{ opacity: 0.88, width: 240 }}>
            <h3>{hovered().name} <span class="tag" style={{ 'margin-left': 'auto' }}>悬停预览</span></h3>
            <div class="kv"><span class="k">标高</span><span class="v">{hovered().elev.toFixed(2)} m</span></div>
            <Show when={hovered().chamber}>
              <div class="kv"><span class="k">舱室</span><span class="v">{CHAMBERS[hovered().chamber]?.name}</span></div>
            </Show>
          </div>
        </Show>

        <Show when={selectedAnnObj()}>
          <div class="info-card" style={{ top: selected() ? 250 : 14, width: 320 }}>
            <h3>批注 #{selectedAnnObj().id.slice(-2)} <span class={`tag ${selectedAnnObj().status}`} style={{ 'margin-left': 'auto' }}>{statusName(selectedAnnObj().status)}</span></h3>
            <div class="meta" style={{ color: 'var(--fg-dim)', margin: '4px 0' }}>{selectedAnnObj().author} · {selectedAnnObj().createdAt}</div>
            <div style={{ 'line-height': 1.6, margin: '6px 0' }}>{selectedAnnObj().text}</div>
            <div class="meta">打点位置：X={selectedAnnObj().x} / Y={selectedAnnObj().y} / Z={selectedAnnObj().z}</div>
            <For each={selectedAnnObj().replies}>
              {(r) => (
                <div class="reply">
                  <div class="rhead">{r.author} · {r.at}</div>
                  <div>{r.text}</div>
                </div>
              )}
            </For>
            <div class="reply-form">
              <input placeholder="制作方逐条回复…" onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  ui.replyAnnotation(selectedAnnObj().id, e.currentTarget.value.trim());
                  e.currentTarget.value = '';
                  rebuildMarkers();
                }
              }} />
              <button class="primary" onClick={() => {
                const inp = document.querySelector('.info-card .reply-form input');
                if (inp?.value.trim()) { ui.replyAnnotation(selectedAnnObj().id, inp.value.trim()); inp.value = ''; rebuildMarkers(); }
              }}>回复</button>
              <button class="ghost" onClick={() => { ui.setAnnotationStatus(selectedAnnObj().id, 'closed'); rebuildMarkers(); }}>关闭</button>
            </div>
          </div>
        </Show>

        <div class="hud">
          <div class="item"><b>{ui.stats().fps}</b><span>FPS</span></div>
          <div class="item"><b>{ui.stats().instances}</b><span>实例总数</span></div>
          <div class="item"><b>{ui.stats().cells}</b><span>可见 Cell</span></div>
          <div class="item"><b>{ui.lodLevel()}</b><span>LOD 级别</span></div>
        </div>

        <div class="slice-bar">
          <div style={{ display: 'flex', 'justify-content': 'space-between', 'margin-bottom': 6 }}>
            <span>沿轴线剖切（X 向）</span>
            <span class="val">{ui.sliceX() == null ? '关闭' : `X=${ui.sliceX().toFixed(0)}m`}</span>
          </div>
          <div class="row">
            <span class="cnt">0m</span>
            <input type="range" min={0} max={GALLERY_LENGTH} value={ui.sliceX() ?? GALLERY_LENGTH} onInput={onSliceInput} />
            <span class="cnt">{GALLERY_LENGTH}m</span>
          </div>
          <div class="hint" style={{ 'margin-top': 4 }}>剖切后可观察分层平面：上层热力(-3.5m) / 中层电力通信(-5.5m) / 下层给水(-7.0m)</div>
        </div>

        <Show when={annOpen()}>
          <div class="modal-mask" onClick={() => setAnnOpen(false)}>
            <div class="modal" onClick={(e) => e.stopPropagation()}>
              <h3>审核批注打点</h3>
              <div class="meta" style={{ color: 'var(--fg-dim)', marginBottom: 8 }}>
                打点坐标：X={annPoint()?.[0].toFixed(2)} / Y={annPoint()?.[1].toFixed(2)} / Z={annPoint()?.[2].toFixed(2)}
              </div>
              <textarea placeholder="填写审核意见…" value={annText()} onInput={(e) => setAnnText(e.target.value)} />
              <div class="actions">
                <button class="ghost" onClick={() => setAnnOpen(false)}>取消</button>
                <button class="primary" onClick={submitAnnotation}>提交批注</button>
              </div>
            </div>
          </div>
        </Show>

        <Show when={toast()}><div class="toast">{toast()}</div></Show>
      </div>
    </div>
  );
}

const rgbOf = (c) => c ? `rgb(${c.map((v) => Math.round(v * 255)).join(',')})` : '#888';
const statusName = (s) => ({ open: '待处理', replied: '已回复', closed: '已关闭' }[s] || s);
