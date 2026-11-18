import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const libDir = fileURLToPath(new URL('./src/lib', import.meta.url));

export default defineConfig({
	plugins: [
		sveltekit({
			// SvelteKit 3：原 svelte.config.js 的选项改由插件参数传入
			preprocess: vitePreprocess(),
			adapter: adapter({ out: 'build' }),
			// alias 虽标记为 deprecated，但仍是 tsconfig paths 与运行时别名的来源
			alias: {
				$lib: libDir,
				'$lib/*': `${libDir}/*`
			}
		})
	],
	server: {
		port: 5173,
		host: '127.0.0.1'
	},
	optimizeDeps: {
		exclude: ['@sveltejs/kit']
	}
});
