<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import * as THREE from 'three';
	import { ViewportEngine } from '$lib/engine/viewport';
	import { buildBuiltinHumanoid } from '$lib/engine/mesh';
	import { AnimationPlayer } from '$lib/engine/player';
	import { jointWorldPosition } from '$lib/engine/skeleton';
	import { expandSegments, samplePoseAt } from '$lib/engine/timeline';
	import { api } from '$lib/api';
	import type { Course, JointTransform } from '$lib/types';

	let course = $state<Course | null>(null);
	let viewportEl: HTMLDivElement | null = $state(null);
	let canvasAnchor: HTMLSpanElement | null = $state(null);
	let engine = $state<ViewportEngine | null>(null);
	let player = $state<AnimationPlayer | null>(null);
	let currentFrame = $state(0);
	let percent = $state(0);
	let segmentName = $state('—');
	let jointId = $state<string | null>(null);
	let isPlaying = $state(false);
	let studentName = $state('学员-张伟');
	let showTraj = $state(true);
	let reported = $state(false);
	let errorMsg = $state('');

	const project = $derived(course ? course.versions.find((v) => v.version === course!.currentVersion)!.project : null);

	// 先取课件数据；视口 div 在 {#if} 内，需等数据就绪渲染后再用 $effect 感知其挂载
	onMount(() => {
		(async () => {
			try {
				course = await api.getCourse(page.params.id!);
			} catch (err) {
				errorMsg = (err as Error).message;
			}
		})();
	});

	// 引擎实例保存在普通变量，init effect 不读不写 $state 的 engine，避免自触发重跑导致 cleanup 销毁
	let engineInstance: ViewportEngine | null = null;

	$effect(() => {
		// 依赖只保留「元素挂载」与「数据就绪」；所有 $state 写入放进 untrack，
		// 防止构造引擎时写状态触发本 effect 重跑而立刻 cleanup 销毁引擎
		const el = viewportEl;
		const ready = project !== null;
		if (!el || !ready || engineInstance) return;
		const p = project;

		let localEngine: ViewportEngine | null = null;
		untrack(() => {
			try {
				localEngine = new ViewportEngine(el);
				engineInstance = localEngine;
				engine = localEngine;
				const geo = buildBuiltinHumanoid();
				localEngine!.setGeometry(geo);
				localEngine!.setSkeleton(p.skeleton);
				localEngine!.setWeights(p.weights);
				localEngine!.setPlayMode(true);
				localEngine!.frameCamera();
				jointId = p.skeleton.joints[1]?.id ?? p.skeleton.joints[0]?.id ?? null;
				if (jointId) localEngine!.selectJoint(jointId);

				player = new AnimationPlayer(
					p,
					(frame, pose) => {
						currentFrame = frame;
						percent = player!.percent;
						segmentName = player!.currentSegmentName;
						engineInstance!.applyAnimatedPose(pose);
						if (showTraj && jointId) updateTrajectory(frame, pose);
					},
					() => {
						percent = 100;
						isPlaying = false;
						report(true);
					}
				);
				// 首帧
				localEngine!.applyAnimatedPose(samplePoseAt(p.skeleton, p.tracks, 0, expandSegments(p.clips)));
			} catch (e) {
				console.error('[player-effect] init failed', e);
				errorMsg = (e as Error).message;
			}
		});

		return () => {
			localEngine?.dispose();
			engineInstance = null;
		};
	});

	$effect(() => {
		// 追踪响应式 engine（engineInstance 是普通变量不会触发重跑）；就绪后把 canvas 插到模板锚点前
		const eng = engine;
		const anchor = canvasAnchor;
		if (eng && anchor && !eng.canvas.parentElement) {
			anchor.parentElement?.insertBefore(eng.canvas, anchor);
			eng.resize();
		}
	});

	function updateTrajectory(frame: number, _pose: Record<string, JointTransform>) {
		if (!player || !engine || !jointId || !project) return;
		const pts: [number, number, number][] = [];
		const segs = expandSegments(project.clips);
		for (let f = 0; f <= frame; f++) {
			const pose = samplePoseAt(project.skeleton, project.tracks, f, segs);
			pts.push(jointWorldPosition(project.skeleton, pose, jointId));
		}
		engine.showTrajectory(pts);
	}

	function togglePlay() {
		if (!player) return;
		if (player.playing) {
			player.pause();
			isPlaying = false;
		} else {
			player.play();
			isPlaying = true;
		}
	}
	function stop() {
		player?.stop();
		isPlaying = false;
	}
	function onScrub(e: Event) {
		const frame = +(e.currentTarget as HTMLInputElement).value;
		player?.seek(frame, true);
	}
	function selectJoint(e: Event) {
		jointId = (e.currentTarget as HTMLSelectElement).value || null;
		if (player && engine && jointId) updateTrajectory(player.frame, {} as Record<string, JointTransform>);
		if (!jointId) engine?.clearTrajectory();
	}

	async function report(completed = false) {
		if (!player || !course || reported) return;
		if (!completed && player.percent < 95) return; // 未到结尾不做完成上报，仅在手动按钮时上报进度
		reported = true;
		await api.reportProgress({
			courseId: course.id,
			student: studentName,
			percent: player.percent,
			completed: completed || player.percent >= 100,
			scrubFrames: player.scrubbedFrames,
			lastFrame: player.frame
		});
		setTimeout(() => (reported = false), 3000);
	}
</script>

{#if errorMsg}
	<div class="panel danger-text">加载失败：{errorMsg}</div>
{:else}
	<div class="player-layout">
		<!-- 视口容器始终挂载（bind:this 不能放在依赖数据的 {#if} 内，否则 $effect 永远等不到元素） -->
		<div class="viewport-wrap panel" style="padding:0;overflow:hidden;position:relative">
			<div bind:this={viewportEl} style="height:480px;position:relative">
				<span bind:this={canvasAnchor} style="display:none"></span>
			</div>
			{#if !course || !player}
				<div class="loading-mask muted">正在载入播放器…</div>
			{:else}
				<div class="hud">
					<span class="tag">帧 <b>{currentFrame}</b> / {player.totalFrames - 1}</span>
					<span class="tag ok">完成率 {percent}%</span>
					<span class="tag review">片段：{segmentName}</span>
					{#if jointId}<span class="tag">轨迹骨骼：{project!.skeleton.joints.find((j) => j.id === jointId)?.name ?? jointId}</span>{/if}
				</div>
			{/if}
		</div>

		<div class="side col">
			<div class="panel">
				<h3>播放控制（24fps）</h3>
				<div class="row" style="margin-bottom:12px">
					<button class="primary" onclick={togglePlay} disabled={!player}>{isPlaying ? '⏸ 暂停' : '▶ 播放'}</button>
					<button onclick={stop} disabled={!player}>⏹ 停止</button>
				</div>
				<label class="small muted col" style="gap:6px">
					拖动时间轴（拖看行为会被记录到看板）
					<input type="range" min="0" max={player ? player.totalFrames - 1 : 0} value={currentFrame} oninput={onScrub} />
				</label>
			</div>

			<div class="panel">
				<h3>轨迹显示</h3>
				<label class="small muted col" style="gap:8px">
					<select onchange={selectJoint}>
						<option value="">不显示轨迹</option>
						{#each project?.skeleton.joints ?? [] as j (j.id)}
							<option value={j.id} selected={j.id === jointId}>{j.name}</option>
						{/each}
					</select>
					<label class="row"><input type="checkbox" bind:checked={showTraj} /> 播放时实时绘制轨迹</label>
					<button onclick={() => engine?.clearTrajectory()}>清除轨迹线</button>
				</label>
			</div>

			<div class="panel">
				<h3>学情上报</h3>
				<label class="small muted col" style="gap:8px">
					学员姓名
					<input bind:value={studentName} />
					<span>已记录拖看帧 {player?.scrubbedFrames.length ?? 0} 次</span>
					<button onclick={() => report(false)}>立即上报进度</button>
					{#if reported}<span class="tag ok">已上报到学情看板</span>{/if}
				</label>
			</div>
		</div>
	</div>
{/if}

<style>
	.player-layout {
		display: grid;
		grid-template-columns: 1fr 300px;
		gap: 14px;
	}
	.hud {
		position: absolute;
		top: 10px;
		left: 10px;
		display: flex;
		gap: 8px;
		pointer-events: none;
	}
	.loading-mask {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(13, 17, 23, 0.7);
	}
	@media (max-width: 1100px) {
		.player-layout {
			grid-template-columns: 1fr;
		}
	}
</style>
