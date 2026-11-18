import fs from 'node:fs';
import path from 'node:path';
import type { Course, DashboardStats, FrameAnnotation, ProgressRecord } from '../types';
import { WORK_TYPES, VOLTAGE_LEVELS } from '../types';
import { seedCourses, seedProgress } from './seed';

// 进程内单例 + 文件落盘，规避 SvelteKit dev 下模块重复求值
declare global {
	// eslint-disable-next-line no-var
	var __LIVEWORK_STORE__: FileStore | undefined;
}

export class FileStore {
	private courses: Course[] = [];
	private progress: ProgressRecord[] = [];
	private dataFile: string;
	private exportDir: string;

	constructor(dataDir: string) {
		this.dataFile = path.join(dataDir, 'db.json');
		this.exportDir = path.join(dataDir, 'exports');
		fs.mkdirSync(dataDir, { recursive: true });
		fs.mkdirSync(this.exportDir, { recursive: true });
		this.load();
		if (this.courses.length === 0) {
			this.courses = seedCourses();
			this.progress = seedProgress();
			this.persist();
		}
	}

	private load() {
		try {
			const raw = fs.readFileSync(this.dataFile, 'utf-8');
			const data = JSON.parse(raw);
			this.courses = data.courses ?? [];
			this.progress = data.progress ?? [];
		} catch {
			this.courses = [];
			this.progress = [];
		}
	}

	private persist() {
		fs.writeFileSync(
			this.dataFile,
			JSON.stringify({ courses: this.courses, progress: this.progress }, null, 1),
			'utf-8'
		);
	}

	// ---------- 课程 ----------

	listCourses(filter?: { voltageLevel?: string; workType?: string; status?: string }): Course[] {
		let rows = [...this.courses];
		if (filter?.voltageLevel) rows = rows.filter((c) => c.voltageLevel === filter.voltageLevel);
		if (filter?.workType) rows = rows.filter((c) => c.workType === filter.workType);
		if (filter?.status) rows = rows.filter((c) => c.status === filter.status);
		return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	getCourse(id: string): Course | undefined {
		return this.courses.find((c) => c.id === id);
	}

	createCourse(input: {
		title: string;
		voltageLevel: Course['voltageLevel'];
		workType: Course['workType'];
		instructor: string;
		project: Course['versions'][number]['project'];
	}): Course {
		const now = new Date().toISOString();
		const course: Course = {
			id: `course_${crypto.randomUUID().slice(0, 8)}`,
			title: input.title,
			voltageLevel: input.voltageLevel,
			workType: input.workType,
			instructor: input.instructor,
			status: 'draft',
			currentVersion: 1,
			versions: [
				{
					version: 1,
					submittedAt: now,
					project: input.project
				}
			],
			createdAt: now,
			updatedAt: now
		};
		this.courses.push(course);
		this.persist();
		return course;
	}

	/** 讲师提交 / 重新提交：生成新版本；被退回的课程重新提交仍沿用上一个版本号 +1 */
	submitVersion(courseId: string, project: Course['versions'][number]['project']): Course {
		const course = this.requireCourse(courseId);
		const nextVersion = course.currentVersion + 1;
		course.versions.push({ version: nextVersion, submittedAt: new Date().toISOString(), project });
		course.currentVersion = nextVersion;
		course.status = 'in_review';
		course.updatedAt = new Date().toISOString();
		this.persist();
		return course;
	}

	saveDraft(courseId: string, project: Course['versions'][number]['project']): Course {
		const course = this.requireCourse(courseId);
		const head = course.versions.find((v) => v.version === course.currentVersion)!;
		head.project = project;
		course.updatedAt = new Date().toISOString();
		this.persist();
		return course;
	}

	/** 主管审片：通过或退回（退回携带逐帧打点意见） */
	review(
		courseId: string,
		decision: 'approved' | 'rejected',
		payload: { reviewer: string; comment: string; annotations: FrameAnnotation[] }
	): Course {
		const course = this.requireCourse(courseId);
		const head = course.versions.find((v) => v.version === course.currentVersion)!;
		head.review = {
			decision,
			reviewer: payload.reviewer,
			comment: payload.comment,
			annotations: payload.annotations,
			reviewedAt: new Date().toISOString()
		};
		course.status = decision === 'approved' ? 'approved' : 'rejected';
		course.updatedAt = new Date().toISOString();
		this.persist();
		return course;
	}

	resolveAnnotation(courseId: string, annotationId: string): Course {
		const course = this.requireCourse(courseId);
		const head = course.versions.find((v) => v.version === course.currentVersion)!;
		for (const a of head.review?.annotations ?? []) {
			if (a.id === annotationId) a.resolved = true;
		}
		this.persist();
		return course;
	}

	deleteCourse(id: string): void {
		const idx = this.courses.findIndex((c) => c.id === id);
		if (idx >= 0) {
			this.courses.splice(idx, 1);
			this.persist();
		}
	}

	private requireCourse(id: string): Course {
		const c = this.courses.find((x) => x.id === id);
		if (!c) throw new Error(`课件不存在：${id}`);
		return c;
	}

	// ---------- 学情 ----------

	upsertProgress(input: Omit<ProgressRecord, 'id' | 'updatedAt'> & { id?: string }): ProgressRecord {
		const existing = this.progress.find(
			(p) => p.courseId === input.courseId && p.student === input.student
		);
		if (existing) {
			// 拖拽帧累加并去重保留计数（看板侧聚合）
			const merged = [...existing.scrubFrames, ...input.scrubFrames];
			existing.scrubFrames = merged;
			existing.percent = Math.max(existing.percent, input.percent);
			existing.completed = existing.completed || input.completed;
			existing.lastFrame = input.lastFrame;
			existing.updatedAt = new Date().toISOString();
			this.persist();
			return existing;
		}
		const record: ProgressRecord = {
			id: `prog_${crypto.randomUUID().slice(0, 8)}`,
			courseId: input.courseId,
			student: input.student,
			percent: input.percent,
			completed: input.completed,
			scrubFrames: input.scrubFrames,
			lastFrame: input.lastFrame,
			updatedAt: new Date().toISOString()
		};
		this.progress.push(record);
		this.persist();
		return record;
	}

	listProgress(courseId?: string): ProgressRecord[] {
		return courseId ? this.progress.filter((p) => p.courseId === courseId) : [...this.progress];
	}

	// ---------- 看板 ----------

	dashboard(): DashboardStats {
		const byVoltage = Object.fromEntries(VOLTAGE_LEVELS.map((v) => [v, 0])) as Record<string, number>;
		const byWorkType = Object.fromEntries(WORK_TYPES.map((v) => [v, 0])) as Record<string, number>;
		const byStatus: Record<string, number> = { draft: 0, in_review: 0, approved: 0, rejected: 0 };
		for (const c of this.courses) {
			byVoltage[c.voltageLevel]++;
			byWorkType[c.workType]++;
			byStatus[c.status]++;
		}

		const reviewQueue = this.courses
			.filter((c) => c.status === 'in_review')
			.map((c) => ({
				id: c.id,
				title: c.title,
				version: c.currentVersion,
				instructor: c.instructor,
				submittedAt: c.versions.find((v) => v.version === c.currentVersion)!.submittedAt
			}));

		const studentRows = this.progress.map((p) => {
			const course = this.courses.find((c) => c.id === p.courseId);
			const counts: Record<number, number> = {};
			for (const f of p.scrubFrames) counts[f] = (counts[f] ?? 0) + 1;
			const topFrames = Object.entries(counts)
				.map(([frame, count]) => ({ frame: Number(frame), count }))
				.sort((a, b) => b.count - a.count)
				.slice(0, 8);
			return {
				courseId: p.courseId,
				courseTitle: course?.title ?? '（已删除课件）',
				student: p.student,
				percent: p.percent,
				completed: p.completed,
				scrubCount: p.scrubFrames.length,
				topFrames
			};
		});

		return {
			totalCourses: this.courses.length,
			byVoltage,
			byWorkType,
			byStatus,
			reviewQueue,
			studentRows
		};
	}

	exportPath(name: string): string {
		return path.join(this.exportDir, name);
	}
}

export function getStore(): FileStore {
	if (!globalThis.__LIVEWORK_STORE__) {
		const dataDir = path.join(process.cwd(), '.data');
		globalThis.__LIVEWORK_STORE__ = new FileStore(dataDir);
	}
	return globalThis.__LIVEWORK_STORE__;
}
