// WebGPU 最小类型声明（避免额外依赖，覆盖本项目实际使用的 API）
interface GPUDeviceLostInfo { reason: string; message: string }
interface GPUCanvasContext {
  configure(cfg: { device: GPUDevice; format: GPUTextureFormat; alphaMode?: string }): void;
  getCurrentTexture(): GPUTexture;
}
interface GPUTexture { createView(): GPUTextureView }
interface GPUTextureView { __brand?: 'GPUTextureView' }
interface GPUShaderModule { __brand?: 'GPUShaderModule' }
interface GPUBuffer { __brand?: 'GPUBuffer'; destroy(): void }
interface GPUBindGroup { __brand?: 'GPUBindGroup' }
interface GPURenderPipeline { getBindGroupLayout(index: number): GPUBindGroupLayout }
interface GPUBindGroupLayout { __brand?: 'GPUBindGroupLayout' }
interface GPUCommandEncoder { beginRenderPass(desc: unknown): GPURenderPassEncoder; finish(): GPUCommandBuffer }
interface GPUCommandBuffer { __brand?: 'GPUCommandBuffer' }
interface GPURenderPassEncoder {
  setPipeline(p: GPURenderPipeline): void;
  setBindGroup(index: number, bg: GPUBindGroup): void;
  setVertexBuffer(slot: number, buffer: GPUBuffer): void;
  draw(count: number): void;
  end(): void;
}
interface GPUDevice {
  createShaderModule(desc: { code: string }): GPUShaderModule;
  createRenderPipeline(desc: unknown): GPURenderPipeline;
  createBuffer(desc: { size: number; usage: number }): GPUBuffer;
  createBindGroup(desc: unknown): GPUBindGroup;
  createCommandEncoder(): GPUCommandEncoder;
  queue: {
    writeBuffer(buffer: GPUBuffer, offset: number, data: Float32Array, dataOffset?: number, size?: number): void;
    submit(buffers: GPUCommandBuffer[]): void;
  };
  lost: Promise<GPUDeviceLostInfo>;
}
interface GPUAdapter { requestDevice(): Promise<GPUDevice> }
type GPUTextureFormat = string;
interface Navigator {
  gpu?: {
    requestAdapter(): Promise<GPUAdapter | null>;
    getPreferredCanvasFormat(): GPUTextureFormat;
  };
}
interface HTMLCanvasElement {
  getContext(contextId: 'webgpu'): GPUCanvasContext | null;
}
declare const GPUBufferUsage: { VERTEX: number; UNIFORM: number; COPY_DST: number };
