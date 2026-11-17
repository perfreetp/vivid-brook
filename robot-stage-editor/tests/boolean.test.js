// 布尔运算验证脚本：node tests/boolean.test.js
import { booleanPolygons, mergeCloseNodes } from '../src/lib/boolean.js'
import { signedArea } from '../src/lib/geometry.js'

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra) }
}
const rect = (x, y, w, h, r = 0) => [
  { x, y, r }, { x: x + w, y, r }, { x: x + w, y: y + h, r }, { x, y: y + h, r }
]
const area = (c) => Math.abs(signedArea(c))

console.log('1) 两矩形重叠并集')
let r = booleanPolygons(rect(0, 0, 100, 100, 10), rect(50, 50, 100, 100, 10), 'union')
check('并集产生 1 个轮廓', r.contours.length === 1, `got ${r.contours.length}`)
check('并集面积 ≈ 17500', Math.abs(area(r.contours[0]) - 17500) < 1, `got ${area(r.contours[0])}`)
check('并集保留原角点圆角数据', r.contours[0].some(p => p.r > 0))

console.log('2) 交集')
r = booleanPolygons(rect(0, 0, 100, 100, 10), rect(50, 50, 100, 100, 10), 'intersect')
check('交集 1 个轮廓', r.contours.length === 1)
check('交集面积 ≈ 2500', Math.abs(area(r.contours[0]) - 2500) < 1, `got ${area(r.contours[0])}`)

console.log('3) 差集')
r = booleanPolygons(rect(0, 0, 100, 100, 10), rect(50, 50, 100, 100, 10), 'difference')
check('差集 1 个轮廓', r.contours.length === 1, `got ${r.contours.length}`)
check('差集面积 ≈ 7500', Math.abs(area(r.contours[0]) - 7500) < 1, `got ${area(r.contours[0])}`)

console.log('4) 完全包含：union/intersect/difference')
r = booleanPolygons(rect(0, 0, 200, 200), rect(50, 50, 50, 50), 'union')
check('包含并集=外轮廓', r.contours.length === 1 && Math.abs(area(r.contours[0]) - 40000) < 1)
r = booleanPolygons(rect(0, 0, 200, 200), rect(50, 50, 50, 50), 'intersect')
check('包含交集=内轮廓', r.contours.length === 1 && Math.abs(area(r.contours[0]) - 2500) < 1)
r = booleanPolygons(rect(0, 0, 200, 200), rect(50, 50, 50, 50), 'difference')
check('包含差集=外轮廓', r.contours.length === 1 && Math.abs(area(r.contours[0]) - 40000) < 1)

console.log('5) 完全分离')
r = booleanPolygons(rect(0, 0, 50, 50), rect(200, 200, 50, 50), 'union')
check('分离并集=2 个轮廓', r.contours.length === 2)
r = booleanPolygons(rect(0, 0, 50, 50), rect(200, 200, 50, 50), 'intersect')
check('分离交集=0', r.contours.length === 0)
r = booleanPolygons(rect(0, 0, 50, 50), rect(200, 200, 50, 50), 'difference')
check('分离差集=原轮廓', r.contours.length === 1 && Math.abs(area(r.contours[0]) - 2500) < 1)

console.log('6) 圆（72 边多边形）与矩形布尔')
const circle = []
for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; circle.push({ x: 100 + Math.cos(a) * 50, y: 100 + Math.sin(a) * 50, smooth: true }) }
r = booleanPolygons(circle, rect(100, 100, 100, 100), 'intersect')
check('圆∩矩形面积约为圆的 1/4 (~1963)', r.contours.length >= 1 && Math.abs(area(r.contours[0]) - Math.PI * 2500 / 4) < 120,
  `got ${r.contours.length ? area(r.contours[0]) : 'none'}`)
check('结果保留 smooth 标记', r.contours[0]?.some(p => p.smooth))

console.log('7) 重叠节点合并')
const merged = mergeCloseNodes([{ x: 0, y: 0, r: 8 }, { x: 0.5, y: 0.2, r: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0.1, y: 0.1 }], 2)
check('近点被合并并保留最大圆角', merged.length === 3 && merged[0].r === 8, `got ${merged.length}`)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
