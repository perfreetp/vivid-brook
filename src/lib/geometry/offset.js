// 等距偏移(内衬轮廓)与自交干涉检测

// 沿法线方向偏移采样折线,d>0 为左法线侧
export function offsetSamples(samples, d) {
  return samples.map((p, i) => ({
    x: p.x + p.nx * d,
    y: p.y + p.ny * d,
    srcIndex: i,
    seg: p.seg,
    u: p.u
  }))
}

function segInt(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y }
  const s = { x: d.x - c.x, y: d.y - c.y }
  const den = r.x * s.y - r.y * s.x
  if (Math.abs(den) < 1e-12) return null
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den
  if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9)
    return { x: a.x + t * r.x, y: a.y + t * r.y, t, u }
  return null
}

// 偏移折线自交检测,返回交点及其对应的源样条采样索引
export function findInterferences(pts) {
  const hits = []
  const n = pts.length
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      // 相邻源段跳过(法线偏移天然相近)
      if (Math.abs(pts[j].srcIndex - pts[i].srcIndex) < 4) continue
      const hit = segInt(pts[i], pts[i + 1], pts[j], pts[j + 1])
      if (hit)
        hits.push({
          x: hit.x, y: hit.y,
          srcA: pts[i].srcIndex, srcB: pts[j].srcIndex,
          segA: pts[i].seg, segB: pts[j].seg
        })
    }
  }
  return hits
}

// 把干涉交点归并成"哪一段干涉"的区段报告(按源样条采样索引)
export function interferenceRanges(hits, totalSamples) {
  if (!hits.length) return []
  const idx = new Set()
  for (const h of hits) { idx.add(h.srcA); idx.add(h.srcB) }
  const sorted = [...idx].sort((a, b) => a - b)
  const ranges = []
  let start = null, prev = null
  for (const i of sorted) {
    if (start === null) { start = i; prev = i; continue }
    if (i - prev <= Math.max(4, totalSamples * 0.02)) { prev = i; continue }
    ranges.push({ from: start, to: prev })
    start = i; prev = i
  }
  if (start !== null) ranges.push({ from: start, to: prev })
  return ranges
}
