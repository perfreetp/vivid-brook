import type { AnimProject, Bone, Part, Keyframe } from '../types.js';
import { uid } from './math.js';

const kf = (frame: number, angle: number): Keyframe => ({
  frame,
  angle,
  easing: 'ease-in-out',
  inTangent: 0,
  outTangent: 0,
});

function bones(): Bone[] {
  return [
    {
      id: 'bone_root', name: '机架（固定）', parentId: null,
      start: { x: 480, y: -220 }, length: 0, restAngle: 0,
      limit: { min: null, max: null },
    },
    {
      id: 'joint_l', name: '左铰点', parentId: 'bone_root',
      start: { x: -260, y: 60 }, length: 30, restAngle: 0,
      limit: { min: -20, max: 100 },
    },
    {
      id: 'board_l', name: '左床板骨架', parentId: 'joint_l',
      start: { x: 30, y: 0 }, length: 230, restAngle: 0,
      limit: { min: -10, max: 95 },
    },
    {
      id: 'joint_m', name: '中间铰点', parentId: 'board_l',
      start: { x: 230, y: 0 }, length: 30, restAngle: 0,
      limit: { min: -30, max: 90 },
    },
    {
      id: 'board_r', name: '右床板骨架', parentId: 'joint_m',
      start: { x: 30, y: 0 }, length: 230, restAngle: 0,
      limit: { min: -10, max: 95 },
    },
    {
      id: 'link_l', name: '左支撑杆', parentId: 'joint_l',
      start: { x: 20, y: -6 }, length: 90, restAngle: -60,
      limit: { min: -80, max: 0 },
    },
    {
      id: 'wheel_l', name: '左脚轮铰点', parentId: 'bone_root',
      start: { x: -260, y: 60 }, length: 0, restAngle: 0,
      limit: { min: null, max: null },
    },
    {
      id: 'wheel_r', name: '右脚轮铰点', parentId: 'board_r',
      start: { x: 260, y: 0 }, length: 0, restAngle: 0,
      limit: { min: null, max: null },
    },
  ];
}

function parts(): Part[] {
  return [
    { id: uid('part'), name: '左塑料床板', type: 'panel', boneId: 'board_l', color: '#7fb2e5', length: 230, thickness: 26, offsetX: 0, offsetY: -13 },
    { id: uid('part'), name: '右塑料床板', type: 'panel', boneId: 'board_r', color: '#90caf9', length: 230, thickness: 26, offsetX: 0, offsetY: -13 },
    { id: uid('part'), name: '左支撑连杆', type: 'link', boneId: 'link_l', color: '#8d6e63', length: 90, thickness: 9, offsetX: 0, offsetY: -4 },
    { id: uid('part'), name: '左铰点塑料件', type: 'joint', boneId: 'joint_l', color: '#f0964b', length: 0, thickness: 0, offsetX: 0, offsetY: 0, radius: 13 },
    { id: uid('part'), name: '中间铰点塑料件', type: 'joint', boneId: 'joint_m', color: '#f0964b', length: 0, thickness: 0, offsetX: 0, offsetY: 0, radius: 13 },
    { id: uid('part'), name: '左脚轮', type: 'joint', boneId: 'wheel_l', color: '#455a64', length: 0, thickness: 0, offsetX: 0, offsetY: 0, radius: 10 },
    { id: uid('part'), name: '右脚轮', type: 'joint', boneId: 'wheel_r', color: '#455a64', length: 0, thickness: 0, offsetX: 0, offsetY: 0, radius: 10 },
  ];
}

export function createDefaultProject(): AnimProject {
  const bs = bones();
  const tracks: Record<string, Keyframe[]> = {};
  for (const b of bs) tracks[b.id] = [];
  tracks['board_l'] = [kf(0, 90), kf(60, 0), kf(120, 90)];
  tracks['board_r'] = [kf(0, 100), kf(60, 0), kf(120, 100)]; // 100° 超过 95° 上限 → 收拢位红色限位提示
  tracks['joint_m'] = [kf(0, 0), kf(60, 0), kf(120, 0)];
  tracks['link_l'] = [kf(0, -10), kf(60, -60), kf(120, -10)];

  return {
    version: 1,
    name: '塑料折叠床-开合机构',
    fps: 30,
    frameCount: 120,
    canvasW: 960,
    canvasH: 640,
    bones: bs,
    parts: parts(),
    tracks,
    segments: [
      { id: uid('seg'), name: '展开', startFrame: 0, endFrame: 60, color: '#4caf50' },
      { id: uid('seg'), name: '收拢', startFrame: 60, endFrame: 120, color: '#ff9800' },
    ],
  };
}
