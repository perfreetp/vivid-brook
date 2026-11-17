// 扫掠曲面:截面样条沿 Z 向扫掠(长度 L,两端线性变截面 taper0→taper1)
// S(u,v) = ( profile(u).x * s(v), profile(u).y * s(v), v * L ), s(v)=lerp(taper0,taper1,v)

export function tessellate(samples, L, taper0, taper1, nv) {
  const nu = samples.length
  const pos = new Float32Array(nu * nv * 3)
  const nrm = new Float32Array(nu * nv * 3)
  const curv = new Float32Array(nu * nv)
  const P = (iu, iv) => {
    const v = iv / (nv - 1)
    const s = taper0 + (taper1 - taper0) * v
    const p = samples[Math.max(0, Math.min(nu - 1, iu))]
    return [p.x * s, p.y * s, v * L]
  }
  for (let iv = 0; iv < nv; iv++) {
    for (let iu = 0; iu < nu; iu++) {
      const o = (iv * nu + iu) * 3
      const [x, y, z] = P(iu, iv)
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z
      const [ax, ay, az] = P(Math.max(0, iu - 1), iv)
      const [bx, by, bz] = P(Math.min(nu - 1, iu + 1), iv)
      const [cx, cy, cz] = P(iu, Math.max(0, iv - 1))
      const [dx2, dy2, dz2] = P(iu, Math.min(nv - 1, iv + 1))
      const su = [bx - ax, by - ay, bz - az]
      const sv = [dx2 - cx, dy2 - cy, dz2 - cz]
      let nx = su[1] * sv[2] - su[2] * sv[1]
      let ny = su[2] * sv[0] - su[0] * sv[2]
      let nz = su[0] * sv[1] - su[1] * sv[0]
      const l = Math.hypot(nx, ny, nz) || 1
      // 法线朝外(背离扫掠轴)
      if (nx * x + ny * y < 0) { nx = -nx; ny = -ny; nz = -nz }
      nrm[o] = nx / l; nrm[o + 1] = ny / l; nrm[o + 2] = nz / l
      curv[iv * nu + iu] = samples[iu].k
    }
  }
  // 面积(三角面片求和)
  let area = 0
  for (let iv = 0; iv < nv - 1; iv++) {
    for (let iu = 0; iu < nu - 1; iu++) {
      const a = (iv * nu + iu) * 3, b = (iv * nu + iu + 1) * 3, c = ((iv + 1) * nu + iu) * 3, d = ((iv + 1) * nu + iu + 1) * 3
      area += triArea(pos, a, b, c) + triArea(pos, b, d, c)
    }
  }
  return { pos, nrm, curv, nu, nv, area }
}

function triArea(p, a, b, c) {
  const ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]
  const ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
  const cx = ab[1] * ac[2] - ab[2] * ac[1]
  const cy = ab[2] * ac[0] - ab[0] * ac[2]
  const cz = ab[0] * ac[1] - ab[1] * ac[0]
  return 0.5 * Math.hypot(cx, cy, cz)
}
