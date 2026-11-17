// 展开下料:把扫掠条带曲面按缝合边切开摊平,带折弯补偿(K 因子中性层)
// 补偿:中性层弧长 ds' = ds * (1 - kFactor * thickness * |κ|),κ 为截面曲率

export function unfoldStrip(samples, opts) {
  const { kFactor = 0.4, thickness = 2, L = 60, taper0 = 1, taper1 = 1, seamU = 0, allowance = 5 } = opts
  const n = samples.length
  if (n < 2) return null
  // 按缝合边位置旋转采样序列:从缝合处开始,绕过原终点→起点回到缝合处
  const si = Math.max(0, Math.min(n - 1, Math.round(seamU * (n - 1))))
  const order = []
  for (let i = si; i < n; i++) order.push(i)
  for (let i = 1; i <= si; i++) order.push(i)
  const joinAt = n - si // 原终点→起点的缝合接缝在序列中的位置

  // 中性层补偿弧长
  const xs = [0]
  let total = 0
  for (let i = 1; i < n; i++) {
    const a = samples[order[i - 1]], b = samples[order[i]]
    let ds
    if (i === joinAt) ds = 0 // 缝合接缝处材料连续,无额外长度
    else ds = Math.hypot(b.x - a.x, b.y - a.y)
    const kAvg = (Math.abs(a.k) + Math.abs(b.k)) / 2
    const comp = Math.max(0.2, 1 - kFactor * thickness * kAvg)
    total += ds * comp
    xs.push(total)
  }

  // 摊平轮廓:下边 z=0(缩放 taper0),上边 z=L(缩放 taper1),反向闭合
  const bottom = order.map((si2, i) => ({ x: xs[i] * taper0, y: 0 }))
  const top = order.map((si2, i) => ({ x: xs[i] * taper1, y: L })).reverse()
  const outline = bottom.concat(top)

  // 多边形面积
  let area = 0
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i], q = outline[(i + 1) % outline.length]
    area += p.x * q.y - q.x * p.y
  }
  area = Math.abs(area) / 2

  const minX = Math.min(...outline.map(p => p.x))
  const maxX = Math.max(...outline.map(p => p.x))
  const width = maxX - minX + 2 * allowance
  const height = L + 2 * allowance

  return {
    order, xs, joinAt, outline,
    seamX: 0,
    joinX: xs[joinAt] ?? null, // 缝合接缝在展开图上的 x(两端接缝重合于 0/total)
    length: total,
    area,
    width, height,
    minX
  }
}

// 把一组(可能带干涉的)偏移采样点也摊平(内衬下料图)
export function unfoldOffset(offsetPts, opts) {
  // 偏移折线没有曲率,用源样条曲率近似(调用方传入源 samples 对齐)
  return unfoldStrip(offsetPts.map(p => ({ ...p, k: p.k ?? 0 })), opts)
}
