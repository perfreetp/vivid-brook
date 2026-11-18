<script lang="ts">
	import type { Keyframe, Vec2 } from '$lib/types';
	import { cubicBezierEase } from '$lib/engine/interpolation';

	let {
		prev,
		next,
		onChange
	}: {
		prev: Keyframe;
		next: Keyframe;
		onChange: (outHandle: Vec2, inHandle: Vec2) => void;
	} = $props();

	const SIZE = 240;
	const PAD = 26;
	let canvas = $state<HTMLCanvasElement | null>(null);
	let dragging: 'out' | 'in' | null = $state(null);

	function toPx(p: Vec2): [number, number] {
		return [PAD + p[0] * (SIZE - PAD * 2), SIZE - PAD - p[1] * (SIZE - PAD * 2)];
	}
	function fromPx(x: number, y: number): Vec2 {
		const u = Math.max(0, Math.min(1, (x - PAD) / (SIZE - PAD * 2)));
		const v = Math.max(0, Math.min(1, 1 - (y - PAD) / (SIZE - PAD * 2)));
		return [+u.toFixed(3), +v.toFixed(3)];
	}

	function draw() {
		const cv = canvas;
		if (!cv) return;
		const ctx = cv.getContext('2d')!;
		ctx.clearRect(0, 0, SIZE, SIZE);
		// 背景网格
		ctx.strokeStyle = '#232c3b';
		ctx.lineWidth = 1;
		for (let i = 0; i <= 4; i++) {
			const x = PAD + (i / 4) * (SIZE - PAD * 2);
			const y = PAD + (i / 4) * (SIZE - PAD * 2);
			ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, SIZE - PAD); ctx.stroke();
			ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(SIZE - PAD, y); ctx.stroke();
		}
		// 对角线参考
		ctx.strokeStyle = '#33415a';
		ctx.setLineDash([4, 4]);
		ctx.beginPath();
		ctx.moveTo(PAD, SIZE - PAD);
		ctx.lineTo(SIZE - PAD, PAD);
		ctx.stroke();
		ctx.setLineDash([]);

		const [x0, y0] = toPx([0, 0]);
		const [x1, y1] = toPx(prev.outHandle);
		const [x2, y2] = toPx(next.inHandle);
		const [x3, y3] = toPx([1, 1]);

		// 手柄连线
		ctx.strokeStyle = '#8fa1b8';
		ctx.beginPath();
		ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
		ctx.moveTo(x3, y3); ctx.lineTo(x2, y2);
		ctx.stroke();

		// 贝塞尔曲线本体
		ctx.strokeStyle = '#2f81f7';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(x0, y0);
		ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
		ctx.stroke();
		ctx.lineWidth = 1;

		// 端点
		ctx.fillStyle = '#e6edf6';
		ctx.beginPath(); ctx.arc(x0, y0, 4, 0, Math.PI * 2); ctx.fill();
		ctx.beginPath(); ctx.arc(x3, y3, 4, 0, Math.PI * 2); ctx.fill();

		// 拖动手柄
		ctx.fillStyle = '#00c2a8';
		ctx.beginPath(); ctx.arc(x1, y1, 6, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = '#f5a623';
		ctx.beginPath(); ctx.arc(x2, y2, 6, 0, Math.PI * 2); ctx.fill();

		ctx.fillStyle = '#8fa1b8';
		ctx.font = '11px sans-serif';
		ctx.fillText(`帧 ${prev.frame}`, PAD, SIZE - 8);
		ctx.fillText(`帧 ${next.frame}`, SIZE - PAD - 34, SIZE - 8);
		ctx.fillText('缓动 →', PAD, 14);
	}

	$effect(() => {
		// 依赖关键帧手柄变化时重绘
		void prev.outHandle;
		void next.inHandle;
		draw();
	});

	function pointerPos(e: PointerEvent): [number, number] {
		const rect = canvas!.getBoundingClientRect();
		return [e.clientX - rect.left, e.clientY - rect.top];
	}

	function onDown(e: PointerEvent) {
		const [px, py] = pointerPos(e);
		const [ox, oy] = toPx(prev.outHandle);
		const [ix, iy] = toPx(next.inHandle);
		if (Math.hypot(px - ox, py - oy) < 12) dragging = 'out';
		else if (Math.hypot(px - ix, py - iy) < 12) dragging = 'in';
	}
	function onMove(e: PointerEvent) {
		if (!dragging) return;
		const [px, py] = pointerPos(e);
		const p = fromPx(px, py);
		if (dragging === 'out') onChange(p, next.inHandle);
		else onChange(prev.outHandle, p);
	}
	function onUp() {
		dragging = null;
	}

	// 预览几个采样值
	const samples = $derived([0.25, 0.5, 0.75].map((t) => ({ t, y: cubicBezierEase(t, prev.outHandle, next.inHandle) })));
</script>

<div class="bezier">
	<canvas
		bind:this={canvas}
		width={SIZE}
		height={SIZE}
		onpointerdown={onDown}
		onpointermove={onMove}
		onpointerup={onUp}
		onpointerleave={onUp}
	></canvas>
	<div class="legend small muted">
		<div><span class="swatch teal"></span>出柄（帧 {prev.frame}）：({prev.outHandle[0]}, {prev.outHandle[1]})</div>
		<div><span class="swatch amber"></span>入柄（帧 {next.frame}）：({next.inHandle[0]}, {next.inHandle[1]})</div>
		<div style="margin-top:6px">
			采样：{#each samples as s}<span class="chip">t={s.t} → {s.y.toFixed(2)}</span>{/each}
		</div>
	</div>
</div>

<style>
	canvas {
		background: #0f1620;
		border: 1px solid var(--border);
		border-radius: 8px;
		touch-action: none;
		cursor: crosshair;
	}
	.legend {
		margin-top: 8px;
		line-height: 1.9;
	}
	.swatch {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		margin-right: 5px;
	}
	.teal {
		background: #00c2a8;
	}
	.amber {
		background: #f5a623;
	}
	.chip {
		display: inline-block;
		background: var(--bg-3);
		border-radius: 5px;
		padding: 1px 7px;
		margin-right: 6px;
	}
</style>
