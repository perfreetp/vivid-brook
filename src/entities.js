// 图元定义:符号库 + 各类图元的轮廓/锚点/默认参数
import {
  circlePoly, rectPoly, capsulePoly, fanGatePoly, transformMP, mpBounds, uid,
} from './geometry';

export const KINDS = {
  sprue:   { name: '主流道',   color: '#e8a13a', height: 8,  z: 0 },
  runner:  { name: '分流道',   color: '#4da3ff', height: 6,  z: 0 },
  fanGate: { name: '扇形浇口', color: '#7ddb6a', height: 2,  z: 0 },
  pin:     { name: '顶针',     color: '#ff6b6b', height: 25, z: -25 },
  cooling: { name: '冷却水路', color: '#39c5cf', height: 4,  z: -12 },
  insert:  { name: '镶件',     color: '#9b8cff', height: 30, z: -30 },
  composite: { name: '布尔结果', color: '#c0c0c0', height: 6, z: 0 },
};

export const LIBRARY = [
  { kind: 'sprue',   label: '主流道',   icon: '◎' },
  { kind: 'runner',  label: '分流道',   icon: '━' },
  { kind: 'fanGate', label: '扇形浇口', icon: '◖' },
  { kind: 'pin',     label: '顶针',     icon: '●' },
  { kind: 'cooling', label: '冷却水路', icon: '◍' },
  { kind: 'insert',  label: '镶件',     icon: '▣' },
];

export function defaultParams(kind) {
  switch (kind) {
    case 'sprue':   return { d: 12 };
    case 'runner':  return { len: 60, w: 8 };
    case 'fanGate': return { w1: 6, w2: 24, len: 20 };
    case 'pin':     return { d: 6 };
    case 'cooling': return { d: 8 };
    case 'insert':  return { w: 120, h: 90 };
    default:        return {};
  }
}

// 局部坐标轮廓 (MultiPolygon)
export function localGeom(e) {
  const p = e.params;
  switch (e.kind) {
    case 'sprue':   return circlePoly(0, 0, p.d / 2);
    case 'runner':  return capsulePoly(0, 0, p.len, p.w);
    case 'fanGate': return fanGatePoly(0, 0, p.w1, p.w2, p.len);
    case 'pin':     return circlePoly(0, 0, p.d / 2);
    case 'cooling': return circlePoly(0, 0, p.d / 2);
    case 'insert':  return rectPoly(0, 0, p.w, p.h);
    case 'composite': return e.geom; // 已存世界轮廓,transform 恒等
    default: return [[[]]];
  }
}

// 世界坐标轮廓
export function worldGeom(e) {
  if (e.kind === 'composite') return e.geom;
  return transformMP(localGeom(e), e.x, e.y, e.rot || 0);
}

// 吸附锚点:端点 / 中点 / 中心(局部坐标,使用时转世界)
export function localAnchors(e) {
  const p = e.params;
  switch (e.kind) {
    case 'runner': {
      const hl = p.len / 2;
      return {
        anchors: [[-hl, 0], [hl, 0]],
        midpoints: [[0, 0], [-hl, -p.w / 2], [hl, p.w / 2], [-hl, p.w / 2], [hl, -p.w / 2]],
        center: [0, 0],
      };
    }
    case 'fanGate':
      return {
        anchors: [[0, 0], [p.len, 0]],
        midpoints: [[p.len / 2, 0], [0, -p.w1 / 2], [0, p.w1 / 2], [p.len, -p.w2 / 2], [p.len, p.w2 / 2]],
        center: [p.len / 2, 0],
      };
    case 'insert': {
      const hw = p.w / 2, hh = p.h / 2;
      return {
        anchors: [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]],
        midpoints: [[0, -hh], [hw, 0], [0, hh], [-hw, 0]],
        center: [0, 0],
      };
    }
    default:
      return { anchors: [[0, 0]], midpoints: [], center: [0, 0] };
  }
}

export function makeEntity(kind, x, y, extra = {}) {
  const e = {
    id: uid(kind.slice(0, 3)),
    kind,
    x, y,
    rot: 0,
    params: defaultParams(kind),
    hidden: false,
    locked: false,
    ...extra,
  };
  return decorate(e);
}

export function decorate(e) {
  const mp = worldGeom(e);
  const la = e.kind === 'composite'
    ? { anchors: [], midpoints: [], center: null }
    : localAnchors(e);
  const toWorld = (pt) => {
    const c = Math.cos(e.rot || 0), s = Math.sin(e.rot || 0);
    return [pt[0] * c - pt[1] * s + e.x, pt[0] * s + pt[1] * c + e.y];
  };
  const b = mpBounds(mp);
  return {
    ...e,
    geomWorld: mp,
    anchors: la.anchors.map(toWorld),
    midpoints: la.midpoints.map(toWorld),
    center: la.center ? toWorld(la.center) : [b.cx, b.cy],
    bounds: b,
  };
}

// 序列化(去掉派生字段)
export function serialize(e) {
  const { geomWorld, anchors, midpoints, center, bounds, ...rest } = e;
  return JSON.parse(JSON.stringify(rest));
}

export function deserialize(raw) {
  return decorate(JSON.parse(JSON.stringify(raw)));
}
