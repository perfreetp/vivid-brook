// 干净 SVG 导出：仅几何与标注，按 舞台 / 路径标线 / 机器人位 三层分组
import { shapeToContour } from './geometry.js'
import { buildCommands, commandsToSvgPath } from './pathbuild.js'

const xmlEscape = (s) => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]))

function shapePathD(s) {
  const contour = shapeToContour(s)
  const closed = s.type !== 'path' || s.closed !== false
  return commandsToSvgPath(buildCommands(contour, closed))
}

// 机器人图标矢量（指向上方，绕中心 angle 旋转）
function robotIconPath(r) {
  // 圆形机身 + 方向三角 + 双轮，简化为可复用路径
  return {
    body: `M${r3(-r * 0.55)} ${r3(-r * 0.3)} L${r3(r * 0.55)} ${r3(-r * 0.3)} L${r3(r * 0.55)} ${r3(r * 0.55)} L${r3(-r * 0.55)} ${r3(r * 0.55)} Z`,
    dir: `M0 ${r3(-r * 0.95)} L${r3(r * 0.28)} ${r3(-r * 0.45)} L${r3(-r * 0.28)} ${r3(-r * 0.45)} Z`
  }
}
const r3 = (v) => Math.round(v * 1000) / 1000

export function exportShowSVG(show) {
  const W = show.stage.width, H = show.stage.height
  const lines = []
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
  lines.push(`<title>${xmlEscape(show.name)}-走位标线</title>`)

  // 第一层：舞台
  lines.push(`<g id="layer-stage" data-name="舞台">`)
  lines.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#10141f" stroke="#3b4256" stroke-width="2"/>`)
  lines.push(`</g>`)

  // 第二层：路径与候场区
  lines.push(`<g id="layer-path" data-name="路径标线">`)
  for (const s of show.shapes) {
    if (s.layer !== 'path' || s.visible === false) continue
    const d = shapePathD(s)
    const meta = []
    if (s.beat) meta.push(`data-beat="${xmlEscape(s.beat)}"`)
    if (s.actor) meta.push(`data-actor="${xmlEscape(s.actor)}"`)
    lines.push(`<path id="${xmlEscape(s.id)}" data-name="${xmlEscape(s.name)}" d="${d}" ` +
      `fill="${s.fill || 'rgba(88,166,255,0.12)'}" stroke="${s.stroke || '#58a6ff'}" ` +
      `stroke-width="${s.strokeWidth || 2}" fill-rule="evenodd" ${meta.join(' ')}/>`)
  }
  lines.push(`</g>`)

  // 第三层：机器人位
  lines.push(`<g id="layer-robot" data-name="机器人位">`)
  for (const s of show.shapes) {
    if (s.layer !== 'robot' || s.visible === false) continue
    const icon = robotIconPath(s.radius)
    lines.push(`<g id="${xmlEscape(s.id)}" data-name="${xmlEscape(s.name)}" transform="translate(${r3(s.x)} ${r3(s.y)}) rotate(${s.angle || 0})">`)
    lines.push(`<circle r="${r3(s.radius)}" fill="${s.fill || 'rgba(255,184,77,0.18)'}" stroke="${s.stroke || '#ffb84d'}" stroke-width="2"/>`)
    lines.push(`<path d="${icon.body}" fill="none" stroke="${s.stroke || '#ffb84d'}" stroke-width="1.5"/>`)
    lines.push(`<path d="${icon.dir}" fill="${s.stroke || '#ffb84d'}"/>`)
    if (s.beat || s.actor) {
      lines.push(`<text y="${r3(s.radius + 16)}" text-anchor="middle" font-size="13" fill="#e6e9f2" font-family="sans-serif">` +
        `${xmlEscape([s.beat, s.actor].filter(Boolean).join(' · '))}</text>`)
    }
    lines.push(`</g>`)
  }
  lines.push(`</g>`)
  lines.push(`</svg>`)
  return lines.join('\n')
}

export function downloadSVG(show) {
  const svg = exportShowSVG(show)
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${show.name || 'show'}-走位.svg`
  a.click()
  URL.revokeObjectURL(url)
}
