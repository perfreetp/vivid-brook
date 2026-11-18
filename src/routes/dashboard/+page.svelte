<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import type { DashboardStats } from '$lib/types';

	let stats = $state<DashboardStats | null>(null);
	onMount(async () => {
		stats = await api.dashboard();
	});

	const statusText: Record<string, string> = { approved: '已通过', in_review: '审核中', rejected: '已退回', draft: '草稿' };
</script>

{#if !stats}
	<p class="muted">加载中…</p>
{:else}
	<div class="cards">
		<div class="panel card"><div class="k">课件总数</div><div class="v">{stats.totalCourses}</div></div>
		<div class="panel card"><div class="k">审核队列</div><div class="v warn">{stats.reviewQueue.length}</div></div>
		<div class="panel card"><div class="k">已通过</div><div class="v ok">{stats.byStatus.approved ?? 0}</div></div>
		<div class="panel card"><div class="k">被退回</div><div class="v danger">{stats.byStatus.rejected ?? 0}</div></div>
	</div>

	<div class="two-col">
		<div class="panel">
			<h3>按电压等级分布</h3>
			{#each Object.entries(stats.byVoltage) as [level, count]}
				<div class="bar-row">
					<span class="label">{level}</span>
					<div class="bar"><div class="fill" style={`width:${stats.totalCourses ? (count / stats.totalCourses) * 100 : 0}%`}></div></div>
					<span class="count">{count}</span>
				</div>
			{/each}
		</div>
		<div class="panel">
			<h3>按作业类型分布</h3>
			{#each Object.entries(stats.byWorkType) as [type, count]}
				<div class="bar-row">
					<span class="label" style="width:110px">{type}</span>
					<div class="bar"><div class="fill teal" style={`width:${stats.totalCourses ? (count / stats.totalCourses) * 100 : 0}%`}></div></div>
					<span class="count">{count}</span>
				</div>
			{/each}
		</div>
	</div>

	<div class="panel" style="margin-top:16px">
		<h3>审核流程状态</h3>
		<div class="row" style="gap:18px;flex-wrap:wrap">
			{#each Object.entries(stats.byStatus) as [s, n]}
				<div class="status-pill"><span class="tag {s === 'approved' ? 'ok' : s === 'in_review' ? 'review' : s === 'rejected' ? 'reject' : 'draft'}">{statusText[s]}</span> <b>{n}</b></div>
			{/each}
		</div>
	</div>

	<div class="panel" style="margin-top:16px">
		<h3>学员播放完成率与反复拖看帧汇总</h3>
		<table>
			<thead>
				<tr><th>学员</th><th>课件</th><th>完成率</th><th>是否完成</th><th>拖看次数</th><th>反复查看的帧（次数）</th></tr>
			</thead>
			<tbody>
				{#each stats.studentRows as row}
					<tr>
						<td>{row.student}</td>
						<td>{row.courseTitle}</td>
						<td>
							<div class="progress"><div style={`width:${row.percent}%`} class="pfill"></div></div>
							<span class="small">{row.percent}%</span>
						</td>
						<td>
							{#if row.completed}
								<span class="tag ok">已完成</span>
							{:else}
								<span class="tag draft">未完成</span>
							{/if}
						</td>
						<td>{row.scrubCount}</td>
						<td class="small">
							{#each row.topFrames as f}<span class="frame-chip">帧 {f.frame} ×{f.count}</span>{/each}
							{#if row.topFrames.length === 0}<span class="muted">无拖看</span>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.cards {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 14px;
	}
	.card .k {
		color: var(--fg-dim);
		font-size: 13px;
	}
	.card .v {
		font-size: 32px;
		font-weight: 700;
		margin-top: 6px;
	}
	.v.ok {
		color: var(--ok);
	}
	.v.warn {
		color: var(--warn);
	}
	.v.danger {
		color: var(--danger);
	}
	.two-col {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
		margin-top: 16px;
	}
	.bar-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 9px 0;
	}
	.label {
		width: 64px;
		color: var(--fg-dim);
	}
	.bar {
		flex: 1;
		height: 10px;
		background: var(--bg);
		border-radius: 6px;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--accent);
		border-radius: 6px;
	}
	.fill.teal {
		background: var(--accent-2);
	}
	.count {
		width: 28px;
		text-align: right;
	}
	.progress {
		display: inline-block;
		width: 120px;
		height: 8px;
		background: var(--bg);
		border-radius: 5px;
		overflow: hidden;
		vertical-align: middle;
		margin-right: 8px;
	}
	.pfill {
		height: 100%;
		background: var(--ok);
	}
	.frame-chip {
		display: inline-block;
		background: var(--bg-3);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 2px 9px;
		margin: 2px 4px 2px 0;
	}
	@media (max-width: 1000px) {
		.cards,
		.two-col {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
