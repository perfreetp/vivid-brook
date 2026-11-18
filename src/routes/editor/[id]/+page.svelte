<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import type { Course } from '$lib/types';
	import EditorWorkspace from '../EditorWorkspace.svelte';

	let course = $state<Course | null>(null);
	let failed = $state('');

	onMount(async () => {
		try {
			course = await api.getCourse(page.params.id!);
		} catch (err) {
			failed = (err as Error).message;
		}
	});
</script>

{#if failed}
	<div class="panel"><p class="danger-text">加载失败：{failed}</p><a href="/courses"><button>返回课件库</button></a></div>
{:else if !course}
	<p class="muted">正在载入课件工程…</p>
{:else}
	<div class="loaded-meta panel">
		<span class="tag">{course.voltageLevel}</span>
		<span class="tag">{course.workType}</span>
		<span class="tag {course.status === 'approved' ? 'ok' : course.status === 'in_review' ? 'review' : course.status === 'rejected' ? 'reject' : 'draft'}">
			v{course.currentVersion} · {course.status === 'approved' ? '已通过' : course.status === 'in_review' ? '审核中' : course.status === 'rejected' ? '已退回' : '草稿'}
		</span>
		{#if course.status === 'rejected'}
			<span class="danger-text small">该版本被退回，修改后重新提交将自动生成 v{course.currentVersion + 1}</span>
		{/if}
	</div>
	<EditorWorkspace initialCourse={course} />
{/if}

<style>
	.loaded-meta {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}
</style>
