import { json, error } from '@sveltejs/kit';
import { getStore } from '$lib/server/store';
import type { EditorProject } from '$lib/types';

/** 讲师保存草稿（覆盖当前版本工程数据，不产生新版本） */
export async function PUT({ params, request }) {
	const body = (await request.json()) as { project: EditorProject };
	const store = getStore();
	if (!store.getCourse(params.id)) throw error(404, '课件不存在');
	return json(store.saveDraft(params.id, body.project));
}

/** 讲师（重新）提交审核 → 生成新版本并置为 in_review */
export async function POST({ params, request }) {
	const body = (await request.json()) as { project: EditorProject };
	const store = getStore();
	if (!store.getCourse(params.id)) throw error(404, '课件不存在');
	return json(store.submitVersion(params.id, body.project));
}
