import { json } from '@sveltejs/kit';
import { getStore } from '$lib/server/store';

export function GET() {
	return json(getStore().dashboard());
}
