<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { ViewportEngine } from '$lib/engine/viewport';
	import { buildBuiltinHumanoid } from '$lib/engine/mesh';
import { AnimationPlayer } from '$lib/engine/player';
	import { expandSegments, samplePoseAt } from '$lib/engine/timeline';
	import { api } from '$lib/api';
	import { deepClone } from '$lib/engine/clone';
	import type { Course, FrameAnnotation } from '$lib/types';

	let course = $state<Course | null>(null);
	let viewportEl: HTMLDivElement | null = $state(null);
	let engine = $state<ViewportEngine | null>(null);
	let player = $state<AnimationPlayer | null>(null);
	let currentFrame = $state(0);
	let isPlaying = $state(false);
	let annotations = $state<FrameAnnotation[]>([]);
	let draftText = $state('');
	let draftFrame = $state(0);
	let reviewer = $state('培训主管-周');
	let overallComment = $state('');
	let decisionDone = $state('');
	let err = $state('');

	const project = $derived(course ? course.versions.find((v) => v.version === course!.currentVersion)!.project : null);
	const headReview = $derived(course?.versions.find((v) => v.version === course!.currentVersion)?.review ?? null);

	// 先取课件数据（含历史打点意见）
	onMount(() => {
		(async () => {
			try {
				course = await api.getCourse(page.params.id!);
				const head = course.versions.find((v) => v.version === course!.currentVersion)!;
				annotations = deepClone(head.review?.annotations ?? []);
				overallComment = head.review?.comment ?? '';
			} catch (e) {
				err = (e as Error).message;
			}
		})();
	});

	// 视口 div 在 {#if} 内，数据就绪渲染后由 $effect 感知挂载再建引擎
	// 引擎实例用普通变量持有，effect 只追踪元素挂载与数据就绪布尔，避免帧更新触发 cleanup 销毁
	let engineInstance: ViewportEngine | null = null;
	let canvasAnchor: HTMLSpanElement | null = $state(null);

	$effect(() => {
		const el = viewportEl;
		const ready = project !== null;
		if (!el || !ready || engineInstance) return;
		const p = project;

		let localEngine: ViewportEngine | null = null;
		untrack(() => {
			localEngine = new ViewportEngine(el);
			engineInstance = localEngine;
			engine = localEngine;
			localEngine!.setGeometry(buildBuiltinHumanoid());
			localEngine!.setSkeleton(p.skeleton);
			localEngine!.setWeights(p.weights);
			localEngine!.setPlayMode(true);
			localEngine!.frameCamera();

			player = new AnimationPlayer(p, (frame: number, pose: Record<string, import('$lib/types').JointTransform>) => {
				currentFrame = frame;
				engineInstance!.applyAnimatedPose(pose);
			}, () => (isPlaying = false));
			localEngine!.applyAnimatedPose(samplePoseAt(p.skeleton, p.tracks, 0, expandSegments(p.clips)));
		});

		return () => {
			localEngine?.dispose();
			engineInstance = null;
		};
	});

	// canvas 插到模板锚点前，进入 Svelte 受管位置（追踪响应式 engine 以触发重跑）
	$effect(() => {
		const eng = engine;
		const anchor = canvasAnchor;
		if (eng && anchor && !eng.canvas.parentElement) {
			anchor.parentElement?.insertBefore(eng.canvas, anchor);
			eng.resize();
		}
	});

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
	function seekFrame(f: number) {
		player?.seek(f);
		draftFrame = f;
	}
	function markFrame() {
		if (!draftText.trim()) return;
		annotations = [
			...annotations,
			{
				id: `ann_${crypto.randomUUID().slice(0, 8)}`,
				frame: currentFrame,
				text: draftText.trim(),
				author: reviewer,
				createdAt: new Date().toISOString(),
				resolved: false
			}
		];
		draftText = '';
	}
	function removeAnnotation(id: string) {
		annotations = annotations.filter((a) => a.id !== id);
	}

	async function decide(decision: 'approved' | 'rejected') {
		if (!course || !player) return;
		if (decision === 'rejected' && annotations.length === 0) {
			err = '退回前至少在一个帧上打点写明修改意见';
			return;
		}
		err = '';
		try {
			const updated = await api.review(course.id, {
				decision,
				reviewer,
				comment: overallComment,
				annotations
			});
			course = updated;
			decisionDone = decision === 'approved' ? '已通过，课件对学员开放' : '已退回，讲师可在编辑器中修改并重新提交新版本';
		} catch (e) {
			err = (e as Error).message;
		}
	}

	$effect(() => {
		if (player) draftFrame = currentFrame;
	});
</script>

{#if err && !course}
	<div class="panel danger-text">{err}</div>
{:else}
	<div class="review-layout">
		<div>
			<!-- 视口容器始终挂载（bind:this 不能放在依赖数据的 {#if} 内，否则 $effect 永远等不到元素） -->
			<div class="panel" style="padding:0;overflow:hidden;position:relative">
				<div bind:this={viewportEl} style="height:460px;position:relative">
					<span bind:this={canvasAnchor} style="display:none"></span>
				</div>
				{#if !course || !player || !project}
					<div class="loading-mask muted">载入审片工作台…</div>
				{:else}
					<div class="hud">
						<span class="tag">帧 <b>{currentFrame}</b> / {player.totalFrames - 1}</span>
						<span class="tag">{project.meta.fps} fps</span>
						{#if annotations.some((a) => a.frame === currentFrame)}
							<span class="tag reject">本帧有 {annotations.filter((a) => a.frame === currentFrame).length} 条意见</span>
						{/if}
					</div>
				{/if}
			</div>

			{#if course && player && project}
			<div class="panel" style="margin-top:12px">
				<div class="row" style="margin-bottom:10px">
					<button class="primary" onclick={togglePlay}>{isPlaying ? '⏸ 暂停' : '▶ 播放'}</button>
					<button onclick={() => player?.stop()}>⏹</button>
					<button onclick={() => seekFrame(currentFrame - 1)}>上一帧</button>
					<button onclick={() => seekFrame(currentFrame + 1)}>下一帧</button>
					<div class="spacer"></div>
					<input type="range" min="0" max={player.totalFrames - 1} value={currentFrame} oninput={(e) => seekFrame(+(e.currentTarget as HTMLInputElement).value)} style="flex:1" />
				</div>

				<!-- 帧打点轨道 -->
				<div class="mark-track">
					{#each annotations as a (a.id)}
						<button
							class="mark"
							class:active={a.frame === currentFrame}
							style={`left:${(a.frame / Math.max(1, player.totalFrames - 1)) * 100}%`}
							title={`帧 ${a.frame}：${a.text}`}
							onclick={() => seekFrame(a.frame)}
						>
							📍{a.frame}
						</button>
					{/each}
				</div>
			</div>

			<div class="panel" style="margin-top:12px">
				<h3>在当前帧打点写意见</h3>
				<div class="row" style="align-items:flex-start">
					<div class="col" style="flex:1;gap:8px">
						<textarea rows="3" bind:value={draftText} placeholder="例如：第 {currentFrame} 帧右手抬升幅度不足，对照规程 7.2.3"></textarea>
						<div class="row">
							<label class="small muted">定位帧 <input type="number" bind:value={draftFrame} min="0" max={player.totalFrames - 1} style="width:80px" /></label>
							<button onclick={() => seekFrame(draftFrame)}>跳转</button>
							<button class="primary" onclick={markFrame}>打点（帧 {currentFrame}）</button>
						</div>
					</div>
				</div>

				<div class="anno-list">
					{#each [...annotations].sort((a, b) => a.frame - b.frame) as a (a.id)}
						<div class="anno">
							<button class="frame-jump" onclick={() => seekFrame(a.frame)}>帧 {a.frame}</button>
							<span style="flex:1">{a.text}</span>
							<span class="small muted">{a.author}</span>
							<button class="danger" onclick={() => removeAnnotation(a.id)}>删除</button>
						</div>
					{/each}
					{#if annotations.length === 0}<p class="muted small">暂无打点意见</p>{/if}
				</div>
			</div>
			{/if}
		</div>

		{#if course}
		<div class="side col">
			<div class="panel">
				<h3>课件信息 · v{course.currentVersion}</h3>
				<p class="small" style="line-height:2">
					<span class="tag">{course.voltageLevel}</span> <span class="tag">{course.workType}</span><br />
					讲师：{course.instructor}<br />
					状态：
					{course.status === 'in_review' ? '审核中' : course.status === 'approved' ? '已通过' : course.status === 'rejected' ? '已退回' : '草稿'}
				</p>
				{#if headReview}
					<div class="small muted" style="border-top:1px solid var(--border);padding-top:8px">
						上轮审核：{headReview.decision === 'approved' ? '通过' : '退回'}（{headReview.reviewer}）
					</div>
				{/if}
			</div>

			<div class="panel">
				<h3>审片结论</h3>
				<label class="small muted col" style="gap:6px">
					审核人
					<input bind:value={reviewer} />
					总体意见
					<textarea rows="4" bind:value={overallComment} placeholder="通过或退回的总体说明"></textarea>
				</label>
				<div class="col" style="gap:8px;margin-top:10px">
					<button class="primary" onclick={() => decide('approved')}>✓ 审核通过</button>
					<button class="danger" onclick={() => decide('rejected')}>↩ 退回讲师修改（重新提交生成新版本）</button>
				</div>
				{#if err}<p class="danger-text small">{err}</p>{/if}
				{#if decisionDone}<p class="tag ok" style="margin-top:8px">{decisionDone}</p>{/if}
			</div>

			<div class="panel">
				<h3>版本记录</h3>
				{#each course.versions as v (v.version)}
					<div class="version-row">
						<b>v{v.version}</b>
						<span class="small muted">{new Date(v.submittedAt).toLocaleString('zh-CN')}</span>
						{#if v.review}
							<span class="tag {v.review.decision === 'approved' ? 'ok' : 'reject'}">
								{v.review.decision === 'approved' ? '通过' : '退回'} · {v.review.annotations.length} 条打点
							</span>
						{:else}
							<span class="tag review">待审</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
		{/if}
	</div>
{/if}

<style>
	.review-layout {
		display: grid;
		grid-template-columns: 1fr 320px;
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
	.mark-track {
		position: relative;
		height: 34px;
		background: var(--bg);
		border-radius: 6px;
		border: 1px solid var(--border);
	}
	.mark {
		position: absolute;
		transform: translateX(-50%);
		top: 4px;
		padding: 2px 7px;
		font-size: 11px;
		background: rgba(240, 80, 99, 0.18);
		border-color: var(--danger);
		color: var(--danger);
	}
	.mark.active {
		background: var(--danger);
		color: #fff;
	}
	.anno-list {
		margin-top: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 220px;
		overflow: auto;
	}
	.anno {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 7px 9px;
	}
	.frame-jump {
		padding: 2px 8px;
		font-size: 12px;
		flex: none;
	}
	.version-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 0;
		border-bottom: 1px solid var(--border);
		flex-wrap: wrap;
	}
	@media (max-width: 1150px) {
		.review-layout {
			grid-template-columns: 1fr;
		}
	}
</style>
