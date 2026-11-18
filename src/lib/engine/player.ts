import type { BoneTrack, Clip, EditorProject, JointTransform, SkeletonData } from '../types';
import { expandSegments, samplePoseAt, totalTimelineFrames } from './timeline';
import { jointWorldPosition } from './skeleton';

/**
 * 纯逻辑播放器：不依赖 three.js，按时间步进采样姿态、
 * 记录选中骨骼轨迹、统计学员拖拽查看帧。组件侧每帧把 pose 推给 ViewportEngine。
 */
export class AnimationPlayer {
	readonly fps: number;
	private segments;
	private total: number;
	frame = 0;
	playing = false;
	private lastTickTime = 0;
	private accumulator = 0;
	scrubbedFrames: number[] = [];
	private lastScrubFrame = -1;

	constructor(
		private project: EditorProject,
		private onFrame: (frame: number, pose: Record<string, JointTransform>) => void,
		private onEnd?: () => void
	) {
		this.fps = project.meta.fps || 24;
		this.segments = expandSegments(project.clips);
		this.total = totalTimelineFrames(project.clips, project.meta.durationFrames);
	}

	get totalFrames(): number {
		return this.total;
	}

	get skeleton(): SkeletonData {
		return this.project.skeleton;
	}

	get tracks(): BoneTrack[] {
		return this.project.tracks;
	}

	get clips(): Clip[] {
		return this.project.clips;
	}

	private emit() {
		const pose = samplePoseAt(this.project.skeleton, this.project.tracks, this.frame, this.segments);
		this.onFrame(this.frame, pose);
	}

	play() {
		if (this.playing) return;
		this.playing = true;
		this.lastTickTime = performance.now();
		this.accumulator = 0;
		const tick = (now: number) => {
			if (!this.playing) return;
			const delta = now - this.lastTickTime;
			this.lastTickTime = now;
			this.accumulator += delta;
			const frameMs = 1000 / this.fps;
			let advanced = false;
			while (this.accumulator >= frameMs) {
				this.accumulator -= frameMs;
				this.frame++;
				advanced = true;
				if (this.frame >= this.total) {
					this.frame = this.total - 1;
					this.emit();
					this.playing = false;
					this.onEnd?.();
					return;
				}
			}
			if (advanced) this.emit();
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}

	pause() {
		this.playing = false;
	}

	stop() {
		this.playing = false;
		this.frame = 0;
		this.emit();
	}

	seek(frame: number, recordScrub = false) {
		this.frame = Math.max(0, Math.min(this.total - 1, Math.round(frame)));
		if (recordScrub && this.frame !== this.lastScrubFrame) {
			this.scrubbedFrames.push(this.frame);
			this.lastScrubFrame = this.frame;
		}
		this.emit();
	}

	/** 当前选中骨骼从第 0 帧到当前帧的完整轨迹（世界坐标） */
	trajectoryOf(jointId: string, upToFrame?: number): [number, number, number][] {
		const end = upToFrame ?? this.frame;
		const pts: [number, number, number][] = [];
		for (let f = 0; f <= end; f++) {
			const pose = samplePoseAt(this.project.skeleton, this.project.tracks, f, this.segments);
			pts.push(jointWorldPosition(this.project.skeleton, pose, jointId));
		}
		return pts;
	}

	/** 播放进度百分比 */
	get percent(): number {
		return this.total <= 1 ? 100 : Math.round((this.frame / (this.total - 1)) * 100);
	}

	/** 当前帧所属片段名（界面提示用） */
	get currentSegmentName(): string {
		for (const s of this.segments) {
			if (this.frame >= s.clipStart && this.frame < s.clipEnd) return s.name;
		}
		return '—';
	}

	scrubStats(): { uniqueFrames: number[]; counts: Record<number, number> } {
		const counts: Record<number, number> = {};
		for (const f of this.scrubbedFrames) counts[f] = (counts[f] ?? 0) + 1;
		return { uniqueFrames: Object.keys(counts).map(Number), counts };
	}
}
