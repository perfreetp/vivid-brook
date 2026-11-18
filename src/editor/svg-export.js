// SVG 导出：保留图层分组、原始路径数据（data-original-nodes）、运算履历与窄缝标红
import { nodesToD, canvasWidthMm } from './model.js'

const r = (v) => (+v).toFixed(4).replace(/\.?0+$/, '')

export function buildSVGString(doc, gapReport) {
  const W = canvasWidthMm(doc)
  const L = doc.shaft.lengthMm
  const layerXml = doc.layers
    .map((layer) => {
      const pathsXml = layer.paths
        .map((p) => {
          const d = nodesToD(p)
          const gaps = gapReport.perPath[p.id] || []
          const gapAttr = gaps.length
            ? ` data-narrow-gaps="${gaps.length}" data-min-gap-mm="${gaps[0].distance}"`
            : ''
          const src = p.sourceData
            ? ` data-source='${JSON.stringify(p.sourceData).replace(/'/g, '&apos;')}'`
            : ''
          const original = ` data-original-nodes='${JSON.stringify(p.nodes).replace(/'/g, '&apos;')}'`
          return `      <path d="${d}" fill="${p.fill}" stroke="${gaps.length ? '#dc2626' : p.stroke}" stroke-width="${p.strokeWidth}"${gapAttr}${src}${original}/>`
        })
        .join('\n')
      return `    <g id="layer-${layer.id}" inkscape:groupmode="layer" inkscape:label="${layer.name}" data-visible="${layer.visible}">\n${pathsXml}\n    </g>`
    })
    .join('\n')

  const gapMarkers = (gapReport.markers || [])
    .map(
      (g) =>
        `    <circle cx="${g.x}" cy="${g.y}" r="0.6" fill="none" stroke="#dc2626" stroke-width="0.12"/><text x="${g.x + 0.8}" y="${g.y}" font-size="1.6" fill="#dc2626">${g.distance}mm</text>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="${W}mm" height="${L}mm" viewBox="0 0 ${r(W)} ${r(L)}"
     data-shaft-diameter-mm="${doc.shaft.diameterMm}"
     data-shaft-length-mm="${doc.shaft.lengthMm}"
     data-circumference-mm="${r(W)}"
     data-narrow-gap-threshold-mm="${doc.narrowGapThresholdMm}">
  <metadata>
    <engine>brush-shaft-engraving-studio</engine>
    <exportedAt>${new Date().toISOString()}</exportedAt>
    <document>${JSON.stringify({ shaft: doc.shaft, grid: doc.grid }).replace(/</g, '&lt;')}</document>
  </metadata>
${layerXml}
  <g id="narrow-gap-markers">
${gapMarkers}
  </g>
</svg>`
}
