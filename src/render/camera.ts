// 轨道相机 + 简易 mat4（WebGPU clip space：z 近 0 远 1）
export interface OrbitState {
  yaw: number;
  pitch: number;
  dist: number;
  target: [number, number, number];
}

export function createOrbit(): OrbitState {
  return { yaw: Math.PI * 0.25, pitch: Math.PI * 0.28, dist: 58, target: [20, 0, 20] };
}

type Mat4 = Float32Array;

export function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}

export function lookAt(eye: number[], center: number[], up: number[]): Mat4 {
  const z = norm3(sub3(eye, center));
  const x = norm3(cross3(up, z));
  const y = cross3(z, x);
  const m = new Float32Array(16);
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0]; m[3] = 0;
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1]; m[7] = 0;
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2]; m[11] = 0;
  m[12] = -dot3(x, eye);
  m[13] = -dot3(y, eye);
  m[14] = -dot3(z, eye);
  m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function orbitEye(o: OrbitState): number[] {
  const cp = Math.cos(o.pitch);
  return [
    o.target[0] + o.dist * cp * Math.sin(o.yaw),
    o.target[1] + o.dist * Math.sin(o.pitch),
    o.target[2] + o.dist * cp * Math.cos(o.yaw),
  ];
}

export function viewProj(o: OrbitState, aspect: number): { vp: Mat4; eye: number[] } {
  const eye = orbitEye(o);
  const view = lookAt(eye, o.target, [0, 1, 0]);
  const proj = perspective(Math.PI / 4, aspect, 0.1, 500);
  return { vp: multiply(proj, view), eye };
}

/** 射线与 y=const 平面求交，返回世界 xz；相机射线由屏幕 NDC 反算 */
export function rayGround(
  o: OrbitState,
  ndcX: number,
  ndcY: number,
  aspect: number,
  groundY: number,
): { x: number; z: number } | null {
  const eye = orbitEye(o);
  const inv = invert4(viewProj(o, aspect).vp);
  if (!inv) return null;
  const nearP = transform4(inv, [ndcX, ndcY, 0, 1]);
  const farP = transform4(inv, [ndcX, ndcY, 1, 1]);
  const p0 = scale4(nearP, 1 / nearP[3]);
  const p1 = scale4(farP, 1 / farP[3]);
  const dy = p1[1] - eye[1];
  if (Math.abs(dy) < 1e-6) return null;
  const t = (groundY - eye[1]) / dy;
  if (t < 0) return null;
  return { x: eye[0] + (p1[0] - eye[0]) * t, z: eye[2] + (p1[2] - eye[2]) * t };
}

function invert4(m: Mat4): Mat4 | null {
  const inv = new Float32Array(16);
  const a = m;
  inv[0] = a[5]*a[10]*a[15]-a[5]*a[11]*a[14]-a[9]*a[6]*a[15]+a[9]*a[7]*a[14]+a[13]*a[6]*a[11]-a[13]*a[7]*a[10];
  inv[4] = -a[4]*a[10]*a[15]+a[4]*a[11]*a[14]+a[8]*a[6]*a[15]-a[8]*a[7]*a[14]-a[12]*a[6]*a[11]+a[12]*a[7]*a[10];
  inv[8] = a[4]*a[9]*a[15]-a[4]*a[11]*a[13]-a[8]*a[5]*a[15]+a[8]*a[7]*a[13]+a[12]*a[5]*a[11]-a[12]*a[7]*a[9];
  inv[12] = -a[4]*a[9]*a[14]+a[4]*a[10]*a[13]+a[8]*a[5]*a[14]-a[8]*a[6]*a[13]-a[12]*a[5]*a[10]+a[12]*a[6]*a[9];
  inv[1] = -a[1]*a[10]*a[15]+a[1]*a[11]*a[14]+a[13]*a[6]*a[15]-a[13]*a[7]*a[14]-a[9]*a[6]*a[11]+a[9]*a[7]*a[10];
  inv[5] = a[0]*a[10]*a[15]-a[0]*a[11]*a[14]-a[8]*a[6]*a[15]+a[8]*a[7]*a[14]+a[12]*a[6]*a[11]-a[12]*a[7]*a[10];
  inv[9] = -a[0]*a[9]*a[15]+a[0]*a[11]*a[13]+a[12]*a[5]*a[15]-a[12]*a[7]*a[13]-a[8]*a[5]*a[11]+a[8]*a[7]*a[9];
  inv[13] = a[0]*a[9]*a[14]-a[0]*a[10]*a[13]-a[8]*a[5]*a[14]+a[8]*a[6]*a[13]+a[12]*a[5]*a[10]-a[12]*a[6]*a[9];
  inv[2] = a[1]*a[6]*a[15]-a[1]*a[7]*a[14]-a[5]*a[2]*a[15]+a[5]*a[3]*a[14]+a[9]*a[2]*a[7]-a[9]*a[3]*a[6];
  inv[6] = -a[0]*a[6]*a[15]+a[0]*a[7]*a[14]+a[4]*a[2]*a[15]-a[4]*a[3]*a[14]-a[8]*a[2]*a[7]+a[8]*a[3]*a[6];
  inv[10] = a[0]*a[5]*a[15]-a[0]*a[7]*a[13]-a[4]*a[5]*a[15]+a[4]*a[3]*a[13]+a[8]*a[5]*a[7]-a[8]*a[3]*a[5];
  inv[14] = -a[0]*a[5]*a[14]+a[0]*a[6]*a[13]+a[4]*a[5]*a[14]-a[4]*a[2]*a[13]-a[8]*a[5]*a[6]+a[8]*a[2]*a[5];
  inv[3] = -a[1]*a[6]*a[11]+a[1]*a[7]*a[10]+a[5]*a[2]*a[11]-a[5]*a[3]*a[10]-a[9]*a[2]*a[7]+a[9]*a[3]*a[6];
  inv[7] = a[0]*a[6]*a[11]-a[0]*a[7]*a[10]-a[4]*a[2]*a[11]+a[4]*a[3]*a[10]+a[8]*a[2]*a[7]-a[8]*a[3]*a[6];
  inv[11] = -a[0]*a[5]*a[11]+a[0]*a[7]*a[9]+a[4]*a[5]*a[11]-a[4]*a[3]*a[9]-a[8]*a[5]*a[7]+a[8]*a[3]*a[5];
  inv[15] = a[0]*a[5]*a[10]-a[0]*a[6]*a[9]-a[4]*a[5]*a[10]+a[4]*a[2]*a[9]+a[8]*a[5]*a[6]-a[8]*a[2]*a[5];
  let det = 0;
  for (let i = 0; i < 4; i++) det += a[i] * inv[i * 4];
  if (Math.abs(det) < 1e-9) return null;
  det = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

function transform4(m: Mat4, v: number[]): number[] {
  return [
    m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12]*v[3],
    m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13]*v[3],
    m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]*v[3],
    m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15]*v[3],
  ];
}
function scale4(v: number[], s: number): number[] {
  return [v[0]*s, v[1]*s, v[2]*s, v[3]*s];
}
function sub3(a: number[], b: number[]): number[] {
  return [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
}
function cross3(a: number[], b: number[]): number[] {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function dot3(a: number[], b: number[]): number {
  return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
}
function norm3(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0]/l, v[1]/l, v[2]/l];
}
