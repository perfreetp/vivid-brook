import { json, error } from '@sveltejs/kit';
import { getStore } from '$lib/server/store';
import type { FrameAnnotation } from '$lib/types';

/** 主管审片：approve / reject，reject 时携带逐帧打点 */
export async function POST({ params, request }) {
	const body = (await request.json()) as {
		decision: 'approved' | 'rejected';
		reviewer: string;
		comment: string;
		annotations: FrameAnnotation[];
	};
	const store = getStore();
	if (!store.getCourse(params.id)) throw error(404, '课件不存在');
	return json(store.review(params.id, body.decision, body));
}
