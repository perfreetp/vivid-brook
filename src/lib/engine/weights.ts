import * as THREE from 'three';
import type { WeightMap } from '../types';
import { deepClone } from './clone';

export const NORMALIZE_EPS = 0.012;

/** 顶点权重和是否归一（和 ≈ 1，已刷权重的顶点才检查） */
export function vertexWeightSum(weights: WeightMap, vertexIndex: number): number {
	const entry = weights[vertexIndex];
	if (!entry) return 0;
	return Object.values(entry).reduce((s, w) => s + w, 0);
}

export function isWeightNormalized(weights: WeightMap, vertexIndex: number): boolean {
	const entry = weights[vertexIndex];
	if (!entry) return true; // 没刷的顶点不标红，仅在刷过的区域做归一检查
	const sum = Object.values(entry).reduce((s, w) => s + w, 0);
	return Math.abs(sum - 1) <= NORMALIZE_EPS;
}

export function nonNormalizedVertices(weights: WeightMap): number[] {
	return Object.keys(weights).map(Number).filter((i) => !isWeightNormalized(weights, i));
}

export function normalizeWeights(weights: WeightMap): WeightMap {
	const out: WeightMap = {};
	for (const [viStr, entry] of Object.entries(weights)) {
		const sum = Object.values(entry).reduce((s, w) => s + w, 0);
		const vi = Number(viStr);
		if (sum <= 1e-6) {
			out[vi] = {};
			continue;
		}
		out[vi] = {};
		for (const [jid, w] of Object.entries(entry)) out[vi][jid] = w / sum;
	}
	return out;
}

/** 画刷涂抹：对顶点以距离衰减叠加/替换某关节权重 */
export function paintWeights(
	weights: WeightMap,
	vertexIndices: number[],
	vertexPositions: Float32Array,
	center: THREE.Vector3,
	jointId: string,
	strength: number,
	brushRadius: number,
	replace: boolean
): WeightMap {
	const next: WeightMap = deepClone(weights);
	const r2 = brushRadius * brushRadius;
	const c = center;

	for (const vi of vertexIndices) {
		const px = vertexPositions[vi * 3];
		const py = vertexPositions[vi * 3 + 1];
		const pz = vertexPositions[vi * 3 + 2];
		const dx = px - c.x;
		const dy = py - c.y;
		const dz = pz - c.z;
		const d2 = dx * dx + dy * dy + dz * dz;
		if (d2 > r2) continue;
		const falloff = 1 - Math.sqrt(d2) / brushRadius;
		const delta = strength * falloff;
		if (!next[vi]) next[vi] = {};
		if (replace) {
			next[vi][jointId] = Math.min(1, (next[vi][jointId] ?? 0) + delta);
		} else {
			// 叠加模式：从其它关节按比例腾出权重
			const cur = next[vi][jointId] ?? 0;
			const room = 1 - cur;
			const applied = Math.min(room, delta);
			const others = Object.entries(next[vi]).filter(([jid]) => jid !== jointId);
			const otherSum = others.reduce((s, [, w]) => s + w, 0);
			if (otherSum > 0 && applied > 0) {
				for (const [jid, w] of others) next[vi][jid] = w * (1 - applied / (otherSum + cur));
			}
			next[vi][jointId] = cur + applied;
		}
	}
	return next;
}

/** 生成顶点色：未归一处标红，其余按权重热度显示主影响关节 */
export function buildWeightColors(
	weights: WeightMap,
	vertexCount: number,
	jointColor: Map<string, THREE.Color>
): Float32Array {
	const colors = new Float32Array(vertexCount * 3);
	const neutral = new THREE.Color(0x6b7280);
	for (let i = 0; i < vertexCount; i++) {
		const entry = weights[i];
		let color: THREE.Color;
		if (!entry || Object.keys(entry).length === 0) {
			color = neutral;
		} else if (!isWeightNormalized(weights, i)) {
			color = new THREE.Color(0xff2222); // 权重未归一 → 标红
		} else {
			color = new THREE.Color(0, 0, 0);
			let total = 0;
			for (const [jid, w] of Object.entries(entry)) {
				const jc = jointColor.get(jid);
				if (!jc) continue;
				color.r += jc.r * w;
				color.g += jc.g * w;
				color.b += jc.b * w;
				total += w;
			}
			if (total === 0) color = neutral;
		}
		colors[i * 3] = color.r;
		colors[i * 3 + 1] = color.g;
		colors[i * 3 + 2] = color.b;
	}
	return colors;
}
