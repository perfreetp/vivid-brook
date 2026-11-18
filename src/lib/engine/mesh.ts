import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * 内置简化人体网格（胶囊躯干 + 四肢），
 * 保证零外部素材也能直接演示骨骼绑定与权重流程。
 */
export function buildBuiltinHumanoid(): THREE.BufferGeometry {
	const geos: THREE.BufferGeometry[] = [];
	const put = (geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rz = 0) => {
		const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz));
		const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
		geo.applyMatrix4(m);
		geos.push(geo);
	};

	// 躯干（y 轴朝上，身高约 1.8）
	put(new THREE.CapsuleGeometry(0.16, 0.42, 6, 12), 0, 1.18, 0);
	// 头
	put(new THREE.SphereGeometry(0.12, 16, 12), 0, 1.62, 0);
	// 颈
	put(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), 0, 1.46, 0);
	// 上臂 / 前臂 / 手
	put(new THREE.CapsuleGeometry(0.055, 0.26, 4, 10), -0.27, 1.28, 0, 0, 0.08);
	put(new THREE.CapsuleGeometry(0.055, 0.26, 4, 10), 0.27, 1.28, 0, 0, -0.08);
	put(new THREE.CapsuleGeometry(0.045, 0.24, 4, 10), -0.33, 0.98, 0, 0, 0.05);
	put(new THREE.CapsuleGeometry(0.045, 0.24, 4, 10), 0.33, 0.98, 0, 0, -0.05);
	put(new THREE.SphereGeometry(0.05, 10, 8), -0.35, 0.72, 0);
	put(new THREE.SphereGeometry(0.05, 10, 8), 0.35, 0.72, 0);
	// 大腿 / 小腿 / 脚
	put(new THREE.CapsuleGeometry(0.075, 0.34, 4, 10), -0.1, 0.62, 0);
	put(new THREE.CapsuleGeometry(0.075, 0.34, 4, 10), 0.1, 0.62, 0);
	put(new THREE.CapsuleGeometry(0.06, 0.32, 4, 10), -0.1, 0.25, 0);
	put(new THREE.CapsuleGeometry(0.06, 0.32, 4, 10), 0.1, 0.25, 0);
	put(new THREE.BoxGeometry(0.1, 0.07, 0.18), -0.1, 0.05, 0.04);
	put(new THREE.BoxGeometry(0.1, 0.07, 0.18), 0.1, 0.05, 0.04);

	const merged = mergeGeometries(geos);
	merged.computeVertexNormals();
	return merged;
}

/** 简易几何合并（避免引入额外 BufferGeometryUtils 依赖链问题） */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
	let vertexCount = 0;
	let indexCount = 0;
	let hasIndex = true;
	for (const g of geos) {
		vertexCount += g.attributes.position.count;
		if (!g.index) hasIndex = false;
		else indexCount += g.index.count;
	}
	const positions = new Float32Array(vertexCount * 3);
	const normals = new Float32Array(vertexCount * 3);
	const indices: number[] = [];
	let voffset = 0;
	for (const g of geos) {
		const p = g.attributes.position.array as Float32Array;
		positions.set(p, voffset * 3);
		const n = g.attributes.normal?.array as Float32Array | undefined;
		if (n) normals.set(n, voffset * 3);
		if (hasIndex && g.index) {
			const idx = g.index.array;
			for (let i = 0; i < idx.length; i++) indices.push(idx[i] + voffset);
		}
		voffset += g.attributes.position.count;
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
	if (hasIndex) out.setIndex(indices);
	return out;
}

export interface ImportedMesh {
	geometry: THREE.BufferGeometry;
	name: string;
	source: 'obj' | 'gltf';
}

export async function importMeshFile(file: File): Promise<ImportedMesh> {
	const ext = file.name.split('.').pop()?.toLowerCase();
	const url = URL.createObjectURL(file);
	try {
		if (ext === 'obj') {
			const obj = await new OBJLoader().loadAsync(url);
			const geo = extractFirstGeometry(obj);
			return { geometry: geo, name: file.name, source: 'obj' };
		}
		if (ext === 'gltf' || ext === 'glb') {
			const gltf = await new GLTFLoader().loadAsync(url);
			const geo = extractFirstGeometry(gltf.scene);
			return { geometry: geo, name: file.name, source: 'gltf' };
		}
		throw new Error(`不支持的网格格式：${ext}（仅支持 .obj / .glb / .gltf）`);
	} finally {
		URL.revokeObjectURL(url);
	}
}

function extractFirstGeometry(root: THREE.Object3D): THREE.BufferGeometry {
	let found: THREE.BufferGeometry | null = null;
	root.updateMatrixWorld(true);
	root.traverse((obj) => {
		if (found) return;
		const mesh = obj as THREE.Mesh;
		if (mesh.isMesh && mesh.geometry) {
			const geo = mesh.geometry.clone();
			geo.applyMatrix4(mesh.matrixWorld);
			found = geo;
		}
	});
	if (!found) throw new Error('文件中没有找到可用的网格');
	const geo: THREE.BufferGeometry = found;
	if (!geo.attributes.normal) geo.computeVertexNormals();
	return geo;
}
