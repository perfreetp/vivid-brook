// paper.js 布尔运算封装（并集/差集/交集）
// 输入输出都是应用内部路径模型，paper 仅作计算引擎，原始路径数据不被覆盖
import paper from 'paper'

let scope = null
function getScope() {
  if (!scope) {
    scope = new paper.PaperScope()
    scope.setup(new scope.Size(10, 10))
  }
  return scope
}

function nodesToPaperD(scopeInstance, path) {
  const n = path.nodes
  if (!n.length) return null
  let d = `M ${n[0].x} ${n[0].y}`
  const limit = path.closed ? n.length : n.length - 1
  for (let i = 0; i < limit; i++) {
    const a = n[i]
    const b = n[(i + 1) % n.length]
    const c1x = a.x + (a.hout ? a.hout.dx : 0)
    const c1y = a.y + (a.hout ? a.hout.dy : 0)
    const c2x = b.x + (b.hin ? b.hin.dx : 0)
    const c2y = b.y + (b.hin ? b.hin.dy : 0)
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${b.x} ${b.y}`
  }
  if (path.closed) d += ' Z'
  return d
}

// 把 paper Path 的结果转回内部节点模型（保留三次贝塞尔段）
function paperToNodes(item) {
  const nodes = []
  const curves = item.curves
  for (let i = 0; i < curves.length; i++) {
    const c = curves[i]
    if (i === 0) {
      nodes.push({
        id: `n${Math.random().toString(36).slice(2, 9)}`,
        x: +c.point1.x.toFixed(4),
        y: +c.point1.y.toFixed(4),
        hin: null,
        hout:
          c.hasHandles() && c.handle1.length > 0
            ? { dx: +c.handle1.x.toFixed(4), dy: +c.handle1.y.toFixed(4) }
            : null
      })
    } else {
      const prev = nodes[nodes.length - 1]
      // 补当前节点的入手柄
      if (c.hasHandles() && curves[i - 1].handle2.length > 0) {
        prev.hin = { dx: +curves[i - 1].handle2.x.toFixed(4), dy: +curves[i - 1].handle2.y.toFixed(4) }
      }
      nodes.push({
        id: `n${Math.random().toString(36).slice(2, 9)}`,
        x: +c.point1.x.toFixed(4),
        y: +c.point1.y.toFixed(4),
        hin: null,
        hout: c.hasHandles() && c.handle1.length > 0 ? { dx: +c.handle1.x.toFixed(4), dy: +c.handle1.y.toFixed(4) } : null
      })
    }
  }
  // 闭合结果最后一段的 handle2 属于首节点的 hin
  if (item.closed && nodes.length && curves.length) {
    const last = curves[curves.length - 1]
    if (last.hasHandles() && last.handle2.length > 0) {
      nodes[0].hin = { dx: +last.handle2.x.toFixed(4), dy: +last.handle2.y.toFixed(4) }
    }
  }
  return { nodes, closed: !!item.closed }
}

/**
 * 对两条内部路径执行布尔运算
 * @param {'unite'|'subtract'|'intersect'} op
 * @returns {Array<{nodes, closed}>} 可能产生多个结果轮廓
 */
export function booleanPaths(op, pathA, pathB) {
  const ps = getScope()
  ps.project.activeLayer.removeChildren()
  const dA = nodesToPaperD(ps, pathA)
  const dB = nodesToPaperD(ps, pathB)
  if (!dA || !dB) throw new Error('路径数据不完整，无法运算')
  const a = new ps.CompoundPath(dA)
  const b = new ps.CompoundPath(dB)
  if (!a.closed || !b.closed) {
    a.remove?.()
    b.remove?.()
    throw new Error('布尔运算要求两条路径均为闭合路径')
  }
  let result
  if (op === 'unite') result = a.unite(b)
  else if (op === 'subtract') result = a.subtract(b)
  else result = a.intersect(b)

  const out = []
  const collect = (item) => {
    if (item.className === 'Path' && item.segments.length > 0) {
      out.push(paperToNodes(item))
    } else if (item.children) {
      item.children.forEach(collect)
    }
  }
  collect(result)
  result.remove?.()
  a.remove?.()
  b.remove?.()
  if (!out.length) throw new Error('运算结果为空（差集可能已完全挖空）')
  return out
}

// 校验路径是否闭合（布尔运算前置条件）
export function isClosedPath(path) {
  return !!path.closed && path.nodes.length >= 3
}
