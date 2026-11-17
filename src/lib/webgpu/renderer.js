// WebGPU 曲面渲染器:曲面细分在顶点着色器内完成(GPU tessellation),
// 截面样条段数据经 storage buffer 上传,曲率热力实时着色。
// 无 WebGPU 时返回 null,由调用方走 CPU 回退。

const WGSL = /* wgsl */`
struct Uniforms {
  mvp: mat4x4f,
  p0: vec4f, // x: L  y: taper0  z: taper1  w: kmax
  p1: vec4u, // x: nu  y: nv  z: nseg  w: colorMode
  light: vec4f,
};
struct Seg { p0: vec4f, c1: vec4f, c2: vec4f, p3: vec4f, };
@group(0) @binding(0) var<uniform> uni: Uniforms;
@group(0) @binding(1) var<storage, read> segs: array<Seg>;

fn evalProfile(u: f32) -> vec2f {
  let nseg = uni.p1.z;
  let fu = clamp(u, 0.0, 1.0) * f32(nseg);
  var si = u32(floor(fu));
  if (si >= nseg) { si = nseg - 1u; }
  let t = clamp(fu - floor(fu), 0.0, 1.0);
  let sg = segs[si];
  let mt = 1.0 - t;
  let b0 = mt*mt*mt; let b1 = 3.0*mt*mt*t; let b2 = 3.0*mt*t*t; let b3 = t*t*t;
  let den = b0*sg.p0.z + b1*sg.c1.z + b2*sg.c2.z + b3*sg.p3.z;
  return vec2f(
    (b0*sg.p0.z*sg.p0.x + b1*sg.c1.z*sg.c1.x + b2*sg.c2.z*sg.c2.x + b3*sg.p3.z*sg.p3.x) / den,
    (b0*sg.p0.z*sg.p0.y + b1*sg.c1.z*sg.c1.y + b2*sg.c2.z*sg.c2.y + b3*sg.p3.z*sg.p3.y) / den
  );
}

fn surfP(u: f32, v: f32) -> vec3f {
  let p = evalProfile(u);
  let s = mix(uni.p0.y, uni.p0.z, v);
  return vec3f(p.x * s, p.y * s, v * uni.p0.x);
}

fn profileCurv(u: f32) -> f32 {
  let e = 0.5 / f32(uni.p1.x);
  let pm = evalProfile(u - e); let p0 = evalProfile(u); let pp = evalProfile(u + e);
  let d1 = (pp - pm) / (2.0 * e);
  let d2 = (pp - 2.0 * p0 + pm) / (e * e);
  let sp = pow(d1.x*d1.x + d1.y*d1.y, 1.5);
  return (d1.x*d2.y - d1.y*d2.x) / max(sp, 1e-9);
}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) nrm: vec3f,
  @location(1) curv: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let nu = uni.p1.x; let nv = uni.p1.y;
  let qu = nu - 1u; let qv = nv - 1u;
  let quad = vi / 6u; let vert = vi % 6u;
  let iu = quad % qu; let iv = quad / qu;
  var du = 0u; var dv = 0u;
  if (vert == 1u || vert == 3u) { du = 1u; }
  if (vert == 2u || vert == 5u) { dv = 1u; }
  if (vert == 4u) { du = 1u; dv = 1u; }
  let u = f32(iu + du) / f32(qu);
  let v = f32(iv + dv) / f32(qv);
  let P = surfP(u, v);
  let e = 0.5 / f32(qu);
  let ev = 0.5 / f32(qv);
  let su = surfP(u + e, v) - surfP(u - e, v);
  let sv = surfP(u, v + ev) - surfP(u, v - ev);
  var n = normalize(cross(su, sv));
  if (dot(n.xy, P.xy) < 0.0) { n = -n; }
  var o: VOut;
  o.pos = uni.mvp * vec4f(P, 1.0);
  o.nrm = n;
  o.curv = profileCurv(u);
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let n = normalize(in.nrm);
  let lam = max(dot(n, normalize(uni.light.xyz)), 0.0) * 0.75 + 0.25;
  var base: vec3f;
  if (uni.p1.w == 1u) {
    // 曲率热力:蓝(平)→青→绿→黄→红(弯)
    let t = clamp(abs(in.curv) / max(uni.p0.w, 1e-6), 0.0, 1.0);
    base = vec3f(t, 0.85 * (1.0 - abs(t - 0.5) * 2.0) + 0.1, 1.0 - t);
  } else {
    base = vec3f(0.62, 0.72, 0.86);
  }
  return vec4f(base * lam, 1.0);
}
`

// ---- 列主序矩阵工具 ----
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2)
  const o = new Float32Array(16)
  o[0] = f / aspect; o[5] = f
  o[10] = far / (near - far); o[11] = -1
  o[14] = (far * near) / (near - far)
  return o
}
function lookAt(eye, center, up) {
  const z = norm3(sub3(eye, center))
  const x = norm3(cross3(up, z))
  const y = cross3(z, x)
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1
  ])
}
function mul4(a, b) {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  return o
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm3 = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

export async function createRenderer(canvas) {
  if (!navigator.gpu) return null
  let adapter = null
  try { adapter = await navigator.gpu.requestAdapter() } catch { return null }
  if (!adapter) return null
  const device = await adapter.requestDevice()
  const ctx = canvas.getContext('webgpu')
  if (!ctx) return null
  const format = navigator.gpu.getPreferredCanvasFormat()
  ctx.configure({ device, format, alphaMode: 'opaque' })

  const module = device.createShaderModule({ code: WGSL })
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
  })

  const uniformBuf = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  let segBuf = null, segCap = 0, bindGroup = null
  let depthTex = null, depthW = 0, depthH = 0

  function ensureSegs(nseg) {
    if (nseg <= segCap) return
    segCap = Math.max(16, 1 << Math.ceil(Math.log2(nseg)))
    segBuf = device.createBuffer({ size: segCap * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: { buffer: segBuf } }
      ]
    })
  }

  // camera: { theta, phi, dist, target:[x,y,z] }
  function render({ anchors, nu, nv, L, taper0, taper1, kmax, colorMode, camera }) {
    const nseg = anchors.length - 1
    if (nseg < 1) return
    ensureSegs(nseg)

    // 段数据:每段 4×vec4 (xy=坐标, z=权重)
    const sd = new Float32Array(nseg * 16)
    for (let i = 0; i < nseg; i++) {
      const a = anchors[i], b = anchors[i + 1], o = i * 16
      sd[o] = a.x; sd[o + 1] = a.y; sd[o + 2] = a.weight ?? 1
      sd[o + 4] = a.hout.x; sd[o + 5] = a.hout.y; sd[o + 6] = 1
      sd[o + 8] = b.hin.x; sd[o + 9] = b.hin.y; sd[o + 10] = 1
      sd[o + 12] = b.x; sd[o + 13] = b.y; sd[o + 14] = b.weight ?? 1
    }
    device.queue.writeBuffer(segBuf, 0, sd)

    const w = canvas.width, h = canvas.height
    if (w !== depthW || h !== depthH) {
      depthTex?.destroy()
      depthTex = device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT })
      depthW = w; depthH = h
    }

    const { theta, phi, dist, target } = camera
    const eye = [
      target[0] + dist * Math.sin(phi) * Math.sin(theta),
      target[1] + dist * Math.cos(phi),
      target[2] + dist * Math.sin(phi) * Math.cos(theta)
    ]
    const proj = perspective(Math.PI / 4, w / Math.max(1, h), 1, dist * 10)
    const view = lookAt(eye, target, [0, 1, 0])
    const mvp = mul4(proj, view)

    const uni = new ArrayBuffer(112)
    const f32 = new Float32Array(uni), u32 = new Uint32Array(uni)
    f32.set(mvp, 0)
    f32[16] = L; f32[17] = taper0; f32[18] = taper1; f32[19] = kmax || 0.1
    u32[20] = nu; u32[21] = nv; u32[22] = nseg; u32[23] = colorMode
    f32[24] = 0.5; f32[25] = 0.8; f32[26] = 0.6; f32[27] = 0
    device.queue.writeBuffer(uniformBuf, 0, uni)

    const enc = device.createCommandEncoder()
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        clearValue: { r: 0.09, g: 0.1, b: 0.13, a: 1 },
        loadOp: 'clear', storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store'
      }
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw((nu - 1) * (nv - 1) * 6)
    pass.end()
    device.queue.submit([enc.finish()])
  }

  return { render }
}
