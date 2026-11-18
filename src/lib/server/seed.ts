import type { Course, EditorProject, ProgressRecord, WeightMap } from '../types';
import { makeKeyframe } from '../engine/interpolation';

/** 构造一个最小可用的示例工程（内置人体、6 关节、含权重与关键帧） */
function buildSeedProject(title: string, variant: number): EditorProject {
	const joints = [
		{ id: 'j_root', name: '骨盆', parentId: null, position: [0, 0.95, 0] as [number, number, number] },
		{ id: 'j_spine', name: '脊柱', parentId: 'j_root', position: [0, 0.22, 0] as [number, number, number] },
		{ id: 'j_head', name: '头部', parentId: 'j_spine', position: [0, 0.32, 0] as [number, number, number] },
		{ id: 'j_handL', name: '左手', parentId: 'j_spine', position: [-0.33, -0.08, 0] as [number, number, number] },
		{ id: 'j_handR', name: '右手', parentId: 'j_spine', position: [0.33, -0.08, 0] as [number, number, number] },
		{ id: 'j_legL', name: '左膝', parentId: 'j_root', position: [-0.1, -0.38, 0] as [number, number, number] }
	].map((j) => ({
		...j,
		rotation: [0, 0, 0, 1] as [number, number, number, number],
		scale: [1, 1, 1] as [number, number, number]
	}));

	// 示意权重（真实网格顶点数由内置人体决定，这里只覆盖部分顶点做演示）
	const weights: WeightMap = {};
	for (let i = 0; i < 240; i++) {
		const t = (i % 5) / 4;
		weights[i] = {
			j_spine: +(0.6 - t * 0.2 + variant * 0).toFixed(3),
			j_root: +(0.4 + t * 0.2).toFixed(3)
		};
	}
	// 故意留两个未归一顶点，演示标红
	weights[7] = { j_spine: 0.5, j_root: 0.2 };
	weights[13] = { j_head: 0.35 };

	const tracks = [
		{
			jointId: 'j_handR',
			keys: [
				makeKeyframe(0, { position: [0.33, -0.08, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, 'linear'),
				makeKeyframe(12, { position: [0.45, 0.12, 0.12], rotation: [0, 0, 0.7, 0.7], scale: [1, 1, 1] }, 'bezier'),
				makeKeyframe(24, { position: [0.33, 0.02, -0.1], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, 'step')
			]
		},
		{
			jointId: 'j_head',
			keys: [
				makeKeyframe(0, { position: [0, 0.32, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, 'linear'),
				makeKeyframe(24, { position: [0, 0.32, 0], rotation: [0, 0.3, 0, 0.95], scale: [1, 1, 1] }, 'linear')
			]
		}
	];

	return {
		meta: {
			title,
			fps: 24,
			durationFrames: 48,
			meshSource: 'builtin',
			meshName: 'builtin-humanoid',
			vertexCount: 240
		},
		skeleton: { rootId: 'j_root', joints },
		weights,
		tracks,
		clips: [
			{ id: 'clip_a', name: '举线就位', startFrame: 0, endFrame: 23, loopCount: 1, order: 0 },
			{ id: 'clip_b', name: '接线操作', startFrame: 0, endFrame: 23, loopCount: 2, order: 1 }
		],
		poseLibrary: [
			{
				id: 'pose_1',
				name: '抬臂预备',
				joints: {
					j_handR: { position: [0.45, 0.12, 0.12], rotation: [0, 0, 0.7, 0.7], scale: [1, 1, 1] }
				}
			}
		]
	};
}

export function seedCourses(): Course[] {
	const now = new Date().toISOString();
	const base: Array<Partial<Course> & { title: string; voltageLevel: Course['voltageLevel']; workType: Course['workType']; status: Course['status']; instructor: string }> = [
		{ title: '10kV 配电线路带电检测标准流程', voltageLevel: '10kV', workType: '带电检测', status: 'in_review', instructor: '王讲师' },
		{ title: '110kV 等电位更换绝缘子串', voltageLevel: '110kV', workType: '等电位带电作业', status: 'approved', instructor: '李讲师' },
		{ title: '35kV 地电位接引流线操作', voltageLevel: '35kV', workType: '地电位带电作业', status: 'rejected', instructor: '赵讲师' },
		{ title: '220kV 停电检修挂接地线演示', voltageLevel: '220kV', workType: '停电检修', status: 'draft', instructor: '王讲师' }
	];

	return base.map((b, i) => {
		const project = buildSeedProject(b.title, i);
		const course: Course = {
			id: `course_seed${i + 1}`,
			title: b.title,
			voltageLevel: b.voltageLevel,
			workType: b.workType,
			instructor: b.instructor,
			status: b.status,
			currentVersion: i === 2 ? 2 : 1,
			versions: [
				{ version: 1, submittedAt: now, project }
			],
			createdAt: now,
			updatedAt: now
		};
		if (i === 2) {
			// 被退回课件：带逐帧打点意见的第 2 版
			course.versions.push({
				version: 2,
				submittedAt: now,
				project,
				review: {
					decision: 'rejected',
					reviewer: '培训主管-周',
					comment: '第 12 帧右手抬升幅度不足，第 30 帧身体朝向错误，请修正后重新提交。',
					reviewedAt: now,
					annotations: [
						{ id: 'ann_1', frame: 12, text: '右手未达到安全作业高度，对照规程 7.2.3', author: '培训主管-周', createdAt: now, resolved: false },
						{ id: 'ann_2', frame: 30, text: '身体朝向应面向导线侧', author: '培训主管-周', createdAt: now, resolved: false }
					]
				}
			});
		}
		if (i === 1) {
			course.versions[0].review = {
				decision: 'approved',
				reviewer: '培训主管-周',
				comment: '动作规范，通过。',
				reviewedAt: now,
				annotations: []
			};
		}
		return course;
	});
}

export function seedProgress(): ProgressRecord[] {
	const now = new Date().toISOString();
	return [
		{
			id: 'prog_seed1',
			courseId: 'course_seed2',
			student: '学员-张伟',
			percent: 100,
			completed: true,
			scrubFrames: [12, 12, 13, 30, 30, 30, 8],
			lastFrame: 47,
			updatedAt: now
		},
		{
			id: 'prog_seed2',
			courseId: 'course_seed2',
			student: '学员-陈静',
			percent: 62,
			completed: false,
			scrubFrames: [12, 12, 5],
			lastFrame: 29,
			updatedAt: now
		},
		{
			id: 'prog_seed3',
			courseId: 'course_seed1',
			student: '学员-张伟',
			percent: 40,
			completed: false,
			scrubFrames: [7, 7, 7, 13],
			lastFrame: 19,
			updatedAt: now
		}
	];
}
