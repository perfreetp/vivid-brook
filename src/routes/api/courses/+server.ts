import { json } from '@sveltejs/kit';
import { getStore } from '$lib/server/store';
import type { EditorProject, VoltageLevel, WorkType } from '$lib/types';

export function GET({ url }) {
	const filter = {
		voltageLevel: url.searchParams.get('voltageLevel') ?? undefined,
		workType: url.searchParams.get('workType') ?? undefined,
		status: url.searchParams.get('status') ?? undefined
	};
	return json(getStore().listCourses(filter));
}

export async function POST({ request }) {
	const body = (await request.json()) as {
		title: string;
		voltageLevel: VoltageLevel;
		workType: WorkType;
		instructor: string;
		project: EditorProject;
	};
	return json(getStore().createCourse(body), { status: 201 });
}
