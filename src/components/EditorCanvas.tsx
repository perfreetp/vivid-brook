import { useEffect, useRef } from 'react';
import type { Pt, Feature, FeatureKind, SnapResult, DistanceLabel } from '../types';
import { store, useEditor } from '../state/store';
import { KIND_META } from '../lib/factory';
import {
  ViewTransform,
  worldToScreen,
  screenToWorld,
  snapPoint,
  findSelfIntersections,
  nearestDistanceLabel,
  featuresInRect,
  pointSegDist,
  pointInPolygon,
  GRID_SIZE,
  fmtDist,
  dist,
} from '../lib/geometry';

interface DragState {
  mode: 'vertex' | 'pan' | 'box' | 'move';
  featureId?: string;
  vertexIndex?: number;
  startScreen?: Pt;
  startWorld?: Pt;
  curScreen?: Pt;
  startPoints?: Record<string, Pt[]>;
  moved?: boolean;
}

interface DraftState {
  kind: FeatureKind;
  points: Pt[];
}

const HANDLE_PX = 6;
const EDGE_HIT_PX = 7;

export default function EditorCanvas() {
  const state = useEditor();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sRef = useRef(state);
  sRef.current = state;

  const vtRef = useRef<ViewTransform>({ scale: 2.2, ox: 0, oy: 0, width: 1, height: 1 });
  const dragRef = useRef<DragState | null>(null);
  const draftRef = useRef<DraftState | null>(null);
  const hoverRef = useRef<{ fid: string; vi: number } | null>(null);
  const snapRef = useRef<SnapResult | null>(null);
  const labelRef = useRef<DistanceLabel | null>(null);
  const cursorWorldRef = useRef<Pt | null>(null);
  const initializedRef = useRef(false);

  // ---------- 命中测试 ----------
  const hitVertex = (w: Pt): { fid: string; vi: number } | null => {
    const vt = vtRef.current;
    const tol = HANDLE_PX / vt.scale;
    const s = sRef.current;
    for (const f of s.features) {
      if (!f.visible || f.locked) continue;
      for (let i = 0; i < f.points.length; i++) {
        if (dist(f.points[i], w) <= tol * 1.4) return { fid: f.id, vi: i };
      }
    }
    return null;
  };

  const hitFeature = (w: Pt): Feature | null => {
    const s = sRef.current;
    const vt = vtRef.current;
    const tol = EDGE_HIT_PX / vt.scale;
    // 逆序：后绘制的在上层
    for (let k = s.features.length - 1; k >= 0; k--) {
      const f = s.features[k];
      if (!f.visible) continue;
      const n = f.pathType === 'closed' ? f.points.length : f.points.length - 1;
      for (let i = 0; i < n; i++) {
        const r = pointSegDist(w, f.points[i], f.points[(i + 1) % f.points.length]);
        if (r.distance <= tol) return f;
      }
      if (f.pathType === 'closed' && pointInPolygon(w, f.points)) return f;
    }
    return null;
  };

  const isEditable = (f: Feature): boolean => !f.locked && !store.isLayerLocked(f.layerId);

  // ---------- 绘制 ----------
  const draw = (ctx: CanvasRenderingContext2D, now: number) => {
    const s = sRef.current;
    const vt = vtRef.current;
    const W = vt.width;
    const H = vt.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);

    // ---- 20 米网格 ----
    const tl = screenToWorld({ x: 0, y: 0 }, vt);
    const br = screenToWorld({ x: W, y: H }, vt);
    const minX = Math.floor(Math.min(tl.x, br.x) / GRID_SIZE) * GRID_SIZE;
    const maxX = Math.ceil(Math.max(tl.x, br.x) / GRID_SIZE) * GRID_SIZE;
    const minY = Math.floor(Math.min(tl.y, br.y) / GRID_SIZE) * GRID_SIZE;
    const maxY = Math.ceil(Math.max(tl.y, br.y) / GRID_SIZE) * GRID_SIZE;
    ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace, monospace';
    for (let x = minX; x <= maxX; x += GRID_SIZE) {
      const p = worldToScreen({ x, y: 0 }, vt);
      const major = Math.round(x / GRID_SIZE) % 5 === 0;
      ctx.strokeStyle = major ? '#cbd5e1' : '#e8edf3';
      ctx.beginPath();
      ctx.moveTo(p.x, 0);
      ctx.lineTo(p.x, H);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`${x}`, p.x + 2, H - 4);
      }
    }
    for (let y = minY; y <= maxY; y += GRID_SIZE) {
      const p = worldToScreen({ x: 0, y }, vt);
      const major = Math.round(y / GRID_SIZE) % 5 === 0;
      ctx.strokeStyle = major ? '#cbd5e1' : '#e8edf3';
      ctx.beginPath();
      ctx.moveTo(0, p.y);
      ctx.lineTo(W, p.y);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`${y}`, 4, p.y - 2);
      }
    }

    const selected = new Set(s.selectedIds);

    // ---- 要素 ----
    for (const f of s.features) {
      if (!f.visible) continue;
      const layer = s.layers.find((l) => l.id === f.layerId);
      const color = layer?.visible === false ? '#9ca3af' : KIND_META[f.kind].color;
      const pts = f.points.map((p) => worldToScreen(p, vt));
      if (pts.length < 2) continue;
      ctx.save();
      if (f.locked) ctx.globalAlpha = 0.65;

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (f.pathType === 'closed') ctx.closePath();

      if (f.pathType === 'closed') {
        // 外环 + 孔洞，evenodd 填充
        for (const hole of f.holes) {
          const hp = hole.map((p) => worldToScreen(p, vt));
          if (hp.length > 2) {
            ctx.moveTo(hp[0].x, hp[0].y);
            for (let i = 1; i < hp.length; i++) ctx.lineTo(hp[i].x, hp[i].y);
            ctx.closePath();
          }
        }
        ctx.fillStyle = KIND_META[f.kind].fill;
        ctx.fill('evenodd');
      }
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = selected.has(f.id) ? 3 : 2;
      if (f.role === 'bank') {
        ctx.setLineDash([7, 5]);
        ctx.lineWidth = 1.5;
      }
      ctx.strokeStyle = selected.has(f.id) ? '#1d4ed8' : color;
      ctx.stroke();
      ctx.setLineDash([]);

      // 方向箭头（开放路径选中时）
      if (selected.has(f.id) && f.pathType === 'open') {
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          ctx.fillStyle = '#1d4ed8';
          ctx.beginPath();
          ctx.moveTo(mx + 6 * Math.cos(ang), my + 6 * Math.sin(ang));
          ctx.lineTo(mx + 6 * Math.cos(ang + 2.5), my + 6 * Math.sin(ang + 2.5));
          ctx.lineTo(mx + 6 * Math.cos(ang - 2.5), my + 6 * Math.sin(ang - 2.5));
          ctx.closePath();
          ctx.fill();
        }
      }

      // 锁定标记
      if (f.locked) {
        const c = pts[0];
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#b45309';
        ctx.fillText('🔒', c.x + 6, c.y - 6);
      }
      ctx.restore();
    }

    // ---- 自交高亮（闭合路径实时检测） ----
    for (const f of s.features) {
      if (!f.visible || f.pathType !== 'closed' || f.points.length < 4) continue;
      if (!selected.has(f.id) && !(dragRef.current?.featureId === f.id)) continue;
      const hits = findSelfIntersections(f.points);
      for (const h of hits) {
        const sp = worldToScreen(h.p, vt);
        const pulse = 5 + Math.sin(now / 180) * 2.5;
        ctx.save();
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, pulse + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#dc2626';
        ctx.fill();
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('自交点', sp.x + 9, sp.y - 8);
        ctx.restore();
      }
    }

    // ---- 选中要素顶点 / 中点手柄 ----
    for (const f of s.features) {
      if (!selected.has(f.id) || !f.visible) continue;
      const pts = f.points.map((p) => worldToScreen(p, vt));
      // 中点手柄
      const segN = f.pathType === 'closed' ? pts.length : pts.length - 1;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < segN; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        ctx.beginPath();
        ctx.rect(mx - 3, my - 3, 6, 6);
        ctx.stroke();
      }
      // 顶点
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const hovered = hoverRef.current?.fid === f.id && hoverRef.current.vi === i;
        ctx.beginPath();
        ctx.arc(p.x, p.y, hovered ? HANDLE_PX + 2 : HANDLE_PX - 1, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#1d4ed8';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // ---- 绘制中的草稿路径 ----
    const draft = draftRef.current;
    if (draft && draft.points.length > 0) {
      const pts = draft.points.map((p) => worldToScreen(p, vt));
      ctx.save();
      ctx.strokeStyle = KIND_META[draft.kind].color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (cursorWorldRef.current) {
        const c = worldToScreen(cursorWorldRef.current, vt);
        ctx.lineTo(c.x, c.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = KIND_META[draft.kind].color;
        ctx.fill();
      }
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#334155';
      ctx.fillText(
        `${draft.kind === 'pool' ? '闭合面' : '开放线'}绘制中：${draft.points.length} 个顶点，双击/回车结束，右键回退`,
        12,
        20,
      );
      ctx.restore();
    }

    // ---- 吸附辅助线与标记 ----
    const snap = snapRef.current;
    if (snap) {
      const sp = worldToScreen(snap.point, vt);
      ctx.save();
      if (snap.guideLine) {
        const a = worldToScreen(snap.guideLine.a, vt);
        const b = worldToScreen(snap.guideLine.b, vt);
        ctx.strokeStyle = '#7c3aed';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      const label: Record<string, string> = {
        endpoint: '端点',
        midpoint: '中点',
        horizontal: '水平对齐',
        vertical: '垂直对齐',
        grid: '网格 20m',
      };
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#7c3aed';
      ctx.fillText(label[snap.type], sp.x + 10, sp.y - 8);
      ctx.restore();
    }

    // ---- 拖动邻近间距标注 ----
    const dl = labelRef.current;
    if (dl) {
      const a = worldToScreen(dl.from, vt);
      const b = worldToScreen(dl.to, vt);
      ctx.save();
      ctx.strokeStyle = '#0f766e';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#0f766e';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fill();
      const txt = fmtDist(dl.distance);
      ctx.font = 'bold 11px ui-monospace, monospace';
      const tw = ctx.measureText(txt).width;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(mx - tw / 2 - 4, my - 9, tw + 8, 16);
      ctx.fillStyle = '#0f766e';
      ctx.textAlign = 'center';
      ctx.fillText(txt, mx, my + 3);
      ctx.textAlign = 'left';
      ctx.restore();
    }

    // ---- 框选矩形 ----
    const drag = dragRef.current;
    if (drag?.mode === 'box' && drag.startScreen && drag.curScreen) {
      ctx.save();
      ctx.strokeStyle = '#2563eb';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      const x = Math.min(drag.startScreen.x, drag.curScreen.x);
      const y = Math.min(drag.startScreen.y, drag.curScreen.y);
      ctx.strokeRect(x, y, Math.abs(drag.curScreen.x - drag.startScreen.x), Math.abs(drag.curScreen.y - drag.startScreen.y));
      ctx.fillStyle = 'rgba(37,99,235,0.08)';
      ctx.fillRect(x, y, Math.abs(drag.curScreen.x - drag.startScreen.x), Math.abs(drag.curScreen.y - drag.startScreen.y));
      ctx.restore();
    }
  };

  // ---------- 事件处理 ----------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      vtRef.current.width = rect.width;
      vtRef.current.height = rect.height;
      if (!initializedRef.current) {
        vtRef.current.ox = rect.width / 2;
        vtRef.current.oy = rect.height / 2;
        initializedRef.current = true;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const loop = (t: number) => {
      draw(ctx, t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const eventPos = (e: PointerEvent | WheelEvent): Pt => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const sp = eventPos(e);
      const wp = screenToWorld(sp, vtRef.current);
      const s = sRef.current;

      // 平移：中键或平移工具
      if (e.button === 1 || s.currentTool === 'pan') {
        dragRef.current = { mode: 'pan', startScreen: sp, curScreen: sp };
        return;
      }
      if (e.button !== 0) return;

      // 绘制工具
      if (s.currentTool === 'intake' || s.currentTool === 'drain' || s.currentTool === 'pool') {
        const kind = s.currentTool as FeatureKind;
        if (!draftRef.current || draftRef.current.kind !== kind) {
          draftRef.current = { kind, points: [] };
        }
        const snapped = snapPoint(wp, s.features, null, vtRef.current);
        draftRef.current.points.push(snapped ? snapped.point : wp);
        return;
      }

      // 选择工具
      const vHit = hitVertex(wp);
      if (vHit) {
        const f = s.features.find((x) => x.id === vHit.fid)!;
        if (!isEditable(f)) return;
        if (!s.selectedIds.includes(vHit.fid)) store.select([vHit.fid], e.shiftKey);
        store.beginGesture();
        dragRef.current = { mode: 'vertex', featureId: vHit.fid, vertexIndex: vHit.vi, startScreen: sp };
        return;
      }
      const fHit = hitFeature(wp);
      if (fHit) {
        if (!isEditable(fHit)) {
          store.select([fHit.id], e.shiftKey);
          return;
        }
        if (!s.selectedIds.includes(fHit.id)) store.select([fHit.id], e.shiftKey);
        const starts: Record<string, Pt[]> = {};
        sRef.current.features
          .filter((f) => sRef.current.selectedIds.includes(f.id) && isEditable(f))
          .forEach((f) => {
            starts[f.id] = f.points.map((p) => ({ ...p }));
          });
        store.beginGesture();
        dragRef.current = {
          mode: 'move',
          startWorld: wp,
          startScreen: sp,
          startPoints: starts,
        };
        return;
      }
      // 空白处：框选
      dragRef.current = { mode: 'box', startScreen: sp, curScreen: sp };
    };

    const onPointerMove = (e: PointerEvent) => {
      const sp = eventPos(e);
      const vt = vtRef.current;
      const rawWp = screenToWorld(sp, vt);
      cursorWorldRef.current = rawWp;
      const s = sRef.current;
      const drag = dragRef.current;

      // 悬停顶点高亮
      hoverRef.current = s.currentTool === 'select' ? hitVertex(rawWp) : null;
      canvas.style.cursor = hoverRef.current ? 'pointer' : s.currentTool === 'pan' ? 'grab' : 'crosshair';

      if (!drag) {
        snapRef.current = null;
        labelRef.current = null;
        return;
      }
      drag.moved = true;
      drag.curScreen = sp;

      if (drag.mode === 'pan') {
        const d = { x: sp.x - (drag.startScreen?.x ?? sp.x), y: sp.y - (drag.startScreen?.y ?? sp.y) };
        vt.ox += d.x;
        vt.oy += d.y;
        drag.startScreen = sp;
        return;
      }

      if (drag.mode === 'box') return;

      // 吸附
      const editingId = drag.featureId ?? null;
      const snapped = snapPoint(rawWp, s.features, editingId, vt);
      snapRef.current = snapped;
      const wp = snapped ? snapped.point : rawWp;

      if (drag.mode === 'vertex' && drag.featureId !== undefined && drag.vertexIndex !== undefined) {
        store.moveVertexGesture(drag.featureId, drag.vertexIndex, wp);
        labelRef.current = nearestDistanceLabel(wp, s.features, drag.featureId);
      } else if (drag.mode === 'move' && drag.startWorld && drag.startPoints) {
        const delta = { x: wp.x - drag.startWorld.x, y: wp.y - drag.startWorld.y };
        store.applyGesture((d) => {
          for (const f of d.features) {
            const start = drag.startPoints![f.id];
            if (!start || f.locked) continue;
            f.points = start.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
          }
        });
        labelRef.current = nearestDistanceLabel(wp, s.features, s.selectedIds[0] ?? '');
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      snapRef.current = null;
      labelRef.current = null;
      if (!drag) return;

      if (drag.mode === 'vertex' || drag.mode === 'move') {
        if (drag.moved) store.endGesture();
        else store.cancelGesture();
      } else if (drag.mode === 'box' && drag.startScreen && drag.curScreen) {
        const a = screenToWorld(drag.startScreen, vtRef.current);
        const b = screenToWorld(drag.curScreen, vtRef.current);
        if (dist(drag.startScreen, drag.curScreen) > 4) {
          const ids = featuresInRect(sRef.current.features, a, b).filter((id) => {
            const f = sRef.current.features.find((x) => x.id === id);
            return f && isEditable(f);
          });
          store.setSelectionLive(
            e.shiftKey ? Array.from(new Set([...sRef.current.selectedIds, ...ids])) : ids,
          );
        } else if (!e.shiftKey) {
          store.setSelectionLive([]);
        }
      }
    };

    const onDblClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const wp = screenToWorld(sp, vtRef.current);
      const s = sRef.current;

      // 绘制中：结束草稿
      if (draftRef.current) {
        const d = draftRef.current;
        // 双击前的 pointerdown 会追加一个重复尾点，去除
        if (d.points.length >= 2) {
          const last = d.points[d.points.length - 1];
          const prev = d.points[d.points.length - 2];
          if (dist(last, prev) < 1e-6) d.points.pop();
        }
        const min = d.kind === 'pool' ? 3 : 2;
        if (d.points.length >= min) {
          store.addFeatureFromPoints(d.kind, d.points.map((p) => ({ ...p })));
        }
        draftRef.current = null;
        return;
      }
      if (s.currentTool !== 'select') return;
      const vHit = hitVertex(wp);
      if (vHit) {
        const f = s.features.find((x) => x.id === vHit.fid)!;
        if (isEditable(f)) store.splitAt(f.id, vHit.vi);
        return;
      }
      const fHit = hitFeature(wp);
      if (fHit && isEditable(fHit)) store.insertVertex(fHit.id, wp);
    };

    const onContext = (e: MouseEvent) => {
      if (draftRef.current && draftRef.current.points.length > 0) {
        e.preventDefault();
        draftRef.current.points.pop();
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const sp = eventPos(e);
      const vt = vtRef.current;
      const before = screenToWorld(sp, vt);
      const factor = Math.pow(1.12, -e.deltaY / 100);
      vt.scale = Math.min(40, Math.max(0.2, vt.scale * factor));
      const after = screenToWorld(sp, vt);
      vt.ox += (after.x - before.x) * vt.scale;
      vt.oy -= (after.y - before.y) * vt.scale;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        store.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        store.deleteSelected();
      } else if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        store.setSelectionLive(sRef.current.features.filter((f) => f.visible && isEditable(f)).map((f) => f.id));
      } else if (e.key === 'Enter' && draftRef.current) {
        const d = draftRef.current;
        const min = d.kind === 'pool' ? 3 : 2;
        if (d.points.length >= min) store.addFeatureFromPoints(d.kind, d.points.map((p) => ({ ...p })));
        draftRef.current = null;
      } else if (e.key === 'Escape') {
        if (dragRef.current) {
          store.cancelGesture();
          dragRef.current = null;
        }
        draftRef.current = null;
        store.clearSelection();
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 工具切换时丢弃草稿
  useEffect(() => {
    if (state.currentTool === 'select') draftRef.current = null;
  }, [state.currentTool]);

  const vt = vtRef.current;
  const snapType = snapRef.current?.type;
  const selectedCount = state.selectedIds.length;

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <canvas ref={canvasRef} />
      <div className="canvas-hud">
        <span>工具：{toolLabel(state.currentTool)}</span>
        <span>吸附：{snapType ? snapLabel(snapType) : '—'}</span>
        <span>缩放：{(vt.scale * 100).toFixed(0)}%</span>
        <span>选中：{selectedCount}</span>
        <span>历史：{store.history.depth}/100（≥50 步）</span>
        <span>滚轮缩放 · 中键/平移工具平移 · 双击线段插顶点 · 双击顶点断开</span>
      </div>
    </div>
  );
}

function toolLabel(t: string): string {
  return { select: '选择/编辑', intake: '纳潮渠', drain: '排淡沟', pool: '卤水池', pan: '平移' }[t] ?? t;
}
function snapLabel(t: string): string {
  return { endpoint: '端点', midpoint: '中点', horizontal: '水平', vertical: '垂直', grid: '20m网格' }[t] ?? t;
}
