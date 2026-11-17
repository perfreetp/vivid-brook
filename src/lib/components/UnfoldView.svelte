<script>
  import { params, samples } from '../stores.js'
  import { offsetSamples, findInterferences, interferenceRanges } from '../geometry/offset.js'
  import { unfoldStrip } from '../geometry/unfold.js'
  import { tessellate } from '../geometry/surface.js'

  // 内衬 = 截面沿内法线等距偏移
  $: offsetPts = offsetSamples($samples, -$params.offset)
  $: hits = findInterferences(offsetPts)
  $: ranges = interferenceRanges(hits, $samples.length)
  $: offsetOk = hits.length === 0

  $: unfoldOpts = {
    kFactor: $params.kFactor, thickness: $params.thickness,
    L: $params.pathLen, taper0: $params.taper0, taper1: $params.taper1,
    seamU: $params.seamU, allowance: $params.allowance
  }
  $: outer = unfoldStrip($samples, unfoldOpts)
  $: linerSamples = offsetPts.map(p => ({ ...p, k: $samples[p.srcIndex]?.k ?? 0 }))
  $: liner = unfoldStrip(linerSamples, unfoldOpts)
  $: surf = tessellate($samples, $params.pathLen, $params.taper0, $params.taper1, $params.unfoldNv)

  // ---- 截面+偏移视图 ----
  $: profView = (() => {
    const xs = $samples.map(p => p.x), ys = $samples.map(p => p.y)
    const m = 15
    const x0 = Math.min(...xs) - m, y0 = Math.min(...ys, -$params.offset - 5) - m
    return `${x0} ${y0} ${Math.max(...xs) - x0 + m} ${Math.max(...ys) - y0 + m}`
  })()
  const poly = pts => pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
  $: inRange = i => ranges.some(r => i >= r.from && i <= r.to)

  // ---- 展开图视图 ----
  const GAP = 25
  $: patView = outer && liner ? (() => {
    const w = Math.max(outer.width, liner.width)
    const x0 = Math.min(outer.minX, liner.minX) - $params.allowance - 8
    const h = outer.height + GAP + liner.height + 16
    return `${x0} -${$params.allowance + 8} ${w + 2 * $params.allowance + 16} ${h}`
  })() : '0 0 100 100'
  $: linerDy = outer ? outer.height + GAP : 0
  const outlinePath = o => o.outline.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z'

  function rangeLabel(r) {
    const a = $samples[r.from], b = $samples[r.to]
    return `第 ${a.seg + 1}${a.seg === b.seg ? '' : '–' + (b.seg + 1)} 段(采样 #${r.from}–#${r.to})`
  }

  function exportSVG() {
    if (!outer || !liner) return
    const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${patView}" font-family="sans-serif">
  <rect x="${outer.minX - $params.allowance}" y="${-$params.allowance}" width="${outer.width}" height="${outer.height}" fill="none" stroke="#888" stroke-dasharray="2 2" stroke-width="0.3"/>
  <path d="${outlinePath(outer)}" fill="#dfe9f5" stroke="#222" stroke-width="0.4"/>
  <line x1="${outer.joinX}" y1="0" x2="${outer.joinX}" y2="${$params.pathLen}" stroke="#d33" stroke-dasharray="2 2" stroke-width="0.4"/>
  <text x="${outer.minX}" y="${$params.pathLen + 6}" font-size="4">外片 ${outer.width.toFixed(1)} × ${outer.height.toFixed(1)} mm  面积 ${outer.area.toFixed(0)} mm²</text>
  <g transform="translate(0 ${linerDy})">
    <rect x="${liner.minX - $params.allowance}" y="${-$params.allowance}" width="${liner.width}" height="${liner.height}" fill="none" stroke="#888" stroke-dasharray="2 2" stroke-width="0.3"/>
    <path d="${outlinePath(liner)}" fill="#f5e9df" stroke="#222" stroke-width="0.4"/>
    <line x1="${liner.joinX}" y1="0" x2="${liner.joinX}" y2="${$params.pathLen}" stroke="#d33" stroke-dasharray="2 2" stroke-width="0.4"/>
    <text x="${liner.minX}" y="${$params.pathLen + 6}" font-size="4">内衬 ${liner.width.toFixed(1)} × ${liner.height.toFixed(1)} mm  面积 ${liner.area.toFixed(0)} mm²</text>
  </g>
</svg>`
    const blob = new Blob([s], { type: 'image/svg+xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'fingertip_pattern.svg'
    a.click()
    URL.revokeObjectURL(a.href)
  }
</script>

<div class="unfold">
  <div class="controls">
    <label>偏移间距 <input type="range" min="1" max="15" step="0.5" bind:value={$params.offset} /> <b>{$params.offset}mm</b></label>
    <label>料厚 <input type="range" min="0.5" max="6" step="0.5" bind:value={$params.thickness} /> <b>{$params.thickness}mm</b></label>
    <label>K 因子 <input type="range" min="0" max="1" step="0.05" bind:value={$params.kFactor} /> <b>{Number($params.kFactor).toFixed(2)}</b></label>
    <label>缝合边位置 <input type="range" min="0" max="1" step="0.01" bind:value={$params.seamU} /> <b>{Number($params.seamU).toFixed(2)}</b></label>
    <label>缝份 <input type="range" min="0" max="15" step="1" bind:value={$params.allowance} /> <b>{$params.allowance}mm</b></label>
    <button on:click={exportSVG}>导出下料 SVG</button>
  </div>

  <div class="panels">
    <div class="panel">
      <h4>截面等距偏移(内衬轮廓)</h4>
      {#if offsetOk}
        <div class="ok">✓ 偏移 {$params.offset}mm 无干涉,内衬轮廓有效</div>
      {:else}
        <div class="fail">✗ 偏移 {$params.offset}mm 失败:{ranges.length} 段干涉 —— {ranges.map(rangeLabel).join(';')}</div>
      {/if}
      <svg viewBox={profView}>
        <polyline points={poly($samples)} fill="none" stroke="#e8ecf1" stroke-width="0.8" />
        <polyline points={poly(offsetPts)} fill="none"
                  stroke={offsetOk ? '#3fb68b' : '#e5a54d'} stroke-width="0.8" stroke-dasharray="2 1" />
        {#each $samples as p, i}
          {#if inRange(i)}
            <circle cx={p.x} cy={p.y} r="1.4" fill="#e5484d" />
          {/if}
        {/each}
        {#each hits as hh}
          <circle cx={hh.x} cy={hh.y} r="1.2" fill="none" stroke="#e5484d" stroke-width="0.5" />
        {/each}
      </svg>
    </div>

    <div class="panel">
      <h4>平面下料图(按缝合边切开 · 折弯补偿后)</h4>
      {#if outer && liner}
        <svg viewBox={patView}>
          <!-- 外片 -->
          <rect x={outer.minX - $params.allowance} y={-$params.allowance}
                width={outer.width} height={outer.height}
                fill="none" stroke="#66708a" stroke-dasharray="2 2" stroke-width="0.3" />
          <path d={outlinePath(outer)} fill="#22304a" stroke="#8fb6f0" stroke-width="0.4" />
          <line x1={outer.joinX} y1="0" x2={outer.joinX} y2={$params.pathLen}
                stroke="#e5484d" stroke-dasharray="2 2" stroke-width="0.4" />
          <text x={outer.minX} y={$params.pathLen + 5} font-size="3.5" fill="#dfe6f2">
            外片 下料 {outer.width.toFixed(1)} × {outer.height.toFixed(1)} mm
          </text>
          <!-- 内衬 -->
          <g transform="translate(0 {linerDy})">
            <rect x={liner.minX - $params.allowance} y={-$params.allowance}
                  width={liner.width} height={liner.height}
                  fill="none" stroke="#66708a" stroke-dasharray="2 2" stroke-width="0.3" />
            <path d={outlinePath(liner)} fill="#3a2f22" stroke="#e0b88f" stroke-width="0.4" />
            <line x1={liner.joinX} y1="0" x2={liner.joinX} y2={$params.pathLen}
                  stroke="#e5484d" stroke-dasharray="2 2" stroke-width="0.4" />
            <text x={liner.minX} y={$params.pathLen + 5} font-size="3.5" fill="#dfe6f2">
              内衬 下料 {liner.width.toFixed(1)} × {liner.height.toFixed(1)} mm
            </text>
          </g>
        </svg>
      {/if}
      <div class="stats">
        <div><span>曲面面积(细分)</span><b>{surf.area.toFixed(1)} mm²</b></div>
        <div><span>外片展开面积</span><b>{outer ? outer.area.toFixed(1) : '-'} mm²</b></div>
        <div><span>外片下料尺寸</span><b>{outer ? `${outer.width.toFixed(1)} × ${outer.height.toFixed(1)} mm` : '-'}</b></div>
        <div><span>内衬展开面积</span><b>{liner ? liner.area.toFixed(1) : '-'} mm²</b></div>
        <div><span>内衬下料尺寸</span><b>{liner ? `${liner.width.toFixed(1)} × ${liner.height.toFixed(1)} mm` : '-'}</b></div>
        <div><span>补偿后展开长</span><b>{outer ? outer.length.toFixed(1) : '-'} mm</b></div>
      </div>
    </div>
  </div>
</div>

<style>
  .unfold { display: flex; flex-direction: column; gap: 8px; height: 100%; }
  .controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; font-size: 12px; color: #aab3c5; }
  .controls b { color: #dfe6f2; min-width: 44px; display: inline-block; }
  button { background: #232a38; color: #dfe6f2; border: 1px solid #3a4358; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  .panels { display: grid; grid-template-columns: 1fr 1.2fr; gap: 10px; flex: 1; min-height: 0; }
  .panel { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  h4 { margin: 0; font-size: 13px; color: #dfe6f2; font-weight: 600; }
  svg { flex: 1; min-height: 300px; background: #12151c; border: 1px solid #2a3142; border-radius: 6px; }
  .ok { color: #3fb68b; font-size: 12px; }
  .fail { color: #e5484d; font-size: 12px; font-weight: 600; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .stats div { background: #1a1f2b; border: 1px solid #2a3142; border-radius: 5px; padding: 6px 8px; display: flex; flex-direction: column; }
  .stats span { font-size: 11px; color: #66708a; }
  .stats b { font-size: 13px; color: #dfe6f2; }
</style>
