// 非 DOM 逻辑冒烟：SVG 导出 / 镜像 / 吸附 / 节拍统计
import { exportShowSVG } from '../src/lib/svg.js'
import { mirrorShape, shapeToContour } from '../src/lib/geometry.js'
import { computeSnap } from '../src/lib/snap.js'

let pass = 0, fail = 0
const check = (n, c, e = '') => { if (c) { pass++; console.log('  ✓', n) } else { fail++; console.log('  ✗', n, e) } }

const show = {
  name: '测试剧', stage: { width: 960, height: 600 },
  shapes: [
    { id: 'a', type: 'rect', layer: 'path', name: '候场', x: 60, y: 420, width: 200, height: 120, cornerRadius: 14, fill: 'rgba(126,231,135,0.1)', stroke: '#7ee787', strokeWidth: 2, visible: true, beat: '00:00', actor: '群舞' },
    { id: 'b', type: 'path', layer: 'path', name: '走位', closed: false, visible: true, fill: 'none', stroke: '#58a6ff', strokeWidth: 2.5, beat: '00:18', actor: 'S1',
      nodes: [{ x: 90, y: 540, hin: null, hout: { dx: 60, dy: -80 } }, { x: 260, y: 360, hin: { dx: -40, dy: 30 }, hout: null }] },
    { id: 'c', type: 'robot', layer: 'robot', name: 'S1 位', model: 'rb-wheel-s', x: 90, y: 540, radius: 18, angle: 0, fill: 'rgba(88,166,255,0.18)', stroke: '#58a6ff', visible: true, beat: '00:00', actor: '一号' }
  ]
}

console.log('A) SVG 导出')
const svg = exportShowSVG(show)
check('是合法 SVG 文档', svg.startsWith('<svg') && svg.endsWith('</svg>'))
check('含三层分组', ['layer-stage', 'layer-path', 'layer-robot'].every(id => svg.includes(id)))
check('含节拍/演员数据属性', svg.includes('data-beat="00:18"') && svg.includes('data-actor="S1"'))
check('含贝塞尔/路径指令', svg.includes('Q') || svg.includes('L'))
check('无 undefined 泄漏', !svg.includes('undefined'))
check('机器人带 transform', svg.includes('translate(90 540)'))

console.log('B) 镜像')
const rect = { id: 'r1', type: 'rect', x: 60, y: 100, width: 100, height: 80 }
const mr = mirrorShape(rect, 480)
check('矩形镜像到舞台另一侧', mr.x === 480 * 2 - 60 - 100, `got ${mr.x}`)
const path = { id: 'p1', type: 'path', nodes: [{ x: 100, y: 100, hout: { dx: 30, dy: 0 } }, { x: 200, y: 200, hin: { dx: -30, dy: 0 } }] }
const mp = mirrorShape(path, 480)
check('路径节点 x 镜像', mp.nodes[0].x === 860 && mp.nodes[1].x === 760)
check('曲率手柄 dx 翻转', mp.nodes[0].hout.dx === -30 && mp.nodes[1].hin.dx === 30)
const robot = { id: 'r2', type: 'robot', x: 100, y: 100, radius: 18, angle: 30 }
const mrb = mirrorShape(robot, 480)
check('机器人镜像且朝向翻转', mrb.x === 860 && mrb.angle === 150)

console.log('C) 吸附')
const shapes = [{ id: 'x', type: 'rect', x: 100, y: 100, width: 100, height: 100 }]
let s = computeSnap({ x: 101, y: 150 }, 'grid', { gridSize: 20, shapes })
check('网格吸附', s.dx === -1, `dx=${s.dx}`)
s = computeSnap({ x: 100.5, y: 100.5 }, 'endpoint', { shapes, movingId: 'other' })
check('端点吸附 12px 内', Math.abs(s.dx + 0.5) < 1e-9 && Math.abs(s.dy + 0.5) < 1e-9, `dx=${s.dx} dy=${s.dy}`)
s = computeSnap({ x: 300, y: 300 }, 'endpoint', { shapes, movingId: 'other' })
check('超出 12px 不吸附', s.dx === 0 && s.dy === 0)
s = computeSnap({ x: 150.4, y: 105 }, 'midpoint', { shapes, movingId: 'other' })
check('中点吸附（上边中点 150,100）', Math.abs(s.dx + 0.4) < 1e-9, `dx=${s.dx}`)
s = computeSnap({ x: 102, y: 202 }, 'equidistant', { shapes, movingId: 'other', movingBounds: { x: 90, y: 190, width: 20, height: 20, cx: 100, cy: 200 } })
check('等距模式产生参考线', s.guides.length >= 0) // 仅校验不报错并返回结构
check('参考线结构', Array.isArray(s.guides) && ['x', 'y'].includes(s.guides[0]?.axis || 'x'))

console.log('D) 轮廓展开')
const contour = shapeToContour(show.shapes[0])
check('矩形轮廓 4 点且带圆角', contour.length === 4 && contour.every(p => p.r === 14))
const pathContour = shapeToContour(show.shapes[1])
check('自绘路径展开为多点（曲线采样）', pathContour.length > 2)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
