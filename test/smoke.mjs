// 核心逻辑冒烟测试：node test/smoke.mjs
import assert from 'node:assert'
import {
  circumference,
  pathToPolylines,
  findNarrowGaps,
  buildSnapCandidates,
  snapPoint,
  nearestPointOnPath
} from '../src/editor/geometry.js'
import { createDocument, createPath, createNode, nodesToD, polarArrayThree, checkSeamContinuity } from '../src/editor/model.js'
import { booleanPaths } from '../src/editor/paper-boolean.js'
import { buildSVGString } from '../src/editor/svg-export.js'
import { CHECK_RULES, createBatch, confirmItem, rejectItem, batchSummary, releaseBatch, buildRejectSheet, loadSampleBatch } from '../src/editor/batch.js'

let pass = 0
const ok = (name, fn) => {
  fn()
  pass++
  console.log(`  ✓ ${name}`)
}

// 1. 周长换算
ok('周长 = π × 直径', () => {
  assert.ok(Math.abs(circumference(12) - Math.PI * 12) < 1e-9)
})

// 2. 贝塞尔展平：直线段节点数量
ok('路径展平为折线', () => {
  const p = createPath([createNode(0, 0), createNode(10, 0), createNode(10, 10)], false)
  const rings = pathToPolylines(p)
  assert.equal(rings.length, 1)
  assert.equal(rings[0].length, 3)
})

// 3. 窄缝检测：两条相距 0.2mm 的平行线应报窄缝；相距 1mm 不报
ok('窄缝检测（< 0.3mm 标红）', () => {
  const rings = [
    [
      { x: 0, y: 0 }, { x: 20, y: 0 }
    ],
    [
      { x: 0, y: 0.2 }, { x: 20, y: 0.2 }
    ]
  ]
  const gaps = findNarrowGaps(rings, 0.3)
  assert.ok(gaps.length >= 1)
  assert.ok(gaps.every((g) => g.distance < 0.3))
  const wide = findNarrowGaps([[{ x: 0, y: 0 }, { x: 20, y: 0 }], [{ x: 0, y: 1 }, { x: 20, y: 1 }]], 0.3)
  assert.equal(wide.length, 0)
})

// 4. 吸附：网格 + 端点
ok('节点吸附网格/端点', () => {
  const doc = createDocument()
  doc.layers[0].paths.push(createPath([createNode(10, 10)], false, 't'))
  const cands = buildSnapCandidates(doc)
  assert.ok(cands.some((c) => c.kind === 'grid'))
  assert.ok(cands.some((c) => c.kind === 'endpoint'))
  const hit = snapPoint(10.2, 10.1, cands, 0.8)
  assert.ok(hit)
  assert.equal(hit.x, 10)
})

// 5. 点边加节点查找
ok('路径上最近点查找', () => {
  const p = createPath([createNode(0, 0), createNode(10, 0)], false)
  const hit = nearestPointOnPath(p, 5, 0.5)
  assert.ok(hit.d < 0.6)
  assert.equal(hit.index, 0)
})

// 6. 布尔运算：两个相交矩形的并集/交集/差集
function rect(x, y, w, h) {
  return createPath(
    [createNode(x, y), createNode(x + w, y), createNode(x + w, y + h), createNode(x, y + h)],
    true
  )
}
ok('布尔并集：两个重叠矩形合成一个轮廓', () => {
  const a = rect(0, 0, 10, 10)
  const b = rect(5, 5, 10, 10)
  const res = booleanPaths('unite', a, b)
  assert.ok(res.length >= 1)
  assert.ok(res[0].closed)
})
ok('布尔交集：重叠区域 5×5', () => {
  const a = rect(0, 0, 10, 10)
  const b = rect(5, 5, 10, 10)
  const res = booleanPaths('intersect', a, b)
  const ring = pathToPolylines({ nodes: res[0].nodes, closed: true }, 0.005)[0]
  const xs = ring.map((p) => p.x)
  const ys = ring.map((p) => p.y)
  assert.ok(Math.max(...xs) - Math.min(...xs) <= 5.05)
  assert.ok(Math.max(...ys) - Math.min(...ys) <= 5.05)
})
ok('布尔差集：A-B 非空', () => {
  const a = rect(0, 0, 10, 10)
  const b = rect(2, 2, 4, 4)
  const res = booleanPaths('subtract', a, b)
  assert.ok(res.length >= 1)
})
ok('开放路径拒绝布尔运算', () => {
  const a = createPath([createNode(0, 0), createNode(10, 0)], false)
  const b = rect(5, 5, 10, 10)
  assert.throws(() => booleanPaths('unite', a, b))
})

// 7. 环向阵列三份 + 首尾相接校验
ok('环向阵列三份等距分布', () => {
  const doc = createDocument()
  const W = circumference(doc.shaft.diameterMm)
  const p = createPath([createNode(0, 20), createNode(5, 30)], false)
  const copies = polarArrayThree(p, W)
  assert.equal(copies.length, 3)
  assert.ok(Math.abs(copies[1].dx - W / 3) < 1e-9)
  assert.ok(Math.abs(copies[2].dx - (2 * W) / 3) < 1e-9)
})
ok('拼缝首尾相接校验能发现错位', () => {
  const W = 30
  const bad = createPath([createNode(0, 10), createNode(10, 20)], false) // 右缝无端点
  const issues = checkSeamContinuity(bad, W, 0.05)
  assert.ok(issues.length >= 1)
  const good = createPath([createNode(0, 10), createNode(15, 20), createNode(30, 10)], false)
  assert.equal(checkSeamContinuity(good, W, 0.05).length, 0)
})

// 8. SVG d 字符串与原始数据
ok('节点模型转 SVG path d（含 Z 闭合）', () => {
  const p = rect(0, 0, 5, 5)
  const d = nodesToD(p)
  assert.ok(d.startsWith('M 0 0'))
  assert.ok(d.endsWith('Z'))
})

// 8. SVG 导出：图层分组 + 原始路径数据 + 窄缝标红
ok('SVG 导出保留图层分组与原始路径数据', () => {
  const doc = createDocument()
  const p = rect(2, 2, 6, 6)
  p.sourceData = { op: 'unite', operands: ['snap-a', 'snap-b'] }
  doc.layers[0].paths.push(p)
  doc.layers[0].name = '雕刻层A'
  const gapReport = { markers: [{ x: 5, y: 5, distance: 0.21 }], perPath: { [p.id]: [{ distance: 0.21 }] } }
  const svg = buildSVGString(doc, gapReport)
  assert.ok(svg.includes('inkscape:label="雕刻层A"'), '图层分组保留')
  assert.ok(svg.includes('data-original-nodes='), '原始节点数据保留')
  assert.ok(svg.includes('data-source='), '运算履历保留')
  assert.ok(svg.includes('stroke="#dc2626"'), '窄缝路径标红')
  assert.ok(svg.includes('data-circumference-mm="37.6991"'), '周长写入 SVG 属性')
  assert.ok(svg.includes('narrow-gap-markers'), '窄缝标记分组存在')
})

// 9. 批次三级分类
const sample = loadSampleBatch()
ok('示例批次自动检查分出合格/警告/退回三级', () => {
  assert.equal(sample.items.length, 6)
  const levels = new Set(sample.items.map((i) => i.check.level))
  assert.ok(levels.has('pass'))
  assert.ok(levels.has('warn'))
  assert.ok(levels.has('reject'))
  // 细线 0.18mm 必须退回
  const thin = sample.items.find((i) => i.code === 'XX-004')
  assert.equal(thin.check.level, 'reject')
  assert.ok(thin.check.reasons.some((r) => r.code === 'LINE_WIDTH'))
  // 窄缝样例必须带 NARROW_GAP
  const narrow = sample.items.find((i) => i.code === 'ZJ-003')
  assert.ok(narrow.check.reasons.some((r) => r.code === 'NARROW_GAP'))
})

// 10. 复核流程：未处理完不能放行；驳回必须有原因
ok('整批未复核完不能放行', () => {
  assert.equal(batchSummary.value.allHandled, false)
  assert.throws(() => releaseBatch())
})
ok('驳回必须填写原因', () => {
  assert.throws(() => rejectItem(sample.items[0].id, '张师傅', ''))
})
ok('逐条确认/驳回后才能整批放行，退回清单带原因', () => {
  sample.items.forEach((item, i) => {
    if (item.check.level === 'reject') {
      rejectItem(item.id, '张师傅', `供应商原因-${i}: 请按厂规修正线宽/窄缝`)
    } else {
      confirmItem(item.id, '张师傅', i % 2 ? '警告项已现场确认可加工' : '')
    }
  })
  assert.equal(batchSummary.value.allHandled, true)
  assert.ok(batchSummary.value.canRelease)
  const sheet = buildRejectSheet()
  assert.ok(sheet.items.length >= 1)
  assert.ok(sheet.items.every((it) => it.rejectReason.includes('供应商原因')))
  const b = releaseBatch()
  assert.equal(b.released, true)
  assert.ok(b.releasedAt)
})

console.log(`\n全部 ${pass} 项测试通过 ✅`)
