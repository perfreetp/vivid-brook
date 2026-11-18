// 三维预览:Babylon.js,二维轮廓按流道高度拉伸,脱模方向干涉检查,面片反查二维图元
import { onMount, onCleanup, createEffect, createRoot, createMemo } from 'solid-js';
import { Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight, Vector2, Vector3, Color3, Color4, StandardMaterial, MeshBuilder, PointerEventTypes, LinesMesh } from '@babylonjs/core';
import earcut from 'earcut';
import { state, setState, entityList } from './store';
import { KINDS } from './entities';
import { pointInMP } from './geometry';

// 脱模干涉:顶针/水路与流道-浇口在 XY 投影重叠 → 顶出时打架
export const { demoldClashes } = createRoot(() => ({
  demoldClashes: createMemo(() => {
    const list = entityList().filter((e) => !e.hidden);
    const flow = list.filter((e) => ['sprue', 'runner', 'fanGate', 'composite'].includes(e.kind));
    const blockers = list.filter((e) => ['pin', 'cooling'].includes(e.kind));
    const clashes = [];
    for (const b of blockers) {
      for (const f of flow) {
        if (pointInMP(b.center, f.geomWorld)) {
          clashes.push({ blocker: b, flow: f });
          break;
        }
      }
    }
    return clashes;
  }),
}));

export default function Preview3D() {
  let canvas;
  let engine, scene;
  let meshes = [];
  let rebuildQueued = false;

  function clearMeshes() {
    for (const m of meshes) m.dispose();
    meshes = [];
  }

  function rebuild() {
    if (!scene) return;
    clearMeshes();
    const clashIds = new Set(demoldClashes().map((c) => c.blocker.id));
    const mats = {};
    const matFor = (kind, clash) => {
      const key = kind + (clash ? '!clash' : '');
      if (mats[key]) return mats[key];
      const m = new StandardMaterial(key, scene);
      const c = Color3.FromHexString(clash ? '#ff2222' : KINDS[kind].color);
      m.diffuseColor = c;
      m.specularColor = new Color3(0.15, 0.15, 0.15);
      if (clash) m.emissiveColor = new Color3(0.5, 0.05, 0.05);
      if (kind === 'cooling') m.alpha = 0.55;
      if (kind === 'insert') m.alpha = 0.35;
      mats[key] = m;
      return m;
    };

    for (const e of entityList()) {
      if (e.hidden) continue;
      const k = KINDS[e.kind];
      const height = e.kind === 'composite' ? (e.params.height || k.height) : k.height;
      for (const poly of e.geomWorld) {
        const shape = poly[0].map(([x, y]) => new Vector2(x, y));
        const holes = poly.slice(1).map((ring) => ring.map(([x, y]) => new Vector2(x, y)));
        let mesh;
        try {
          mesh = MeshBuilder.ExtrudePolygon(
            e.id,
            { shape, holes: holes.length ? holes : undefined, depth: height, sideOrientation: 2 },
            scene,
            earcut
          );
        } catch { continue; }
        mesh.position.y = k.z;
        mesh.material = matFor(e.kind, clashIds.has(e.id));
        mesh.metadata = { entityId: e.id, kind: e.kind };
        mesh.isPickable = true;
        meshes.push(mesh);
      }
    }
    // 脱模方向箭头(+Y)
    const arrow = MeshBuilder.CreateLines('demold', {
      points: [new Vector3(0, 0, 0), new Vector3(0, 45, 0)],
    }, scene);
    arrow.color = new Color3(1, 1, 0.3);
    const cone = MeshBuilder.CreateCylinder('demoldCone', { diameterTop: 0, diameterBottom: 5, height: 8 }, scene);
    cone.position.y = 48;
    const cm = new StandardMaterial('cm', scene);
    cm.emissiveColor = new Color3(1, 1, 0.3);
    cone.material = cm;
    cone.isPickable = false;
    arrow.isPickable = false;
    meshes.push(arrow, cone);
  }

  function queueRebuild() {
    if (rebuildQueued) return;
    rebuildQueued = true;
    requestAnimationFrame(() => { rebuildQueued = false; rebuild(); });
  }

  onMount(() => {
    engine = new Engine(canvas, true, { antialias: true });
    scene = new Scene(engine);
    scene.clearColor = new Color4(0.09, 0.1, 0.12, 1);
    const cam = new ArcRotateCamera('cam', -Math.PI / 2.5, Math.PI / 3.2, 320, new Vector3(0, 0, 20), scene);
    cam.attachControl(canvas, true);
    cam.wheelPrecision = 3;
    new HemisphericLight('h', new Vector3(0.3, 1, 0.2), scene);
    const d = new DirectionalLight('d', new Vector3(-0.4, -1, -0.5), scene);
    d.intensity = 0.7;

    scene.onPointerObservable.add((pi) => {
      if (pi.type === PointerEventTypes.POINTERTAP && pi.pickInfo?.hit) {
        const id = pi.pickInfo.pickedMesh?.metadata?.entityId;
        if (id) {
          setState('selection', [id]);
          canvas.focus?.();
        }
      }
    });

    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    rebuild();
    onCleanup(() => {
      window.removeEventListener('resize', onResize);
      engine.dispose();
    });
  });

  createEffect(() => {
    entityList();
    queueRebuild();
  });

  const clashes = demoldClashes;

  return (
    <div class="preview3d">
      <canvas ref={canvas} />
      <div class="preview-overlay">
        <div class="preview-title">三维预览 · 脱模方向 +Y</div>
        {clashes().length > 0 ? (
          <div class="clash-list">
            <b>⚠ 脱模干涉 {clashes().length} 处</b>
            {clashes().map((c) => (
              <div class="clash-item" onClick={() => setState('selection', [c.blocker.id])}>
                {KINDS[c.blocker.kind].name}({c.blocker.id}) 与 {KINDS[c.flow.kind].name} 投影重叠
              </div>
            ))}
          </div>
        ) : (
          <div class="clash-ok">✓ 无脱模干涉</div>
        )}
      </div>
    </div>
  );
}
