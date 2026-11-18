<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { VOLTAGE_LEVELS, WORK_TYPES } from '$lib/types';
	import type { Course } from '$lib/types';

	let courses = $state<Course[]>([]);
	let voltage = $state('');
	let workType = $state('');
	let status = $state('');

	async function load() {
		const filter: Record<string, string> = {};
		if (voltage) filter.voltageLevel = voltage;
		if (workType) filter.workType = workType;
		if (status) filter.status = status;
		courses = await api.listCourses(filter);
	}
	onMount(load);

	const statusText: Record<string, string> = { approved: '已通过', in_review: '审核中', rejected: '已退回', draft: '草稿' };
</script>

<div class="panel row" style="flex-wrap:wrap;margin-bottom:16px">
	<h3 style="margin:0">课件库（按电压等级与作业类型归类）</h3>
	<div class="spacer"></div>
	<select bind:value={voltage} onchange={load}>
		<option value="">全部电压等级</option>
		{#each VOLTAGE_LEVELS as v}<option value={v}>{v}</option>{/each}
	</select>
	<select bind:value={workType} onchange={load}>
		<option value="">全部作业类型</option>
		{#each WORK_TYPES as t}<option value={t}>{t}</option>{/each}
	</select>
	<select bind:value={status} onchange={load}>
		<option value="">全部状态</option>
		<option value="draft">草稿</option>
		<option value="in_review">审核中</option>
		<option value="approved">已通过</option>
		<option value="rejected">已退回</option>
	</select>
</div>

<div class="panel">
	<table>
		<thead>
			<tr><th>课件</th><th>电压等级</th><th>作业类型</th><th>讲师</th><th>版本</th><th>状态</th><th>更新时间</th><th></th></tr>
		</thead>
		<tbody>
			{#each courses as c (c.id)}
				<tr>
					<td>{c.title}</td>
					<td><span class="tag">{c.voltageLevel}</span></td>
					<td>{c.workType}</td>
					<td>{c.instructor}</td>
					<td>v{c.currentVersion}</td>
					<td><span class="tag {c.status === 'approved' ? 'ok' : c.status === 'in_review' ? 'review' : c.status === 'rejected' ? 'reject' : 'draft'}">{statusText[c.status]}</span></td>
					<td class="small muted">{new Date(c.updatedAt).toLocaleString('zh-CN')}</td>
					<td class="row" style="gap:6px">
						<a href="/editor/{c.id}"><button>编辑</button></a>
						<a href="/player/{c.id}"><button>学习</button></a>
					</td>
				</tr>
			{/each}
			{#if courses.length === 0}
				<tr><td colspan="8" class="muted" style="text-align:center;padding:30px">没有匹配的课件</td></tr>
			{/if}
		</tbody>
	</table>
</div>
