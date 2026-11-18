import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useStore, statusOf } from '../store/store';
import {
  COMPONENTS, COMP_BY_ID, TYPES, TYPE_LIST, POOLS, ZONES,
  PIPE_SEGS, PIPE_DIAMS, PIPE_COLORS, WARN_POLYS, TREES, PARK, STATUS_COLORS,
} from '../data/surveyData';

// ---------------- 纹理工具 ----------------
function makeIconTexture(shape) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  g.lineWidth = 5;
  g.beginPath();
  if (shape === 'tri') {
    g.moveTo(32, 8); g.lineTo(56, 52); g.lineTo(8, 52); g.closePath(); g.fill();
  } else if (shape === 'square') {
    g.fillRect(12, 12, 40, 40);
  } else if (shape === 'circle') {
    g.arc(32, 32, 22, 0, Math.PI * 2); g.fill();
  } else if (shape === 'diamond') {
    g.moveTo(32, 6); g.lineTo(58, 32); g.lineTo(32, 58); g.lineTo(6, 32); g.closePath(); g.fill();
  } else if (shape === 'grid') {
    g.fillRect(8, 8, 48, 48);
    g.globalCompositeOperation = 'destination-out';
    g.lineWidth = 6;
    for (let i = 20; i <= 44; i += 12) {
      g.beginPath(); g.moveTo(i, 8); g.lineTo(i, 56); g.stroke();
      g.beginPath(); g.moveTo(8, i); g.lineTo(56, i); g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function makeArrowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(6, 26); g.lineTo(38, 26); g.lineTo(38, 16); g.lineTo(58, 32);
  g.lineTo(38, 48); g.lineTo(38, 38); g.lineTo(6, 38); g.closePath(); g.fill();
  return new THREE.CanvasTexture(c);
}

function makeRingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = '#ffffff';
  g.lineWidth = 7;
  g.beginPath(); g.arc(32, 32, 25, 0, Math.PI * 2); g.stroke();
  return new THREE.CanvasTexture(c);
}

function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 2, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

const shortId = (id) => id.split('-').slice(1).join('-');
const LEVEL_OF_WIDTH = (w) => (w > 700 ? 'park' : w > 180 ? 'zone' : 'pool');

export default function MapView() {
  const mountRef = useRef(null);
  const labelLayerRef = useRef(null);
  const boxRef = useRef(null);
  const apiRef = useRef({});

  const layers = useStore((s) => s.layers);
  const typeToggles = useStore((s) => s.typeToggles);
  const flyTarget = useStore((s) => s.flyTarget);
  const exportTick = useStore((s) => s.exportTick);
  const statusVersion = useStore((s) => s.statusVersion);
  const selection = useStore((s) => s.selection);
  const focused = useStore((s) => s.focused);

  // ================= 初始化(仅一次) =================
  useEffect(() => {
    const mount = mountRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.style.display = 'block';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e6edf1');

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
    camera.position.set(PARK.w / 2, PARK.h / 2, 1000);
    camera.lookAt(PARK.w / 2, PARK.h / 2, 0);

    const view = { cx: PARK.w / 2, cy: PARK.h / 2, zoom: 1 };
    const target = { ...view };
    const dirtyRef = { value: true };
    const levelRef = { current: 'park' };
    const labelsRef = { current: [] };

    // ---------- 底图:园区边界 ----------
    const borderGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(20, 20, 0), new THREE.Vector3(PARK.w - 20, 20, 0),
      new THREE.Vector3(PARK.w - 20, PARK.h - 20, 0), new THREE.Vector3(20, PARK.h - 20, 0),
      new THREE.Vector3(20, 20, 0),
    ]);
    scene.add(new THREE.Line(borderGeo, new THREE.LineBasicMaterial({ color: '#90a4ae' })));

    // ---------- 池体填充 + 轮廓(各级都显示) ----------
    const poolGroup = new THREE.Group();
    const poolFillMeshes = [];
    for (const pool of POOLS) {
      const shape = new THREE.Shape(pool.poly.map(([x, y]) => new THREE.Vector2(x, y)));
      const fill = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: '#8fd3ea', transparent: true, opacity: 0.55 })
      );
      fill.userData.pool = pool;
      poolFillMeshes.push(fill);
      poolGroup.add(fill);
      const outlinePts = pool.poly.map(([x, y]) => new THREE.Vector3(x, y, 0.5));
      outlinePts.push(outlinePts[0].clone());
      poolGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(outlinePts),
        new THREE.LineBasicMaterial({ color: '#2b7a9c' })
      ));
    }
    scene.add(poolGroup);

    // ---------- 管线层(按管径分色,交叉已断开) ----------
    const pipelineGroup = new THREE.Group();
    for (const diam of PIPE_DIAMS) {
      const segs = PIPE_SEGS.filter((s) => s.diam === diam);
      const pos = new Float32Array(segs.length * 6);
      segs.forEach((s, i) => {
        pos.set([s.x1, s.y1, 1, s.x2, s.y2, 1], i * 6);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      pipelineGroup.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: PIPE_COLORS[diam] })));
    }
    scene.add(pipelineGroup);

    // ---------- 绿化层 ----------
    const treeGeo = new THREE.BufferGeometry();
    treeGeo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array(TREES.flatMap((t) => [t.x, t.y, 0.2])), 3));
    const greenGroup = new THREE.Group();
    greenGroup.add(new THREE.Points(treeGeo, new THREE.PointsMaterial({
      color: '#66bb6a', size: 8, sizeAttenuation: false, map: makeDotTexture(),
      transparent: true, alphaTest: 0.3, depthWrite: false,
    })));
    scene.add(greenGroup);

    // ---------- 警戒线层 ----------
    const warnGroup = new THREE.Group();
    for (const w of WARN_POLYS) {
      const pts = w.poly.map(([x, y]) => new THREE.Vector3(x, y, 0.6));
      pts.push(pts[0].clone());
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({ color: '#e53935', dashSize: 5, gapSize: 4 })
      );
      line.computeLineDistances();
      warnGroup.add(line);
    }
    scene.add(warnGroup);

    // ---------- 设备层:全园点阵 ----------
    const compPos = new Float32Array(COMPONENTS.length * 3);
    const compCol = new Float32Array(COMPONENTS.length * 3);
    COMPONENTS.forEach((c, i) => compPos.set([c.x, c.y, 2], i * 3));
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(compPos, 3));
    pointsGeo.setAttribute('color', new THREE.BufferAttribute(compCol, 3));
    const pointsMesh = new THREE.Points(pointsGeo, new THREE.PointsMaterial({
      size: 3.5, sizeAttenuation: false, vertexColors: true,
    }));
    scene.add(pointsMesh);

    // ---------- 设备层:片区级构件图标(InstancedMesh,每类一次 draw call) ----------
    const iconMeshes = {};
    const iconGroup = new THREE.Group();
    const tmpM = new THREE.Matrix4();
    const tmpC = new THREE.Color();
    for (const type of TYPE_LIST) {
      const comps = COMPONENTS.filter((c) => c.type === type);
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(6, 6),
        new THREE.MeshBasicMaterial({ map: makeIconTexture(TYPES[type].shape), transparent: true, alphaTest: 0.4, depthWrite: false }),
        comps.length
      );
      comps.forEach((c, i) => {
        tmpM.makeTranslation(c.x, c.y, 3);
        mesh.setMatrixAt(i, tmpM);
        mesh.setColorAt(i, tmpC.set('#ffffff'));
      });
      mesh.userData.comps = comps;
      mesh.userData.type = type;
      iconMeshes[type] = mesh;
      iconGroup.add(mesh);
    }
    scene.add(iconGroup);

    // ---------- 设备层:池体级喷淋头朝向箭头 ----------
    const sprinklers = COMPONENTS.filter((c) => c.type === 'SP');
    const arrowMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({ map: makeArrowTexture(), transparent: true, alphaTest: 0.4, depthWrite: false, color: '#c62828' }),
      sprinklers.length
    );
    sprinklers.forEach((c, i) => {
      tmpM.makeRotationZ((c.angle * Math.PI) / 180).setPosition(c.x, c.y, 4);
      arrowMesh.setMatrixAt(i, tmpM);
    });
    scene.add(arrowMesh);

    // ---------- 选中高亮描边 ----------
    const ringMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(11, 11),
      new THREE.MeshBasicMaterial({ map: makeRingTexture(), transparent: true, alphaTest: 0.3, depthWrite: false, color: '#ff2d55' }),
      1024
    );
    ringMesh.count = 0;
    scene.add(ringMesh);

    // ================= 相机与交互 =================
    const zoomFor = (worldWidth) => mount.clientWidth / worldWidth;

    function resize() {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.left = -w / 2; camera.right = w / 2;
      camera.top = h / 2; camera.bottom = -h / 2;
      camera.updateProjectionMatrix();
      dirtyRef.value = true;
    }
    resize();
    // 初始视野:全园
    view.zoom = target.zoom = Math.min(mount.clientWidth / (PARK.w + 160), mount.clientHeight / (PARK.h + 160));
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    function applyCamera() {
      camera.position.x = view.cx;
      camera.position.y = view.cy;
      camera.zoom = view.zoom;
      camera.updateProjectionMatrix();
    }

    function currentWorldWidth() {
      return mount.clientWidth / view.zoom;
    }

    function applyVisibility() {
      const st = useStore.getState();
      const lv = levelRef.current;
      pipelineGroup.visible = st.layers.pipeline;
      greenGroup.visible = st.layers.green;
      warnGroup.visible = st.layers.warn;
      pointsMesh.visible = st.layers.device && lv === 'park';
      iconGroup.visible = st.layers.device && lv !== 'park';
      arrowMesh.visible = st.layers.device && lv === 'pool' && st.typeToggles.SP;
      for (const t of TYPE_LIST) iconMeshes[t].visible = st.typeToggles[t];
    }

    function updateLOD() {
      const lv = LEVEL_OF_WIDTH(currentWorldWidth());
      if (lv !== levelRef.current) {
        levelRef.current = lv;
        useStore.getState().setViewLevel(lv);
        useStore.getState().setPopup(null);
      }
      applyVisibility();
    }

    function colorOf(comp) {
      const st = statusOf(comp);
      return st === '正常' ? TYPES[comp.type].color : STATUS_COLORS[st];
    }

    function updateColors() {
      for (const type of TYPE_LIST) {
        const mesh = iconMeshes[type];
        mesh.userData.comps.forEach((c, i) => mesh.setColorAt(i, tmpC.set(colorOf(c))));
        mesh.instanceColor.needsUpdate = true;
      }
      COMPONENTS.forEach((c, i) => {
        tmpC.set(colorOf(c));
        compCol.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
      });
      pointsGeo.attributes.color.needsUpdate = true;
      dirtyRef.value = true;
    }
    updateColors();

    function updateRings() {
      const st = useStore.getState();
      const ids = st.selection;
      const n = Math.min(ids.length, 1024);
      for (let i = 0; i < n; i++) {
        const c = COMP_BY_ID[ids[i]];
        if (!c) continue;
        tmpM.makeTranslation(c.x, c.y, 5);
        ringMesh.setMatrixAt(i, tmpM);
      }
      ringMesh.count = n;
      ringMesh.instanceMatrix.needsUpdate = true;
      dirtyRef.value = true;
    }

    // ---------- 标注(自动抽稀):DOM 覆盖层,节点复用 ----------
    function updateLabels() {
      const cont = labelLayerRef.current;
      if (!cont) return;
      const st = useStore.getState();
      const lv = levelRef.current;
      const w = mount.clientWidth, h = mount.clientHeight;
      const labels = [];
      const toScreen = (x, y) => [(x - view.cx) * view.zoom + w / 2, (view.cy - y) * view.zoom + h / 2];

      if (lv === 'park') {
        for (const z of ZONES) {
          const [sx, sy] = toScreen(z.rect[0] + z.rect[2] / 2, z.rect[1] + z.rect[3] / 2);
          labels.push({ sx, sy, text: z.name, cls: 'zone' });
        }
      } else {
        const hw = w / 2 / view.zoom, hh = h / 2 / view.zoom;
        for (const p of POOLS) {
          if (p.cx < view.cx - hw || p.cx > view.cx + hw || p.cy < view.cy - hh || p.cy > view.cy + hh) continue;
          const [sx, sy] = toScreen(p.cx, p.cy);
          labels.push({ sx, sy, text: p.name, cls: 'pool' });
        }
        if (st.layers.device) {
          const selSet = new Set(st.selection);
          const occ = new Set();
          const cand = [];
          for (const c of COMPONENTS) {
            if (c.x < view.cx - hw || c.x > view.cx + hw || c.y < view.cy - hh || c.y > view.cy + hh) continue;
            if (!st.typeToggles[c.type]) continue;
            const text = lv === 'pool' && c.type === 'SP' ? `${shortId(c.id)} ${c.angle}°` : shortId(c.id);
            cand.push({ c, text, sel: selSet.has(c.id) });
          }
          cand.sort((a, b) => (b.sel - a.sel) || a.c.id.localeCompare(b.c.id));
          let placed = 0;
          for (const { c, text, sel } of cand) {
            if (placed >= 90) break;
            const [sx, sy] = toScreen(c.x, c.y);
            const key = `${Math.floor(sx / 108)}:${Math.floor(sy / 20)}`;
            if (occ.has(key)) continue; // 重叠抽稀
            occ.add(key);
            labels.push({ sx, sy, text, cls: sel ? 'sel' : 'dev' });
            placed++;
          }
        }
      }

      labelsRef.current = labels;
      const kids = cont.children;
      let i = 0;
      for (const L of labels) {
        let d = kids[i];
        if (!d) { d = document.createElement('div'); cont.appendChild(d); }
        d.className = `map-label ${L.cls}`;
        d.style.display = 'block';
        d.style.transform = `translate(${L.sx}px, ${L.sy}px) translate(-50%, -135%)`;
        d.textContent = L.text;
        i++;
      }
      for (; i < kids.length; i++) kids[i].style.display = 'none';
    }

    // ---------- 渲染循环:阻尼趋近目标,静止时不再重绘 ----------
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const k = 0.2;
      const dx = target.cx - view.cx, dy = target.cy - view.cy, dz = target.zoom - view.zoom;
      if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001 || Math.abs(dz) > 1e-5) {
        view.cx += dx * k; view.cy += dy * k; view.zoom += dz * k;
        dirtyRef.value = true;
      }
      if (dirtyRef.value) {
        applyCamera();
        updateLOD();
        updateLabels();
        renderer.render(scene, camera);
        dirtyRef.value = false;
      }
    };
    loop();

    // ---------- 指针交互:平移 / 点选 / 框选 ----------
    const raycaster = new THREE.Raycaster();
    let drag = null; // {sx, sy, moved, box}
    const boxDiv = boxRef.current;

    function toWorld(px, py) {
      const w = mount.clientWidth, h = mount.clientHeight;
      return [view.cx + (px - w / 2) / view.zoom, view.cy - (py - h / 2) / view.zoom];
    }

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      drag = { sx: e.clientX - rect.left, sy: e.clientY - rect.top, moved: 0, box: e.shiftKey };
      if (drag.box) {
        boxDiv.style.display = 'block';
        boxDiv.style.left = `${drag.sx}px`; boxDiv.style.top = `${drag.sy}px`;
        boxDiv.style.width = '0px'; boxDiv.style.height = '0px';
      }
      useStore.getState().setPopup(null);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const dx = px - drag.sx, dy = py - drag.sy;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      if (drag.box) {
        boxDiv.style.left = `${Math.min(drag.sx, px)}px`;
        boxDiv.style.top = `${Math.min(drag.sy, py)}px`;
        boxDiv.style.width = `${Math.abs(dx)}px`;
        boxDiv.style.height = `${Math.abs(dy)}px`;
      } else if (drag.moved > 3) {
        // 平移:直接跟手,保证 60 帧
        view.cx -= (e.movementX || 0) / view.zoom;
        view.cy += (e.movementY || 0) / view.zoom;
        target.cx = view.cx; target.cy = view.cy;
        dirtyRef.value = true;
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const st = useStore.getState();
      if (drag.box) {
        boxDiv.style.display = 'none';
        if (drag.moved > 8 && levelRef.current !== 'park') {
          const [x1, y1] = toWorld(Math.min(drag.sx, px), Math.max(drag.sy, py));
          const [x2, y2] = toWorld(Math.max(drag.sx, px), Math.min(drag.sy, py));
          const ids = COMPONENTS.filter((c) =>
            c.x >= x1 && c.x <= x2 && c.y >= y1 && c.y <= y2 && st.typeToggles[c.type]
          ).map((c) => c.id);
          st.setSelection(ids);
          st.setFocused(null);
        }
        drag = null;
        return;
      }
      if (drag.moved <= 4) {
        // 点选
        const ndc = new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        if (levelRef.current === 'park') {
          const hits = raycaster.intersectObjects(poolFillMeshes);
          if (hits.length) {
            const pool = hits[0].object.userData.pool;
            const zone = ZONES.find((z) => z.id === pool.zoneId);
            target.cx = zone.rect[0] + zone.rect[2] / 2;
            target.cy = zone.rect[1] + zone.rect[3] / 2;
            target.zoom = zoomFor(430);
          }
        } else {
          const visible = TYPE_LIST.filter((t) => st.typeToggles[t]).map((t) => iconMeshes[t]);
          const hits = raycaster.intersectObjects(visible);
          if (hits.length) {
            const { object, instanceId } = hits[0];
            const comp = object.userData.comps[instanceId];
            st.setSelection([comp.id]);
            st.setFocused(comp.id);
            st.setPopup({ id: comp.id, sx: px, sy: py });
          } else {
            st.setSelection([]);
            st.setFocused(null);
          }
        }
      }
      drag = null;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const w = mount.clientWidth, h = mount.clientHeight;
      const f = Math.exp(-e.deltaY * 0.0012);
      const minZoom = zoomFor(1500), maxZoom = zoomFor(40);
      const nz = Math.min(Math.max(target.zoom * f, minZoom), maxZoom);
      // 以光标为锚点缩放
      const wx = target.cx + (px - w / 2) / target.zoom;
      const wy = target.cy - (py - h / 2) / target.zoom;
      target.zoom = nz;
      target.cx = wx - (px - w / 2) / nz;
      target.cy = wy + (py - h / 2) / nz;
      dirtyRef.value = true;
    }, { passive: false });

    canvas.addEventListener('dblclick', (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const w = mount.clientWidth, h = mount.clientHeight;
      const wx = target.cx + (px - w / 2) / target.zoom;
      const wy = target.cy - (py - h / 2) / target.zoom;
      target.cx = wx; target.cy = wy;
      target.zoom = Math.min(target.zoom * 2.5, zoomFor(40));
      dirtyRef.value = true;
    });

    // ================= 对外 API =================
    apiRef.current = {
      invalidate: () => { dirtyRef.value = true; },
      applyVisibility: () => { applyVisibility(); dirtyRef.value = true; },
      updateColors,
      updateRings,
      flyTo: (x, y, worldWidth) => {
        target.cx = x; target.cy = y;
        target.zoom = zoomFor(worldWidth);
        dirtyRef.value = true;
      },
      flyToLevel: (lv) => {
        if (lv === 'park') {
          target.cx = PARK.w / 2; target.cy = PARK.h / 2;
          target.zoom = Math.min(mount.clientWidth / (PARK.w + 160), mount.clientHeight / (PARK.h + 160));
        } else if (lv === 'zone') {
          target.zoom = zoomFor(430);
        } else {
          target.zoom = zoomFor(95);
        }
        dirtyRef.value = true;
      },
      exportPNG: () => {
        applyCamera();
        renderer.render(scene, camera);
        const pr = renderer.getPixelRatio();
        const src = renderer.domElement;
        const headerH = 64, footerH = 56;
        const out = document.createElement('canvas');
        out.width = src.width;
        out.height = src.height + (headerH + footerH) * pr;
        const g = out.getContext('2d');
        g.scale(pr, pr);
        const W = src.width / pr, H = src.height / pr;
        // 页眉
        g.fillStyle = '#0d3b5c';
        g.fillRect(0, 0, W, headerH);
        g.fillStyle = '#ffffff';
        g.font = 'bold 22px "Microsoft YaHei", sans-serif';
        g.fillText(`${PARK.name} · 园区平面总图`, 20, 32);
        g.font = '13px "Microsoft YaHei", sans-serif';
        const lvName = { park: '全园', zone: '片区', pool: '池体' }[levelRef.current];
        g.fillText(`视口级别:${lvName}    视口宽度:约 ${Math.round(currentWorldWidth())} m    导出时间:${new Date().toLocaleString('zh-CN', { hour12: false })}`, 20, 52);
        // 图面
        g.drawImage(src, 0, 0, src.width, src.height, 0, headerH, W, H);
        // 标注叠加到导出图
        g.font = '10px "Microsoft YaHei", sans-serif';
        for (const L of labelsRef.current) {
          if (L.cls === 'zone' || L.cls === 'pool') continue;
          const tw = g.measureText(L.text).width;
          g.fillStyle = 'rgba(255,255,255,0.85)';
          g.fillRect(L.sx - tw / 2 - 3, L.sy + headerH - 24, tw + 6, 13);
          g.fillStyle = '#37474f';
          g.fillText(L.text, L.sx - tw / 2, L.sy + headerH - 14);
        }
        // 页脚图例
        g.fillStyle = '#f5f7f9';
        g.fillRect(0, headerH + H, W, footerH);
        g.fillStyle = '#37474f';
        g.font = '12px "Microsoft YaHei", sans-serif';
        let lx = 20;
        const ly = headerH + H + 22;
        g.fillText('图例:', lx, ly); lx += 40;
        for (const t of TYPE_LIST) {
          g.fillStyle = TYPES[t].color;
          g.fillRect(lx, ly - 10, 10, 10);
          g.fillStyle = '#37474f';
          g.fillText(TYPES[t].name, lx + 14, ly);
          lx += 14 + g.measureText(TYPES[t].name).width + 18;
        }
        for (const d of PIPE_DIAMS) {
          g.strokeStyle = PIPE_COLORS[d];
          g.lineWidth = 3;
          g.beginPath(); g.moveTo(lx, ly - 4); g.lineTo(lx + 18, ly - 4); g.stroke();
          g.fillStyle = '#37474f';
          g.fillText(`DN${d}`, lx + 22, ly);
          lx += 22 + g.measureText(`DN${d}`).width + 18;
        }
        g.fillStyle = '#78909c';
        g.fillText('红色虚线:警戒线    绿色点:绿化    管线交叉处断开表示下层位', lx + 10, ly);
        g.fillText(`${PARK.name} 运营部 · 园务会用图`, 20, headerH + H + 44);
        const a = document.createElement('a');
        a.download = `园区平面图_${lvName}_${Date.now()}.png`;
        a.href = out.toDataURL('image/png');
        a.click();
      },
    };
    useStore.getState().setMapApi(apiRef.current);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      mount.removeChild(canvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ================= 响应 store 变化 =================
  useEffect(() => { apiRef.current.applyVisibility?.(); }, [layers, typeToggles]);
  useEffect(() => { apiRef.current.updateColors?.(); }, [statusVersion]);
  useEffect(() => { apiRef.current.updateRings?.(); apiRef.current.invalidate?.(); }, [selection, focused]);
  useEffect(() => {
    if (flyTarget) apiRef.current.flyTo?.(flyTarget.x, flyTarget.y, flyTarget.worldWidth);
  }, [flyTarget]);
  useEffect(() => {
    if (exportTick > 0) apiRef.current.exportPNG?.();
  }, [exportTick]);

  return (
    <div ref={mountRef} className="map-canvas">
      <div ref={labelLayerRef} className="label-layer" />
      <div ref={boxRef} className="box-select" />
    </div>
  );
}
