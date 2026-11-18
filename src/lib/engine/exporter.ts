import JSZip from 'jszip';
import * as THREE from 'three';
import type { EditorProject } from '../types';
import { expandSegments, samplePoseAt, totalTimelineFrames } from './timeline';
import { computePoseWorldMatrices } from './skeleton';
import { ViewportEngine } from './viewport';

export interface ExportProgress {
	frame: number;
	total: number;
}

/**
 * 按 fps（24）逐帧离屏渲染，导出 PNG 序列 + 骨架 JSON，打包为 ZIP。
 * 为不阻塞主线程，每帧之间让出一帧给浏览器。
 */
export async function exportSequence(
	viewport: ViewportEngine,
	project: EditorProject,
	onProgress?: (p: ExportProgress) => void
): Promise<Blob> {
	const fps = project.meta.fps || 24;
	const segments = expandSegments(project.clips);
	const total = totalTimelineFrames(project.clips, project.meta.durationFrames);
	const zip = new JSZip();
	const framesFolder = zip.folder('frames')!;
	const skeletonFolder = zip.folder('skeleton')!;

	viewport.setPlayMode(true);
	try {
		for (let f = 0; f < total; f++) {
			const pose = samplePoseAt(project.skeleton, project.tracks, f, segments);
			viewport.applyAnimatedPose(pose);
			// 等渲染管线出图
			await nextFrame();
			const dataUrl = viewport.captureFrame();
			const base64 = dataUrl.split(',')[1];
			framesFolder.file(`frame_${String(f).padStart(5, '0')}.png`, base64, { base64: true });

			// 骨架 JSON：每帧的世界矩阵 + 局部 TRS
			const world = computePoseWorldMatrices(project.skeleton, pose);
			const frameJson = {
				frame: f,
				fps,
				joints: project.skeleton.joints.map((j) => {
					const m = world.get(j.id)!;
					const e = m.elements;
					return {
						id: j.id,
						name: j.name,
						parentId: j.parentId,
						local: pose[j.id],
						worldMatrix: [e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7], e[8], e[9], e[10], e[11], e[12], e[13], e[14], e[15]]
					};
				})
			};
			skeletonFolder.file(`skeleton_${String(f).padStart(5, '0')}.json`, JSON.stringify(frameJson, null, 1));

			onProgress?.({ frame: f + 1, total });
		}

		zip.file(
			'manifest.json',
			JSON.stringify(
				{
					title: project.meta.title,
					fps,
					frameCount: total,
					exportedAt: new Date().toISOString(),
					segments: segments.map((s) => ({
						clip: s.name,
						start: s.clipStart,
						end: s.clipEnd,
						sourceStart: s.sourceStart,
						sourceEnd: s.sourceEnd,
						loopIndex: s.loopIndex
					})),
					jointTree: project.skeleton.joints.map((j) => ({ id: j.id, name: j.name, parentId: j.parentId }))
				},
				null,
				2
			)
		);
		return await zip.generateAsync({ type: 'blob' }, (meta) => {
			onProgress?.({ frame: Math.round((meta.percent / 100) * total), total });
		});
	} finally {
		viewport.setPlayMode(false);
	}
}

export function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 单独导出完整骨架 JSON（绑定姿势 + 权重 + 片段定义） */
export function buildSkeletonJson(project: EditorProject): string {
	const fps = project.meta.fps || 24;
	return JSON.stringify(
		{
			format: 'livework-skeleton/1',
			exportedAt: new Date().toISOString(),
			fps,
			meta: project.meta,
			skeleton: project.skeleton,
			weights: project.weights,
			clips: project.clips,
			tracks: project.tracks,
			segments: expandSegments(project.clips)
		},
		null,
		2
	);
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function matrixToArray(m: THREE.Matrix4): number[] {
	return Array.from(m.elements);
}
