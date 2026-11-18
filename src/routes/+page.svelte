<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import type { Course } from '$lib/types';

	let courses = $state<Course[]>([]);
	let loading = $state(true);

	onMount(async () => {
		courses = await api.listCourses();
		loading = false;
	});

	const statusClass: Record<string, string> = {
		approved: 'ok',
		in_review: 'review',
		rejected: 'reject',
		draft: 'draft'
	};
	const statusText: Record<string, string> = {
		approved: '已通过',
		in_review: '审核中',
		rejected: '已退回',
		draft: '草稿'
	};
</script>

<div class="hero panel">
	<div>
		<h1 style="margin:0 0 8px">带电作业培训 · 三维人体骨骼动画课件编辑器</h1>
		<p class="muted" style="margin:0;max-width:760px;line-height:1.7">
			导入简化人体网格，在视口中点选关节搭建骨骼树、拖拽调整绑定姿势，画刷涂抹蒙皮权重并自动标红未归一区域；
			姿态库存取、时间轴关键帧（线性 / 贝塞尔 / 阶梯）、动作片段拼接循环、24fps PNG 序列帧与骨架 JSON 导出，
			覆盖讲师制作、主管审片退回、学员播放学情汇总全流程。
		</p>
	</div>
	<a class="cta" href="/editor"><button class="primary">进入编辑器</button></a>
</div>

<div class="grid">
	<a class="entry panel" href="/courses">
		<div class="num">{courses.length}</div>
		<div>课件库<div class="muted small">按电压等级 / 作业类型归类</div></div>
	</a>
	<a class="entry panel" href="/review">
		<div class="num">{courses.filter((c) => c.status === 'in_review').length}</div>
		<div>待审课件<div class="muted small">逐帧打点退回</div></div>
	</a>
	<a class="entry panel" href="/dashboard">
		<div class="num">📊</div>
		<div>学情看板<div class="muted small">完成率与反复拖看帧</div></div>
	</a>
	<a class="entry panel" href="/editor">
		<div class="num">🦴</div>
		<div>新建工程<div class="muted small">骨骼 / 权重 / 动画</div></div>
	</a>
</div>

<div class="panel" style="margin-top:18px">
	<h3>最近课件</h3>
	{#if loading}
		<p class="muted">加载中…</p>
	{:else}
		<table>
			<thead>
				<tr><th>课件</th><th>电压等级</th><th>作业类型</th><th>讲师</th><th>版本</th><th>状态</th><th></th></tr>
			</thead>
			<tbody>
				{#snippet courseRow(c: Course)}
					<tr>
						<td>{c.title}</td>
						<td><span class="tag">{c.voltageLevel}</span></td>
						<td>{c.workType}</td>
						<td>{c.instructor}</td>
						<td>v{c.currentVersion}</td>
						<td><span class="tag {statusClass[c.status]}">{statusText[c.status]}</span></td>
						<td class="row" style="gap:6px">
							<a href="/editor/{c.id}"><button>编辑</button></a>
							<a href="/review/{c.id}"><button>审片</button></a>
							<a href="/player/{c.id}"><button>学习</button></a>
						</td>
					</tr>
				{/snippet}
				{#each courses.slice(0, 6) as c (c.id)}
					{@render courseRow(c)}
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<style>
	.hero {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 20px;
		background: linear-gradient(120deg, #16233a, #121a27 60%);
	}
	.cta {
		white-space: nowrap;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 14px;
		margin-top: 18px;
	}
	.entry {
		display: flex;
		align-items: center;
		gap: 14px;
		color: var(--fg);
	}
	.entry:hover {
		text-decoration: none;
		border-color: var(--accent);
	}
	.num {
		font-size: 30px;
		font-weight: 700;
		color: var(--accent);
		min-width: 52px;
	}
	@media (max-width: 1000px) {
		.grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
