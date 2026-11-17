// 带圆角/平滑段的轮廓构建器：生成统一指令序列，供 Pixi Graphics 与 SVG 导出共用
// 指令: { c:'M'|'L'|'Q'|'Z', ... }

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }

// 单个顶点的圆角切线点
function filletPoints(prev, p, next, r) {
  const rmax = Math.min(dist(prev, p) / 2 - 0.01, dist(p, next) / 2 - 0.01)
  const rr = Math.max(0, Math.min(r, rmax))
  if (rr <= 0) return null
  const t1 = { x: p.x + (prev.x - p.x) * (rr / dist(prev, p)), y: p.y + (prev.y - p.y) * (rr / dist(prev, p)) }
  const t2 = { x: p.x + (next.x - p.x) * (rr / dist(next, p)), y: p.y + (next.y - p.y) * (rr / dist(next, p)) }
  return { t1, t2 }
}

export function buildCommands(contour, closed = true) {
  const pts = contour
  const n = pts.length
  if (n === 0) return []
  if (n === 1) return [{ c: 'M', x: pts[0].x, y: pts[0].y }]
  const cmds = []
  let i = 0
  // 定位起点：优先第一个带圆角顶点的入切点
  let startIdx = 0
  for (let k = 0; k < n; k++) {
    if ((pts[k].r || 0) > 0) {
      const prev = pts[(k - 1 + n) % n], next = pts[(k + 1) % n]
      const f = filletPoints(prev, pts[k], next, pts[k].r)
      if (f) { startIdx = k; break }
    }
  }
  const at = (k) => pts[(k + n) % n]
  // 起点：startIdx 顶点的入切点 t1
  const startP = at(startIdx), sp = at(startIdx - 1), sn = at(startIdx + 1)
  const sf = filletPoints(sp, startP, sn, startP.r || 0)
  let cursor = sf ? sf.t1 : startP
  cmds.push({ c: 'M', x: cursor.x, y: cursor.y })

  for (let step = 0; step < n; step++) {
    const k = startIdx + step
    const p = at(k), next = at(k + 1), next2 = at(k + 2)
    if ((p.r || 0) > 0) {
      const f = filletPoints(at(k - 1), p, next, p.r)
      if (f) {
        cmds.push({ c: 'L', x: f.t1.x, y: f.t1.y })
        cmds.push({ c: 'Q', cx: p.x, cy: p.y, x: f.t2.x, y: f.t2.y })
        cursor = f.t2
      } else {
        cmds.push({ c: 'L', x: p.x, y: p.y }); cursor = p
      }
    } else if (p.smooth) {
      // 平滑段：二次曲线经顶点到与下一点的中点
      const mid = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 }
      cmds.push({ c: 'Q', cx: p.x, cy: p.y, x: mid.x, y: mid.y })
      cursor = mid
    } else {
      cmds.push({ c: 'L', x: p.x, y: p.y }); cursor = p
    }
    // 末尾处理
    if (step === n - 1) break
  }
  if (closed) cmds.push({ c: 'Z' })
  return cmds
}

export function commandsToSvgPath(cmds) {
  return cmds.map(m => {
    if (m.c === 'M') return `M${r3(m.x)} ${r3(m.y)}`
    if (m.c === 'L') return `L${r3(m.x)} ${r3(m.y)}`
    if (m.c === 'Q') return `Q${r3(m.cx)} ${r3(m.cy)} ${r3(m.x)} ${r3(m.y)}`
    if (m.c === 'Z') return 'Z'
  }).join(' ')
}
const r3 = (v) => Math.round(v * 1000) / 1000

// Pixi Graphics v8 绘制
export function paintCommands(g, cmds) {
  for (const m of cmds) {
    if (m.c === 'M') g.moveTo(m.x, m.y)
    else if (m.c === 'L') g.lineTo(m.x, m.y)
    else if (m.c === 'Q') g.quadraticCurveTo(m.cx, m.cy, m.x, m.y)
    else if (m.c === 'Z') g.closePath()
  }
}
