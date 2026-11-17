import type { Camera, RenderPrimitive, Vec2 } from '../types.js';
import { SceneRenderer, hexToRgb, worldToScreen } from './renderer.js';

// 顶点：x, y（画布像素坐标）, r, g, b
const FLOATS_PER_VERTEX = 5;

const WGSL = /* wgsl */ `
struct Uniforms {
  viewport: vec2<f32>,
  _pad: vec2<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec3<f32>,
};

@vertex
fn vs_main(@location(0) pos: vec2<f32>, @location(1) color: vec3<f32>) -> VSOut {
  var out: VSOut;
  let ndc = vec2<f32>(
    (pos.x / u.viewport.x) * 2.0 - 1.0,
    1.0 - (pos.y / u.viewport.y) * 2.0
  );
  out.pos = vec4<f32>(ndc, 0.0, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}
`;

export class WebGPURenderer implements SceneRenderer {
  readonly kind = 'webgpu' as const;
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private pipeline: GPURenderPipeline;
  private vertexBuffer: GPUBuffer;
  private uniformBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private capacity = 4096 * FLOATS_PER_VERTEX;
  private lost = false;

  private constructor(
    private canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    const module = device.createShaderModule({ code: WGSL });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: FLOATS_PER_VERTEX * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x3' },
          ],
        }],
      },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.vertexBuffer = device.createBuffer({
      size: this.capacity * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.uniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    device.lost.then(() => { this.lost = true; });
  }

  static async create(canvas: HTMLCanvasElement): Promise<WebGPURenderer> {
    if (!('gpu' in navigator) || !navigator.gpu) throw new Error('当前浏览器不支持 WebGPU');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('未找到可用的 WebGPU 适配器');
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) throw new Error('无法获取 WebGPU 画布上下文');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    return new WebGPURenderer(canvas, device, context, format);
  }

  render(primitives: RenderPrimitive[], camera: Camera, canvasW: number, canvasH: number): void {
    if (this.lost) return;
    const data = this.triangulate(primitives, camera, canvasW, canvasH);
    if (data.length > this.capacity) {
      this.vertexBuffer.destroy();
      this.capacity = Math.ceil(data.length / 4096) * 4096;
      this.vertexBuffer = this.device.createBuffer({
        size: this.capacity * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(this.vertexBuffer, 0, data, 0, data.length);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array([canvasW, canvasH, 0, 0]));

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.063, g: 0.09, b: 0.118, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(data.length / FLOATS_PER_VERTEX);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  // ---------------- CPU 三角化 ----------------

  private triangulate(primitives: RenderPrimitive[], camera: Camera, w: number, h: number): Float32Array {
    const verts: number[] = [];
    const sp = (p: Vec2) => worldToScreen(p.x, p.y, camera, w, h);

    const tri = (a: Vec2, b: Vec2, c: Vec2, color: string) => {
      const [r, g, bl] = hexToRgb(color);
      for (const p of [a, b, c]) verts.push(p.x, p.y, r, g, bl);
    };

    for (const prim of primitives) {
      switch (prim.type) {
        case 'poly': {
          const pts = prim.points!.map(sp);
          for (let i = 1; i < pts.length - 1; i++) tri(pts[0], pts[i], pts[i + 1], prim.color);
          break;
        }
        case 'line': {
          const [a, b] = prim.points!.map(sp);
          const widthPx = (prim.width ?? 1) * Math.max(1, camera.zoom * 0.8);
          this.pushThickLine(verts, a, b, widthPx, prim.color);
          break;
        }
        case 'circle': {
          const c = sp(prim.center!);
          const r = (prim.radius ?? 8) * camera.zoom;
          const seg = 28;
          for (let i = 0; i < seg; i++) {
            const a0 = (i / seg) * Math.PI * 2;
            const a1 = ((i + 1) / seg) * Math.PI * 2;
            const p0 = { x: c.x + Math.cos(a0) * r, y: c.y + Math.sin(a0) * r };
            const p1 = { x: c.x + Math.cos(a1) * r, y: c.y + Math.sin(a1) * r };
            if (prim.fill) tri(c, p0, p1, prim.color);
            else this.pushThickLine(verts, p0, p1, 2, prim.color);
          }
          break;
        }
        case 'rect': {
          const c = sp({ x: prim.x!, y: prim.y! });
          const rw = prim.w! * camera.zoom;
          const rh = prim.h! * camera.zoom;
          const p0 = c, p1 = { x: c.x + rw, y: c.y }, p2 = { x: c.x + rw, y: c.y - rh }, p3 = { x: c.x, y: c.y - rh };
          tri(p0, p1, p2, prim.color);
          tri(p0, p2, p3, prim.color);
          break;
        }
      }
    }
    return new Float32Array(verts);
  }

  private pushThickLine(verts: number[], a: Vec2, b: Vec2, width: number, color: string): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * width * 0.5;
    const ny = (dx / len) * width * 0.5;
    const p0 = { x: a.x + nx, y: a.y + ny };
    const p1 = { x: a.x - nx, y: a.y - ny };
    const p2 = { x: b.x - nx, y: b.y - ny };
    const p3 = { x: b.x + nx, y: b.y + ny };
    const [r, g, bl] = hexToRgb(color);
    for (const p of [p0, p1, p2, p0, p2, p3]) verts.push(p.x, p.y, r, g, bl);
  }

  dispose(): void {
    this.vertexBuffer.destroy();
    this.uniformBuffer.destroy();
  }
}
