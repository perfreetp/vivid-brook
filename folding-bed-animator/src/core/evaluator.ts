import type { AnimProject, BoneWorld, EvaluatedScene } from '../types.js';
import { sampleTrack } from './easing.js';
import { add, angleDelta, rotate, toWorld } from './math.js';

/** 判断当前局部角是否超出塑料件限位（最小夹角比较） */
export function isOverLimit(localAngle: number, bone: { limit: { min: number | null; max: number | null } }): boolean {
  const { min, max } = bone.limit;
  if (min !== null && angleDelta(localAngle, min) < 0) return true;
  if (max !== null && angleDelta(localAngle, max) > 0) return true;
  return false;
}

/** 按当前帧对骨架求值：局部角 -> 世界角 -> 世界坐标 */
export function evaluateScene(project: AnimProject, frame: number): EvaluatedScene {
  const byId = new Map<string, BoneWorld>();
  const out: BoneWorld[] = [];
  const bones = project.bones;

  // 父节点先算（数据上保证父在数组前面；保险起见做拓扑排序）
  const ordered = topoSort(bones);

  for (const bone of ordered) {
    const localAngle = sampleTrack(project.tracks[bone.id], frame, bone.restAngle);
    const parent = bone.parentId ? byId.get(bone.parentId) : undefined;
    const worldAngle = parent ? parent.worldAngle + localAngle : localAngle;
    const origin = parent
      ? toWorld(bone.start, parent.start, parent.worldAngle)
      : { ...bone.start };
    const end = add(origin, rotate({ x: bone.length, y: 0 }, worldAngle));
    const bw: BoneWorld = {
      bone,
      localAngle,
      worldAngle,
      start: origin,
      end,
      depth: parent ? parent.depth + 1 : 0,
      overLimit: isOverLimit(localAngle, bone),
    };
    byId.set(bone.id, bw);
    out.push(bw);
  }
  return { bones: out, byId, frame };
}

function topoSort(bones: AnimProject['bones']): AnimProject['bones'] {
  const map = new Map(bones.map((b) => [b.id, b]));
  const visited = new Set<string>();
  const out: AnimProject['bones'] = [];
  const visit = (b: (typeof bones)[number]): void => {
    if (visited.has(b.id)) return;
    if (b.parentId && map.has(b.parentId)) visit(map.get(b.parentId)!);
    visited.add(b.id);
    out.push(b);
  };
  bones.forEach(visit);
  return out;
}
