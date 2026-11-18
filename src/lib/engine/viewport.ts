import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { JointData, JointTransform, SkeletonData, WeightMap } from '../types';
import { computeBindWorldMatrices, computePoseWorldMatrices, jointMap } from './skeleton';
import { paintWeights } from './weights';
import { SkinBinding, jointColorMap } from './skin';

export type ToolMode = 'select' | 'addJoint' | 'paint';
export type TransformSpace = 'translate' | 'rotate' | 'scale';

export interface ViewportCallbacks {
	onSelectJoint?: (id: string | null) => void;
	onJointMove?: (id: string, localPosition: [number, number, number], localRotation: [number, number, number, number]) => void;
	onPaint?: (weights: WeightMap) => void;
	onAddJointAt?: (worldPoint: THREE.Vector3) => void;
}

const MARKER_RADIUS = 0.045;

export class ViewportEngine {
	renderer: THREE.WebGLRenderer;
	scene = new THREE.Scene();
	camera: THREE.PerspectiveCamera;
	orbit: OrbitControls;
	transform: TransformControls;
	raycaster = new THREE.Raycaster();
	pointer = new THREE.Vector2();

	meshGeometry: THREE.BufferGeometry | null = null;
	private meshObject: THREE.Mesh | null = null;
	private binding = new SkinBinding();
	private jointLayer = new THREE.Group();
	private markerMeshes = new Map<string, THREE.Mesh>();
	private boneLines: THREE.LineSegments | null = null;
	private trajectoryLine: THREE.Line | null = null;
	private brushHelper: THREE.Mesh;
	private grid: THREE.GridHelper;

	tool: ToolMode = 'select';
	space: TransformSpace = 'translate';
	private skeleton: SkeletonData = { rootId: null, joints: [] };
	private weights: WeightMap = {};
	private selectedId: string | null = null;
	private showWeights = false;
	private cb: ViewportCallbacks;
	private container: HTMLElement;
	/** renderer 的 canvas，由外部组件挂到受管容器中（避免被 Svelte 重渲染清除） */
	canvas: HTMLCanvasElement;
	private raf = 0;
	private downPos = new THREE.Vector2();
	private downHit: { jointId: string | null; point: THREE.Vector3 } = { jointId: null, point: new THREE.Vector3() };
	private painting = false;
	private jointColors = new Map<string, THREE.Color>();
	private resizeObserver: ResizeObserver;
	private playMode = false;

	constructor(container: HTMLElement, cb: ViewportCallbacks = {}) {
		// canvas 由引擎创建但不主动 append：组件侧通过受管 div 挂接，Svelte 重渲染不会清除它
		this.container = container;
		this.cb = cb;
		const w = container.clientWidth || 800;
		const h = container.clientHeight || 600;

		this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
		this.canvas = this.renderer.domElement;
		this.canvas.style.display = 'block';
		this.canvas.style.width = '100%';
		this.canvas.style.height = '100%';
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(w, h);
		this.renderer.shadowMap.enabled = true;
		// three 0.187 已移除 PCFSoftShadowMap，使用基础 PCF 阴影
		this.renderer.shadowMap.type = THREE.PCFShadowMap;

		this.scene.background = new THREE.Color(0x10151d);
		this.camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 100);
		this.camera.position.set(2.2, 1.6, 2.6);

		this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
		this.orbit.target.set(0, 0.9, 0);
		this.orbit.enableDamping = true;
		this.orbit.dampingFactor = 0.08;

		this.transform = new TransformControls(this.camera, this.renderer.domElement);
		this.transform.setSize(0.85);
		this.scene.add(this.transform.getHelper ? this.transform.getHelper() : (this.transform as unknown as THREE.Object3D));

		// 灯光
		const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2f3a, 0.85);
		const key = new THREE.DirectionalLight(0xffffff, 1.6);
		key.position.set(2.5, 4, 2);
		key.castShadow = true;
		key.shadow.mapSize.set(1024, 1024);
		this.scene.add(hemi, key);

		this.grid = new THREE.GridHelper(6, 24, 0x3a4456, 0x232b38);
		this.grid.position.y = 0;
		this.scene.add(this.grid);
		this.scene.add(this.jointLayer);

		// 画刷球
		this.brushHelper = new THREE.Mesh(
			new THREE.SphereGeometry(1, 18, 14),
			new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.25, depthWrite: false })
		);
		this.brushHelper.visible = false;
		this.scene.add(this.brushHelper);

		// transform 拖拽时禁用 orbit
		this.transform.addEventListener('dragging-changed', (event) => {
			this.orbit.enabled = !(event as unknown as { value: boolean }).value;
		});
		this.transform.addEventListener('objectChange', () => this.handleObjectChange());

		const dom = this.renderer.domElement;
		dom.addEventListener('pointerdown', this.onPointerDown);
		dom.addEventListener('pointermove', this.onPointerMove);
		dom.addEventListener('pointerup', this.onPointerUp);
		dom.addEventListener('pointerleave', this.onPointerLeave);

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(container);
		// 容器挂载后首帧可能仍为 0 尺寸，下一帧强制同步一次
		requestAnimationFrame(() => this.resize());

		this.animate();
	}

	// ---------------- 网格 ----------------

	setGeometry(geometry: THREE.BufferGeometry, rebuild = true) {
		this.meshGeometry = geometry;
		this.binding.setGeometry(geometry);
		if (this.meshObject) {
			this.scene.remove(this.meshObject);
			this.meshObject.geometry.dispose();
		}
		this.meshObject = new THREE.Mesh(
			geometry,
			new THREE.MeshStandardMaterial({ color: 0xc7d2e0, roughness: 0.65 })
		);
		this.meshObject.castShadow = true;
		this.meshObject.visible = this.skeleton.joints.length === 0; // 有骨骼后显示蒙皮版
		this.scene.add(this.meshObject);
		if (rebuild) this.rebuildSkin();
	}

	private rebuildSkin() {
		// 移除旧蒙皮
		const old = this.scene.children.find((c) => c instanceof THREE.SkinnedMesh);
		if (old) {
			this.scene.remove(old);
			(old as THREE.SkinnedMesh).geometry.dispose();
		}
		const mesh = this.binding.rebuild(this.skeleton, this.weights, this.showWeights);
		if (mesh) {
			this.scene.add(mesh);
			if (this.meshObject) this.meshObject.visible = false;
		} else if (this.meshObject) {
			this.meshObject.visible = true;
		}
		this.refreshJointMarkers();
	}

	// ---------------- 状态同步 ----------------

	setSkeleton(skeleton: SkeletonData) {
		this.skeleton = skeleton;
		this.jointColors = jointColorMap(skeleton);
		this.rebuildSkin();
		this.refreshJointMarkers();
		this.refreshBoneLines();
		if (this.selectedId && !skeleton.joints.some((j) => j.id === this.selectedId)) {
			this.selectJoint(null);
		}
	}

	setWeights(weights: WeightMap) {
		this.weights = weights;
		this.binding.updateWeightColors(weights);
	}

	setTool(tool: ToolMode) {
		this.tool = tool;
		this.brushHelper.visible = tool === 'paint';
		if (tool === 'paint' || tool === 'addJoint') {
			this.transform.detach();
		}
		this.renderer.domElement.style.cursor = tool === 'select' ? 'default' : 'crosshair';
	}

	setSpace(space: TransformSpace) {
		this.space = space;
		if (this.selectedId) this.attachTransform(this.selectedId, space);
	}

	setShowWeights(show: boolean) {
		this.showWeights = show;
		this.binding.setShowWeights(show);
		this.jointLayer.visible = !show || true; // 关节标记在权重模式下仍可见，方便选关节
	}

	setPlayMode(on: boolean) {
		this.playMode = on;
		if (on) this.transform.detach();
	}

	// ---------------- 关节选择 / 标记 ----------------

	selectJoint(id: string | null) {
		this.selectedId = id;
		this.markerMeshes.forEach((m, jid) => {
			(m.material as THREE.MeshStandardMaterial).emissive.set(jid === id ? 0xffffff : 0x000000);
		});
		if (id && this.tool === 'select' && !this.playMode) {
			this.attachTransform(id, this.space);
		} else {
			this.transform.detach();
		}
		this.cb.onSelectJoint?.(id);
	}

	private attachTransform(id: string, space: TransformSpace) {
		const marker = this.markerMeshes.get(id);
		if (!marker) return;
		this.transform.attach(marker);
		this.transform.setMode(space === 'scale' ? 'scale' : space);
	}

	private refreshJointMarkers() {
		this.jointLayer.clear();
		this.markerMeshes.clear();
		const world = computeBindWorldMatrices(this.skeleton);
		for (const j of this.skeleton.joints) {
			const color = this.jointColors.get(j.id) ?? new THREE.Color(0x22d3ee);
			const marker = new THREE.Mesh(
				new THREE.SphereGeometry(MARKER_RADIUS, 16, 12),
				new THREE.MeshStandardMaterial({ color, emissive: j.id === this.selectedId ? 0x888888 : 0x000000, roughness: 0.4 })
			);
			const p = new THREE.Vector3().setFromMatrixPosition(world.get(j.id)!);
			marker.position.copy(p);
			marker.userData.jointId = j.id;
			this.jointLayer.add(marker);
			this.markerMeshes.set(j.id, marker);
		}
		this.refreshBoneLines();
	}

	private refreshBoneLines() {
		if (this.boneLines) {
			this.jointLayer.remove(this.boneLines);
			this.boneLines.geometry.dispose();
		}
		const world = computeBindWorldMatrices(this.skeleton);
		const pts: number[] = [];
		for (const j of this.skeleton.joints) {
			if (!j.parentId || !world.has(j.parentId)) continue;
			const a = new THREE.Vector3().setFromMatrixPosition(world.get(j.parentId)!);
			const b = new THREE.Vector3().setFromMatrixPosition(world.get(j.id)!);
			pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
		this.boneLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fb4d4 }));
		this.jointLayer.add(this.boneLines);
	}

	private handleObjectChange() {
		if (!this.selectedId) return;
		const marker = this.markerMeshes.get(this.selectedId);
		if (!marker) return;
		marker.updateMatrixWorld();
		const j = this.skeleton.joints.find((x) => x.id === this.selectedId);
		if (!j || !j.parentId) {
			this.cb.onJointMove?.(this.selectedId, [marker.position.x, marker.position.y, marker.position.z], [
				marker.quaternion.x, marker.quaternion.y, marker.quaternion.z, marker.quaternion.w
			]);
			return;
		}
		const parentWorld = computeBindWorldMatrices(this.skeleton).get(j.parentId)!;
		const local = marker.matrixWorld.clone().premultiply(parentWorld.clone().invert());
		const pos = new THREE.Vector3();
		const quat = new THREE.Quaternion();
		const scl = new THREE.Vector3();
		local.decompose(pos, quat, scl);
		this.cb.onJointMove?.(this.selectedId, [pos.x, pos.y, pos.z], [quat.x, quat.y, quat.z, quat.w]);
	}

	/** 外部修改绑定姿势后，把标记与骨骼线刷新到新位置 */
	syncMarkersFromSkeleton() {
		const world = computeBindWorldMatrices(this.skeleton);
		for (const j of this.skeleton.joints) {
			const marker = this.markerMeshes.get(j.id);
			if (marker) marker.position.copy(new THREE.Vector3().setFromMatrixPosition(world.get(j.id)!));
		}
		this.refreshBoneLines();
	}

	// ---------------- 指针交互 ----------------

	private updatePointer(event: PointerEvent) {
		const rect = this.renderer.domElement.getBoundingClientRect();
		this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
	}

	private hitTest(): { jointId: string | null; point: THREE.Vector3; meshPoint: THREE.Vector3 | null } {
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const markerArr = [...this.markerMeshes.values()];
		const hits = this.raycaster.intersectObjects(markerArr, false);
		const point = new THREE.Vector3();
		let jointId: string | null = null;
		if (hits.length > 0) {
			jointId = hits[0].object.userData.jointId as string;
			point.copy(hits[0].point);
		}
		// 与网格求交（加点 / 画刷定位用）
		const meshTargets: THREE.Object3D[] = [];
		if (this.meshObject?.visible) meshTargets.push(this.meshObject);
		const skinned = this.scene.children.find((c) => c instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh | undefined;
		if (skinned) meshTargets.push(skinned);
		const meshHits = this.raycaster.intersectObjects(meshTargets, false);
		const meshPoint = meshHits.length > 0 ? meshHits[0].point.clone() : null;
		if (!jointId && meshPoint) point.copy(meshPoint);
		else if (!jointId) this.raycaster.ray.at(1.5, point);
		return { jointId, point, meshPoint };
	}

	private onPointerDown = (event: PointerEvent) => {
		this.updatePointer(event);
		this.downPos.set(event.clientX, event.clientY);
		const hit = this.hitTest();
		this.downHit = { jointId: hit.jointId, point: hit.point.clone() };
		if (this.tool === 'paint') {
			this.painting = true;
			this.applyPaint(hit);
		}
	};

	private onPointerMove = (event: PointerEvent) => {
		this.updatePointer(event);
		const hit = this.hitTest();
		if (this.tool === 'paint') {
			this.brushHelper.visible = true;
			this.brushHelper.position.copy(hit.meshPoint ?? hit.point);
			this.brushHelper.scale.setScalar(this.brushRadius);
			if (this.painting) this.applyPaint(hit);
		} else {
			this.brushHelper.visible = false;
		}
	};

	private onPointerUp = (event: PointerEvent) => {
		const moved = Math.hypot(event.clientX - this.downPos.x, event.clientY - this.downPos.y);
		this.painting = false;
		if (moved > 5) return; // 拖拽不触发点击语义
		if (this.tool === 'addJoint' && this.downHit.point) {
			this.cb.onAddJointAt?.(this.downHit.point.clone());
			return;
		}
		if (this.tool === 'select') {
			this.selectJoint(this.downHit.jointId);
		}
	};

	private onPointerLeave = () => {
		this.painting = false;
		this.brushHelper.visible = false;
	};

	// ---------------- 权重画刷 ----------------

	brushRadius = 0.14;
	brushStrength = 0.18;
	brushReplace = false;

	private applyPaint(hit: { point: THREE.Vector3; meshPoint: THREE.Vector3 | null }) {
		if (!this.meshGeometry || !this.selectedId) return;
		const center = hit.meshPoint ?? hit.point;
		const positions = this.meshGeometry.attributes.position.array as Float32Array;
		const indices: number[] = [];
		for (let i = 0; i < this.meshGeometry.attributes.position.count; i++) indices.push(i);
		const next = paintWeights(
			this.weights,
			indices,
			positions,
			center,
			this.selectedId,
			this.brushStrength,
			this.brushRadius,
			this.brushReplace
		);
		this.weights = next;
		this.binding.updateWeightColors(next);
		this.cb.onPaint?.(next);
	}

	// ---------------- 姿态与轨迹 ----------------

	applyAnimatedPose(pose: Record<string, JointTransform>) {
		if (this.skeleton.joints.length === 0) return;
		const world = computePoseWorldMatrices(this.skeleton, pose);
		this.binding.applyPose(world);
		// 同步关节标记位置
		for (const j of this.skeleton.joints) {
			const marker = this.markerMeshes.get(j.id);
			const m = world.get(j.id);
			if (marker && m) marker.position.copy(new THREE.Vector3().setFromMatrixPosition(m));
		}
		this.refreshBoneLinesFromWorld(world);
	}

	private refreshBoneLinesFromWorld(world: Map<string, THREE.Matrix4>) {
		if (!this.boneLines) return;
		const attr = this.boneLines.geometry.attributes.position as THREE.BufferAttribute;
		let k = 0;
		for (const j of this.skeleton.joints) {
			if (!j.parentId || !world.has(j.parentId)) continue;
			const a = new THREE.Vector3().setFromMatrixPosition(world.get(j.parentId)!);
			const b = new THREE.Vector3().setFromMatrixPosition(world.get(j.id)!);
			attr.setXYZ(k++, a.x, a.y, a.z);
			attr.setXYZ(k++, b.x, b.y, b.z);
		}
		attr.needsUpdate = true;
		this.boneLines.geometry.computeBoundingSphere();
	}

	showTrajectory(points: [number, number, number][]) {
		this.clearTrajectory();
		if (points.length < 2) return;
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
		this.trajectoryLine = new THREE.Line(
			geo,
			new THREE.LineBasicMaterial({ color: 0xffd166, linewidth: 2 })
		);
		this.scene.add(this.trajectoryLine);
	}

	clearTrajectory() {
		if (this.trajectoryLine) {
			this.scene.remove(this.trajectoryLine);
			this.trajectoryLine.geometry.dispose();
			this.trajectoryLine = null;
		}
	}

	// ---------------- 工具方法 ----------------

	frameCamera() {
		const box = new THREE.Box3();
		if (this.meshObject) box.expandByObject(this.meshObject);
		const skinned = this.scene.children.find((c) => c instanceof THREE.SkinnedMesh);
		if (skinned) box.expandByObject(skinned);
		if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(2, 2, 2));
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z);
		const dist = maxDim * 1.8;
		this.camera.position.set(center.x + dist, center.y + dist * 0.6, center.z + dist);
		this.orbit.target.copy(center);
		this.orbit.update();
	}

	captureFrame(): string {
		this.renderer.render(this.scene, this.camera);
		return this.renderer.domElement.toDataURL('image/png');
	}

	resize() {
		const w = this.container.clientWidth;
		const h = this.container.clientHeight;
		if (w === 0 || h === 0) return;
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(w, h);
	}

	getJointWorldPosition(jointId: string): [number, number, number] | null {
		const m = this.markerMeshes.get(jointId);
		if (!m) return null;
		return [m.position.x, m.position.y, m.position.z];
	}

	private animate = () => {
		this.raf = requestAnimationFrame(this.animate);
		this.orbit.update();
		this.renderer.render(this.scene, this.camera);
	};

	dispose() {
		cancelAnimationFrame(this.raf);
		this.resizeObserver.disconnect();
		const dom = this.renderer.domElement;
		dom.removeEventListener('pointerdown', this.onPointerDown);
		dom.removeEventListener('pointermove', this.onPointerMove);
		dom.removeEventListener('pointerup', this.onPointerUp);
		dom.removeEventListener('pointerleave', this.onPointerLeave);
		this.transform.dispose();
		this.orbit.dispose();
		this.binding.dispose();
		this.renderer.dispose();
		this.canvas.remove();
		dom.remove();
	}

	// 供外部查询当前骨架（树组件等）
	getSkeleton(): SkeletonData {
		return this.skeleton;
	}

	jointData(id: string): JointData | undefined {
		return jointMap(this.skeleton).get(id);
	}
}
