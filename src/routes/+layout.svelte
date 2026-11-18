<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<header class="topbar">
	<div class="brand">⚡ 带电作业三维课件平台</div>
	<nav>
		<a href="/">首页</a>
		<a href="/editor">课件编辑器</a>
		<a href="/courses">课件库</a>
		<a href="/review">审片台</a>
		<a href="/dashboard">学情看板</a>
	</nav>
</header>

<main class="page">
	{@render children()}
</main>

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: 26px;
		padding: 0 22px;
		height: 54px;
		background: var(--bg-2);
		border-bottom: 1px solid var(--border);
		position: sticky;
		top: 0;
		z-index: 20;
	}
	.brand {
		font-weight: 700;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	nav {
		display: flex;
		gap: 18px;
	}
	nav a {
		color: var(--fg-dim);
		font-size: 13.5px;
	}
	nav a:hover {
		color: var(--fg);
		text-decoration: none;
	}
	.page {
		padding: 20px 24px 40px;
		max-width: 1500px;
		margin: 0 auto;
	}
</style>
