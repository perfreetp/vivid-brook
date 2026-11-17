<script>
  import { onMount, onDestroy } from 'svelte'
  import { anchors, params, samples } from '../stores.js'
  import { createRenderer } from '../webgpu/renderer.js'
  import { tessellate } from '../geometry/surface.js'

  let canvas
  let renderer = null
  let gpuOk = null // null=初始化中 true/false
  let raf = 0
  const camera = { theta: 0.8, phi: 1.1, dist: 180, target: [0, 10, 30] }

  $: kmax = $samples.reduce((m, p) => Math.max(m, Math.abs(p.k)), 1e-6)

  onMount(async () => {
    renderer = await createRenderer(canvas)
    gpuOk = !!renderer
    resize()
    window.addEventListener('resize', resize)
    const loop = () => { draw(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
  })

  onDestroy(() => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', resize)
  })

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.max(1, canvas.clientWidth * dpr)
    canvas.height = Math.max(1, canvas.clientHeight * dpr)
  }

  function draw() {
    if (!$samples.length) return
    camera.target = [0, 10, $params.pathLen / 2]
    if (renderer) {
      renderer.render({
        anchors: $anchors,
        nu: $samples.length,
        nv: $params.unfoldNv,
        L: $params.pathLen,
        taper0: $params.taper0,
        taper1: $params.taper1,
        kmax,
        colorMode: $params.colorMode,
        camera
      })
    } else if (gpuOk === false) {
      drawFallback()
    }
  }

  // CPU 回退:软件细分 + 正交投影线框
  function drawFallback() {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { pos, nu, nv } = tessellate($samples, $params.pathLen, $params.taper0, $params.taper1, $params.unfoldNv)
    const w = canvas.width, h = canvas.height
    ctx.fillStyle = '#171a21'
    ctx.fillRect(0, 0, w, h)
    const { theta, phi } = camera
    const st = Math.sin(theta), ct = Math.cos(theta), sp = Math.sin(phi), cp = Math.cos(phi)
    const scale = Math.min(w, h) / 160
    const proj = (x, y, z) => {
      const X = x * ct - z * st
      const Z = x * st + z * ct
      const Y = y * cp - Z * sp * 0.6
      return [w / 2 + X * scale, h / 2 - (Y - 10) * scale]
    }
    ctx.strokeStyle = '#4f9cff'
    ctx.lineWidth = 0.6
    ctx.beginPath()
    for (let iv = 0; iv < nv; iv += 2) {
      for (let iu = 0; iu < nu; iu++) {
        const o = (iv * nu + iu) * 3
        const [px, py] = proj(pos[o], pos[o + 1], pos[o + 2])
        iu === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
      }
    }
    for (let iu = 0; iu < nu; iu += 4) {
      for (let iv = 0; iv < nv; iv++) {
        const o = (iv * nu + iu) * 3
        const [px, py] = proj(pos[o], pos[o + 1], pos[o + 2])
        iv === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
      }
    }
    ctx.stroke()
  }

  let dragging = false, lx = 0, ly = 0
  function down(e) { dragging = true; lx = e.clientX; ly = e.clientY }
  function move(e) {
    if (!dragging) return
    camera.theta += (e.clientX - lx) * 0.01
    camera.phi = Math.max(0.15, Math.min(Math.PI - 0.15, camera.phi - (e.clientY - ly) * 0.01))
    lx = e.clientX; ly = e.clientY
  }
  function up() { dragging = false }
  function wheel(e) {
    e.preventDefault()
    camera.dist = Math.max(60, Math.min(600, camera.dist * (1 + Math.sign(e.deltaY) * 0.1)))
  }
</script>

<div class="view">
  <div class="bar">
    <span class={gpuOk ? 'ok' : gpuOk === false ? 'bad' : ''}>
      {gpuOk === null ? 'WebGPU 初始化…' : gpuOk ? '● WebGPU 曲面细分+实时着色' : '○ WebGPU 不可用,CPU 线框回退'}
    </span>
    <label><input type="checkbox" checked={$params.colorMode === 1}
      on:change={e => ($params.colorMode = e.target.checked ? 1 : 0)} /> 曲率热力着色</label>
    <label>扫掠长 <input type="range" min="20" max="120" bind:value={$params.pathLen} /> <b>{$params.pathLen}mm</b></label>
    <label>末端变截面 <input type="range" min="0.5" max="1.2" step="0.05" bind:value={$params.taper1} /> <b>{Number($params.taper1).toFixed(2)}</b></label>
  </div>
  <canvas bind:this={canvas} on:pointerdown={down} on:pointermove={move} on:pointerup={up}
          on:pointerleave={up} on:wheel={wheel}></canvas>
  <div class="tip">拖拽旋转 · 滚轮缩放 · 曲面面积(细分求和)见下方展开页</div>
</div>

<style>
  .view { display: flex; flex-direction: column; gap: 6px; height: 100%; }
  .bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; font-size: 12px; color: #aab3c5; }
  .bar b { color: #dfe6f2; font-weight: 600; }
  .ok { color: #3fb68b; }
  .bad { color: #e5a54d; }
  canvas { flex: 1; min-height: 320px; width: 100%; background: #171a21; border: 1px solid #2a3142; border-radius: 6px; touch-action: none; }
  .tip { font-size: 11px; color: #66708a; }
</style>
