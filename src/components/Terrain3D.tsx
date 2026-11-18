import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Feature } from '../types';
import { useEditor } from '../state/store';
import { KIND_META } from '../lib/factory';
import { pointInPolygon, pointSegDist, offsetOpenPath } from '../lib/geometry';

/** 简易确定性噪声，避免每帧抖动 */
function noise(x: number, z: number): number {
  return (
    Math.sin(x * 0.021) * Math.cos(z * 0.017) * 0.9 +
    Math.sin(x * 0.05 + 2.1) * Math.cos(z * 0.043 - 0.7) * 0.4
  );
}

/** 在 (x,z) 处计算地形高程：池内/渠内下沉，其余为缓起伏 */
function sampleHeight(x: number, z: number, features: Feature[]): number {
  let h = noise(x, z) * 0.6;
  let cut = 0;
  for (const f of features) {
    if (!f.visible || f.role === 'bank') continue;
    if (f.pathType === 'closed' && f.points.length >= 3) {
      if (pointInPolygon({ x, y: z }, f.points)) {
        let inHole = false;
        for (const hole of f.holes) {
          if (pointInPolygon({ x, y: z }, hole)) {
            inHole = true;
            break;
          }
        }
        if (!inHole) cut = Math.max(cut, f.depth);
      }
    } else if (f.points.length >= 2) {
      const half = Math.max(f.width / 2, 0.8);
      for (let i = 0; i < f.points.length - 1; i++) {
        const r = pointSegDist({ x, y: z }, f.points[i], f.points[i + 1]);
        if (r.distance < half) {
          // 渠底平、坡面按边坡比过渡
          const over = half - r.distance;
          const slopePart = Math.min(over, f.depth * f.slope);
          const d = Math.min(f.depth, slopePart / Math.max(f.slope, 0.1));
          cut = Math.max(cut, d);
        }
      }
    }
  }
  return h - cut;
}

export default function Terrain3D() {
  const state = useEditor();
  const mountRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const features = state.features;

  // 几何签名：仅当点位/尺寸变化时重建
  const signature = useMemo(
    () =>
      JSON.stringify(
        features
          .filter((f) => f.role !== 'bank')
          .map((f) => ({
            id: f.id,
            k: f.kind,
            w: f.width,
            d: f.depth,
            s: f.slope,
            v: f.visible,
            p: f.points,
            h: f.holes,
          })),
      ),
    [features],
  );

  useEffect(() => {
    if (collapsed) return;
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = mount.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#eef2f7');

    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 5000);
    camera.position.set(320, 300, 320);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.target.set(0, -2, 0);

    // 光照
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(200, 400, 150);
    scene.add(sun);

    // 20m 网格参考
    const grid = new THREE.GridHelper(800, 40, 0x94a3b8, 0xcbd5e1);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    const group = new THREE.Group();
    scene.add(group);

    // ---- 地形曲面 ----
    const SIZE = 760;
    const SEG = 90;
    const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    terrainGeo.rotateX(-Math.PI / 2);
    const pos = terrainGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, sampleHeight(x, z, features));
    }
    terrainGeo.computeVertexNormals();
    const terrain = new THREE.Mesh(
      terrainGeo,
      new THREE.MeshStandardMaterial({ color: 0xd8c9a3, roughness: 1, metalness: 0, flatShading: false }),
    );
    group.add(terrain);

    // ---- 卤水池：带孔洞的拉伸体（池埂交线/缺口随布尔孔洞呈现） ----
    for (const f of features) {
      if (!f.visible || f.pathType !== 'closed' || f.points.length < 3) continue;
      const shape = new THREE.Shape(f.points.map((p) => new THREE.Vector2(p.x, p.y)));
      for (const hole of f.holes) {
        if (hole.length < 3) continue;
        const path = new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y)));
        shape.holes.push(path);
      }
      const geo = new THREE.ExtrudeGeometry(shape, { depth: f.depth, bevelEnabled: false });
      geo.rotateX(Math.PI / 2); // 形状平面落到 XZ，深度朝 -Y（向下开挖）
      const color = new THREE.Color(KIND_META[f.kind].color);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, transparent: true, opacity: 0.88 }),
      );
      group.add(mesh);
    }

    // ---- 纳潮渠 / 排淡沟：沿路径的等宽带状体 ----
    for (const f of features) {
      if (!f.visible || f.pathType !== 'open' || f.points.length < 2) continue;
      const half = Math.max(f.width / 2, 0.8);
      const { left, right } = offsetOpenPath(f.points, half);
      const verts: number[] = [];
      for (let i = 0; i < left.length; i++) {
        verts.push(left[i].x, 0.08, left[i].y, right[i].x, 0.08, right[i].y);
      }
      const idx: number[] = [];
      for (let i = 0; i < left.length - 1; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(KIND_META[f.kind].color),
          roughness: 0.55,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
        }),
      );
      group.add(mesh);

      // 沟沿虚线（偏移生成的 bank 要素）以细线表示
      for (const bank of features.filter((b) => b.sourceId === f.id)) {
        const linePts = bank.points.map((p) => new THREE.Vector3(p.x, 0.25, p.y));
        const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
        const line = new THREE.Line(
          lineGeo,
          new THREE.LineDashedMaterial({ color: 0x334155, dashSize: 4, gapSize: 3 }),
        );
        line.computeLineDistances();
        group.add(line);
      }
    }

    // 坐标轴小标识
    const axes = new THREE.AxesHelper(60);
    axes.position.set(-SIZE / 2 + 20, 1, -SIZE / 2 + 20);
    scene.add(axes);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry?.dispose();
          const m = obj.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m?.dispose();
        }
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // signature 控制重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, collapsed]);

  return (
    <div className={`terrain-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="terrain-header" onClick={() => setCollapsed((c) => !c)}>
        <strong>三维地形参考底图（three.js）</strong>
        <span className="terrain-toggle">{collapsed ? '展开 ▲' : '收起 ▼'}</span>
      </div>
      {!collapsed && <div ref={mountRef} className="terrain-mount" />}
    </div>
  );
}
