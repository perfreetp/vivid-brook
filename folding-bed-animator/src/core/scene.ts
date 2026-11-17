import type { AnimProject, EvaluatedScene, RenderPrimitive, Vec2, BoneWorld, Part } from '../types.js';
import { toWorld } from './math.js';

const GRID = 40;
const OVER_LIMIT_COLOR = '#e53935';
const BONE_COLOR = '#90a4ae';
const SELECT_COLOR = '#ffd54f';

/** 把场景拍平成与渲染后端无关的图元列表（WebGPU / Canvas2D 共用） */
export function buildPrimitives(
  project: AnimProject,
  scene: EvaluatedScene,
  selectedBoneId: string | null,
): RenderPrimitive[] {
  const p: RenderPrimitive[] = [];
  p.push(...grid(project));
  p.push(ground());

  // 先画部件（床板、连杆），再画骨骼线，最后画铰点，保证关节在最上层
  for (const part of project.parts) {
    if (part.type !== 'joint') p.push(partPrimitive(part, scene));
  }
  for (const bw of scene.bones) {
    if (bw.bone.length > 0) p.push(boneLine(bw, selectedBoneId === bw.bone.id));
  }
  for (const part of project.parts) {
    if (part.type === 'joint') p.push(jointPrimitive(part, scene));
  }
  // 限位红色提示：在超限关节上叠加醒目红圈
  for (const bw of scene.bones) {
    if (bw.overLimit) {
      p.push({ type: 'circle', center: bw.start, radius: 18, color: OVER_LIMIT_COLOR, fill: false, width: 3 });
    }
    if (selectedBoneId === bw.bone.id) {
      p.push({ type: 'circle', center: bw.start, radius: 21, color: SELECT_COLOR, fill: false, width: 2 });
    }
  }
  return p;
}

function grid(project: AnimProject): RenderPrimitive[] {
  const lines: RenderPrimitive[] = [];
  const w = project.canvasW;
  const h = project.canvasH;
  const halfW = w / 2;
  const halfH = h / 2;
  for (let x = -Math.floor(halfW / GRID) * GRID; x <= halfW; x += GRID) {
    lines.push({ type: 'line', points: [{ x, y: halfH }, { x, y: -halfH }], color: '#26313d', fill: false, width: 1 });
  }
  for (let y = -Math.floor(halfH / GRID) * GRID; y <= halfH; y += GRID) {
    lines.push({ type: 'line', points: [{ x: -halfW, y }, { x: halfW, y }], color: '#26313d', fill: false, width: 1 });
  }
  return lines;
}

function ground(): RenderPrimitive {
  return {
    type: 'line',
    points: [{ x: -2000, y: 0 }, { x: 2000, y: 0 }],
    color: '#546e7a',
    fill: false,
    width: 2,
  };
}

function partPrimitive(part: Part, scene: EvaluatedScene): RenderPrimitive {
  const bw = scene.byId.get(part.boneId);
  const angle = bw ? bw.worldAngle : 0;
  const origin = bw ? bw.start : { x: 0, y: 0 };
  const c0 = toWorld({ x: part.offsetX, y: part.offsetY }, origin, angle);
  const c1 = toWorld({ x: part.offsetX + part.length, y: part.offsetY }, origin, angle);
  const c2 = toWorld({ x: part.offsetX + part.length, y: part.offsetY + part.thickness }, origin, angle);
  const c3 = toWorld({ x: part.offsetX, y: part.offsetY + part.thickness }, origin, angle);
  return { type: 'poly', points: [c0, c1, c2, c3], color: part.color, fill: true };
}

function boneLine(bw: BoneWorld, selected: boolean): RenderPrimitive {
  return {
    type: 'line',
    points: [bw.start, bw.end],
    color: selected ? SELECT_COLOR : BONE_COLOR,
    fill: false,
    width: selected ? 3 : 2,
  };
}

function jointPrimitive(part: Part, scene: EvaluatedScene): RenderPrimitive {
  const bw = scene.byId.get(part.boneId);
  const center: Vec2 = bw ? bw.start : { x: 0, y: 0 };
  const over = bw?.overLimit ?? false;
  return {
    type: 'circle',
    center,
    radius: part.radius ?? 10,
    color: over ? OVER_LIMIT_COLOR : part.color,
    fill: true,
  };
}
