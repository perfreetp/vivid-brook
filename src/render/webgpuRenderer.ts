// WebGPU 地形渲染器：每顶点从高度 storage buffer 取高，fill/line 两套管线，线框可切
import { CELL, CHUNK_COUNT, CHUNKS_PER_SIDE, FIELD_SIZE, GRID, VERTS } from '../terrain/config';
import { createOrbit, orbitEye, rayGround, viewProj } from './camera';
import type { OrbitState } from './camera';
import type { RenderSettings, Renderer } from './types';

const UNIFORM_BYTES = 256;
const TAG_BITS: Record<string, number> = { slope: 1, step: 2, gravel: 4, trench: 8, water: 16 };
const LOCK_BIT = 0x8000;

const VERT_WGSL = /* wgsl */ `
struct Uniforms {
  vp: mat4x4f,
  eye: vec4f,
  params: vec4f, // x=waterDepth y=hoverId+1 z=selId+1 w=flags
};
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> heights: array<f32>;
@group(0) @binding(2) var<storage, read> chunkFlags: array<u32>;

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) chunkId: u32,
};

fn cellHeight(vx: u32, vz: u32) -> f32 {
  return heights[vz * ${VERTS}u + vx];
}

fn buildPos(vx: u32, vz: u32) -> VSOut {
  let h = cellHeight(vx, vz);
  let world = vec3f(f32(vx) * ${CELL.toFixed(6)}, h, f32(vz) * ${CELL.toFixed(6)});
  let xl = if vx > 0u { vx - 1u } else { vx };
  let xr = if vx < ${GRID}u { vx + 1u } else { vx };
  let zt = if vz > 0u { vz - 1u } else { vz };
  let zb = if vz < ${GRID}u { vz + 1u } else { vz };
  let dx = cellHeight(xr, vz) - cellHeight(xl, vz);
  let dz = cellHeight(vx, zb) - cellHeight(vx, zt);
  let n = normalize(vec3f(-dx / ${(2 * CELL).toFixed(6)}, 1.0, -dz / ${(2 * CELL).toFixed(6)}));
  var cid = (vz / 4u) * ${CHUNKS_PER_SIDE}u + (vx / 4u);
  cid = min(cid, ${CHUNK_COUNT - 1}u);
  var o: VSOut;
  o.clip = U.vp * vec4f(world, 1.0);
  o.world = world;
  o.normal = n;
  o.chunkId = cid;
  return o;
}

// 实体面：非索引绘制，每单元 6 顶点
@vertex
fn vsFill(@builtin(vertex_index) vi: u32) -> VSOut {
  let cell = vi / 6u;
  let corner = vi % 6u;
  var ixTab = array<u32, 6>(0u, 0u, 1u, 1u, 0u, 1u);
  var izTab = array<u32, 6>(0u, 1u, 0u, 0u, 1u, 1u);
  let cx = cell % ${GRID}u;
  let cz = cell / ${GRID}u;
  return buildPos(cx + ixTab[corner], cz + izTab[corner]);
}

// 线框：索引绘制，vertex_index 即格网顶点号
@vertex
fn vsLine(@builtin(vertex_index) vi: u32) -> VSOut {
  let vx = vi % ${VERTS}u;
  let vz = vi / ${VERTS}u;
  return buildPos(vx, vz);
}

struct FragOut { @location(0) color: vec4f };

fn baseColor(world: vec3f, n: vec3f, cid: u32) -> vec3f {
  let light = normalize(vec3f(0.45, 0.9, 0.3));
  let diff = clamp(dot(n, light), 0.25, 1.0);
  // 高度染色：低地深绿 -> 高地土黄
  let t = clamp((world.y + 1.2) / 4.5, 0.0, 1.0);
  var col = mix(vec3f(0.16, 0.30, 0.13), vec3f(0.55, 0.47, 0.28), t);
  let flags = chunkFlags[cid];
  if (flags & 1u) != 0u { col = mix(col, vec3f(0.75, 0.55, 0.25), 0.35); } // 坡度带 暖
  if (flags & 2u) != 0u { col = mix(col, vec3f(0.45, 0.45, 0.5), 0.35); }  // 台阶带 灰
  if (flags & 4u) != 0u { col = mix(col, vec3f(0.6, 0.5, 0.35), 0.45); }    // 碎石带
  if (flags & 8u) != 0u { col = mix(col, vec3f(0.25, 0.2, 0.15), 0.4); }    // 沟槽带 深
  if (flags & 16u) != 0u { col = mix(col, vec3f(0.2, 0.35, 0.45), 0.4); }   // 涉水带 蓝
  if (flags & ${LOCK_BIT}u) != 0u { col = mix(col, vec3f(0.95, 0.45, 0.15), 0.45); } // 锁定 橙
  if f32(cid) == U.params.y - 1.0 { col = mix(col, vec3f(1.0, 0.95, 0.3), 0.5); }    // 悬停 黄
  if f32(cid) == U.params.z - 1.0 { col = mix(col, vec3f(0.25, 0.85, 1.0), 0.5); }    // 选中 青
  return col * diff;
}

@fragment
fn fsFill(in: VSOut) -> FragOut {
  var o: FragOut;
  o.color = vec4f(baseColor(in.world, in.normal, in.chunkId), 1.0);
  return o;
}

@fragment
fn fsLine(in: VSOut) -> FragOut {
  var o: FragOut;
  let base = baseColor(in.world, in.normal, in.chunkId);
  o.color = vec4f(base * 0.55, 1.0);
  return o;
}

@fragment
fn fsChunkLine(in: VSOut) -> FragOut {
  var o: FragOut;
  o.color = vec4f(0.92, 0.95, 1.0, 0.9);
  return o;
}
`;

const WATER_WGSL = /* wgsl */ `
struct Uniforms {
  vp: mat4x4f,
  eye: vec4f,
  params: vec4f,
};
@group(0) @binding(0) var<uniform> U: Uniforms;
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var px = array<f32, 6>(0.0, 40.0, 0.0, 40.0, 0.0, 40.0);
  var pz = array<f32, 6>(32.0, 32.0, 40.0, 32.0, 40.0, 40.0);
  let y = U.params.x * 0.35;
  return U.vp * vec4f(px[vi], y, pz[vi], 1.0);
}
@fragment
fn fs() -> @location(0) vec4f {
  return vec4f(0.25, 0.55, 0.85, 0.45);
}
`;

export class WebGpuRenderer implements Renderer {
  readonly kind = 'webgpu' as const;
  private orbit: OrbitState = createOrbit();
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private canvas: HTMLCanvasElement;
  private heightBuf: GPUBuffer;
  private flagBuf: GPUBuffer;
  private uniformBuf: GPUBuffer;
  private lineIndexBuf: GPUBuffer;
  private chunkLineIndexBuf: GPUBuffer;
  private fillPipe: GPURenderPipeline;
  private linePipe: GPURenderPipeline;
  private chunkLinePipe: GPURenderPipeline;
  private waterPipe: GPURenderPipeline;
  private bindGroup: GPUBindGroup;
  private depthTex: GPUTexture | null = null;
  private heightData = new Float64Array(VERTS * VERTS);
  private settings: RenderSettings = { wireframe: false, showWater: true, showChunkGrid: true };
  private hover = -1;
  private selection = -1;
  private waterDepth = 0;
  private raf = 0;
  private ro: ResizeObserver;
  private dragState: { button: number; x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.format = format;

    this.heightBuf = device.createBuffer({ size: VERTS * VERTS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.flagBuf = device.createBuffer({ size: CHUNK_COUNT * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.uniformBuf = device.createBuffer({ size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const { line, chunkLine } = this.buildLineIndices();
    this.lineIndexBuf = device.createBuffer({ size: line.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.lineIndexBuf, 0, line);
    this.chunkLineIndexBuf = device.createBuffer({ size: chunkLine.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.chunkLineIndexBuf, 0, chunkLine);

    const module = device.createShaderModule({ code: VERT_WGSL });
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });
    const pipeLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    this.fillPipe = device.createRenderPipeline({
      layout: pipeLayout,
      vertex: { module, entryPoint: 'vsFill' },
      fragment: { module, entryPoint: 'fsFill', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this.linePipe = device.createRenderPipeline({
      layout: pipeLayout,
      vertex: { module, entryPoint: 'vsLine' },
      fragment: { module, entryPoint: 'fsLine', targets: [{ format }] },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });
    this.chunkLinePipe = device.createRenderPipeline({
      layout: pipeLayout,
      vertex: { module, entryPoint: 'vsLine' },
      fragment: { module, entryPoint: 'fsChunkLine', targets: [{ format }] },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });

    const waterModule = device.createShaderModule({ code: WATER_WGSL });
    this.waterPipe = device.createRenderPipeline({
      layout: pipeLayout,
      vertex: { module: waterModule, entryPoint: 'vs' },
      fragment: {
        module: waterModule,
        entryPoint: 'fs',
        targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });

    this.bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: { buffer: this.heightBuf } },
        { binding: 2, resource: { buffer: this.flagBuf } },
      ],
    });

    this.attachControls();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.loop();
  }

  private buildLineIndices(): { line: Uint32Array; chunkLine: Uint32Array } {
    const lines: number[] = [];
    const chunkLines: number[] = [];
    const vid = (ix: number, iz: number) => iz * VERTS + ix;
    for (let iz = 0; iz < VERTS; iz++) {
      for (let ix = 0; ix < GRID; ix++) {
        lines.push(vid(ix, iz), vid(ix + 1, iz));
        if (ix % 4 === 0) chunkLines.push(vid(ix, iz), vid(ix + 1, iz));
      }
    }
    for (let ix = 0; ix < VERTS; ix++) {
      for (let iz = 0; iz < GRID; iz++) {
        lines.push(vid(ix, iz), vid(ix, iz + 1));
        if (iz % 4 === 0) chunkLines.push(vid(ix, iz), vid(ix, iz + 1));
      }
    }
    return { line: Uint32Array.from(lines), chunkLine: Uint32Array.from(chunkLines) };
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.depthTex?.destroy();
    this.depthTex = this.device.createTexture({
      size: [w, h],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private attachControls() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2) {
        this.dragState = { button: e.button, x: e.clientX, y: e.clientY };
        c.setPointerCapture(e.pointerId);
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragState) return;
      const dx = e.clientX - this.dragState.x;
      const dy = e.clientY - this.dragState.y;
      this.dragState.x = e.clientX;
      this.dragState.y = e.clientY;
      this.orbitBy(dx, dy);
    });
    const up = (e: PointerEvent) => {
      if (this.dragState && (e.button === 1 || e.button === 2)) this.dragState = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY);
    }, { passive: false });
  }

  orbitBy(dxPx: number, dyPx: number) {
    this.orbit.yaw -= dxPx * 0.006;
    this.orbit.pitch = Math.max(0.08, Math.min(Math.PI / 2 - 0.05, this.orbit.pitch + dyPx * 0.006));
  }

  zoomBy(delta: number) {
    this.orbit.dist = Math.max(12, Math.min(140, this.orbit.dist * (1 + Math.sign(delta) * 0.08)));
  }

  getOrbit(): OrbitState {
    return this.orbit;
  }

  setHover(id: number | null) { this.hover = id ?? -1; }
  setSelection(id: number | null) { this.selection = id ?? -1; }
  setDragRect() { /* WebGPU 下用区块高亮表达拖框，组件层直接更新 hover/锁定 */ }
  setSettings(s: RenderSettings) { this.settings = { ...s }; }
  setWaterDepth(d: number) { this.waterDepth = d; }

  updateTerrain(heights: Float64Array, chunkLocked: Uint8Array, chunkTags: string[][]): void {
    this.heightData = heights;
    const f32 = new Float32Array(heights.length);
    for (let i = 0; i < heights.length; i++) f32[i] = heights[i];
    this.device.queue.writeBuffer(this.heightBuf, 0, f32);
    const flags = new Uint32Array(CHUNK_COUNT);
    for (let i = 0; i < CHUNK_COUNT; i++) {
      let f = 0;
      for (const t of chunkTags[i]) f |= TAG_BITS[t] ?? 0;
      if (chunkLocked[i]) f |= LOCK_BIT;
      flags[i] = f;
    }
    this.device.queue.writeBuffer(this.flagBuf, 0, flags);
  }

  pick(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const aspect = rect.width / rect.height;
    // 迭代 3 次：先打 y=0 平面，再用该处地形高度修正射线平面
    let y = 0;
    let hit: { x: number; z: number } | null = null;
    for (let i = 0; i < 3; i++) {
      hit = rayGround(this.orbit, ndcX, ndcY, aspect, y);
      if (!hit) return null;
      const ix = Math.max(0, Math.min(GRID, Math.round(hit.x / CELL)));
      const iz = Math.max(0, Math.min(GRID, Math.round(hit.z / CELL)));
      y = this.heightData[iz * VERTS + ix];
    }
    if (!hit || hit.x < 0 || hit.z < 0 || hit.x > FIELD_SIZE || hit.z > FIELD_SIZE) return null;
    return hit;
  }

  private writeUniforms() {
    const aspect = this.canvas.width / this.canvas.height;
    const { vp } = viewProj(this.orbit, aspect);
    const eye = orbitEye(this.orbit);
    const data = new ArrayBuffer(UNIFORM_BYTES);
    const f = new Float32Array(data);
    f.set(vp, 0);
    f[16] = eye[0]; f[17] = eye[1]; f[18] = eye[2]; f[19] = 1;
    f[20] = this.waterDepth;
    f[21] = this.hover + 1;
    f[22] = this.selection + 1;
    f[23] = (this.settings.showWater ? 1 : 0) | (this.settings.showChunkGrid ? 2 : 0);
    this.device.queue.writeBuffer(this.uniformBuf, 0, data);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.writeUniforms();
    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0.07, g: 0.09, b: 0.12, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: this.depthTex ? {
        view: this.depthTex.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      } : undefined,
    });
    pass.setBindGroup(0, this.bindGroup);
    if (!this.settings.wireframe) {
      pass.setPipeline(this.fillPipe);
      pass.draw(GRID * GRID * 6);
    }
    pass.setPipeline(this.linePipe);
    pass.setIndexBuffer(this.lineIndexBuf, 'uint32');
    pass.drawIndexed(this.lineIndexBuf.size / 4);
    if (this.settings.showChunkGrid) {
      pass.setPipeline(this.chunkLinePipe);
      pass.setIndexBuffer(this.chunkLineIndexBuf, 'uint32');
      pass.drawIndexed(this.chunkLineIndexBuf.size / 4);
    }
    if (this.settings.showWater && this.waterDepth > 0) {
      pass.setPipeline(this.waterPipe);
      pass.draw(6);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.heightBuf.destroy();
    this.flagBuf.destroy();
    this.uniformBuf.destroy();
    this.lineIndexBuf.destroy();
    this.chunkLineIndexBuf.destroy();
    this.depthTex?.destroy();
  }
}

export async function createWebGpuRenderer(canvas: HTMLCanvasElement): Promise<WebGpuRenderer | null> {
  const nav = navigator as unknown as { gpu?: GPU };
  if (!nav.gpu) return null;
  const adapter = await nav.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) return null;
  const format = nav.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  return new WebGpuRenderer(canvas, device, context, format);
}
