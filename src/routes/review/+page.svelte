<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import type { Course } from '$lib/types';

	let queue = $state<Course[]>([]);
	onMount(async () => {
		const all = await api.listCourses();
		queue = all.filter((c) => c.status === 'in_review' || c.status === 'rejected');
	});
</script>

<div class="panel">
	<h3>审片台 — 待审核 / 被退回课件</h3>
	<table>
		<thead>
			<tr><th>课件</th><th>电压等级</th><th>作业类型</th><th>讲师</th><th>当前版本</th><th>状态</th><th></th></tr>
		</thead>
		<tbody>
			{#each queue as c (c.id)}
				<tr>
					<td>{c.title}</td>
					<td><span class="tag">{c.voltageLevel}</span></td>
					<td>{c.workType}</td>
					<td>{c.instructor}</td>
					<td>v{c.currentVersion}</td>
					<td><span class="tag {c.status === 'in_review' ? 'review' : 'reject'}">{c.status === 'in_review' ? '审核中' : '已退回（讲师修改中）'}</span></td>
					<td><a href="/review/{c.id}"><button class="primary">进入审片</button></a></td>
				</tr>
			{/each}
			{#if queue.length === 0}
				<tr><td colspan="7" class="muted" style="text-align:center;padding:30px">暂无待审课件</td></tr>
			{/if}
		</tbody>
	</table>
</div>
