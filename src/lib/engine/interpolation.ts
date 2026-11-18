import * as THREE from 'three';
import type { InterpMode, Keyframe, Vec2, Vec3, Vec4 } from '../types';

export const IDENTITY_QUAT: Vec4 = [0, 0, 0, 1];
export const UNIT_SCALE: Vec3 = [1, 1, 1];

export function uid(prefix = 'id'): string {
	return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export function v3(): Vec3 {
	return [0, 0, 0];
}

function quat(a: Vec4): THREE.Quaternion {
	return new THREE.Quaternion(a[0], a[1], a[2], a[3]);
}

/**
 * 三次贝塞尔缓动求解。手柄为段内归一化坐标 (x,y) ∈ [0,1]²，
 * 给定时间比 t（x 轴），牛顿+二分回退求参数 u，再取 y(u) 作为缓动值。
 */
export function cubicBezierEase(t: number, outHandle: Vec2, inHandle: Vec2): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	const [x1, y1] = outHandle;
	const [x2, y2] = inHandle;

	const cx = 3 * x1;
	const bx = 3 * (x2 - x1) - cx;
	const ax = 1 - cx - bx;
	const cy = 3 * y1;
	const by = 3 * (y2 - y1) - cy;
	const ay = 1 - cy - by;

	const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
	const sampleDX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
	const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;

	// 牛顿迭代
	let u = t;
	for (let i = 0; i < 8; i++) {
		const x = sampleX(u) - t;
		const dx = sampleDX(u);
		if (Math.abs(x) < 1e-6) return sampleY(u);
		if (Math.abs(dx) < 1e-6) break;
		u -= x / dx;
	}
	// 二分回退
	let lo = 0;
	let hi = 1;
	u = t;
	while (lo < hi) {
		const x = sampleX(u);
		if (Math.abs(x - t) < 1e-6) break;
		if (x < t) lo = u;
		else hi = u;
		u = (lo + hi) / 2;
	}
	return sampleY(u);
}

export function defaultOutHandle(mode: InterpMode): Vec2 {
	return mode === 'step' ? [0, 1] : [0, 0];
}
export function defaultInHandle(mode: InterpMode): Vec2 {
	return mode === 'step' ? [1, 1] : [1, 1];
}

function interpAlpha(alpha: number, a: Keyframe, b: Keyframe): number {
	switch (a.interp) {
		case 'step':
			return 0;
		case 'linear':
			return alpha;
		case 'bezier':
			return cubicBezierEase(alpha, a.outHandle, b.inHandle);
	}
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function slerpQuat(a: Vec4, b: Vec4, t: number): Vec4 {
	const qa = quat(a);
	const qb = quat(b);
	qa.slerp(qb, t);
	return [qa.x, qa.y, qa.z, qa.w];
}

/** 在两个关键帧之间按 frame 采样，frame 超出范围时夹住端点 */
export function sampleKeyPair(
	keys: Keyframe[],
	frame: number
): { position: Vec3; rotation: Vec4; scale: Vec3 } {
	if (keys.length === 0) {
		return { position: [0, 0, 0], rotation: [...IDENTITY_QUAT] as Vec4, scale: [...UNIT_SCALE] as Vec3 };
	}
	const sorted = [...keys].sort((a, b) => a.frame - b.frame);
	if (frame <= sorted[0].frame) {
		return { position: [...sorted[0].position] as Vec3, rotation: [...sorted[0].rotation] as Vec4, scale: [...sorted[0].scale] as Vec3 };
	}
	const last = sorted[sorted.length - 1];
	if (frame >= last.frame) {
		return { position: [...last.position] as Vec3, rotation: [...last.rotation] as Vec4, scale: [...last.scale] as Vec3 };
	}
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i];
		const b = sorted[i + 1];
		if (frame >= a.frame && frame <= b.frame) {
			const span = b.frame - a.frame;
			const raw = span === 0 ? 0 : (frame - a.frame) / span;
			const t = interpAlpha(raw, a, b);
			return {
				position: lerpVec3(a.position, b.position, t),
				rotation: slerpQuat(a.rotation, b.rotation, t),
				scale: lerpVec3(a.scale, b.scale, t)
			};
		}
	}
	return { position: [...last.position] as Vec3, rotation: [...last.rotation] as Vec4, scale: [...last.scale] as Vec3 };
}

export function makeKeyframe(frame: number, trs: { position: Vec3; rotation: Vec4; scale: Vec3 }, interp: InterpMode = 'linear'): Keyframe {
	return {
		id: `kf_${crypto.randomUUID().slice(0, 8)}`,
		frame,
		position: [...trs.position] as Vec3,
		rotation: [...trs.rotation] as Vec4,
		scale: [...trs.scale] as Vec3,
		interp,
		outHandle: [0, 0],
		inHandle: [1, 1]
	};
}
