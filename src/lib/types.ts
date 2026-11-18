// 全局共享数据模型

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number]; // 四元数 x,y,z,w
export type Vec2 = [number, number];

export type InterpMode = 'linear' | 'bezier' | 'step';

export interface JointTransform {
	position: Vec3;
	rotation: Vec4;
	scale: Vec3;
}

export interface JointData {
	id: string;
	name: string;
	parentId: string | null;
	position: Vec3; // 绑定姿势下的局部坐标
	rotation: Vec4; // 绑定姿势下的局部旋转
	scale: Vec3;
}

export interface SkeletonData {
	rootId: string | null;
	joints: JointData[];
}

/** 顶点权重：vertexIndex -> (jointId -> weight 0..1) */
export type WeightMap = Record<number, Record<string, number>>;

export interface Keyframe {
	id: string;
	frame: number;
	position: Vec3;
	rotation: Vec4;
	scale: Vec3;
	interp: InterpMode;
	/** 贝塞尔切线手柄，归一化到段内 [0,1]²，out 关联前一关键帧，in 关联后一关键帧 */
	outHandle: Vec2;
	inHandle: Vec2;
}

export interface BoneTrack {
	jointId: string;
	keys: Keyframe[];
}

export interface Clip {
	id: string;
	name: string;
	startFrame: number;
	endFrame: number;
	loopCount: number;
	order: number;
}

export interface NamedPose {
	id: string;
	name: string;
	joints: Record<string, JointTransform>;
}

export interface EditorProject {
	meta: {
		title: string;
		fps: number;
		durationFrames: number;
		meshSource: 'builtin' | 'obj' | 'gltf';
		meshName: string;
		vertexCount: number;
	};
	skeleton: SkeletonData;
	weights: WeightMap;
	tracks: BoneTrack[];
	clips: Clip[];
	poseLibrary: NamedPose[];
}

// ---------- 后台课件 / 审核 / 学情 ----------

export const VOLTAGE_LEVELS = ['10kV', '35kV', '110kV', '220kV', '500kV'] as const;
export type VoltageLevel = (typeof VOLTAGE_LEVELS)[number];

export const WORK_TYPES = [
	'带电检测',
	'地电位带电作业',
	'等电位带电作业',
	'停电检修',
	'应急抢修'
] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export type CourseStatus = 'draft' | 'in_review' | 'approved' | 'rejected';

export interface FrameAnnotation {
	id: string;
	frame: number;
	text: string;
	author: string;
	createdAt: string;
	resolved: boolean;
}

export interface CourseVersion {
	version: number;
	submittedAt: string;
	project: EditorProject;
	review?: {
		decision: 'approved' | 'rejected';
		reviewer: string;
		annotations: FrameAnnotation[];
		comment: string;
		reviewedAt: string;
	};
}

export interface Course {
	id: string;
	title: string;
	voltageLevel: VoltageLevel;
	workType: WorkType;
	instructor: string;
	status: CourseStatus;
	currentVersion: number;
	versions: CourseVersion[];
	createdAt: string;
	updatedAt: string;
}

export interface ProgressRecord {
	id: string;
	courseId: string;
	student: string;
	percent: number;
	completed: boolean;
	/** 学员反复拖动查看过的帧（去重计数在看板聚合） */
	scrubFrames: number[];
	lastFrame: number;
	updatedAt: string;
}

export interface DashboardStats {
	totalCourses: number;
	byVoltage: Record<string, number>;
	byWorkType: Record<string, number>;
	byStatus: Record<string, number>;
	reviewQueue: { id: string; title: string; version: number; instructor: string; submittedAt: string }[];
	studentRows: {
		courseId: string;
		courseTitle: string;
		student: string;
		percent: number;
		completed: boolean;
		scrubCount: number;
		topFrames: { frame: number; count: number }[];
	}[];
}
