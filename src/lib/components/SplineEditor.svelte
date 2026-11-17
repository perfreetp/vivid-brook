<script>
  import { anchors, params, samples } from '../stores.js'
  import { curvatureJumps, splitSegment, smoothAnchor, closestOnSpline } from '../geometry/spline.js'

  let svg
  let selected = -1
  let addMode = false
  let drag = null // { kind:'anchor'|'hin'|'hout', i }

  $: jumps = curvatureJumps($samples, $params.jumpThresh)
  $: pathD = buildPath($anchors)
  $: viewBox = computeViewBox($anchors)
  $: combLines = $samples.map((p, i) => ({
    x1: p.x, y1: p.y,
    x2: p.x + p.nx * p.k * $params.combScale,
    y2: p.y + p.ny * p.k * $params.combScale,
    red: jumps[i]
  }))
  $: combTipPath = combLines.length
    ? 'M' + combLines.map(l => `${l.x2.toFixed(2)} ${l.y2.toFixed(2)}`).join(' L')
    : ''
  $: jumpCount = jumps.filter(Boolean).length

  function buildPath(list) {
    if (list.length < 2) return ''
    let d = `M ${list[0].x} ${list[0].y}`
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1]
      d += ` C ${a.hout.x} ${a.hout.y}, ${b.hin.x} ${b.hin.y}, ${b.x} ${b.y}`
    }
    return d
  }

  function computeViewBox(list) {
    const xs = [], ys = []
    for (const a of list) {
      xs.push(a.x, a.hin.x, a.hout.x); ys.push(a.y, a.hin.y, a.hout.y)
    }
    const m = 25
    const x0 = Math.min(...xs) - m, y0 = Math.min(...ys) - m
    return `${x0} ${y0} ${Math.max(...xs) - x0 + m} ${Math.max(...ys) - y0 + m}`
  }

  function toLocal(e) {
    const pt = new DOMPoint(e.clientX, e.clientY)
    return pt.matrixTransform(svg.getScreenCTM().inverse())
  }

  function onSvgDown(e) {
    if (!addMode) return
    const p = toLocal(e)
    const hit = closestOnSpline($anchors, p.x, p.y)
    if (hit) {
      anchors.update(a => splitSegment(a, hit.seg, hit.t))
      selected = hit.seg + 1
    }
  }

  function startDrag(e, kind, i) {
    e.stopPropagation()
    selected = i
    drag = { kind, i }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', endDrag, { once: true })
  }

  function onMove(e) {
    if (!drag) return
    const p = toLocal(e)
    anchors.update(list => {
      const l = list.map(a => ({ ...a, hin: { ...a.hin }, hout: { ...a.hout } }))
      const a = l[drag.i]
      if (drag.kind === 'anchor') {
        const dx = p.x - a.x, dy = p.y - a.y
        a.x = p.x; a.y = p.y
        a.hin.x += dx; a.hin.y += dy
        a.hout.x += dx; a.hout.y += dy
      } else if (drag.kind === 'hin') {
        a.hin = { x: p.x, y: p.y }
      } else {
        a.hout = { x: p.x, y: p.y }
      }
      return l
    })
  }

  function endDrag() {
    drag = null
    window.removeEventListener('pointermove', onMove)
  }

  function removeSelected() {
    if (selected < 0 || $anchors.length <= 2) return
    anchors.update(l => l.filter((_, i) => i !== selected))
    selected = -1
  }

  function smoothSelected() {
    if (selected < 0) return
    anchors.update(l => l.map((a, i) => (i === selected ? smoothAnchor(a) : a)))
  }
</script>

<div class="editor">
  <div class="toolbar">
    <button class:active={addMode} on:click={() => (addMode = !addMode)}>
      {addMode ? '✚ 点击曲线加点中…' : '✚ 加点模式'}
    </button>
    <button on:click={smoothSelected} disabled={selected < 0}>光顺手柄</button>
    <button on:click={removeSelected} disabled={selected < 0 || $anchors.length <= 2}>删除锚点</button>
    <label>曲率梳 <input type="range" min="5" max="80" bind:value={$params.combScale} /></label>
    <label>突变阈值 <input type="range" min="0.01" max="0.2" step="0.005" bind:value={$params.jumpThresh} />
      <span class="num">{$params.jumpThresh.toFixed(3)}</span></label>
    <label>采样密度 <input type="range" min="8" max="64" step="1" bind:value={$params.density} />
      <span class="num">{$params.density}/段</span></label>
    {#if jumpCount > 0}
      <span class="warn">⚠ {jumpCount} 处曲率突变</span>
    {/if}
  </div>

  <svg bind:this={svg} {viewBox} on:pointerdown={onSvgDown} class:addmode={addMode}>
    <!-- 曲率梳 -->
    {#each combLines as l}
      <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke={l.red ? '#e5484d' : '#5b9bd5'} stroke-width={l.red ? 0.9 : 0.45} />
    {/each}
    <path d={combTipPath} fill="none" stroke="#5b9bd5" stroke-width="0.4" opacity="0.6" />
    <!-- 曲率突变红点 -->
    {#each $samples as p, i}
      {#if jumps[i]}
        <circle cx={p.x} cy={p.y} r="1.6" fill="#e5484d" />
      {/if}
    {/each}
    <!-- 样条本体 -->
    <path d={pathD} fill="none" stroke="#e8ecf1" stroke-width="1.2" />
    <!-- 手柄 -->
    {#each $anchors as a, i}
      <line x1={a.x} y1={a.y} x2={a.hin.x} y2={a.hin.y} stroke="#8a93a6" stroke-width="0.4" />
      <line x1={a.x} y1={a.y} x2={a.hout.x} y2={a.hout.y} stroke="#8a93a6" stroke-width="0.4" />
      <rect x={a.hin.x - 1.6} y={a.hin.y - 1.6} width="3.2" height="3.2"
            fill="#c9a227" class="handle" on:pointerdown={e => startDrag(e, 'hin', i)} />
      <rect x={a.hout.x - 1.6} y={a.hout.y - 1.6} width="3.2" height="3.2"
            fill="#c9a227" class="handle" on:pointerdown={e => startDrag(e, 'hout', i)} />
      <circle cx={a.x} cy={a.y} r={i === selected ? 3 : 2.2}
              fill={i === selected ? '#4f9cff' : '#e8ecf1'} stroke="#233" stroke-width="0.4"
              class="anchor" on:pointerdown={e => startDrag(e, 'anchor', i)} />
    {/each}
  </svg>

  {#if selected >= 0 && $anchors[selected]}
    <div class="selbar">
      锚点 #{selected + 1}:
      权重 <input type="range" min="0.1" max="10" step="0.1" bind:value={$anchors[selected].weight} />
      <span class="num">{Number($anchors[selected].weight).toFixed(1)}</span>
      <span class="hint">(权重&gt;1 拉向该点,&lt;1 远离;调大可做硬挺的唇口)</span>
    </div>
  {/if}
</div>

<style>
  .editor { display: flex; flex-direction: column; gap: 6px; height: 100%; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; }
  .toolbar label { display: flex; align-items: center; gap: 4px; color: #aab3c5; }
  button { background: #232a38; color: #dfe6f2; border: 1px solid #3a4358; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  button:disabled { opacity: 0.4; cursor: default; }
  button.active { background: #2d4a78; border-color: #4f9cff; }
  svg { flex: 1; min-height: 320px; background: #12151c; border: 1px solid #2a3142; border-radius: 6px; touch-action: none; }
  svg.addmode { cursor: crosshair; }
  .anchor, .handle { cursor: grab; }
  .num { color: #dfe6f2; min-width: 42px; display: inline-block; }
  .warn { color: #e5484d; font-weight: 600; }
  .selbar { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #aab3c5; }
  .hint { color: #66708a; }
</style>
