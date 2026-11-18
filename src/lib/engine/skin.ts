import * as THREE from 'three';
import type { SkeletonData, WeightMap } from '../types';
import { computeInverseBind } from './skeleton';
import { buildWeightColors, isWeightNormalized } from './weights';

const JOINT_PALETTE = [
	0x22d3ee, 0xa78bfa, 0x34d399, 0xfbbf24, 0xf472b6, 0x60a5fa,
	0xfb923c, 0x4ade80, 0xe879f9, 0x2dd4bf, 0xfacc15, 0x818cf8
];

export function jointColorMap(skeleton: SkeletonData): Map<string, THREE.Color> {
	const map = new Map<string, THREE.Color>();
	skeleton.joints.forEach((j, i) => map.set(j.id, new THREE.Color(JOINT_PALETTE[i % JOINT_PALETTE.length])));
	return map;
}

/**
 * 蒙皮网格管理：按骨骼树构建 THREE.Bone / SkinnedMesh，
 * 每帧用姿态世界矩阵更新 boneMatrices，并维护权重顶点色（未归一处标红）。
 */
export class SkinBinding {
	skinned: THREE.SkinnedMesh | null = null;
	bones = new Map<string, THREE.Bone>();
	private geometry: THREE.BufferGeometry | null = null;
	private baseMaterial: THREE.MeshStandardMaterial;
	weightMaterial: THREE.MeshStandardMaterial;
	private jointColors = new Map<string, THREE.Color>();
	private weightAttr: THREE.BufferAttribute | null = null;

	constructor() {
		this.baseMaterial = new THREE.MeshStandardMaterial({ color: 0xc7d2e0, roughness: 0.65, metalness: 0.05 });
		this.weightMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
	}

	setGeometry(geometry: THREE.BufferGeometry) {
		this.geometry = geometry;
	}

	rebuild(skeleton: SkeletonData, weights: WeightMap, showWeights: boolean): THREE.SkinnedMesh | null {
		if (!this.geometry || skeleton.joints.length === 0) return null;
		this.disposeMesh();

		const inverseBind = computeInverseBind(skeleton);
		this.jointColors = jointColorMap(skeleton);
		const bones: THREE.Bone[] = [];
		this.bones.clear();
		for (const j of skeleton.joints) {
			const bone = new THREE.Bone();
			bone.name = j.name;
			this.bones.set(j.id, bone);
			bones.push(bone);
		}
		// 父子挂接（Bone 层级稍后由 applyPose 的 matrixWorld 驱动）
		for (const j of skeleton.joints) {
			if (j.parentId) this.bones.get(j.parentId)!.add(this.bones.get(j.id)!);
		}

		const indexById = new Map(skeleton.joints.map((j, i) => [j.id, i]));
		const boneInverses = skeleton.joints.map((j) => inverseBind.get(j.id)!.clone());

		const geo = this.geometry.clone();
		const vertexCount = geo.attributes.position.count;

		// 构建 skinIndex / skinWeight（每顶点最多 4 关节影响）
		const skinIndex = new Uint16Array(vertexCount * 4);
		const skinWeight = new Float32Array(vertexCount * 4);
		for (let vi = 0; vi < vertexCount; vi++) {
			const entry = weights[vi] ?? {};
			const sorted = Object.entries(entry).sort((a, b) => b[1] - a[1]).slice(0, 4);
			let sum = 0;
			sorted.forEach(([jid, w], slot) => {
				const idx = indexById.get(jid);
				if (idx === undefined) return;
				skinIndex[vi * 4 + slot] = idx;
				skinWeight[vi * 4 + slot] = w;
				sum += w;
			});
			// 无权重顶点挂到根骨，避免蒙皮后炸飞
			if (sum === 0 && skeleton.rootId) {
				skinIndex[vi * 4] = indexById.get(skeleton.rootId)!;
				skinWeight[vi * 4] = 1;
			}
		}
		geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
		geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));

		const colors = buildWeightColors(weights, vertexCount, this.jointColors);
		this.weightAttr = new THREE.BufferAttribute(colors, 3);
		geo.setAttribute('color', this.weightAttr);

		const threeSkeleton = new THREE.Skeleton(bones, boneInverses);
		const mesh = new THREE.SkinnedMesh(geo, showWeights ? this.weightMaterial : this.baseMaterial);
		mesh.add(bones.find((b) => !b.parent) ?? bones[0]);
		mesh.bind(threeSkeleton, new THREE.Matrix4());
		mesh.castShadow = true;
		this.skinned = mesh;
		return mesh;
	}

	updateWeightColors(weights: WeightMap) {
		if (!this.skinned || !this.weightAttr) return;
		const vertexCount = this.skinned.geometry.attributes.position.count;
		const colors = buildWeightColors(weights, vertexCount, this.jointColors);
		(this.weightAttr.array as Float32Array).set(colors);
		this.weightAttr.needsUpdate = true;
	}

	setShowWeights(show: boolean) {
		if (!this.skinned) return;
		this.skinned.material = show ? this.weightMaterial : this.baseMaterial;
	}

	/** 用外部姿态世界矩阵更新骨骼 */
	applyPose(worldMatrices: Map<string, THREE.Matrix4>) {
		for (const [id, bone] of this.bones) {
			const m = worldMatrices.get(id);
			if (m) bone.matrixWorld.copy(m);
		}
		this.skinned?.skeleton.update();
		this.skinned?.skeleton.calculateInverses?.();
	}

	redVertices(weights: WeightMap): number[] {
		if (!this.skinned) return [];
		const count = this.skinned.geometry.attributes.position.count;
		const out: number[] = [];
		for (let i = 0; i < count; i++) {
			if (weights[i] && !isWeightNormalized(weights, i)) out.push(i);
		}
		return out;
	}

	private disposeMesh() {
		if (this.skinned) {
			this.skinned.geometry.dispose();
			this.skinned.removeFromParent();
			this.skinned = null;
		}
		this.bones.clear();
	}

	dispose() {
		this.disposeMesh();
		this.baseMaterial.dispose();
		this.weightMaterial.dispose();
	}
}
