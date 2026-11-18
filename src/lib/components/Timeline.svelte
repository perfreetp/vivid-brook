<script lang="ts">
	import type { BoneTrack, Clip, InterpMode } from '$lib/types';

	let {
		tracks,
		clips,
		durationFrames,
		currentFrame,
		selectedJointId,
		selectedKeyId,
		onSeek,
		onAddKey,
		onSelectKey,
		onMoveKey,
		onDeleteKey,
		onSetInterp
	}: {
		tracks: BoneTrack[];
		clips: Clip[];
		durationFrames: number;
		currentFrame: number;
		selectedJointId: string | null;
		selectedKeyId: string | null;
		onSeek: (frame: number) => void;
		onAddKey: (frame: number) => void;
		onSelectKey: (jointId: string, keyId: string) => void;
		onMoveKey: (jointId: string, keyId: string, frame: number) => void;
		onDeleteKey: (jointId: string, keyId: string) => void;
		onSetInterp: (jointId: string, keyId: string, interp: InterpMode) => void;
	} = $props();

	const RULER_H = 26;
	const ROW_H = 34;
	const LABEL_W = 130;
	let trackAreaWidth = $state(900);
	let dragKey: { jointId: string; keyId: string; startX: number; startFrame: number } | null = null;
	let scrubbing = false;

	const interpColor: Record<InterpMode, string> = {
		linear: '#2f81f7',
		bezier: '#00c2a8',
		step: '#f5a623'
	};
	const interpLabel: Record<InterpMode, string> = { linear: '线性', bezier: '贝塞尔', step: '阶梯' };

	function frameX(frame: number) {
		return (frame / Math.max(1, durationFrames - 1)) * trackAreaWidth;
	}
	function xFrame(x: number) {
		return Math.round((x / trackAreaWidth) * Math.max(1, durationFrames - 1));
	}

	function rulerTicks() {
		const step = durationFrames > 120 ? 12 : durationFrames > 60 ? 6 : 4;
		const ticks: number[] = [];
		for (let f = 0; f < durationFrames; f += step) ticks.push(f);
		return ticks;
	}

	function clipBars() {
		const ordered = [...clips].sort((a, b) => a.order - b.order);
		let cursor = 0;
		return ordered.map((c) => {
			const len = (c.endFrame - c.startFrame + 1) * c.loopCount;
			const bar = { id: c.id, name: c.name, x: frameX(cursor), w: (len / durationFrames) * trackAreaWidth, loops: c.loopCount };
			cursor += len;
			return bar;
		});
	}

	function trackPointer(e: PointerEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return e.clientX - rect.left;
	}

	function startScrub(e: PointerEvent) {
		scrubbing = true;
		onSeek(Math.max(0, Math.min(durationFrames - 1, xFrame(trackPointer(e)))));
	}
	function moveScrub(e: PointerEvent) {
		if (!scrubbing) return;
		onSeek(Math.max(0, Math.min(durationFrames - 1, xFrame(trackPointer(e)))));
	}
	function endScrub() {
		scrubbing = false;
	}

	function startKeyDrag(e: PointerEvent, jointId: string, keyId: string, frame: number) {
		e.stopPropagation();
		onSelectKey(jointId, keyId);
		dragKey = { jointId, keyId, startX: e.clientX, startFrame: frame };
		const move = (ev: PointerEvent) => {
			if (!dragKey) return;
			const dx = ev.clientX - dragKey.startX;
			const df = xFrame(dx + frameX(dragKey.startFrame)) - dragKey.startFrame;
			onMoveKey(dragKey.jointId, dragKey.keyId, Math.max(0, Math.min(durationFrames - 1, dragKey.startFrame + df)));
		};
		const up = () => {
			dragKey = null;
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	let areaEl: HTMLDivElement | null = $state(null);
	$effect(() => {
		if (!areaEl) return;
		const ro = new ResizeObserver(() => {
			trackAreaWidth = Math.max(300, areaEl!.clientWidth);
		});
		ro.observe(areaEl);
		trackAreaWidth = Math.max(300, areaEl.clientWidth);
		return () => ro.disconnect();
	});
</script>

<div class="timeline">
	<div class="ruler-row" style="height:{RULER_H}px">
		<div class="label-cell" style="width:{LABEL_W}px">片段 / 骨骼轨道</div>
		<div class="track-area" bind:this={areaEl} role="slider" tabindex="0" aria-label="时间轴播放头" aria-valuemin="0" aria-valuemax={durationFrames - 1} aria-valuenow={currentFrame} onpointerdown={startScrub} onpointermove={moveScrub} onpointerup={endScrub} onpointerleave={endScrub}>
			{#each rulerTicks() as f}
				<div class="tick" style="left:{frameX(f)}px"><span>{f}</span></div>
			{/each}
			{#each clipBars() as bar (bar.id)}
				<div class="clip-bar" style="left:{bar.x}px;width:{Math.max(20, bar.w - 4)}px" title={`${bar.name} ×${bar.loops}`}>
					{bar.name}{bar.loops > 1 ? ` ×${bar.loops}` : ''}
				</div>
			{/each}
			<div class="playhead" style="left:{frameX(currentFrame)}px"></div>
		</div>
	</div>

	{#each tracks as track (track.jointId)}
		<div class="track-row" class:muted={selectedJointId && selectedJointId !== track.jointId} style="height:{ROW_H}px">
			<div class="label-cell" style="width:{LABEL_W}px" title={track.jointId}>
				<span class="bone-dot" style="background:{interpColor.linear}"></span>
				{track.keys.length > 0 ? track.jointId.replace('j_', '骨·') : track.jointId}
				<span class="keycount">{track.keys.length} 帧</span>
			</div>
			<div class="track-area" role="button" aria-label="轨道点击跳转" tabindex="0" onpointerdown={(e) => onSeek(xFrame(trackPointer(e)))}>
				<div class="gridline" style="left:{frameX(currentFrame)}px"></div>
				{#each [...track.keys].sort((a, b) => a.frame - b.frame) as key, i (key.id)}
					{@const nextKey = [...track.keys].sort((a, b) => a.frame - b.frame)[i + 1]}
					{#if nextKey}
						<svg class="seg" style="left:{frameX(key.frame)}px;width:{frameX(nextKey.frame) - frameX(key.frame)}px;height:100%">
							<line x1="0" y1="{ROW_H / 2}" x2="100%" y2="{ROW_H / 2}" stroke={interpColor[key.interp]} stroke-width="2"
								stroke-dasharray={key.interp === 'step' ? '5 4' : key.interp === 'bezier' ? '2 3' : 'none'} />
						</svg>
					{/if}
					<button
						class="key"
						class:sel={selectedKeyId === key.id}
						style="left:{frameX(key.frame)}px;background:{interpColor[key.interp]}"
						title={`帧 ${key.frame} · ${interpLabel[key.interp]}`}
						onpointerdown={(e) => startKeyDrag(e, track.jointId, key.id, key.frame)}
						oncontextmenu={(e) => {
							e.preventDefault();
							onDeleteKey(track.jointId, key.id);
						}}
					></button>
				{/each}
			</div>
		</div>
	{/each}
	{#if tracks.length === 0}
		<div class="muted small" style="padding:14px">先在视口中创建骨骼，再在当前帧打关键帧。</div>
	{/if}

	<div class="tl-actions">
		<button onclick={() => onAddKey(currentFrame)}>◆ 在帧 {currentFrame} 打关键帧</button>
		<span class="muted small">拖动菱形改帧号 · 右键删除 · 点击轨道跳转</span>
		<div class="spacer"></div>
		{#if selectedKeyId}
			<span class="small muted">选中关键帧插值：</span>
			{#each (['linear', 'bezier', 'step'] as InterpMode[]) as mode}
				<button
					class:toggled={tracks.some((t) => t.keys.some((k) => k.id === selectedKeyId && k.interp === mode))}
					onclick={() => {
						const t = tracks.find((tr) => tr.keys.some((k) => k.id === selectedKeyId));
						const k = t?.keys.find((kk) => kk.id === selectedKeyId);
						if (t && k) onSetInterp(t.jointId, k.id, mode);
					}}
				>
					{interpLabel[mode]}
				</button>
			{/each}
		{/if}
	</div>
</div>

<style>
	.timeline {
		background: var(--bg-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		overflow: hidden;
	}
	.ruler-row,
	.track-row {
		display: flex;
		align-items: stretch;
		border-bottom: 1px solid var(--border);
	}
	.label-cell {
		flex: none;
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 0 10px;
		background: var(--bg-3);
		border-right: 1px solid var(--border);
		font-size: 12.5px;
		overflow: hidden;
		white-space: nowrap;
	}
	.bone-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex: none;
	}
	.keycount {
		color: var(--fg-dim);
		font-size: 11px;
		margin-left: auto;
	}
	.track-area {
		position: relative;
		flex: 1;
		cursor: pointer;
	}
	.tick {
		position: absolute;
		top: 0;
		bottom: 0;
		border-left: 1px solid #232c3b;
		pointer-events: none;
	}
	.tick span {
		position: absolute;
		top: 5px;
		left: 4px;
		font-size: 10px;
		color: var(--fg-dim);
	}
	.clip-bar {
		position: absolute;
		top: 14px;
		height: 10px;
		background: rgba(0, 194, 168, 0.35);
		border: 1px solid rgba(0, 194, 168, 0.7);
		border-radius: 4px;
		font-size: 9px;
		color: var(--fg);
		overflow: hidden;
		white-space: nowrap;
		padding: 0 4px;
		line-height: 9px;
		pointer-events: none;
	}
	.playhead,
	.gridline {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--danger);
		pointer-events: none;
		z-index: 5;
	}
	.track-row.muted {
		opacity: 0.55;
	}
	.seg {
		position: absolute;
		top: 0;
		pointer-events: none;
	}
	.key {
		position: absolute;
		top: 50%;
		transform: translate(-50%, -50%) rotate(45deg);
		width: 12px;
		height: 12px;
		padding: 0;
		border: 1px solid #fff8;
		border-radius: 2px;
		z-index: 4;
		cursor: grab;
	}
	.key.sel {
		box-shadow: 0 0 0 2px #fff;
	}
	.tl-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 9px 12px;
		background: var(--bg);
		flex-wrap: wrap;
	}
</style>
