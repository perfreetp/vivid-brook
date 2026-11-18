// 最小 4x4 矩阵 / 向量数学库（列主序，Float32Array）
export const m4 = {
  identity() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },

  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) * nf;
    m[11] = -1;
    m[14] = 2 * far * near * nf;
    return m;
  },

  lookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let l = Math.hypot(zx, zy, zz) || 1;
    zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1;
    xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    const m = new Float32Array(16);
    m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
    m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
    m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
    m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    m[15] = 1;
    return m;
  },

  multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[0 * 4 + r] * b[c * 4 + 0] +
          a[1 * 4 + r] * b[c * 4 + 1] +
          a[2 * 4 + r] * b[c * 4 + 2] +
          a[3 * 4 + r] * b[c * 4 + 3];
      }
    }
    return o;
  },

  // 由平移/缩放构造轴对齐实例矩阵（列主序，Float32Array 16）
  compose(px, py, pz, sx, sy, sz) {
    const m = new Float32Array(16);
    m[0] = sx; m[5] = sy; m[10] = sz; m[15] = 1;
    m[12] = px; m[13] = py; m[14] = pz;
    return m;
  },

  transformPoint(m, p) {
    const x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
    ];
  },
};

// 由视图投影矩阵提取 6 个视锥平面（Gribb-Hartmann），返回 [nx,ny,nz,d][]
export function extractFrustumPlanes(vp) {
  const p = [];
  const row = (i) => [vp[i], vp[i + 4], vp[i + 8], vp[i + 12]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const add = (a, b) => {
    const pl = [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
    const l = Math.hypot(pl[0], pl[1], pl[2]) || 1;
    p.push([pl[0] / l, pl[1] / l, pl[2] / l, pl[3] / l]);
  };
  add(r3, r0); // left
  sub(r3, r0); // right
  add(r3, r1); // bottom
  sub(r3, r1); // top
  add(r3, r2); // near
  sub(r3, r2); // far
  function sub(a, b) {
    const pl = [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
    const l = Math.hypot(pl[0], pl[1], pl[2]) || 1;
    p.push([pl[0] / l, pl[1] / l, pl[2] / l, pl[3] / l]);
  }
  return p;
}

export function aabbInFrustum(planes, minX, minY, minZ, maxX, maxY, maxZ) {
  for (const [nx, ny, nz, d] of planes) {
    const px = nx >= 0 ? maxX : minX;
    const py = ny >= 0 ? maxY : minY;
    const pz = nz >= 0 ? maxZ : minZ;
    if (nx * px + ny * py + nz * pz + d < 0) return false;
  }
  return true;
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
