import { json, error } from '@sveltejs/kit';
import { getStore } from '$lib/server/store';

export async function POST({ params, request }) {
	const body = (await request.json()) as { annotationId: string };
	const store = getStore();
	if (!store.getCourse(params.id)) throw error(404, '课件不存在');
	return json(store.resolveAnnotation(params.id, body.annotationId));
}
