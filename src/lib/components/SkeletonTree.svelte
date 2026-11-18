<script lang="ts">
	import type { SkeletonData } from '$lib/types';

	let {
		skeleton,
		selectedJointId,
		onSelect,
		onReparent,
		onDelete,
		onRename
	}: {
		skeleton: SkeletonData;
		selectedJointId: string | null;
		onSelect: (id: string | null) => void;
		onReparent: (jointId: string, newParentId: string | null) => void;
		onDelete: (id: string) => void;
		onRename: (id: string, name: string) => void;
	} = $props();

	let dragId = $state<string | null>(null);

	function children(parentId: string | null) {
		return skeleton.joints.filter((j) => j.parentId === parentId);
	}

	function nameOf(id: string) {
		return skeleton.joints.find((j) => j.id === id)?.name ?? '?';
	}
</script>

<div class="tree">
	{#snippet node(jointId: string, depth: number)}
		{@const j = skeleton.joints.find((x) => x.id === jointId)}
		{#if j}
			<div
				class="node"
				class:selected={selectedJointId === jointId}
				style="padding-left:{10 + depth * 16}px"
				draggable="true"
				ondragstart={() => (dragId = jointId)}
				ondragover={(e) => e.preventDefault()}
				ondrop={(e) => {
					e.preventDefault();
					if (dragId && dragId !== jointId) onReparent(dragId, jointId);
					dragId = null;
				}}
				onclick={() => onSelect(jointId)}
				role="button"
				tabindex="0"
				onkeydown={(e) => e.key === 'Enter' && onSelect(jointId)}
			>
				<span class="dot"></span>
				<input
					value={j.name}
					onclick={(e) => e.stopPropagation()}
					onchange={(e) => onRename(jointId, (e.currentTarget as HTMLInputElement).value)}
				/>
				<button
					class="icon-btn"
					title="升级为根节点（解除父子关系）"
					onclick={(e) => {
						e.stopPropagation();
						onReparent(jointId, null);
					}}>↥</button
				>
				<button
					class="icon-btn danger"
					title="删除关节（子关节提升到根）"
					onclick={(e) => {
						e.stopPropagation();
						onDelete(jointId);
					}}>✕</button
				>
			</div>
			{#each children(jointId) as child (child.id)}
				{@render node(child.id, depth + 1)}
			{/each}
		{/if}
	{/snippet}

	{#if skeleton.joints.length === 0}
		<p class="muted small" style="padding:8px 4px">
			还没有关节。切换到「加点」工具，在视口中点击人体网格表面放置第一个关节（自动成为根）。
		</p>
	{:else}
		{#each children(null) as root (root.id)}
			{@render node(root.id, 0)}
		{/each}
	{/if}
</div>

<div class="hint small muted">拖拽节点到另一个节点上可调整父子关系；拖到空白处无效，用 ↥ 解除父级。</div>

<style>
	.tree {
		max-height: 300px;
		overflow: auto;
	}
	.node {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 8px;
		border-radius: 6px;
		cursor: pointer;
	}
	.node:hover {
		background: var(--bg-3);
	}
	.node.selected {
		background: rgba(47, 129, 247, 0.22);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent-2);
		flex: none;
	}
	input {
		flex: 1;
		min-width: 0;
		padding: 3px 6px;
	}
	.icon-btn {
		padding: 1px 6px;
		font-size: 12px;
	}
	.hint {
		margin-top: 8px;
		line-height: 1.6;
	}
</style>
