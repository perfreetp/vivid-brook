import * as THREE from 'three';
import type { JointData, JointTransform, SkeletonData, Vec3, Vec4 } from '../types';
import { IDENTITY_QUAT, UNIT_SCALE } from './interpolation';

export function createJoint(name: string, parentId: string | null, position: Vec3 = [0, 0, 0]): JointData {
	return {
		id: `j_${crypto.randomUUID().slice(0, 8)}`,
		name,
		parentId,
		position: [...position] as Vec3,
		rotation: [...IDENTITY_QUAT] as Vec4,
		scale: [...UNIT_SCALE] as Vec3
	};
}

export function jointMap(skeleton: SkeletonData): Map<string, JointData> {
	return new Map(skeleton.joints.map((j) => [j.id, j]));
}

export function childrenOf(skeleton: SkeletonData, parentId: string | null): JointData[] {
	return skeleton.joints.filter((j) => j.parentId === parentId);
}

/** 校验是否会形成环（reparent 时用）：newParent 不能是 jointId 自己或其后代 */
export function wouldCycle(skeleton: SkeletonData, jointId: string, newParentId: string | null): boolean {
	if (newParentId === jointId) return true;
	if (newParentId === null) return false;
	let cursor: string | null = newParentId;
	const map = jointMap(skeleton);
	while (cursor) {
		if (cursor === jointId) return true;
		cursor = map.get(cursor)?.parentId ?? null;
	}
	return false;
}

export function reparent(skeleton: SkeletonData, jointId: string, newParentId: string | null): SkeletonData {
	if (wouldCycle(skeleton, jointId, newParentId)) return skeleton;
	return {
		rootId: skeleton.rootId,
		joints: skeleton.joints.map((j) => (j.id === jointId ? { ...j, parentId: newParentId } : j))
	};
}

export function renameJoint(skeleton: SkeletonData, jointId: string, name: string): SkeletonData {
	return {
		rootId: skeleton.rootId,
		joints: skeleton.joints.map((j) => (j.id === jointId ? { ...j, name } : j))
	};
}

export function deleteJoint(skeleton: SkeletonData, jointId: string): SkeletonData {
	const joints: JointData[] = [];
	for (const j of skeleton.joints) {
		if (j.id === jointId) continue;
		joints.push(j.parentId === jointId ? { ...j, parentId: null } : j);
	}
	const remainingRoots = joints.filter((j) => j.parentId === null);
	return {
		rootId: joints.length === 0 ? null : remainingRoots[0]?.id ?? null,
		joints
	};
}

/** 计算绑定姿势下每个关节的世界矩阵（按父链递归） */
export function computeBindWorldMatrices(skeleton: SkeletonData): Map<string, THREE.Matrix4> {
	const map = jointMap(skeleton);
	const cache = new Map<string, THREE.Matrix4>();

	const local = (j: JointData) =>
		new THREE.Matrix4().compose(
			new THREE.Vector3(...j.position),
			new THREE.Quaternion(...j.rotation),
			new THREE.Vector3(...j.scale)
		);

	const world = (id: string): THREE.Matrix4 => {
		const hit = cache.get(id);
		if (hit) return hit;
		const j = map.get(id);
		if (!j) return new THREE.Matrix4();
		const m = local(j);
		if (j.parentId && map.has(j.parentId)) {
			m.premultiply(world(j.parentId));
		}
		cache.set(id, m);
		return m;
	};

	for (const j of skeleton.joints) world(j.id);
	return cache;
}

export function computeInverseBind(skeleton: SkeletonData): Map<string, THREE.Matrix4> {
	const out = new Map<string, THREE.Matrix4>();
	for (const [id, m] of computeBindWorldMatrices(skeleton)) {
		out.set(id, m.clone().invert());
	}
	return out;
}

/** 把一组局部 TRS（动画姿态）解析为世界矩阵，parentId 链以 skeleton 为准 */
export function computePoseWorldMatrices(
	skeleton: SkeletonData,
	pose: Record<string, JointTransform>
): Map<string, THREE.Matrix4> {
	const map = jointMap(skeleton);
	const cache = new Map<string, THREE.Matrix4>();

	const world = (id: string): THREE.Matrix4 => {
		const hit = cache.get(id);
		if (hit) return hit;
		const j = map.get(id);
		if (!j) return new THREE.Matrix4();
		const trs = pose[id] ?? { position: j.position, rotation: j.rotation, scale: j.scale };
		const m = new THREE.Matrix4().compose(
			new THREE.Vector3(...trs.position),
			new THREE.Quaternion(...trs.rotation),
			new THREE.Vector3(...trs.scale)
		);
		if (j.parentId && map.has(j.parentId)) m.premultiply(world(j.parentId));
		cache.set(id, m);
		return m;
	};

	for (const j of skeleton.joints) world(j.id);
	return cache;
}

/** 取某关节当前世界坐标（用于轨迹显示） */
export function jointWorldPosition(skeleton: SkeletonData, pose: Record<string, JointTransform>, jointId: string): Vec3 {
	const m = computePoseWorldMatrices(skeleton, pose).get(jointId);
	if (!m) return [0, 0, 0];
	const p = new THREE.Vector3().setFromMatrixPosition(m);
	return [p.x, p.y, p.z];
}

export function emptySkeleton(): SkeletonData {
	return { rootId: null, joints: [] };
}
