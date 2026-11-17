// 几何内核数值自检:node scripts/test-geometry.mjs
import { sampleSpline, defaultAnchors, splitSegment, closestOnSpline, curvatureJumps } from '../src/lib/geometry/spline.js'
import { offsetSamples, findInterferences, interferenceRanges } from '../src/lib/geometry/offset.js'
import { unfoldStrip } from '../src/lib/geometry/unfold.js'
import { tessellate } from '../src/lib/geometry/surface.js'

let fail = 0
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++ }

const anchors = defaultAnchors()
const s = sampleSpline(anchors, 24)
ok(s.length === 97, `采样点数 97(实际 ${s.length})`)
const kmax = Math.max(...s.map(p => Math.abs(p.k)))
ok(kmax < 0.2, `默认型面曲率有界 |κ|max=${kmax.toFixed(4)} 1/mm`)
ok(curvatureJumps(s, 0.05).filter(Boolean).length === 0, '光顺型面无曲率突变误报')

const off3 = offsetSamples(s, -3)
ok(findInterferences(off3).length === 0, '偏移 3mm 无干涉')
const off40 = offsetSamples(s, -40)
const hits = findInterferences(off40)
ok(hits.length > 0, `偏移 40mm 检出干涉(${hits.length} 个交点)`)
ok(interferenceRanges(hits, s.length).length > 0, '干涉区段可归并报告')

const u = unfoldStrip(s, { kFactor: 0.4, thickness: 2, L: 60, taper0: 1, taper1: 0.85, seamU: 0.5, allowance: 5 })
ok(u.length > 100 && u.length < 160, `补偿后展开长 ${u.length.toFixed(1)}mm 合理`)
ok(u.area > 5000, `展开面积 ${u.area.toFixed(0)}mm²`)
ok(u.width > u.length, '下料宽 = 展开长 + 两侧缝份')

const t = tessellate(s, 60, 1, 0.85, 24)
ok(Math.abs(t.area - u.area) / t.area < 0.15, `曲面面积 ${t.area.toFixed(0)} 与展开面积 ${u.area.toFixed(0)} 偏差 <15%`)

const sp = splitSegment(anchors, 1, 0.5)
ok(sp.length === anchors.length + 1, 'de Casteljau 加点后锚点 +1')
const c = closestOnSpline(anchors, 0, 38)
ok(c && c.seg >= 1 && c.seg <= 2, `最近点定位 seg=${c?.seg}`)

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
