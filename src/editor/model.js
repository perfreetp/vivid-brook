// 文档模型与工厂函数
import { circumference } from './geometry.js'

let seq = 0
export function uid(prefix = 'id') {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 7)}`
}

export function createNode(x, y, hin = null, hout = null) {
  return { id: uid('n'), x: +x.toFixed(4), y: +y.toFixed(4), hin, hout }
}

export function createPath(nodes = [], closed = false, name = '路径') {
  return {
    id: uid('p'),
    name,
    nodes,
    closed,
    // 原始路径数据：每次结构性修改前由 store 写入，导出 SVG 时一并保留
    sourceData: null,
    fill: 'rgba(64, 128, 224, 0.18)',
    stroke: '#2563eb',
    strokeWidth: 0.15,
    booleans: [], // 运算履历：{op, withPathId, at}
    narrowGaps: [] // 最新窄缝检测结果
  }
}

export function createLayer(name, paths = []) {
  return { id: uid('l'), name, visible: true, locked: false, paths }
}

export function createDocument() {
  return {
    version: 1,
    shaft: {
      diameterMm: 12, // 笔杆直径
      lengthMm: 140 // 笔杆雕刻段长度（画布高）
    },
    grid: {
      divisions: 12, // 环向等分数
      axialStepMm: 10, // 轴向网格间距
      showDivisionLines: true,
      showAxialGrid: true,
      showCenterLine: true,
      snapGrid: true,
      snapCenter: true,
      snapEndpoints: true,
      snapThresholdMm: 0.8
    },
    narrowGapThresholdMm: 0.3, // 激光雕刻最小窄缝阈值
    layers: [createLayer('主纹样层')],
    activeLayerId: null,
    selection: { type: null, pathId: null, nodeIndex: null }
  }
}

export function canvasWidthMm(doc) {
  return circumference(doc.shaft.diameterMm)
}

// 深拷贝（历史栈用，结构纯 JSON + 普通对象，structuredClone 可用）
export function cloneDoc(doc) {
  return structuredClone(doc)
}

// 节点模型转 SVG path d 字符串
export function nodesToD(path) {
  const n = path.nodes
  if (!n.length) return ''
  let d = `M ${r(n[0].x)} ${r(n[0].y)}`
  const limit = path.closed ? n.length : n.length - 1
  for (let i = 0; i < limit; i++) {
    const a = n[i]
    const b = n[(i + 1) % n.length]
    const c1x = a.x + (a.hout ? a.hout.dx : 0)
    const c1y = a.y + (a.hout ? a.hout.dy : 0)
    const c2x = b.x + (b.hin ? b.hin.dx : 0)
    const c2y = b.y + (b.hin ? b.hin.dy : 0)
    d += ` C ${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(b.x)} ${r(b.y)}`
  }
  if (path.closed) d += ' Z'
  return d
}
const r = (v) => (+v).toFixed(4).replace(/\.?0+$/, '')

// 环向阵列：把路径沿周长复刻 3 份，并在拼缝处保证首尾相接
export function polarArrayThree(path, widthMm) {
  const copies = []
  for (let k = 0; k < 3; k++) {
    const dx = (widthMm / 3) * k
    const nodes = path.nodes.map((nd) => ({
      ...nd,
      x: +(nd.x + dx).toFixed(4),
      hin: nd.hin ? { ...nd.hin } : null,
      hout: nd.hout ? { ...nd.hout } : null
    }))
    copies.push({ nodes, closed: path.closed, dx })
  }
  return copies
}

// 检查路径在 x=0 / x=W 两条拼缝上的端点是否匹配（首尾相接校验）
export function checkSeamContinuity(path, widthMm, tolMm = 0.05) {
  const issues = []
  if (path.closed) return issues
  const left = path.nodes.filter((n) => Math.abs(n.x) <= tolMm)
  const right = path.nodes.filter((n) => Math.abs(n.x - widthMm) <= tolMm)
  if (left.length && !right.length) issues.push('左拼缝有端点但右拼缝无对应端点，环绕后无法首尾相接')
  if (right.length && !left.length) issues.push('右拼缝有端点但左拼缝无对应端点，环绕后无法首尾相接')
  if (left.length && right.length) {
    for (const l of left) {
      const ok = right.some((rr) => Math.abs(rr.y - l.y) <= tolMm)
      if (!ok) issues.push(`拼缝端点 y=${l.y.toFixed(2)}mm 在另一侧无匹配，环绕后错位`)
    }
  }
  return issues
}
