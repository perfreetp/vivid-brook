// ============================================================
// 园区测绘底图模拟数据(确定性伪随机生成,单位:米,坐标系:左下角原点,Y 轴向上)
// 数据结构模拟测绘交付成果:片区 / 池体 / 构件点 / 管线 / 绿化 / 警戒线
// ============================================================

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261118);

export const PARK = { w: 1000, h: 700, name: '蓝湾水上乐园' };

// ---------------- 片区 ----------------
export const ZONES = [
  { id: 'Z1', name: '造浪池区', rect: [40, 360, 460, 300] },
  { id: 'Z2', name: '滑道竞技区', rect: [540, 360, 420, 300] },
  { id: 'Z3', name: '儿童水寨区', rect: [40, 40, 460, 280] },
  { id: 'Z4', name: '温泉理疗区', rect: [540, 40, 420, 280] },
];
export const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z]));

// ---------------- 池体(测绘轮廓多边形) ----------------
function ellipsePoly(cx, cy, rx, ry, rot = 0, n = 36) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = rx * Math.cos(a), y = ry * Math.sin(a);
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return pts;
}

export const POOLS = [
  { id: 'P1', zoneId: 'Z1', name: '造浪池', cx: 270, cy: 520, rx: 175, ry: 100, poly: ellipsePoly(270, 520, 175, 100) },
  { id: 'P2', zoneId: 'Z1', name: '沙滩戏水池', cx: 130, cy: 415, rx: 62, ry: 40, poly: ellipsePoly(130, 415, 62, 40, 0.3) },
  { id: 'P3', zoneId: 'Z2', name: '高速滑道落水池', cx: 660, cy: 565, rx: 95, ry: 48, poly: ellipsePoly(660, 565, 95, 48) },
  { id: 'P4', zoneId: 'Z2', name: '竞技泳池', cx: 835, cy: 480, rx: 100, ry: 58, poly: ellipsePoly(835, 480, 100, 58) },
  { id: 'P5', zoneId: 'Z2', name: '螺旋滑道落水池', cx: 650, cy: 425, rx: 58, ry: 38, poly: ellipsePoly(650, 425, 58, 38, -0.2) },
  { id: 'P6', zoneId: 'Z3', name: '儿童戏水池', cx: 165, cy: 195, rx: 92, ry: 58, poly: ellipsePoly(165, 195, 92, 58, 0.15) },
  { id: 'P7', zoneId: 'Z3', name: '水寨池', cx: 370, cy: 165, rx: 82, ry: 52, poly: ellipsePoly(370, 165, 82, 52) },
  { id: 'P8', zoneId: 'Z4', name: '温泉泡池', cx: 680, cy: 195, rx: 82, ry: 55, poly: ellipsePoly(680, 195, 82, 55, 0.1) },
  { id: 'P9', zoneId: 'Z4', name: '理疗池', cx: 855, cy: 150, rx: 68, ry: 45, poly: ellipsePoly(855, 150, 68, 45, -0.25) },
];
export const POOL_BY_ID = Object.fromEntries(POOLS.map((p) => [p.id, p]));

function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}
function scalePoly(poly, f) {
  const [cx, cy] = centroid(poly);
  return poly.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]);
}
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------- 构件(设备层) ----------------
export const TYPES = {
  SP: { name: '喷淋头', color: '#ef5350', shape: 'tri' },
  DR: { name: '排水篦子', color: '#8d6e63', shape: 'grid' },
  LC: { name: '救生椅', color: '#f9a825', shape: 'square' },
  LP: { name: '灯杆', color: '#ab47bc', shape: 'circle' },
  CAM: { name: '监控点位', color: '#26a69a', shape: 'diamond' },
};
export const TYPE_LIST = Object.keys(TYPES);

export const STATUS_LIST = ['正常', '待修', '维修中', '停用'];
export const STATUS_COLORS = { 正常: null, 待修: '#ff9800', 维修中: '#29b6f6', 停用: '#9e9e9e' };

const COMPONENTS = [];
const seq = {};
const BASE_DATE = new Date('2026-11-18').getTime();

function addComp(type, x, y, zoneId, poolId, extra = {}) {
  const zn = zoneId.slice(1);
  const key = `${type}-${zn}`;
  seq[key] = (seq[key] || 0) + 1;
  const id = `${type}-${zn}-${String(seq[key]).padStart(4, '0')}`;
  const r = rand();
  const status = r < 0.9 ? '正常' : r < 0.95 ? '待修' : r < 0.98 ? '维修中' : '停用';
  const lastMaintenance = new Date(BASE_DATE - rand() * 400 * 86400000).toISOString().slice(0, 10);
  COMPONENTS.push({ id, type, x, y, zoneId, poolId, status, lastMaintenance, ...extra });
}

// 沿多边形边缘按步长布点,返回 {x, y, angle}(angle 为外法线方向,度)
function walkEdge(poly, step, offset, cb) {
  let acc = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    // CCW 多边形的外法线 = (dy, -dx)
    const nx = dy / len, ny = -dx / len;
    let d = step - acc;
    while (d < len) {
      const t = d / len;
      cb(x1 + dx * t + nx * offset, y1 + dy * t + ny * offset, (Math.atan2(ny, nx) * 180) / Math.PI);
      d += step;
    }
    acc = (acc + len) % step;
  }
}

for (const pool of POOLS) {
  // 喷淋头:池岸线上每 ~4.5m 一个,带朝向角
  walkEdge(pool.poly, 4.5, 0.5, (x, y, angle) =>
    addComp('SP', x, y, pool.zoneId, pool.id, { angle: Math.round((angle + 360) % 360) }));
  // 救生椅:外偏 8m,每 ~55m 一把
  walkEdge(pool.poly, 55, 8, (x, y, angle) =>
    addComp('LC', x, y, pool.zoneId, pool.id, { angle: Math.round((angle + 360) % 360) }));
  // 监控点位:每 5 个轮廓点一个,外偏 5m
  walkEdge(pool.poly, (2 * Math.PI * Math.max(pool.rx, pool.ry)) / 7, 5, (x, y, angle) =>
    addComp('CAM', x, y, pool.zoneId, pool.id, { angle: Math.round((angle + 180) % 360) }));
}

for (const zone of ZONES) {
  const [zx, zy, zw, zh] = zone.rect;
  const zonePools = POOLS.filter((p) => p.zoneId === zone.id);
  const inAnyPool = (x, y, marginPoly) =>
    zonePools.some((p) => pointInPoly(x, y, marginPoly ? scalePoly(p.poly, 1.06) : p.poly));
  // 排水篦子:池岸硬化面网格,间距 13m
  for (let x = zx + 8; x < zx + zw - 8; x += 13) {
    for (let y = zy + 8; y < zy + zh - 8; y += 13) {
      if (!inAnyPool(x, y, true)) addComp('DR', x + rand() * 2, y + rand() * 2, zone.id, nearestPool(zonePools, x, y));
    }
  }
  // 灯杆:沿片区道路(边界内缩 5m)每 ~42m
  const per = [
    [zx + 5, zy + 5, zx + zw - 5, zy + 5],
    [zx + zw - 5, zy + 5, zx + zw - 5, zy + zh - 5],
    [zx + zw - 5, zy + zh - 5, zx + 5, zy + zh - 5],
    [zx + 5, zy + zh - 5, zx + 5, zy + 5],
  ];
  for (const [x1, y1, x2, y2] of per) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    for (let d = 0; d < len; d += 42) {
      const t = d / len;
      const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      if (!inAnyPool(x, y, true)) addComp('LP', x, y, zone.id, nearestPool(zonePools, x, y));
    }
  }
}

function nearestPool(pools, x, y) {
  let best = null, bd = Infinity;
  for (const p of pools) {
    const d = (p.cx - x) ** 2 + (p.cy - y) ** 2;
    if (d < bd) { bd = d; best = p.id; }
  }
  return best;
}

export { COMPONENTS };
export const COMP_BY_ID = Object.fromEntries(COMPONENTS.map((c) => [c.id, c]));

// ---------------- 管线层(按管径分色,十字交叉自动断开) ----------------
export const PIPE_DIAMS = [50, 75, 110, 160];
export const PIPE_COLORS = { 50: '#1e88e5', 75: '#43a047', 110: '#fb8c00', 160: '#e53935' };

const pipes = [];
for (const zone of ZONES) {
  const [zx, zy, zw] = zone.rect;
  // 片区主管 DN160
  pipes.push({ diam: 160, pts: [[zx + 12, zy + 10], [zx + zw - 12, zy + 10]] });
}
// 跨区连通干线 DN160(与各池体支管形成十字交叉,演示自动断开)
pipes.push({ diam: 160, pts: [[60, 385], [940, 385]] });
pipes.push({ diam: 160, pts: [[60, 95], [940, 95]] });
for (const pool of POOLS) {
  const zone = ZONE_BY_ID[pool.zoneId];
  const ringDiam = pool.rx > 120 ? 160 : pool.rx > 70 ? 110 : 75;
  const ring = scalePoly(pool.poly, 1.18);
  ring.push(ring[0]); // 闭合
  pipes.push({ diam: ringDiam, pts: ring });
  // 支管 DN50:环管底部接到片区主管
  const mainY = zone.rect[1] + 10;
  const by = pool.cy - pool.ry * 1.18;
  if (by > mainY + 2) pipes.push({ diam: 50, pts: [[pool.cx, by], [pool.cx, mainY]] });
}

function segInt(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) return t;
  return null;
}

// 交叉处理:管径小的(下层位)在交叉点断开,留 4.4m 缺口
function buildPipeSegs() {
  const GAP_HALF = 2.2;
  const segs = pipes.map((p) => {
    const s = [];
    for (let i = 0; i < p.pts.length - 1; i++) s.push({ a: p.pts[i], b: p.pts[i + 1], gaps: [] });
    return s;
  });
  for (let i = 0; i < pipes.length; i++) {
    for (let j = i + 1; j < pipes.length; j++) {
      if (pipes[i].diam === pipes[j].diam) continue;
      const low = pipes[i].diam < pipes[j].diam ? i : j;
      const high = low === i ? j : i;
      for (const sl of segs[low]) {
        for (const sh of segs[high]) {
          const t = segInt(sl.a, sl.b, sh.a, sh.b);
          if (t !== null) sl.gaps.push(t);
        }
      }
    }
  }
  const out = [];
  pipes.forEach((p, pi) => {
    for (const s of segs[pi]) {
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const half = GAP_HALF / len;
      const cuts = s.gaps.filter((t) => t > half && t < 1 - half).sort((a, b) => a - b);
      let start = 0;
      const intervals = [];
      for (const t of cuts) { intervals.push([start, t - half]); start = t + half; }
      intervals.push([start, 1]);
      for (const [u, v] of intervals) {
        if (v - u < 0.005) continue;
        out.push({
          x1: s.a[0] + dx * u, y1: s.a[1] + dy * u,
          x2: s.a[0] + dx * v, y2: s.a[1] + dy * v,
          diam: p.diam,
        });
      }
    }
  });
  return out;
}
export const PIPE_SEGS = buildPipeSegs();

// ---------------- 绿化层 ----------------
export const TREES = [];
for (const zone of ZONES) {
  const [zx, zy, zw, zh] = zone.rect;
  const zonePools = POOLS.filter((p) => p.zoneId === zone.id);
  let placed = 0, guard = 0;
  while (placed < 85 && guard++ < 3000) {
    const x = zx + 10 + rand() * (zw - 20);
    const y = zy + 10 + rand() * (zh - 20);
    if (zonePools.some((p) => pointInPoly(x, y, scalePoly(p.poly, 1.12)))) continue;
    TREES.push({ x, y, r: 2 + rand() * 2.5 });
    placed++;
  }
}

// ---------------- 警戒线层(池体外扩 9%) ----------------
export const WARN_POLYS = POOLS.map((p) => ({ poolId: p.id, poly: scalePoly(p.poly, 1.09) }));

export const STATS = {
  components: COMPONENTS.length,
  pipes: PIPE_SEGS.length,
  trees: TREES.length,
};
