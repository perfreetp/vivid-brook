// 编辑器核心状态：文档、工具、选择、全部编辑操作（均走历史栈）
import { reactive, computed, shallowRef } from 'vue'
import {
  createDocument,
  createLayer,
  createPath,
  createNode,
  cloneDoc,
  nodesToD,
  canvasWidthMm,
  uid,
  checkSeamContinuity
} from './model.js'
import { History } from './history.js'
import {
  buildSnapCandidates,
  snapPoint,
  clampToCanvas,
  pathToPolylines,
  findNarrowGaps,
  nearestPointOnPath
} from './geometry.js'
import { booleanPaths, isClosedPath } from './paper-boolean.js'
import { buildSVGString } from './svg-export.js'

const state = reactive({
  doc: createDocument(),
  tool: 'select', // select | pen | nodeAdd | pan
  penPathId: null, // 正在绘制的路径
  selection: { pathId: null, nodeIndex: null },
  booleanIds: [], // 布尔运算候选路径（有序，最多 2 条）
  snapIndicator: null, // 最近一次吸附的点
  toasts: [],
  historySize: 0,
  historyLimit: 100,
  undoLabel: '',
  redoLabel: '',
  canUndo: false,
  canRedo: false,
  zoom: 1,
  panelOpen: true
})

const history = shallowRef(new History(state.doc))
const historyVersion = reactive({ n: 0 })

function refreshHistoryMeta() {
  const h = history.value
  state.historySize = h.size
  state.historyLimit = h.limit
  state.canUndo = h.canUndo
  state.canRedo = h.canRedo
  state.undoLabel = h.undoLabel
  state.redoLabel = h.redoLabel
  historyVersion.n++
}

// ---------- Toast ----------
export function toast(message, type = 'info', timeout = 3600) {
  const t = { id: uid('t'), message, type, at: Date.now() }
  state.toasts.push(t)
  if (timeout) setTimeout(() => dismissToast(t.id), timeout)
}
export function dismissToast(id) {
  const i = state.toasts.findIndex((t) => t.id === id)
  if (i >= 0) state.toasts.splice(i, 1)
}

// ---------- 历史提交 ----------
function commit(label, fn, coalesceKey = null) {
  const merging = coalesceKey && history.value.coalescingKey === coalesceKey
  if (!merging) history.value.push(state.doc, label, coalesceKey)
  fn()
  refreshHistoryMeta()
}
function beginCoalesce(key) {
  history.value.coalescingKey = key
}
function endCoalesce() {
  history.value.endCoalesce()
  refreshHistoryMeta()
}

export function undo() {
  const d = history.value.undo(state.doc)
  if (d) {
    state.doc = d
    state.selection = { pathId: null, nodeIndex: null }
    state.booleanIds = []
    state.penPathId = null
    refreshHistoryMeta()
  }
}
export function redo() {
  const d = history.value.redo()
  if (d) {
    state.doc = d
    state.selection = { pathId: null, nodeIndex: null }
    state.booleanIds = []
    refreshHistoryMeta()
  }
}

// ---------- 路径查找 ----------
export function findPath(pathId) {
  for (const layer of state.doc.layers) {
    const p = layer.paths.find((x) => x.id === pathId)
    if (p) return { layer, path: p, index: layer.paths.indexOf(p) }
  }
  return null
}
export function allPathsFlat() {
  const out = []
  state.doc.layers.forEach((l) => l.paths.forEach((p) => out.push({ layer: l, path: p })))
  return out
}

export const selectedPath = computed(() =>
  state.selection.pathId ? findPath(state.selection.pathId)?.path ?? null : null
)

// ---------- 文档/图层 ----------
export function setDiameter(mm) {
  commit('修改笔杆直径', () => {
    state.doc.shaft.diameterMm = Math.max(1, +mm)
  })
}
export function setLength(mm) {
  commit('修改笔杆长度', () => {
    state.doc.shaft.lengthMm = Math.max(1, +mm)
  })
}
export function addLayer(name) {
  commit('新增图层', () => {
    const layer = createLayer(name || `图层 ${state.doc.layers.length + 1}`)
    state.doc.layers.push(layer)
    state.doc.activeLayerId = layer.id
  })
}
export function toggleLayerVisible(id) {
  const l = state.doc.layers.find((x) => x.id === id)
  if (l) l.visible = !l.visible
}
export function toggleLayerLock(id) {
  const l = state.doc.layers.find((x) => x.id === id)
  if (l) l.locked = !l.locked
}
export function removeLayer(id) {
  if (state.doc.layers.length <= 1) return toast('至少保留一个图层', 'warn')
  commit('删除图层', () => {
    const i = state.doc.layers.findIndex((x) => x.id === id)
    if (i >= 0) state.doc.layers.splice(i, 1)
  })
}
export function renameLayer(id, name) {
  const l = state.doc.layers.find((x) => x.id === id)
  if (l) l.name = name
}
export function getActiveLayer() {
  let l = state.doc.layers.find((x) => x.id === state.doc.activeLayerId)
  if (!l) l = state.doc.layers[0]
  return l
}

// ---------- 工具与选择 ----------
export function setTool(tool) {
  state.tool = tool
  if (tool !== 'pen') state.penPathId = null
  if (tool !== 'select') state.selection = { pathId: null, nodeIndex: null }
}
export function selectPath(pathId, nodeIndex = null, additive = false) {
  if (additive && pathId) {
    toggleBooleanPath(pathId)
    return
  }
  state.selection = { pathId, nodeIndex }
}
export function selectNode(pathId, nodeIndex) {
  state.selection = { pathId, nodeIndex }
}
export function clearSelection() {
  state.selection = { pathId: null, nodeIndex: null }
}
export function toggleBooleanPath(pathId) {
  const i = state.booleanIds.indexOf(pathId)
  if (i >= 0) state.booleanIds.splice(i, 1)
  else {
    if (state.booleanIds.length >= 2) state.booleanIds.shift()
    state.booleanIds.push(pathId)
  }
}

// ---------- 吸附 ----------
export function applySnap(x, y, excludePathId = null) {
  const cands = buildSnapCandidates(state.doc)
  const hit = snapPoint(x, y, cands, state.doc.grid.snapThresholdMm, excludePathId)
  state.snapIndicator = hit ? { x: hit.x, y: hit.y, kind: hit.target.kind } : null
  return hit ? { x: hit.x, y: hit.y } : { x, y }
}
export function clearSnapIndicator() {
  state.snapIndicator = null
}

// ---------- 钢笔工具 ----------
export function penStart(x, y) {
  const layer = getActiveLayer()
  if (layer.locked) return toast('该图层已锁定', 'warn')
  const snapped = applySnap(x, y)
  const path = createPath([createNode(snapped.x, snapped.y)], false, `纹样 ${layer.paths.length + 1}`)
  commit('钢笔起笔', () => {
    layer.paths.push(path)
    state.penPathId = path.id
    state.selection = { pathId: path.id, nodeIndex: 0 }
  })
}
export function penAddNode(x, y, smooth = false) {
  const found = findPath(state.penPathId)
  if (!found) return
  const { path } = found
  const snapped = applySnap(x, y, path.id)
  commit('钢笔添加节点', () => {
    const node = createNode(snapped.x, snapped.y)
    if (smooth) {
      const prev = path.nodes[path.nodes.length - 1]
      const dx = node.x - prev.x
      const dy = node.y - prev.y
      prev.hout = { dx: dx / 3, dy: dy / 3 }
      node.hin = { dx: -dx / 3, dy: -dy / 3 }
    }
    path.nodes.push(node)
    state.selection.nodeIndex = path.nodes.length - 1
  })
}
// 拖拽时给最后一个节点加贝塞尔手柄
export function penDragHandle(x, y) {
  const found = findPath(state.penPathId)
  if (!found) return
  const { path } = found
  const node = path.nodes[path.nodes.length - 1]
  const prev = path.nodes[path.nodes.length - 2]
  const snapped = applySnap(x, y, path.id)
  commit('钢笔拖出手柄', () => {
    const dx = snapped.x - node.x
    const dy = snapped.y - node.y
    node.hin = { dx: -dx / 3, dy: -dy / 3 }
    node.hout = { dx: dx / 3, dy: dy / 3 }
    if (prev && !prev.hout) prev.hout = { dx: (node.x - prev.x) / 3, dy: (node.y - prev.y) / 3 }
  }, 'pen-handle')
}
export function penFinish(close = false) {
  const found = findPath(state.penPathId)
  if (!found) {
    state.penPathId = null
    return
  }
  const { path } = found
  if (path.nodes.length < 2) {
    commit('取消空路径', () => {
      const layer = findPath(path.id).layer
      layer.paths.splice(layer.paths.indexOf(path), 1)
    })
  } else if (close) {
    commit('闭合路径', () => {
      path.closed = true
    })
    toast('路径已闭合', 'success', 1800)
  } else {
    // 双击结束时若末节点与上一节点重合（快速双击），去掉重复点
    const n = path.nodes
    if (n.length >= 2) {
      const a = n[n.length - 1]
      const b = n[n.length - 2]
      if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) n.pop()
    }
  }
  state.penPathId = null
  state.tool = 'select'
}

// ---------- 节点编辑 ----------
export function dragNodeTo(pathId, nodeIndex, x, y, key) {
  const found = findPath(pathId)
  if (!found) return
  const { path } = found
  const clamped = clampToCanvas(x, y, state.doc)
  const snapped = applySnap(clamped.x, clamped.y, path.id)
  commit('拖动节点', () => {
    const node = path.nodes[nodeIndex]
    node.x = snapped.x
    node.y = snapped.y
  }, key)
}
export function dragPathTo(pathId, dx, dy, key) {
  const found = findPath(pathId)
  if (!found) return
  commit('拖动路径', () => {
    found.path.nodes.forEach((n) => {
      const p = clampToCanvas(n.x + dx, n.y + dy, state.doc)
      n.x = p.x
      n.y = p.y
    })
  }, key)
}
export function addNodeOnEdge(pathId, x, y) {
  const found = findPath(pathId)
  if (!found) return
  const { path } = found
  const hit = nearestPointOnPath(path, x, y)
  if (!hit) return
  commit('边上加节点', () => {
    splitSegment(path, hit.index, hit.t)
    state.selection = { pathId, nodeIndex: hit.index + 1 }
  })
}
// de Casteljau 拆分三次贝塞尔段，在 t 处插入新节点
function splitSegment(path, index, t) {
  const n = path.nodes
  const a = n[index]
  const b = n[(index + 1) % n.length]
  const p0 = { x: a.x, y: a.y }
  const p3 = { x: b.x, y: b.y }
  const c1 = a.hout ? { x: a.x + a.hout.dx, y: a.y + a.hout.dy } : { ...p0 }
  const c2 = b.hin ? { x: b.x + b.hin.dx, y: b.y + b.hin.dy } : { ...p3 }
  const lerp = (u, v) => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t })
  const p01 = lerp(p0, c1)
  const p12 = lerp(c1, c2)
  const p23 = lerp(c2, p3)
  const p012 = lerp(p01, p12)
  const p123 = lerp(p12, p23)
  const m = lerp(p012, p123)
  a.hout = { dx: +(p012.x - p0.x).toFixed(4), dy: +(p012.y - p0.y).toFixed(4) }
  const mid = createNode(m.x, m.y, { dx: +(p123.x - m.x).toFixed(4), dy: +(p123.y - m.y).toFixed(4) }, {
    dx: +(p012.x - m.x).toFixed(4),
    dy: +(p012.y - m.y).toFixed(4)
  })
  b.hin = { dx: +(p23.x - p3.x).toFixed(4), dy: +(p23.y - p3.y).toFixed(4) }
  n.splice(index + 1, 0, mid)
}
export function breakNode(pathId, nodeIndex) {
  const found = findPath(pathId)
  if (!found) return
  const { layer, path, index } = found
  if (path.closed) {
    commit('断开闭合路径', () => {
      path.closed = false
      // 闭合路径在节点处断开：复制该节点作为新的末节点
      const n = path.nodes[nodeIndex]
      const tail = createNode(n.x, n.y)
      const head = path.nodes.splice(0, nodeIndex + 1)
      const rest = path.nodes.splice(0)
      path.nodes = [...head, ...rest, tail]
      state.selection = { pathId, nodeIndex }
    })
  } else {
    if (nodeIndex === 0 || nodeIndex === path.nodes.length - 1) {
      return toast('开放路径的端点无需断开', 'warn')
    }
    commit('断开节点', () => {
      const nodes = path.nodes
      const rightNodes = nodes.splice(nodeIndex + 1)
      const p2 = createPath(rightNodes, false, `${path.name}-2`)
      path.name = `${path.name}-1`
      layer.paths.splice(index + 1, 0, p2)
      state.selection = { pathId: p2.id, nodeIndex: 0 }
    })
  }
}
export function closePath(pathId) {
  const found = findPath(pathId)
  if (!found || found.path.closed) return
  if (found.path.nodes.length < 3) return toast('至少需要 3 个节点才能闭合', 'warn')
  commit('闭合路径', () => {
    found.path.closed = true
  })
}
export function deleteSelected() {
  const { pathId, nodeIndex } = state.selection
  if (!pathId) return
  const found = findPath(pathId)
  if (!found) return
  if (nodeIndex !== null && found.path.nodes.length > 2) {
    commit('删除节点', () => {
      found.path.nodes.splice(nodeIndex, 1)
      state.selection = { pathId, nodeIndex: null }
    })
  } else {
    commit('删除路径', () => {
      found.layer.paths.splice(found.index, 1)
      state.selection = { pathId: null, nodeIndex: null }
      state.booleanIds = state.booleanIds.filter((id) => id !== pathId)
    })
  }
}
// 拖拽贝塞尔手柄（走合并历史）
export function dragHandleTo(pathId, nodeIndex, which, x, y, key) {
  const found = findPath(pathId)
  if (!found) return
  const node = found.path.nodes[nodeIndex]
  if (!node[which]) node[which] = { dx: 0, dy: 0 }
  commit('拖动手柄', () => {
    node[which].dx = +(x - node.x).toFixed(4)
    node[which].dy = +(y - node.y).toFixed(4)
  }, key)
}
export function toggleSmoothNode(pathId, nodeIndex) {
  const found = findPath(pathId)
  if (!found) return
  const { path } = found
  const node = path.nodes[nodeIndex]
  commit('节点光滑/尖角切换', () => {
    if (node.hin || node.hout) {
      node.hin = null
      node.hout = null
    } else {
      const prev = path.nodes[(nodeIndex - 1 + path.nodes.length) % path.nodes.length]
      const next = path.nodes[(nodeIndex + 1) % path.nodes.length]
      const dxp = node.x - prev.x
      const dyp = node.y - prev.y
      const dxn = next.x - node.x
      const dyn = next.y - node.y
      node.hin = { dx: -dxp / 3, dy: -dyp / 3 }
      node.hout = { dx: dxn / 3, dy: dyn / 3 }
    }
  })
}

// ---------- 布尔运算 ----------
export function runBoolean(op) {
  if (state.booleanIds.length !== 2) return toast('请先选择两条路径', 'warn')
  const a = findPath(state.booleanIds[0])
  const b = findPath(state.booleanIds[1])
  if (!a || !b) return
  if (!isClosedPath(a.path) || !isClosedPath(b.path)) {
    return toast('布尔运算要求两条路径均为闭合路径（≥3 节点）', 'error')
  }
  let results
  try {
    // 留存原始路径数据
    const snapshotA = JSON.stringify({ d: nodesToD(a.path), nodes: a.path.nodes })
    const snapshotB = JSON.stringify({ d: nodesToD(b.path), nodes: b.path.nodes })
    results = booleanPaths(op, a.path, b.path)
    commit(`布尔-${op === 'unite' ? '并集' : op === 'subtract' ? '差集' : '交集'}`, () => {
      const opName = { unite: '并集', subtract: '差集', intersect: '交集' }[op]
      results.forEach((r, i) => {
        const np = createPath(
          r.nodes,
          r.closed,
          `${opName}结果${results.length > 1 ? '-' + (i + 1) : ''}`
        )
        np.sourceData = { op, operands: [snapshotA, snapshotB], at: new Date().toISOString() }
        np.booleans.push({ op, withPathId: [a.path.id, b.path.id], at: np.sourceData.at })
        a.layer.paths.push(np)
      })
      // 原始路径保留但隐藏，保证可追溯
      a.path.visible = false
      b.path.visible = false
      state.booleanIds = []
      state.selection = { pathId: null, nodeIndex: null }
    })
    toast(`${op === 'unite' ? '并集' : op === 'subtract' ? '差集' : '交集'}完成，原路径已隐藏保留`, 'success', 2600)
  } catch (e) {
    toast(`布尔运算失败：${e.message || e}`, 'error', 5000)
  }
}

// ---------- 环向阵列 ----------
export function ringArray(pathId) {
  const found = findPath(pathId)
  if (!found) return
  const { layer, path } = found
  const W = canvasWidthMm(state.doc)
  const tile = W / 3
  commit('环向阵列×3', () => {
    for (let k = 1; k < 3; k++) {
      const dx = tile * k
      const nodes = path.nodes.map((nd) => ({
        ...structuredClone(nd),
        id: uid('n'),
        x: +(nd.x + dx).toFixed(4)
      }))
      const copy = createPath(nodes, path.closed, `${path.name}-阵列${k + 1}`)
      copy.sourceData = { op: 'ringArray', sourcePathId: path.id, offsetMm: +dx.toFixed(4) }
      layer.paths.push(copy)
    }
  })
  // 首尾相接校验：把三份纹样整体按拼缝回绕检查
  const issues = []
  const copies = layer.paths.slice(-2)
  const all = [path, ...copies]
  all.forEach((p, k) => {
    const shifted = {
      ...p,
      nodes: p.nodes.map((nd) => ({ ...nd, x: nd.x - tile * k }))
    }
    issues.push(...checkSeamContinuity(shifted, tile, state.doc.grid.snapThresholdMm))
  })
  if (issues.length) toast(`阵列完成，但首尾相接存在 ${issues.length} 处问题：${issues[0]}`, 'warn', 6000)
  else toast('环向阵列完成，三份纹样首尾相接', 'success', 3000)
}

// ---------- 窄缝检测（响应式） ----------
export const narrowGapReport = computed(() => {
  const threshold = state.doc.narrowGapThresholdMm
  const markers = []
  const perPath = {}
  for (const layer of state.doc.layers) {
    if (!layer.visible) continue
    const rings = []
    const ringOwner = []
    for (const p of layer.paths) {
      if (p.visible === false || p.nodes.length < 2) continue
      const pr = pathToPolylines(p, 0.01)
      pr.forEach((ring) => {
        rings.push(ring)
        ringOwner.push(p.id)
      })
    }
    const gaps = findNarrowGaps(rings, threshold)
    gaps.forEach((g) => {
      markers.push({ ...g, layerId: layer.id })
      const owner = ringOwner[parseInt(g.seg1.split(':')[0])]
      if (owner) {
        perPath[owner] = perPath[owner] || []
        perPath[owner].push(g)
      }
    })
  }
  return { markers, perPath, threshold }
})

// ---------- 导入/导出 ----------
export function exportSVG() {
  const svg = buildSVGString(state.doc, narrowGapReport.value)
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `笔杆纹样_${state.doc.shaft.diameterMm}mm_${Date.now()}.svg`)
  toast('SVG 已导出（含图层分组与原始路径数据）', 'success')
}

export function exportProject() {
  const blob = new Blob([JSON.stringify(state.doc, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `笔杆项目_${Date.now()}.json`)
}
export function importProject(file) {
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const doc = JSON.parse(reader.result)
      if (!doc.shaft || !Array.isArray(doc.layers)) throw new Error('文件格式不正确')
      commit('导入项目', () => {
        state.doc = doc
        state.selection = { pathId: null, nodeIndex: null }
        state.booleanIds = []
      })
      toast('项目已导入', 'success')
    } catch (e) {
      toast(`导入失败：${e.message}`, 'error', 5000)
    }
  }
  reader.readAsText(file)
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ---------- 示例纹样 ----------
export function loadSample() {
  const layer = getActiveLayer()
  const W = canvasWidthMm(state.doc)
  commit('载入示例纹样', () => {
    const cx = W / 2
    const cy = state.doc.shaft.lengthMm / 2
    // 一个菱形闭合纹样
    const p = createPath(
      [
        createNode(cx, cy - 18),
        createNode(cx + 10, cy, { dx: -3, dy: -5 }, { dx: 3, dy: 5 }),
        createNode(cx, cy + 18),
        createNode(cx - 10, cy, { dx: 3, dy: 5 }, { dx: -3, dy: -5 })
      ],
      true,
      '示例-菱形'
    )
    layer.paths.push(p)
    // 一条窄缝对照路径（与菱形间距 < 0.3mm）
    const p2 = createPath(
      [
        createNode(cx + 10.2, cy - 6),
        createNode(cx + 14, cy),
        createNode(cx + 10.2, cy + 6)
      ],
      false,
      '示例-窄缝对照'
    )
    layer.paths.push(p2)
    state.selection = { pathId: p.id, nodeIndex: null }
  })
}

export function resetDocument() {
  commit('重置文档', () => {
    state.doc = createDocument()
    state.selection = { pathId: null, nodeIndex: null }
    state.booleanIds = []
    state.penPathId = null
  })
}

export function useEditor() {
  return {
    state,
    historyVersion,
    selectedPath,
    narrowGapReport,
    // 文档
    setDiameter,
    setLength,
    addLayer,
    toggleLayerVisible,
    toggleLayerLock,
    removeLayer,
    renameLayer,
    // 工具
    setTool,
    selectPath,
    selectNode,
    clearSelection,
    toggleBooleanPath,
    applySnap,
    clearSnapIndicator,
    // 钢笔
    penStart,
    penAddNode,
    penDragHandle,
    penFinish,
    // 节点
    dragNodeTo,
    dragPathTo,
    dragHandleTo,
    addNodeOnEdge,
    breakNode,
    closePath,
    deleteSelected,
    toggleSmoothNode,
    // 布尔 / 阵列
    runBoolean,
    ringArray,
    // 历史
    undo,
    redo,
    beginCoalesce,
    endCoalesce,
    // 导入导出
    exportSVG,
    exportProject,
    importProject,
    loadSample,
    resetDocument,
    // 工具函数
    findPath,
    allPathsFlat,
    toast,
    dismissToast
  }
}
