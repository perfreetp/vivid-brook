import type { BoneTrack, Clip, JointTransform, SkeletonData } from '../types';
import { sampleKeyPair } from './interpolation';
import { jointMap } from './skeleton';

/** 把片段按 order 首尾拼接（含循环次数），展开成全局帧序列 */
export interface PlaybackSegment {
	clipId: string;
	name: string;
	clipStart: number; // 时间轴起始帧
	clipEnd: number; // 时间轴结束帧（不含）
	sourceStart: number;
	sourceEnd: number;
	loopIndex: number;
}

export function expandSegments(clips: Clip[]): PlaybackSegment[] {
	const ordered = [...clips].sort((a, b) => a.order - b.order);
	const segments: PlaybackSegment[] = [];
	let cursor = 0;
	for (const clip of ordered) {
		const len = clip.endFrame - clip.startFrame + 1;
		const loops = Math.max(1, clip.loopCount);
		for (let l = 0; l < loops; l++) {
			segments.push({
				clipId: clip.id,
				name: clip.name,
				clipStart: cursor,
				clipEnd: cursor + len,
				sourceStart: clip.startFrame,
				sourceEnd: clip.endFrame,
				loopIndex: l
			});
			cursor += len;
		}
	}
	return segments;
}

export function totalTimelineFrames(clips: Clip[], fallback: number): number {
	const segs = expandSegments(clips);
	if (segs.length === 0) return fallback;
	return segs[segs.length - 1].clipEnd;
}

/** 全局帧 → 片段内源帧 */
export function frameToSource(segments: PlaybackSegment[], frame: number): { frame: number; segment: PlaybackSegment | null } {
	for (const seg of segments) {
		if (frame >= seg.clipStart && frame < seg.clipEnd) {
			return {
				frame: seg.sourceStart + (frame - seg.clipStart),
				segment: seg
			};
		}
	}
	return { frame, segment: null };
}

/** 在全局帧采样整条骨骼的局部 TRS 姿态 */
export function samplePoseAt(
	skeleton: SkeletonData,
	tracks: BoneTrack[],
	globalFrame: number,
	segments: PlaybackSegment[]
): Record<string, JointTransform> {
	const { frame: sourceFrame } = frameToSource(segments, globalFrame);
	const map = jointMap(skeleton);
	const trackByJoint = new Map(tracks.map((t) => [t.jointId, t]));
	const pose: Record<string, JointTransform> = {};
	for (const joint of skeleton.joints) {
		const track = trackByJoint.get(joint.id);
		if (track && track.keys.length > 0) {
			pose[joint.id] = sampleKeyPair(track.keys, sourceFrame);
		} else {
			// 无轨道时回落到绑定姿势
			pose[joint.id] = {
				position: [...joint.position],
				rotation: [...joint.rotation],
				scale: [...joint.scale]
			};
		}
		map.get(joint.id); // 保留 map 引用，后续扩展用
	}
	return pose;
}

export function clipOf(clip: Partial<Clip> & { name: string }, order: number): Clip {
	return {
		id: `clip_${crypto.randomUUID().slice(0, 8)}`,
		name: clip.name,
		startFrame: clip.startFrame ?? 0,
		endFrame: clip.endFrame ?? 23,
		loopCount: clip.loopCount ?? 1,
		order
	};
}
