<template>
  <div class="canvas-wrap" ref="wrapRef">
    <canvas ref="canvasRef" class="stage-canvas"></canvas>
    <div class="canvas-hud">
      <span>缩放 {{ Math.round(scale * 100) }}%</span>
      <button class="mini" @click="zoomBy(1.2)">＋</button>
      <button class="mini" @click="zoomBy(1 / 1.2)">－</button>
      <button class="mini" @click="resetView">复位</button>
      <span class="hint">{{ hintText }}</span>
    </div>
    <div v-if="guides.length" class="guide-badge">吸附参考线 ×{{ guideCount }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Application, Container, Graphics, Text } from 'pixi.js'
import { store, currentShow, addShape, pushHistory, hitTest, placeRobot, removeShapes } from '../store/store.js'
import { shapeToContour, boundsOfShape, insertNodeOnPath } from '../lib/geometry.js'
import { buildCommands, paintCommands } from '../lib/pathbuild.js'
import { computeSnap } from '../lib/snap.js'

const wrapRef = ref(null), canvasRef = ref(null)
const scale = ref(1)
const guides = ref([])
const guideCount = computed(() => guides.value.length)

let app, viewport, gridG, shapeLayer, guideG, overlayG, labelLayer
let drag = null // 交互状态机
const HANDLE_R = 6

const hintText = computed(() => ({
  select: '拖动图形移动 · 双击路径插入节点 · 滚轮缩放 · 空格/中键平移',
  rect: '按下拖拽绘制矩形（圆角在右侧面板调整）',
  circle: '按下拖拽绘制圆',
  polygon: '单击添加顶点，双击或回车闭合，Esc 取消',
  path: '单击添加路径节点（拖拽出曲率手柄），双击结束，Esc 取消',
  node: '节点工具：拖锚点移动 · 拖圆点改曲率 · 双击边线插入节点'
}[store.tool] || ''))

onMounted(async () => {
  app = new Application()
  await app.init({ canvas: canvasRef.value, resizeTo: wrapRef.value, background: '#0b0e16', antialias: true, autoDensity: true })
  viewport = new Container(); app.stage.addChild(viewport)
  gridG = new Graphics(); viewport.addChild(gridG)
  shapeLayer = new Container(); viewport.addChild(shapeLayer)
  guideG = new Graphics(); viewport.addChild(guideG)
  overlayG = new Graphics(); viewport.addChild(overlayG)
  labelLayer = new Container(); viewport.addChild(labelLayer)

  const el = app.canvas
  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  el.addEventListener('dblclick', onDblClick)
  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('contextmenu', onContext)
  el.addEventListener('pointerenter', onPointerEnter)
  el.addEventListener('drop', onHtmlDrop)
  el.addEventListener('dragover', onDragOver)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)

  app.ticker.add(render)
  resetView()
})

let spaceDown = false
function onPointerEnter() { /* 占位：确保指针事件激活 */ }
function onKeyUp(e) { if (e.code === 'Space') spaceDown = false }
function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
function onHtmlDrop(e) {
  e.preventDefault()
  if (!store.robotModel) return
  const rect = app.canvas.getBoundingClientRect()
  const x = (e.clientX - rect.left - viewport.x) / viewport.scale.x
  const y = (e.clientY - rect.top - viewport.y) / viewport.scale.y
  const r = placeRobot(store.robotModel, x, y)
  store.selection = [r.id]
}

onBeforeUnmount(() => {
  app?.canvas?.removeEventListener('pointerdown', onDown)
  app?.canvas?.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  app?.canvas?.removeEventListener('dblclick', onDblClick)
  app?.canvas?.removeEventListener('wheel', onWheel)
  app?.canvas?.removeEventListener('contextmenu', onContext)
  app?.canvas?.removeEventListener('pointerenter', onPointerEnter)
  app?.canvas?.removeEventListener('drop', onHtmlDrop)
  app?.canvas?.removeEventListener('dragover', onDragOver)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKeyUp)
  app?.destroy({ removeView: true })
})

watch(() => store.currentShowId, () => { drag = null; guides.value = [] })

// ---------- 坐标 ----------
function toWorld(e) {
  const rect = app.canvas.getBoundingClientRect()
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top
  return { x: (sx - viewport.x) / viewport.scale.x, y: (sy - viewport.y) / viewport.scale.y }
}
function zoomBy(f) {
  const next = Math.max(0.25, Math.min(4, viewport.scale.x * f))
  const cx = app.screen.width / 2, cy = app.screen.height / 2
  const wx = (cx - viewport.x) / viewport.scale.x, wy = (cy - viewport.y) / viewport.scale.y
  viewport.scale.set(next)
  viewport.x = cx - wx * next; viewport.y = cy - wy * next
  scale.value = next
}
function resetView() {
  const show = currentShow.value
  if (!show || !app) return
  const fit = Math.min((app.screen.width - 80) / show.stage.width, (app.screen.height - 120) / show.stage.height, 1.4)
  viewport.scale.set(fit)
  viewport.x = (app.screen.width - show.stage.width * fit) / 2
  viewport.y = (app.screen.height - show.stage.height * fit) / 2 + 10
  scale.value = fit
}
function onWheel(e) {
  e.preventDefault()
  const f = e.deltaY < 0 ? 1.12 : 1 / 1.12
  const rect = app.canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left, my = e.clientY - rect.top
  const wx = (mx - viewport.x) / viewport.scale.x, wy = (my - viewport.y) / viewport.scale.y
  const next = Math.max(0.25, Math.min(4, viewport.scale.x * f))
  viewport.scale.set(next)
  viewport.x = mx - wx * next; viewport.y = my - wy * next
  scale.value = next
}
function onContext(e) { e.preventDefault() }
function onKey(e) {
  if (e.code === 'Space') { spaceDown = true; return }
  if (e.key === 'Escape') {
    // 绘制中的半成品直接丢弃，不入撤销栈
    if (drag && (drag.kind === 'poly' || drag.kind === 'path')) {
      const show = currentShow.value
      if (show) show.shapes = show.shapes.filter(s => s.id !== drag.id)
      drag = null
      return
    }
    drag = null; store.selection = []
  }
  if (e.key === 'Enter' && drag?.kind === 'poly') finishPoly()
  if ((e.key === 'Delete' || e.key === 'Backspace') && store.selection.length) {
    removeShapes([...store.selection])
  }
}

// ---------- 交互状态机 ----------
function onDown(e) {
  const show = currentShow.value
  if (!show) return
  const p = toWorld(e)
  if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown)) {
    drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, ox: viewport.x, oy: viewport.y }
    return
  }
  if (store.tool === 'robot' && store.robotModel) {
    const r = placeRobot(store.robotModel, p.x, p.y)
    drag = { kind: 'move', ids: [r.id], start: p, orig: new Map([[r.id, { x: r.x, y: r.y }]]) }
    return
  }
  if (store.tool === 'rect') {
    const s = addShape({ type: 'rect', layer: 'path', name: '矩形区域', x: p.x, y: p.y, width: 0, height: 0, cornerRadius: 12 }, false)
    drag = { kind: 'draw-rect', id: s.id, start: p }
    return
  }
  if (store.tool === 'circle') {
    const s = addShape({ type: 'circle', layer: 'path', name: '圆形区域', x: p.x, y: p.y, radius: 1 }, false)
    drag = { kind: 'draw-circle', id: s.id, start: p }
    return
  }
  if (store.tool === 'polygon') {
    if (!drag || drag.kind !== 'poly') {
      const s = addShape({ type: 'polygon', layer: 'path', name: '多边形区域', points: [{ x: p.x, y: p.y }], cornerRadius: 8 }, false)
      drag = { kind: 'poly', id: s.id, points: s.points }
    } else {
      const last = drag.points[drag.points.length - 1]
      // 双击会产生两次 down，容差内忽略重复点
      if (Math.hypot(last.x - p.x, last.y - p.y) > 4) drag.points.push({ x: p.x, y: p.y })
    }
    return
  }
  if (store.tool === 'path') {
    if (!drag || drag.kind !== 'path') {
      const s = addShape({
        type: 'path', layer: 'path', name: '行走路径', closed: false,
        nodes: [{ x: p.x, y: p.y, hin: null, hout: null }]
      }, false)
      drag = { kind: 'path', id: s.id, nodes: s.nodes, down: p, pending: { x: p.x, y: p.y } }
    } else {
      const last = drag.nodes[drag.nodes.length - 1]
      last.hout = { dx: p.x - last.x - 30, dy: p.y - last.y }
      drag.nodes.push({ x: p.x, y: p.y, hin: { dx: 30, dy: 0 }, hout: null })
      drag.down = p; drag.pending = { x: p.x, y: p.y }
    }
    return
  }
  // select / node 工具：先命中手柄，再命中图形
  if (store.tool === 'node') {
    const h = hitHandle(p)
    if (h) { drag = { kind: 'handle', ...h, start: p }; return }
  }
  const hit = hitTest(show, p.x, p.y)
  if (hit) {
    if (!store.selection.includes(hit.id)) {
      store.selection = e.shiftKey ? [...store.selection, hit.id] : [hit.id]
    }
    const orig = new Map()
    for (const id of store.selection) {
      const s = show.shapes.find(x => x.id === id)
      if (!s) continue
      if (s.type === 'rect') orig.set(id, { x: s.x, y: s.y })
      else if (s.type === 'circle' || s.type === 'robot') orig.set(id, { x: s.x, y: s.y })
      else orig.set(id, (s.nodes || s.points).map(pt => ({ x: pt.x, y: pt.y })))
    }
    drag = { kind: 'move', ids: [...store.selection], start: p, orig, moved: false }
  } else if (store.tool === 'select') {
    store.selection = []
    drag = { kind: 'box', start: p, rect: null }
  }
}

function onMove(e) {
  if (!drag) return
  const p = toWorld(e)
  if (drag.kind === 'pan') {
    viewport.x = drag.ox + (e.clientX - drag.startX)
    viewport.y = drag.oy + (e.clientY - drag.startY)
    return
  }
  const show = currentShow.value
  if (drag.kind === 'draw-rect') {
    const s = show.shapes.find(x => x.id === drag.id)
    s.x = Math.min(drag.start.x, p.x); s.y = Math.min(drag.start.y, p.y)
    s.width = Math.abs(p.x - drag.start.x); s.height = Math.abs(p.y - drag.start.y)
    return
  }
  if (drag.kind === 'draw-circle') {
    const s = show.shapes.find(x => x.id === drag.id)
    s.radius = Math.max(2, Math.hypot(p.x - drag.start.x, p.y - drag.start.y))
    s.x = drag.start.x; s.y = drag.start.y
    return
  }
  if (drag.kind === 'poly') { drag.pending = p; return }
  if (drag.kind === 'path') { drag.pending = p; return }
  if (drag.kind === 'handle') {
    const s = show.shapes.find(x => x.id === drag.shapeId)
    const node = s.nodes[drag.nodeIndex]
    if (drag.part === 'anchor') {
      const snapped = applySnap(p, s.id)
      node.x = snapped.x; node.y = snapped.y
    } else {
      const h = drag.part === 'hout' ? 'hout' : 'hin'
      if (!node[h]) node[h] = { dx: 0, dy: 0 }
      node[h].dx = p.x - node.x; node[h].dy = p.y - node.y
      if (!e.shiftKey) {
        const opp = h === 'hout' ? 'hin' : 'hout'
        if (node[opp]) { node[opp].dx = -node[h].dx; node[opp].dy = -node[h].dy }
      }
    }
    return
  }
  if (drag.kind === 'move') {
    drag.moved = true
    let dx = p.x - drag.start.x, dy = p.y - drag.start.y
    // 吸附：以主选中图形计算
    const main = show.shapes.find(x => x.id === drag.ids[0])
    const mb = boundsOfShape(main)
    const anchor = { x: mb.cx + dx, y: mb.cy + dy }
    const snap = computeSnap(anchor, store.snapMode, {
      gridSize: show.stage.gridSize, shapes: show.shapes, movingId: main.id, movingBounds: mb
    })
    dx += snap.dx; dy += snap.dy
    guides.value = snap.guides
    for (const id of drag.ids) {
      const s = show.shapes.find(x => x.id === id)
      const o = drag.orig.get(id)
      if (!o) continue
      if (s.type === 'rect' || s.type === 'circle' || s.type === 'robot') { s.x = o.x + dx; s.y = o.y + dy }
      else (s.nodes || s.points).forEach((pt, i) => { pt.x = o[i].x + dx; pt.y = o[i].y + dy })
    }
    return
  }
  if (drag.kind === 'box') {
    drag.rect = {
      x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y),
      w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y)
    }
  }
}

function onUp(e) {
  if (!drag) return
  const show = currentShow.value
  const kind = drag.kind
  if (kind === 'draw-rect' || kind === 'draw-circle') {
    const s = show.shapes.find(x => x.id === drag.id)
    if ((kind === 'draw-rect' && (s.width < 3 || s.height < 3)) || (kind === 'draw-circle' && s.radius < 3)) {
      show.shapes = show.shapes.filter(x => x.id !== drag.id)
    } else {
      store.selection = [drag.id]; pushHistory(kind === 'draw-rect' ? '绘制矩形' : '绘制圆')
    }
  } else if (kind === 'move') {
    if (drag.moved) pushHistory('移动图形')
  } else if (kind === 'box' && drag.rect) {
    const r = drag.rect
    store.selection = show.shapes.filter(s => {
      const b = boundsOfShape(s)
      return b.x >= r.x && b.y >= r.y && b.x + b.width <= r.x + r.w && b.y + b.height <= r.y + r.h
    }).map(s => s.id)
  } else if (kind === 'handle') {
    pushHistory('编辑节点/曲率')
  }
  guides.value = []
  drag = null
}

function onDblClick(e) {
  const show = currentShow.value
  if (!show) return
  const p = toWorld(e)
  if (drag?.kind === 'poly') { finishPoly(); return }
  if (drag?.kind === 'path') { finishPath(); return }
  // 双击路径边线插入节点
  const hit = hitTest(show, p.x, p.y)
  if (hit && hit.type === 'path') {
    const edge = nearestEdge(hit, p)
    if (edge) {
      insertNodeOnPath(hit.nodes, edge.index, edge.t)
      pushHistory('插入路径节点')
    }
  }
}

function finishPoly() {
  const show = currentShow.value
  const s = show.shapes.find(x => x.id === drag.id)
  if (s.points.length < 3) show.shapes = show.shapes.filter(x => x.id !== drag.id)
  else { store.selection = [s.id]; pushHistory('绘制多边形') }
  drag = null
}
function finishPath() {
  const show = currentShow.value
  const s = show.shapes.find(x => x.id === drag.id)
  if (s.nodes.length < 2) show.shapes = show.shapes.filter(x => x.id !== drag.id)
  else { store.selection = [s.id]; pushHistory('绘制行走路径') }
  drag = null
}

function nearestEdge(path, p) {
  let best = null
  for (let i = 0; i < path.nodes.length - 1; i++) {
    const a = path.nodes[i], b = path.nodes[i + 1]
    const t = projT(a, b, p)
    const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if ((!best || d < best.d) && d < 14) best = { index: i, t, d }
  }
  return best
}
function projT(a, b, p) {
  const dx = b.x - a.x, dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 < 1e-6) return 0
  return Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
}

// ---------- 手柄命中（node 工具） ----------
function hitHandle(p) {
  const show = currentShow.value
  for (const id of store.selection.length ? store.selection : show.shapes.map(s => s.id)) {
    const s = show.shapes.find(x => x.id === id)
    if (!s || s.type !== 'path') continue
    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i]
      if (Math.hypot(n.x - p.x, n.y - p.y) <= HANDLE_R + 3) return { kind: 'handle', shapeId: s.id, nodeIndex: i, part: 'anchor' }
      for (const part of ['hout', 'hin']) {
        if (n[part]) {
          const hx = n.x + n[part].dx, hy = n.y + n[part].dy
          if (Math.hypot(hx - p.x, hy - p.y) <= HANDLE_R + 2) return { shapeId: s.id, nodeIndex: i, part }
        }
      }
    }
  }
  return null
}

function applySnap(p, movingId) {
  const show = currentShow.value
  const snap = computeSnap(p, store.snapMode, { gridSize: show.stage.gridSize, shapes: show.shapes, movingId })
  guides.value = snap.guides
  return { x: p.x + snap.dx, y: p.y + snap.dy }
}

// ---------- 渲染 ----------
function render() {
  const show = currentShow.value
  gridG.clear(); shapeLayer.removeChildren().forEach(c => c.destroy({ children: true }))
  guideG.clear(); overlayG.clear(); labelLayer.removeChildren().forEach(c => c.destroy())
  if (!show) return

  // 舞台底板 + 网格
  const { width: W, height: H, gridSize } = show.stage
  gridG.rect(0, 0, W, H).fill({ color: 0x121624 }).stroke({ color: 0x3b4256, width: 2 })
  gridG.rect(W / 2 - 1, 0, 2, H).fill({ color: 0x2a3550 }) // 中线（镜像轴）
  for (let x = gridSize; x < W; x += gridSize) gridG.moveTo(x, 0).lineTo(x, H).stroke({ color: 0x1d2436, width: 1 })
  for (let y = gridSize; y < H; y += gridSize) gridG.moveTo(0, y).lineTo(W, y).stroke({ color: 0x1d2436, width: 1 })

  // 按固定层序绘制
  for (const layerKey of ['stage', 'path', 'robot']) {
    for (const s of show.shapes) {
      if (s.layer !== layerKey || s.visible === false) continue
      drawShape(s)
    }
  }
  drawGuides(show)
  drawOverlay(show)
  drawDraft(show)
}

function drawShape(s) {
  const g = new Graphics()
  const selected = store.selection.includes(s.id)
  const strokeColor = parseInt((s.stroke || '#58a6ff').slice(1), 16)
  if (s.type === 'rect') {
    g.roundRect(s.x, s.y, s.width, s.height, s.cornerRadius || 0)
    g.fill({ color: hexToNum(s.fill) || 0x16314f, alpha: alphaOf(s.fill) })
    g.stroke({ color: strokeColor, width: s.strokeWidth || 2 })
  } else if (s.type === 'circle') {
    g.circle(s.x, s.y, s.radius).fill({ color: hexToNum(s.fill) || 0x2b2140, alpha: alphaOf(s.fill) }).stroke({ color: strokeColor, width: s.strokeWidth || 2 })
  } else if (s.type === 'robot') {
    drawRobot(g, s, strokeColor)
  } else {
    const contour = shapeToContour(s)
    const closed = s.type !== 'path' || s.closed !== false
    paintCommands(g, buildCommands(contour, closed))
    const fillColor = hexToNum(s.fill)
    if (fillColor != null) g.fill({ color: fillColor, alpha: alphaOf(s.fill) })
    g.stroke({ color: strokeColor, width: s.strokeWidth || 2 })
  }
  if (selected) {
    const b = boundsOfShape(s)
    g.rect(b.x - 4, b.y - 4, b.width + 8, b.height + 8).stroke({ color: 0x7ee787, width: 1.5, alpha: 0.9 })
  }
  shapeLayer.addChild(g)

  if ((s.beat || s.actor) && s.type !== 'robot') {
    const b = boundsOfShape(s)
    const t = new Text([s.beat, s.actor].filter(Boolean).join(' · '), { fontSize: 12, fill: 0x9fb0d0, fontFamily: 'sans-serif' })
    t.position.set(b.x, b.y - 16); labelLayer.addChild(t)
  }
  // node 工具下绘制路径锚点与曲率手柄
  if (store.tool === 'node' && s.type === 'path' && (store.selection.includes(s.id) || store.selection.length === 0)) {
    drawNodes(s)
  }
}

function drawRobot(g, s, color) {
  const { x, y, radius: r, angle } = s
  g.save()
  g.translate(x, y).rotate((angle * Math.PI) / 180)
  g.circle(0, 0, r).fill({ color: hexToNum(s.fill) || color, alpha: alphaOf(s.fill) }).stroke({ color, width: 2 })
  // 方向三角
  g.poly([{ x: 0, y: -r - 4 }, { x: r * 0.35, y: -r * 0.4 }, { x: -r * 0.35, y: -r * 0.4 }]).fill({ color })
  // 机身标记
  g.roundRect(-r * 0.45, -r * 0.2, r * 0.9, r * 0.7, 4).stroke({ color, width: 1.4 })
  g.restore()
  const label = new Text(s.name.replace(' 位', ''), { fontSize: 11, fill: 0xc9d4ec, fontFamily: 'sans-serif' })
  label.anchor.set(0.5, 0); label.position.set(x, y + r + 3); labelLayer.addChild(label)
}

function drawNodes(s) {
  const g = new Graphics()
  for (const n of s.nodes) {
    if (n.hin) g.moveTo(n.x, n.y).lineTo(n.x + n.hin.dx, n.y + n.hin.dy).stroke({ color: 0x7ee787, width: 1 })
    if (n.hout) g.moveTo(n.x, n.y).lineTo(n.x + n.hout.dx, n.y + n.hout.dy).stroke({ color: 0x7ee787, width: 1 })
    for (const h of [n.hin, n.hout]) {
      if (h) g.circle(n.x + h.dx, n.y + h.dy, HANDLE_R - 1).fill({ color: 0x0b0e16 }).stroke({ color: 0x7ee787, width: 1.5 })
    }
    g.circle(n.x, n.y, HANDLE_R).fill({ color: 0x0b0e16 }).stroke({ color: 0xffb84d, width: 2 })
  }
  shapeLayer.addChild(g)
}

function drawGuides(show) {
  const W = show.stage.width, H = show.stage.height
  for (const gd of guides.value) {
    if (gd.axis === 'x') guideG.moveTo(gd.pos, 0).lineTo(gd.pos, H).stroke({ color: gd.equidistant ? 0xd2a8ff : 0xff6b6b, width: 1, alpha: 0.85 })
    else guideG.moveTo(0, gd.pos).lineTo(W, gd.pos).stroke({ color: gd.equidistant ? 0xd2a8ff : 0xff6b6b, width: 1, alpha: 0.85 })
  }
}

function drawOverlay(show) {
  if (drag?.kind === 'box' && drag.rect) {
    const r = drag.rect
    overlayG.rect(r.x, r.y, r.w, r.h).fill({ color: 0x58a6ff, alpha: 0.08 }).stroke({ color: 0x58a6ff, width: 1 })
  }
}

function drawDraft(show) {
  if (!drag || (drag.kind !== 'poly' && drag.kind !== 'path')) return
  const g = new Graphics()
  const pts = drag.kind === 'poly' ? drag.points : drag.nodes
  if (!pts.length) return
  g.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y)
  if (drag.pending) g.lineTo(drag.pending.x, drag.pending.y)
  g.stroke({ color: 0x9fb0d0, width: 1.5, alpha: 0.8 })
  for (const pt of pts) g.circle(pt.x, pt.y, 4).fill({ color: 0xffb84d })
  shapeLayer.addChild(g)
}

function hexToNum(fill) {
  if (!fill) return null
  const m = fill.match(/#([0-9a-f]{6})/i)
  return m ? parseInt(m[1], 16) : null
}
function alphaOf(fill) {
  if (!fill) return 0.12
  const m = fill.match(/rgba?\([^)]+,([\d.]+)\)/)
  return m ? parseFloat(m[1]) : 1
}

defineExpose({ resetView })
</script>

<style scoped>
.canvas-wrap { position: relative; width: 100%; height: 100%; overflow: hidden; }
.stage-canvas { display: block; width: 100%; height: 100%; cursor: crosshair; }
.canvas-hud {
  position: absolute; left: 12px; bottom: 12px; display: flex; align-items: center; gap: 8px;
  background: rgba(16, 20, 31, 0.85); border: 1px solid #2a3247; border-radius: 8px;
  padding: 6px 10px; font-size: 12px; color: #9fb0d0;
}
.mini { background: #1d2436; color: #c9d4ec; border: 1px solid #33405c; border-radius: 5px; width: 26px; height: 24px; cursor: pointer; }
.mini:hover { background: #283350; }
.hint { margin-left: 10px; color: #6b7a99; }
.guide-badge {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  background: rgba(255, 107, 107, 0.15); border: 1px solid #ff6b6b; color: #ff9b9b;
  padding: 4px 12px; border-radius: 999px; font-size: 12px;
}
</style>
