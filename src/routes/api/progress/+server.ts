import { json } from '@sveltejs/kit';
import { getStore } from '$lib/server/store';

export function GET({ url }) {
	const courseId = url.searchParams.get('courseId') ?? undefined;
	return json(getStore().listProgress(courseId));
}

export async function POST({ request }) {
	const body = (await request.json()) as {
		courseId: string;
		student: string;
		percent: number;
		completed: boolean;
		scrubFrames: number[];
		lastFrame: number;
	};
	return json(getStore().upsertProgress(body), { status: 201 });
}
