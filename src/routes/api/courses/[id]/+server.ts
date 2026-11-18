import { json, error } from '@sveltejs/kit';
import { getStore } from '$lib/server/store';

export function GET({ params }) {
	const course = getStore().getCourse(params.id);
	if (!course) throw error(404, '课件不存在');
	return json(course);
}

export function DELETE({ params }) {
	const store = getStore();
	if (!store.getCourse(params.id)) throw error(404, '课件不存在');
	store.deleteCourse(params.id);
	return json({ ok: true });
}
