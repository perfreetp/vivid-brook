// 编辑画布:Canvas2D,平移缩放 / 选择 / 拖动吸附 / 对齐参考线 / 批注打点
import { onMount, onCleanup, createEffect, createSignal } from 'solid-js';
import {
  state, setState, entityList, addEntity, commit, undo, redo,
  deleteSelected, addAnnotation, distributeAlongEdge, persist,
} from './store';
import { KINDS } from './entities';
import {
  collectSnapPoints, nearestSnap, alignmentGuides, nearestEdge, pointInMP, dist,
} from './geometry';
import { produce } from 'solid-js/store';

export default function CanvasEditor() {
  let canvas, wrap;
  const [view, setView] = createSignal({ scale: 4, ox: 0, oy: 0 }); // px/mm + 偏移(px)
  let drag = null;        // 拖动会话
  let hoverSnap = null;   // 当前吸附指示
  let guides = null;      // 对齐参考线
  let rubber = null;      // 框选矩形
  let spaceDown = false;
  let edgeHover = null;   // edgeArray 模式下悬停的边

  const w2s = (p) => {
    const v = view();
    return [p[0] * v.scale + v.ox, p[1] * v.scale + v.oy];
  };
  const s2w = (sx, sy) => {
    const v = view();
    return [(sx - v.ox) / v.scale, (sy - v.oy) / v.scale];
  };

  function fitView() {
    const list = entityList();
    const rect = wrap.getBoundingClientRect();
    if (!list.length) { setView({ scale: 4, ox: rect.width / 2, oy: rect.height / 2 }); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of list) {
      x0 = Math.min(x0, e.bounds.x0); y0 = Math.min(y0, e.bounds.y0);
      x1 = Math.max(x1, e.bounds.x1); y1 = Math.max(y1, e.bounds.y1);
    }
    const pad = 60;
    const s = Math.min((rect.width - pad * 2) / Math.max(1, x1 - x0), (rect.height - pad * 2) / Math.max(1, y1 - y0));
    setView({ scale: Math.max(0.5, Math.min(12, s)), ox: rect.width / 2 - ((x0 + x1) / 2) * Math.max(0.5, Math.min(12, s)), oy: rect.height / 2 - ((y0 + y1) / 2) * Math.max(0.5, Math.min(12, s)) });
  }

  // ---------- 绘制 ----------
  function draw() {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr) { canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; }
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1a1d23';
    ctx.fillRect(0, 0, rect.width, rect.height);
    const v = view();

    // 模架螺孔网格
    const pitch = state.gridPitch;
    const [wx0, wy0] = s2w(0, 0), [wx1, wy1] = s2w(rect.width, rect.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    const gx0 = Math.floor(wx0 / pitch) * pitch, gy0 = Math.floor(wy0 / pitch) * pitch;
    for (let gx = gx0; gx <= wx1; gx += pitch) {
      for (let gy = gy0; gy <= wy1; gy += pitch) {
        const [sx, sy] = w2s([gx, gy]);
        ctx.beginPath();
        ctx.moveTo(sx - 4, sy); ctx.lineTo(sx + 4, sy);
        ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy + 4);
        ctx.stroke();
      }
    }
    // 原点
    const [ox0, oy0] = w2s([0, 0]);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.moveTo(ox0 - 8, oy0); ctx.lineTo(ox0 + 8, oy0); ctx.moveTo(ox0, oy0 - 8); ctx.lineTo(ox0, oy0 + 8); ctx.stroke();

    // 图元
    for (const e of entityList()) {
      const selected = state.selection.includes(e.id);
      ctx.save();
      if (e.hidden) ctx.globalAlpha = 0.25;
      for (const poly of e.geomWorld) {
        ctx.beginPath();
        for (const ring of poly) {
          ring.forEach((p, i) => {
            const [sx, sy] = w2s(p);
            i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
          });
          ctx.closePath();
        }
        ctx.fillStyle = KINDS[e.kind].color + (e.kind === 'insert' ? '33' : '55');
        ctx.strokeStyle = selected ? '#ffd54a' : KINDS[e.kind].color;
        ctx.lineWidth = selected ? 2.5 : 1.2;
        ctx.fill('evenodd');
        ctx.stroke();
      }
      // 选中时显示锚点
      if (selected) {
        ctx.fillStyle = '#ffd54a';
        for (const p of [...e.anchors, ...e.midpoints]) {
          const [sx, sy] = w2s(p);
          ctx.fillRect(sx - 3, sy - 3, 6, 6);
        }
      }
      // 名称标签
      const [lx, ly] = w2s([e.bounds.x0, e.bounds.y0]);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '10px sans-serif';
      ctx.fillText(KINDS[e.kind].name + (e.hidden ? '(隐藏)' : ''), lx, ly - 4);
      ctx.restore();
    }

    // 对齐参考线
    if (guides) {
      ctx.strokeStyle = '#ff4dd2';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      if (guides.gx) {
        const [sx] = w2s([guides.gx.x, 0]);
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, rect.height); ctx.stroke();
      }
      if (guides.gy) {
        const [, sy] = w2s([0, guides.gy.y]);
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(rect.width, sy); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // 吸附指示
    if (hoverSnap) {
      const [sx, sy] = w2s(hoverSnap.p);
      ctx.strokeStyle = hoverSnap.type === 'grid' ? '#8ab4ff' : '#4dffa6';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '10px sans-serif';
      ctx.fillText({ grid: '网格', endpoint: '端点', midpoint: '中点' }[hoverSnap.type] || '', sx + 10, sy - 6);
    }

    // edgeArray 悬停边高亮
    if (edgeHover) {
      const a = w2s(edgeHover.a), b = w2s(edgeHover.b);
      ctx.strokeStyle = '#4dffa6';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }

    // 框选
    if (rubber) {
      ctx.strokeStyle = '#8ab4ff';
      ctx.fillStyle = 'rgba(138,180,255,0.12)';
      ctx.setLineDash([4, 3]);
      ctx.fillRect(rubber.x0, rubber.y0, rubber.x1 - rubber.x0, rubber.y1 - rubber.y0);
      ctx.strokeRect(rubber.x0, rubber.y0, rubber.x1 - rubber.x0, rubber.y1 - rubber.y0);
      ctx.setLineDash([]);
    }

    // 批注点
    state.annotations.forEach((a, i) => {
      const [sx, sy] = w2s([a.x, a.y]);
      ctx.beginPath();
      ctx.arc(sx, sy, 9, 0, Math.PI * 2);
      ctx.fillStyle = a.status === 'done' ? '#4caf50' : '#ff9800';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), sx, sy);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    });
  }

  createEffect(() => {
    entityList(); state.selection; state.annotations; view(); state.gridPitch;
    state.tool;
    draw();
  });

  // ---------- 交互 ----------
  function snapCandidates(exclude) {
    const pts = [];
    const all = collectSnapPoints(entityList(), exclude);
    if (state.snap.endpoint) pts.push(...all.filter((p) => p.type === 'endpoint'));
    if (state.snap.midpoint) pts.push(...all.filter((p) => p.type === 'midpoint'));
    return pts;
  }

  function hitEntity(wp) {
    const list = entityList();
    for (let i = list.length - 1; i >= 0; i--) {
      if (!list[i].hidden && pointInMP(wp, list[i].geomWorld)) return list[i];
    }
    return null;
  }

  function onPointerDown(ev) {
    canvas.setPointerCapture(ev.pointerId);
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    const wp = s2w(sx, sy);

    if (ev.button === 1 || spaceDown) {
      drag = { type: 'pan', sx, sy, v0: view() };
      return;
    }
    if (state.tool === 'annotate') {
      const text = prompt('批注内容:');
      if (text) addAnnotation(wp[0], wp[1], text);
      return;
    }
    if (state.tool === 'edgeArray') {
      // 点选目标边 → 把当前选中图元沿该边等距排列
      const list = entityList();
      for (const e of list) {
        if (state.selection.includes(e.id)) continue;
        const ne = nearestEdge(wp, e.geomWorld, 12, view().scale);
        if (ne) {
          distributeAlongEdge(e.id, [...state.selection], ne.edgeIdx);
          setState('tool', 'select');
          return;
        }
      }
      return;
    }

    const hit = hitEntity(wp);
    if (hit) {
      let sel;
      if (ev.shiftKey) {
        sel = state.selection.includes(hit.id)
          ? state.selection.filter((id) => id !== hit.id)
          : [...state.selection, hit.id];
      } else {
        sel = state.selection.includes(hit.id) ? state.selection : [hit.id];
      }
      setState('selection', sel);
      // 开始拖动
      const starts = {};
      for (const id of sel) {
        const e = state.doc.entities[id];
        starts[id] = { x: e.x, y: e.y, geom: e.kind === 'composite' ? JSON.parse(JSON.stringify(e.geom)) : null };
      }
      drag = { type: 'move', sx, sy, wp0: wp, starts, moved: false, ids: sel };
    } else {
      if (!ev.shiftKey) setState('selection', []);
      rubber = { x0: sx, y0: sy, x1: sx, y1: sy };
      drag = { type: 'rubber' };
    }
  }

  function onPointerMove(ev) {
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    const wp = s2w(sx, sy);

    if (state.tool === 'edgeArray') {
      edgeHover = null;
      for (const e of entityList()) {
        if (state.selection.includes(e.id)) continue;
        const ne = nearestEdge(wp, e.geomWorld, 12, view().scale);
        if (ne) { edgeHover = ne; break; }
      }
      draw();
    }

    if (!drag) return;
    if (drag.type === 'pan') {
      setView({ ...drag.v0, ox: drag.v0.ox + sx - drag.sx, oy: drag.v0.oy + sy - drag.sy });
      return;
    }
    if (drag.type === 'rubber') {
      rubber = { ...rubber, x1: sx, y1: sy };
      return;
    }
    if (drag.type === 'move') {
      drag.moved = true;
      let dx = wp[0] - drag.wp0[0];
      let dy = wp[1] - drag.wp0[1];
      // 吸附:以第一个拖动图元的中心为探测点
      const firstId = drag.ids[0];
      const st0 = drag.starts[firstId];
      const exclude = new Set(drag.ids);
      const probe = [st0.x + dx, st0.y + dy];
      const snap = nearestSnap(probe, snapCandidates(exclude), 10, view().scale, state.snap.grid, state.gridPitch);
      hoverSnap = snap;
      if (snap) { dx += snap.p[0] - probe[0]; dy += snap.p[1] - probe[1]; }
      // 对齐参考线
      guides = state.snap.guides ? alignmentGuides([st0.x + dx, st0.y + dy], entityList(), exclude, 6, view().scale) : null;
      if (guides?.gx) dx += guides.gx.x - (st0.x + dx);
      if (guides?.gy) dy += guides.gy.y - (st0.y + dy);
      drag.dx = dx; drag.dy = dy;
      setState(produce((s) => {
        for (const id of drag.ids) {
          const e = s.doc.entities[id];
          const st = drag.starts[id];
          if (!e || e.locked) continue;
          e.x = st.x + dx; e.y = st.y + dy;
          if (e.kind === 'composite' && st.geom) {
            e.geom = st.geom.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x + dx, y + dy])));
          }
        }
      }));
    }
  }

  function onPointerUp(ev) {
    if (drag?.type === 'move' && drag.moved) commit('移动图元');
    if (drag?.type === 'rubber' && rubber) {
      const r = rubber;
      const w0 = s2w(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1));
      const w1 = s2w(Math.max(r.x0, r.x1), Math.max(r.y0, r.y1));
      const sel = entityList()
        .filter((e) => !e.hidden && e.bounds.x0 >= w0[0] && e.bounds.x1 <= w1[0] && e.bounds.y0 >= w0[1] && e.bounds.y1 <= w1[1])
        .map((e) => e.id);
      setState('selection', ev.shiftKey ? [...new Set([...state.selection, ...sel])] : sel);
      rubber = null;
    }
    drag = null;
    hoverSnap = null;
    guides = null;
    persist();
  }

  function onWheel(ev) {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    const v = view();
    const k = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    const ns = Math.max(0.3, Math.min(40, v.scale * k));
    const wp = s2w(sx, sy);
    setView({ scale: ns, ox: sx - wp[0] * ns, oy: sy - wp[1] * ns });
  }

  function onDrop(ev) {
    ev.preventDefault();
    const kind = ev.dataTransfer.getData('text/x-symbol');
    if (!kind) return;
    const rect = canvas.getBoundingClientRect();
    let wp = s2w(ev.clientX - rect.left, ev.clientY - rect.top);
    if (state.snap.grid) {
      wp = [Math.round(wp[0] / state.gridPitch) * state.gridPitch, Math.round(wp[1] / state.gridPitch) * state.gridPitch];
    }
    addEntity(kind, wp[0], wp[1]);
  }

  function onKeyDown(ev) {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
    if (ev.code === 'Space') { spaceDown = true; ev.preventDefault(); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); }
    if (ev.key === 'Delete' || ev.key === 'Backspace') deleteSelected();
    if (ev.key === 'Escape') { setState('selection', []); setState('tool', 'select'); }
    if (ev.key.startsWith('Arrow') && state.selection.length) {
      ev.preventDefault();
      const stepN = ev.shiftKey ? 10 : 1;
      const dx = ev.key === 'ArrowLeft' ? -stepN : ev.key === 'ArrowRight' ? stepN : 0;
      const dy = ev.key === 'ArrowUp' ? -stepN : ev.key === 'ArrowDown' ? stepN : 0;
      setState(produce((s) => {
        for (const id of s.selection) { const e = s.doc.entities[id]; if (e) { e.x += dx; e.y += dy; } }
      }));
      commit('微调位置');
    }
  }
  function onKeyUp(ev) { if (ev.code === 'Space') spaceDown = false; }

  let ro;
  onMount(() => {
    ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    fitView();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  });
  onCleanup(() => {
    ro?.disconnect();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  });

  return (
    <div ref={wrap} class="canvas-wrap"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}>
      <canvas
        ref={canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        style={{ cursor: state.tool === 'annotate' ? 'crosshair' : 'default', 'touch-action': 'none' }}
      />
      <div class="canvas-hud">
        <span>缩放 {(view().scale * 25.4 / 25.4).toFixed(1)}x</span>
        <button onClick={fitView}>适应视图</button>
        <span class="hint">空格+拖动平移 · 滚轮缩放 · Shift多选 · Del删除 · Ctrl+Z/Y 撤销重做</span>
      </div>
    </div>
  );
}
