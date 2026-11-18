// 管廊数据模型：确定性生成 + 版本修订 + 版本 diff
import {
  CHAMBERS, LEVELS, PROFESSIONS, PROFESSION_LAYOUT, CELL_SIZE, GALLERY_LENGTH, LAYER_BITS,
} from './constants.js';

// ---------- 确定性随机 ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layerMaskFor(prof, chamber, level) {
  return LAYER_BITS.profession[prof] | LAYER_BITS.chamber[chamber] | LAYER_BITS.level[level];
}

const elevOf = (levelId) => LEVELS.find((l) => l.id === levelId).elev;

// 各专业管线“线路”定义（同一专业可含多条并行管线）
const LINE_DEFS = [
  { prof: 'water', key: 'water-supply', name: '给水管', spec: 'DN400 球墨铸铁', r: 0.22, dz: -0.75, dy: 0 },
  { prof: 'water', key: 'water-reuse', name: '中水管', spec: 'DN300 球墨铸铁', r: 0.17, dz: 0.75, dy: 0 },
  { prof: 'heat', key: 'heat-supply', name: '热力一次供水管', spec: 'DN350 保温钢管', r: 0.19, dz: -0.75, dy: 0 },
  { prof: 'heat', key: 'heat-return', name: '热力一次回水管', spec: 'DN350 保温钢管', r: 0.19, dz: 0.75, dy: 0 },
  ...[-1, 1].flatMap((cz) =>
    [0, 1, 2].map((row) => ({
      prof: 'power', key: `power-${cz}-${row}`, name: `电力排管 ${row + 1}#`, spec: 'DN150 CPVC 电力套管',
      r: 0.095, dz: cz * 0.45, dy: row * 0.32,
    }))),
  ...[-1, 1].flatMap((cz) =>
    [0, 1].map((row) => ({
      prof: 'comm', key: `comm-${cz}-${row}`, name: `通信排管 ${row + 1}#`, spec: 'DN100 PE 通信套管',
      r: 0.07, dz: cz * 0.35, dy: row * 0.28,
    }))),
];

const CHAMBER_Z = { comp: 0, power: -3.7, comm: 3.0 };
const SEG_LEN = 2;       // 每段管 2m（段段相接，之间留 5cm 缝）
const BRANCH_EVERY = 6;  // 每 6m 一个支管
const BRACKET_EVERY = 4; // 每 4m 一副支架
const COLLAR_EVERY = 8;  // 每 8m 一道套管接头

let uid = 0;
function baseElement(partial) {
  return {
    id: `e${uid++}`,
    cellId: 0, lod: 0, layerMask: 0,
    axis: 'x', pos: [0, 0, 0], scale: [1, 1, 1],
    color: [0.8, 0.8, 0.8], radius: 0,
    prof: null, chamber: null, level: null, elev: 0,
    name: '', spec: '', kind: '', ...partial,
  };
}

// 生成基线模型（不含任何修订）
function generateBase(seed) {
  uid = 0;
  const rnd = mulberry32(seed);
  const groups = { structure: [], main: [], branch: [], support: [], fitting: [], collar: [] };
  const push = (g, el) => { groups[g].push(el); return el; };

  // ---- 舱室结构：每 Cell 底板/顶板/两侧墙 ----
  for (const chamber of Object.values(CHAMBERS)) {
    const cz = CHAMBER_Z[chamber.id];
    const cells = Math.ceil(GALLERY_LENGTH / CELL_SIZE);
    for (let c = 0; c < cells; c++) {
      const x0 = c * CELL_SIZE;
      const cx = x0 + CELL_SIZE / 2;
      const yFloor = chamber.floor;
      const common = {
        kind: 'structure', group: 'structure', lod: 0, chamber: chamber.id,
        prof: null, level: null, elev: yFloor, cellId: c,
        color: [0.62, 0.64, 0.68], layerMask: layerMaskFor(null, chamber.id, null) || 0,
      };
      // 结构件挂舱室掩码（专业/标高位留空，可见性判定时按舱室位 + 全局位处理）
      const mask = LAYER_BITS.chamber[chamber.id];
      const slab = (dy, th, name) => push('structure', baseElement({
        ...common, name: `${chamber.name}-${name}`, spec: 'C40 钢筋混凝土',
        layerMask: mask, axis: 'x',
        pos: [cx, yFloor + dy, cz], scale: [CELL_SIZE, th, chamber.width], radius: 0,
      }));
      slab(0, 0.25, '底板');
      slab(chamber.height, 0.25, '顶板');
      const wall = (dz, name) => push('structure', baseElement({
        ...common, name: `${chamber.name}-${name}`, spec: 'C40 钢筋混凝土',
        layerMask: mask,
        pos: [cx, yFloor + chamber.height / 2, cz + dz],
        scale: [CELL_SIZE, chamber.height, 0.2],
      }));
      wall(-chamber.width / 2, '左侧墙');
      wall(chamber.width / 2, '右侧墙');
    }
  }

  // ---- 管线干管、支管、接头、支架、附件 ----
  for (const line of LINE_DEFS) {
    const layout = PROFESSION_LAYOUT[line.prof];
    const chamber = layout.chamber;
    const levelId = layout.level;
    const baseY = elevOf(levelId) + (line.dy || 0);
    const z = CHAMBER_Z[chamber] + line.dz;
    const color = PROFESSIONS[line.prof].color;
    const mask = layerMaskFor(line.prof, chamber, levelId);
    let segIndex = 0;
    for (let x = 0; x < GALLERY_LENGTH; x += SEG_LEN) {
      const len = Math.min(SEG_LEN - 0.05, GALLERY_LENGTH - x);
      const cx = x + len / 2;
      push('main', baseElement({
        kind: 'main', group: 'main', lod: 0, prof: line.prof, chamber, level: levelId,
        elev: baseY, layerMask: mask, color, radius: line.r,
        axis: 'x', pos: [cx, baseY, z], scale: [len / 2, line.r, line.r],
        name: line.name, spec: line.spec,
        cellId: Math.floor(cx / CELL_SIZE),
        lineKey: line.key, segIndex,
      }));
      segIndex++;

      // 套管接头（LOD2）
      if (segIndex % (COLLAR_EVERY / SEG_LEN) === 0) {
        push('collar', baseElement({
          kind: 'collar', group: 'collar', lod: 2, prof: line.prof, chamber, level: levelId,
          elev: baseY, layerMask: mask, color: color.map((v) => v * 0.7),
          axis: 'x', pos: [x, baseY, z], scale: [0.06, line.r * 1.12, line.r * 1.12],
          radius: line.r * 1.12, name: `${line.name}-接头套管`, spec: '钢制套管',
          cellId: Math.floor(x / CELL_SIZE), lineKey: line.key,
        }));
      }
    }

    // 支管：沿 Z 向外侧接出
    for (let x = BRANCH_EVERY; x < GALLERY_LENGTH; x += BRANCH_EVERY) {
      const side = (Math.floor(x / BRANCH_EVERY) % 2 === 0) ? 1 : -1;
      const blen = 1.6 + rnd() * 1.4;
      push('branch', baseElement({
        kind: 'branch', group: 'branch', lod: 1, prof: line.prof, chamber, level: levelId,
        elev: baseY, layerMask: mask, color, radius: line.r * 0.7,
        axis: 'z', pos: [x, baseY, z + side * blen / 2],
        scale: [line.r * 0.7, line.r * 0.7, blen / 2],
        name: `${line.name}-支管`, spec: line.spec.replace(/DN\d+/, (m) => `DN${Math.round(parseInt(m.slice(2)) * 0.7)}`),
        cellId: Math.floor(x / CELL_SIZE), lineKey: line.key,
      }));
    }

    // 支架：每 4m 一副托臂
    for (let x = BRACKET_EVERY / 2; x < GALLERY_LENGTH; x += BRACKET_EVERY) {
      push('support', baseElement({
        kind: 'support', group: 'support', lod: 2, prof: line.prof, chamber, level: levelId,
        elev: baseY - line.r - 0.08, layerMask: mask, color: [0.45, 0.47, 0.52],
        axis: 'x', pos: [x, baseY - line.r - 0.08, z], scale: [0.08, 0.06, 0.45],
        radius: 0, name: `${line.name}-托臂支架`, spec: 'Q235 热镀锌型钢',
        cellId: Math.floor(x / CELL_SIZE), lineKey: line.key,
      }));
    }

    // 附件：阀/井室/接线盒
    const fittingEvery = line.prof === 'water' || line.prof === 'heat' ? 80 : 40;
    for (let x = fittingEvery; x < GALLERY_LENGTH; x += fittingEvery) {
      const isValve = line.prof === 'water' || line.prof === 'heat';
      push('fitting', baseElement({
        kind: 'fitting', group: 'fitting', lod: 2, prof: line.prof, chamber, level: levelId,
        elev: baseY, layerMask: mask,
        color: isValve ? [0.85, 0.35, 0.3] : [0.35, 0.4, 0.55],
        axis: 'x', pos: [x, baseY, z],
        scale: isValve ? [0.25, line.r * 1.6, line.r * 1.6] : [0.3, 0.22, 0.22],
        radius: line.r, name: `${line.name}-${isValve ? '阀门' : '接线盒'}`,
        spec: isValve ? 'DN 配套闸阀' : '防爆接线盒',
        cellId: Math.floor(x / CELL_SIZE), lineKey: line.key,
      }));
    }
  }

  // ---- 舱室综合支架门框（每 10m 一榀）----
  for (const chamber of Object.values(CHAMBERS)) {
    const cz = CHAMBER_Z[chamber.id];
    const mask = LAYER_BITS.chamber[chamber.id];
    for (let x = 5; x < GALLERY_LENGTH; x += 10) {
      const yMid = chamber.floor + chamber.height / 2;
      const post = (dz) => push('support', baseElement({
        kind: 'support', group: 'support', lod: 2, chamber: chamber.id, prof: null,
        level: null, elev: yMid, layerMask: mask, color: [0.4, 0.42, 0.47],
        pos: [x, yMid, cz + dz], scale: [0.07, chamber.height / 2, 0.07],
        name: `${chamber.name}-综合支架立柱`, spec: '槽钢 10#',
        cellId: Math.floor(x / CELL_SIZE),
      }));
      post(-chamber.width / 2 + 0.25);
      post(chamber.width / 2 - 0.25);
      push('support', baseElement({
        kind: 'support', group: 'support', lod: 2, chamber: chamber.id, prof: null,
        level: null, elev: chamber.floor + chamber.height - 0.2, layerMask: mask,
        color: [0.4, 0.42, 0.47],
        pos: [x, chamber.floor + chamber.height - 0.2, cz],
        scale: [0.07, 0.07, chamber.width / 2],
        name: `${chamber.name}-综合支架横梁`, spec: '槽钢 10#',
        cellId: Math.floor(x / CELL_SIZE),
      }));
    }
  }

  return groups;
}

// ---------- 版本修订 ----------
// 每次出图提交产生一批确定性修订：管径调整、支管移位（删+增）、新增阀门
function planEdits(vid, baseGroups, seed) {
  const rnd = mulberry32(seed + vid * 7919);
  const edits = [];
  const mains = baseGroups.main;
  // 1) 随机 8 段干管调整管径
  for (let i = 0; i < 8; i++) {
    const el = mains[Math.floor(rnd() * mains.length)];
    const factor = 0.85 + rnd() * 0.3;
    edits.push({ type: 'radius', id: el.id, r: +(el.radius * factor).toFixed(3), vid });
  }
  // 2) 移除 4 条支管并在邻近位置新增 4 条
  const branches = baseGroups.branch;
  for (let i = 0; i < 4; i++) {
    const el = branches[Math.floor(rnd() * branches.length)];
    edits.push({ type: 'remove', id: el.id, vid });
    const nx = Math.max(2, el.pos[0] + (rnd() > 0.5 ? 3 : -3));
    edits.push({
      type: 'add', vid, newId: `v${vid}-a${i}`,
      el: { ...el, id: `v${vid}-a${i}`, pos: [nx, el.pos[1], el.pos[2]], cellId: Math.floor(nx / CELL_SIZE) },
    });
  }
  // 3) 新增 2 个阀门
  const waterMains = mains.filter((e) => e.prof === 'water');
  for (let i = 0; i < 2; i++) {
    const el = waterMains[Math.floor(rnd() * waterMains.length)];
    edits.push({
      type: 'add', vid, newId: `v${vid}-f${i}`,
      el: {
        ...el, id: `v${vid}-f${i}`, kind: 'fitting', group: 'fitting', lod: 2,
        color: [0.85, 0.35, 0.3], radius: el.radius,
        pos: [el.pos[0], el.pos[1], el.pos[2]],
        scale: [0.25, el.radius * 1.6, el.radius * 1.6],
        name: `${el.name}-新增阀门`, spec: 'DN 配套闸阀',
      },
    });
  }
  return edits;
}

function applyEdits(groups, edits) {
  const removed = new Set();
  const byId = new Map();
  for (const list of Object.values(groups)) for (const el of list) byId.set(el.id, el);
  for (const e of edits) {
    if (e.type === 'remove') removed.add(e.id);
    if (e.type === 'radius') {
      const el = byId.get(e.id);
      if (el) {
        el.radius = e.r;
        if (el.axis === 'x') el.scale = [el.scale[0], e.r, e.r];
        else el.scale = [e.r, e.r, el.scale[2]];
      }
    }
    if (e.type === 'add') groups[e.el.group].push(e.el);
  }
  if (removed.size) {
    for (const key of Object.keys(groups)) {
      groups[key] = groups[key].filter((el) => !removed.has(el.id));
    }
  }
  return groups;
}

// ---------- 构建某版本的完整模型 ----------
const buildCache = new Map();

export function buildModel(version) {
  if (buildCache.has(version.vid)) return buildCache.get(version.vid);
  const groups = generateBase(version.seed);
  if (version.edits && version.edits.length) applyEdits(groups, version.edits);
  const stats = { total: 0, byGroup: {} };
  for (const [k, list] of Object.entries(groups)) {
    stats.byGroup[k] = list.length;
    stats.total += list.length;
  }
  const model = {
    vid: version.vid, groups, stats,
    bounds: { x: [0, GALLERY_LENGTH], y: [-9, -2.5], z: [-6, 6] },
  };
  buildCache.set(version.vid, model);
  return model;
}

// ---------- 版本 diff ----------
const SIGNATURE_KEYS = ['pos', 'scale', 'radius', 'spec'];
function signature(el) {
  return SIGNATURE_KEYS.map((k) =>
    Array.isArray(el[k]) ? el[k].map((v) => v.toFixed(3)).join(',') : String(el[k])).join('|');
}

export function diffModels(modelA, modelB) {
  const mapA = new Map(), mapB = new Map();
  for (const list of Object.values(modelA.groups)) for (const el of list) mapA.set(el.id, el);
  for (const list of Object.values(modelB.groups)) for (const el of list) mapB.set(el.id, el);
  const added = [], removed = [], changed = [];
  for (const [id, b] of mapB) {
    const a = mapA.get(id);
    if (!a) added.push(b);
    else if (signature(a) !== signature(b)) changed.push({ id, before: a, after: b });
  }
  for (const [id, a] of mapA) if (!mapB.has(id)) removed.push(a);
  return { added, removed, changed };
}

export { planEdits, LINE_DEFS, layerMaskFor };
