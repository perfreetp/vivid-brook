import type {
	Course,
	DashboardStats,
	EditorProject,
	FrameAnnotation,
	ProgressRecord
} from './types';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, {
		headers: { 'Content-Type': 'application/json' },
		...init
	});
	if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `请求失败 ${res.status}`);
	return res.json() as Promise<T>;
}

export const api = {
	listCourses: (filter?: Record<string, string>) => {
		const qs = filter ? '?' + new URLSearchParams(Object.entries(filter)).toString() : '';
		return req<Course[]>(`/api/courses${qs}`);
	},
	getCourse: (id: string) => req<Course>(`/api/courses/${id}`),
	createCourse: (body: {
		title: string;
		voltageLevel: Course['voltageLevel'];
		workType: Course['workType'];
		instructor: string;
		project: EditorProject;
	}) => req<Course>('/api/courses', { method: 'POST', body: JSON.stringify(body) }),
	deleteCourse: (id: string) => req<{ ok: boolean }>(`/api/courses/${id}`, { method: 'DELETE' }),
	saveDraft: (id: string, project: EditorProject) =>
		req<Course>(`/api/courses/${id}/submit`, {
			method: 'PUT',
			body: JSON.stringify({ project })
		}),
	submit: (id: string, project: EditorProject) =>
		req<Course>(`/api/courses/${id}/submit`, { method: 'POST', body: JSON.stringify({ project }) }),
	review: (
		id: string,
		body: { decision: 'approved' | 'rejected'; reviewer: string; comment: string; annotations: FrameAnnotation[] }
	) => req<Course>(`/api/courses/${id}/review`, { method: 'POST', body: JSON.stringify(body) }),
	resolveAnnotation: (id: string, annotationId: string) =>
		req<Course>(`/api/courses/${id}/annotations`, { method: 'POST', body: JSON.stringify({ annotationId }) }),
	dashboard: () => req<DashboardStats>('/api/dashboard'),
	listProgress: (courseId?: string) =>
		req<ProgressRecord[]>(`/api/progress${courseId ? `?courseId=${courseId}` : ''}`),
	reportProgress: (body: Omit<ProgressRecord, 'id' | 'updatedAt'>) =>
		req<ProgressRecord>('/api/progress', { method: 'POST', body: JSON.stringify(body) })
};
