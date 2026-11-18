// ---------- PixiJS 画布: 渲染 + 交互 ----------

import { onMount, onCleanup, createEffect, getOwner, runWithOwner } from 'solid-js';
import { Application, Container, Graphics, Sprite, Texture, Text } from 'pixi.js';
import {
  store, setStore, tool, setTool, selectedId, setSelectedId, selectedKind, setSelectedKind,
  layers, result, draftPoints, setDraftPoints, annotText, editable, persist, env,
} from '../model/store';
import { uid, nowStr, LIGHT_TYPE_LABEL } from '../model/types';
import type { LightType } from '../model/types';
import { GRID_W, GRID_H, kelvinToRgb, DARK_LUX } from '../engine/lighting';
import { exposure, gamma } from '../model/store';

const PM = 5; // 初始: 1m = 5px

export function CanvasView() {
  let host!: HTMLDivElement;

  onMount(() => {
    const owner = getOwner();
    (async () => {
    const app = new Application();
    await app.init({ background: 0x11141b, resizeTo: host, antialias: true });
    host.appendChild(app.canvas);
    runWithOwner(owner, () => {

    const world = new Container();
    app.stage.addChild(world);

    // 图层容器(自下而上)
    const groundG = new Graphics();
    const lightSprite = new Sprite();      // 效果图(累计光照)
    const spotC = new Container();         // 光斑
    const heatSprite = new Sprite();       // 热力图
    const gridG = new Graphics();
    const buildingG = new Graphics();
    const buildingLabels = new Container();
    const blockG = new Graphics();
    const blockLabels = new Container();
    const lightG = new Graphics();
    const lightLabels = new Container();
    const annotG = new Graphics();
    const annotLabels = new Container();
    const draftG = new Graphics();
    const valueC = new Container();        // 每格照度数值

    world.addChild(groundG, lightSprite, spotC, heatSprite, gridG, buildingG, buildingLabels,
      blockG, blockLabels, lightG, lightLabels, annotG, annotLabels, draftG, valueC);

    // 太阳指北针(屏幕固定)
    const compass = new Graphics();
    app.stage.addChild(compass);

    // ---------- 视口 ----------
    let scale = PM, vx = 20, vy = 20;
    function applyView() {
      world.scale.set(scale);
      world.position.set(vx, vy);
      updateValues();
    }
    function toWorld(gx: number, gy: number) {
      return { x: (gx - vx) / scale, y: (gy - vy) / scale };
    }
    applyView();

    // ---------- 地面 ----------
    groundG.rect(0, 0, GRID_W, GRID_H).fill({ color: 0x1a1f2a });
    groundG.rect(0, 0, GRID_W, GRID_H).stroke({ width: 0.4, color: 0x3a4356 });

    // ---------- 效果图纹理 ----------
    const lightCanvas = document.createElement('canvas');
    lightCanvas.width = GRID_W; lightCanvas.height = GRID_H;
    const lightCtx = lightCanvas.getContext('2d')!;
    const lightImg = lightCtx.createImageData(GRID_W, GRID_H);
    const lightTex = Texture.from(lightCanvas);
    lightTex.source.scaleMode = 'linear';
    lightSprite.texture = lightTex;
    lightSprite.width = GRID_W; lightSprite.height = GRID_H;

    // ---------- 热力图纹理 ----------
    const heatCanvas = document.createElement('canvas');
    heatCanvas.width = GRID_W; heatCanvas.height = GRID_H;
    const heatCtx = heatCanvas.getContext('2d')!;
    const heatImg = heatCtx.createImageData(GRID_W, GRID_H);
    const heatTex = Texture.from(heatCanvas);
    heatTex.source.scaleMode = 'nearest';
    heatSprite.texture = heatTex;
    heatSprite.width = GRID_W; heatSprite.height = GRID_H;
    heatSprite.alpha = 0.85;

    function ramp(t: number): [number, number, number] {
      // 蓝->青->绿->黄->红
      const stops: [number, [number, number, number]][] = [
        [0.0, [20, 24, 90]], [0.25, [0, 140, 200]], [0.5, [30, 180, 80]],
        [0.75, [240, 200, 40]], [1.0, [230, 40, 30]],
      ];
      for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
          const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
          const k = (t - t0) / (t1 - t0);
          return [
            Math.round(c0[0] + (c1[0] - c0[0]) * k),
            Math.round(c0[1] + (c1[1] - c0[1]) * k),
            Math.round(c0[2] + (c1[2] - c0[2]) * k),
          ];
        }
      }
      return [230, 40, 30];
    }

    function updateLightTexture() {
      const res = result();
      const d = lightImg.data;
      if (!res) { for (let i = 0; i < d.length; i += 4) { d[i+3] = 255; } }
      else {
        const ex = exposure(), gm = gamma();
        for (let i = 0; i < GRID_W * GRID_H; i++) {
          // 曝光(胶片式) + 伽马
          const ch = (v: number) => {
            const t = 1 - Math.exp(-ex * v / 4000);
            return Math.round(255 * Math.pow(Math.min(1, t), 1 / gm));
          };
          d[i * 4] = ch(res.r[i]);
          d[i * 4 + 1] = ch(res.g[i]);
          d[i * 4 + 2] = ch(res.b[i]);
          d[i * 4 + 3] = 255;
        }
      }
      lightCtx.putImageData(lightImg, 0, 0);
      lightTex.source.update();
    }

    function updateHeatTexture() {
      const res = result();
      const d = heatImg.data;
      if (!res) return;
      const lo = Math.log10(0.2), hi = Math.log10(120000);
      for (let i = 0; i < GRID_W * GRID_H; i++) {
        const o = i * 4;
        if (res.dark[i]) {
          // 低于 20lx 自动标红
          d[o] = 255; d[o + 1] = 30; d[o + 2] = 30; d[o + 3] = 235;
        } else {
          const t = Math.max(0, Math.min(1, (Math.log10(res.lux[i] + 0.01) - lo) / (hi - lo)));
          const [r, g, b] = ramp(t);
          d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 205;
        }
      }
      heatCtx.putImageData(heatImg, 0, 0);
      heatTex.source.update();
    }

    // ---------- 每格照度数值(对象池) ----------
    const valuePool: Text[] = [];
    function updateValues() {
      const res = result();
      valueC.removeChildren();
      if (!res || !layers.heat || !layers.values || scale < 9) return;
      const x0 = Math.max(0, Math.floor(-vx / scale)), x1 = Math.min(GRID_W, Math.ceil((app.screen.width - vx) / scale));
      const y0 = Math.max(0, Math.floor(-vy / scale)), y1 = Math.min(GRID_H, Math.ceil((app.screen.height - vy) / scale));
      let n = 0;
      for (let gy = y0; gy < y1; gy += 1) {
        for (let gx = x0; gx < x1; gx += 1) {
          if (n >= 900) return;
          let t = valuePool[n];
          if (!t) {
            t = new Text({ text: '', style: { fontSize: 0.62, fill: 0xffffff, fontFamily: 'monospace' }, resolution: 10 });
            t.anchor.set(0.5);
            valuePool.push(t);
          }
          const v = res.lux[gy * GRID_W + gx];
          t.text = v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0);
          t.style.fill = res.dark[gy * GRID_W + gx] ? 0xffdddd : 0x111111;
          t.position.set(gx + 0.5, gy + 0.5);
          valueC.addChild(t);
          n++;
        }
      }
    }

    // ---------- 网格 ----------
    function drawGrid() {
      gridG.clear();
      if (!layers.grid) return;
      for (let x = 0; x <= GRID_W; x += 1) {
        const major = x % 10 === 0;
        gridG.moveTo(x, 0).lineTo(x, GRID_H).stroke({ width: major ? 0.18 : 0.07, color: 0xffffff, alpha: major ? 0.22 : 0.07 });
      }
      for (let y = 0; y <= GRID_H; y += 1) {
        const major = y % 10 === 0;
        gridG.moveTo(0, y).lineTo(GRID_W, y).stroke({ width: major ? 0.18 : 0.07, color: 0xffffff, alpha: major ? 0.22 : 0.07 });
      }
    }

    // ---------- 建筑 ----------
    function drawBuildings() {
      buildingG.clear();
      buildingLabels.removeChildren();
      if (!layers.buildings) return;
      for (const b of store.scene.buildings) {
        const flat = b.polygon.flatMap(p => [p.x, p.y]);
        const sel = selectedId() === b.id;
        const shade = Math.min(0.55, 0.18 + b.floors * 0.07);
        buildingG.poly(flat).fill({ color: 0x8a94a8, alpha: shade });
        buildingG.poly(flat).stroke({ width: sel ? 0.5 : 0.22, color: sel ? 0xffc857 : 0xcfd6e4, alpha: 0.95 });
        const cx = b.polygon.reduce((s, p) => s + p.x, 0) / b.polygon.length;
        const cy = b.polygon.reduce((s, p) => s + p.y, 0) / b.polygon.length;
        const t = new Text({
          text: `${b.name} ${b.floors}F`,
          style: { fontSize: 1.6, fill: sel ? 0xffc857 : 0xe8ecf4, fontFamily: 'sans-serif' },
          resolution: 8,
        });
        t.anchor.set(0.5); t.position.set(cx, cy);
        buildingLabels.addChild(t);
      }
    }

    // ---------- 街坊边界 ----------
    function drawBlocks() {
      blockG.clear();
      blockLabels.removeChildren();
      if (!layers.blocks) return;
      for (const b of store.scene.blocks) {
        const flat = b.polygon.flatMap(p => [p.x, p.y]);
        const sel = selectedId() === b.id;
        blockG.poly(flat).stroke({ width: sel ? 0.6 : 0.35, color: sel ? 0xffc857 : 0x4ecdc4, alpha: 0.9 });
        blockG.poly(flat).fill({ color: 0x4ecdc4, alpha: 0.05 });
        const t = new Text({
          text: `【${b.name}】`,
          style: { fontSize: 2.2, fill: 0x4ecdc4, fontFamily: 'sans-serif', fontWeight: 'bold' },
          resolution: 8,
        });
        t.position.set(b.polygon[0].x + 1, b.polygon[0].y + 1);
        blockLabels.addChild(t);
      }
    }

    // ---------- 光斑 ----------
    const spotTexCache = new Map<string, Texture>();
    function spotTexture(kelvin: number): Texture {
      const key = String(Math.round(kelvin / 100));
      let tex = spotTexCache.get(key);
      if (tex) return tex;
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d')!;
      const [r, g, b] = kelvinToRgb(kelvin);
      const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
      grad.addColorStop(0, `rgba(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0},0.55)`);
      grad.addColorStop(0.5, `rgba(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0},0.18)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      tex = Texture.from(c);
      spotTexCache.set(key, tex);
      return tex;
    }

    function drawSpots() {
      spotC.removeChildren();
      if (!layers.spots) return;
      for (const l of store.scene.lights) {
        if (!l.on) continue;
        const s = new Sprite(spotTexture(l.kelvin));
        s.anchor.set(0.5);
        s.position.set(l.pos.x, l.pos.y);
        s.width = s.height = l.radius * 2;
        s.blendMode = 'add';
        s.alpha = Math.min(1, 0.25 + l.intensity / 4000);
        spotC.addChild(s);
      }
    }

    // ---------- 光源标记 ----------
    const TYPE_COLOR: Record<LightType, number> = { street: 0xffd166, courtyard: 0x8ecae6, wall: 0xf4845f };
    function drawLights() {
      lightG.clear();
      lightLabels.removeChildren();
      for (const l of store.scene.lights) {
        const sel = selectedId() === l.id;
        const col = TYPE_COLOR[l.type];
        if (sel) {
          lightG.circle(l.pos.x, l.pos.y, l.radius).stroke({ width: 0.15, color: col, alpha: 0.5 });
        }
        lightG.circle(l.pos.x, l.pos.y, 1.1).fill({ color: col, alpha: l.on ? 1 : 0.35 });
        lightG.circle(l.pos.x, l.pos.y, 1.1).stroke({ width: sel ? 0.4 : 0.18, color: sel ? 0xffffff : 0x222222 });
        if (!l.on) {
          lightG.moveTo(l.pos.x - 1.4, l.pos.y - 1.4).lineTo(l.pos.x + 1.4, l.pos.y + 1.4)
            .stroke({ width: 0.3, color: 0xff5555 });
        }
        const t = new Text({
          text: `${LIGHT_TYPE_LABEL[l.type]}${l.on ? '' : '(关)'}`,
          style: { fontSize: 1.3, fill: col, fontFamily: 'sans-serif' },
          resolution: 8,
        });
        t.anchor.set(0.5, 1.6);
        t.position.set(l.pos.x, l.pos.y);
        lightLabels.addChild(t);
      }
    }

    // ---------- 批注 ----------
    function drawAnnotations() {
      annotG.clear();
      annotLabels.removeChildren();
      if (!layers.annotations) return;
      store.scene.annotations.forEach((a, i) => {
        annotG.circle(a.pos.x, a.pos.y, 1.2).fill({ color: 0xff5d8f });
        annotG.circle(a.pos.x, a.pos.y, 1.2).stroke({ width: 0.25, color: 0xffffff });
        const t = new Text({ text: String(i + 1), style: { fontSize: 1.5, fill: 0xffffff, fontWeight: 'bold' }, resolution: 8 });
        t.anchor.set(0.5); t.position.set(a.pos.x, a.pos.y);
        annotLabels.addChild(t);
      });
    }

    // ---------- 绘制中的多边形 ----------
    let mouseWorld = { x: 0, y: 0 };
    function drawDraft() {
      draftG.clear();
      const pts = draftPoints();
      if (!pts.length) return;
      const col = tool() === 'draw-block' ? 0x4ecdc4 : 0xffc857;
      const path = pts.flatMap(p => [p.x, p.y]);
      if (pts.length >= 2) draftG.poly([...path, mouseWorld.x, mouseWorld.y]).stroke({ width: 0.3, color: col, alpha: 0.9 });
      for (const p of pts) draftG.circle(p.x, p.y, 0.5).fill({ color: col });
    }

    // ---------- 指南针 ----------
    function drawCompass() {
      compass.clear();
      const res = result();
      const cx = app.screen.width - 60, cy = 60;
      compass.circle(cx, cy, 34).fill({ color: 0x000000, alpha: 0.45 });
      compass.circle(cx, cy, 34).stroke({ width: 1, color: 0x8a94a8 });
      // 北
      compass.moveTo(cx, cy - 30).lineTo(cx, cy - 22).stroke({ width: 2, color: 0xffffff });
      if (res && !res.night) {
        const az = res.sunAzDeg * Math.PI / 180;
        const dx = Math.sin(az), dy = -Math.cos(az);
        compass.moveTo(cx, cy).lineTo(cx + dx * 26, cy + dy * 26).stroke({ width: 3, color: 0xffd166 });
        compass.circle(cx + dx * 26, cy + dy * 26, 4).fill({ color: 0xffd166 });
      }
    }

    // ---------- 渲染触发 ----------
    createEffect(() => { store.scene.buildings.map(b => b.floors + b.name + b.polygon.length).join(); drawBuildings(); });
    createEffect(() => { store.scene.blocks.length; drawBlocks(); });
    createEffect(() => { store.scene.lights.map(l => `${l.pos.x},${l.pos.y},${l.kelvin},${l.radius},${l.intensity},${l.on}`).join(); drawSpots(); drawLights(); });
    createEffect(() => { store.scene.annotations.length; drawAnnotations(); });
    createEffect(() => { layers.grid; drawGrid(); });
    createEffect(() => { layers.buildings; drawBuildings(); });
    createEffect(() => { layers.blocks; drawBlocks(); });
    createEffect(() => { layers.spots; drawSpots(); });
    createEffect(() => { layers.annotations; drawAnnotations(); });
    createEffect(() => { selectedId(); drawBuildings(); drawLights(); drawBlocks(); });
    createEffect(() => { result(); updateLightTexture(); updateHeatTexture(); updateValues(); drawCompass(); });
    createEffect(() => { layers.heat; heatSprite.visible = layers.heat; lightSprite.alpha = layers.heat ? 0.25 : 1; updateValues(); });
    createEffect(() => { layers.values; updateValues(); });
    createEffect(() => { draftPoints().length; drawDraft(); });
    createEffect(() => { exposure(); gamma(); updateLightTexture(); });

    // ---------- 交互 ----------
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;

    let panning = false, panStart = { x: 0, y: 0 }, viewStart = { x: 0, y: 0 };
    let dragLight: string | null = null;

    function hitLight(wx: number, wy: number): string | null {
      for (let i = store.scene.lights.length - 1; i >= 0; i--) {
        const l = store.scene.lights[i];
        if (Math.hypot(l.pos.x - wx, l.pos.y - wy) < 2) return l.id;
      }
      return null;
    }
    function hitBuilding(wx: number, wy: number): string | null {
      for (let i = store.scene.buildings.length - 1; i >= 0; i--) {
        const b = store.scene.buildings[i];
        // 简单点在多边形
        let inside = false;
        const poly = b.polygon;
        for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
          if ((poly[k].y > wy) !== (poly[j].y > wy) &&
            wx < ((poly[j].x - poly[k].x) * (wy - poly[k].y)) / (poly[j].y - poly[k].y) + poly[k].x) inside = !inside;
        }
        if (inside) return b.id;
      }
      return null;
    }

    function closePolygon() {
      const pts = draftPoints();
      if (pts.length < 3) { setDraftPoints([]); return; }
      if (tool() === 'draw-building') {
        const id = uid();
        setStore('scene', 'buildings', store.scene.buildings.length, {
          id, name: `建筑${store.scene.buildings.length + 1}`, floors: 2, polygon: pts,
        });
        setSelectedId(id); setSelectedKind('building');
      } else if (tool() === 'draw-block') {
        const id = uid();
        setStore('scene', 'blocks', store.scene.blocks.length, {
          id, name: `街坊${store.scene.blocks.length + 1}`, polygon: pts,
        });
        setSelectedId(id); setSelectedKind('block');
      }
      setDraftPoints([]);
      setTool('select');
      persist();
    }

    app.stage.on('pointerdown', (e: any) => {
      const w = toWorld(e.global.x, e.global.y);
      const t = tool();
      if (t === 'draw-building' || t === 'draw-block') {
        if (!editable()) return;
        setDraftPoints([...draftPoints(), w]);
        return;
      }
      if (t === 'add-street' || t === 'add-courtyard' || t === 'add-wall') {
        if (!editable()) return;
        const type: LightType = t === 'add-street' ? 'street' : t === 'add-courtyard' ? 'courtyard' : 'wall';
        const preset = { street: '路灯', courtyard: '庭院灯', wall: '洗墙灯' }[type];
        const presets = { street: { height: 6, radius: 18, kelvin: 3000, intensity: 2600 }, courtyard: { height: 3.5, radius: 11, kelvin: 2700, intensity: 1000 }, wall: { height: 4, radius: 9, kelvin: 3000, intensity: 1300 } }[type];
        const id = uid();
        setStore('scene', 'lights', store.scene.lights.length, {
          id, type, name: `${preset}${store.scene.lights.filter(l => l.type === type).length + 1}`,
          pos: w, ...presets, on: true,
        });
        setSelectedId(id); setSelectedKind('light');
        setTool('select');
        persist();
        return;
      }
      if (t === 'annotate') {
        if (store.status !== 'published') return;
        const text = annotText().trim() || '批注';
        setStore('scene', 'annotations', store.scene.annotations.length, {
          id: uid(), pos: w, text, author: '公众', time: nowStr(),
        });
        persist();
        return;
      }
      // select
      const lid = hitLight(w.x, w.y);
      if (lid) {
        setSelectedId(lid); setSelectedKind('light');
        if (editable()) dragLight = lid;
        return;
      }
      const bid = hitBuilding(w.x, w.y);
      if (bid) { setSelectedId(bid); setSelectedKind('building'); return; }
      setSelectedId(null); setSelectedKind(null);
      panning = true;
      panStart = { x: e.global.x, y: e.global.y };
      viewStart = { x: vx, y: vy };
    });

    app.stage.on('pointermove', (e: any) => {
      const w = toWorld(e.global.x, e.global.y);
      mouseWorld = w;
      if (draftPoints().length) drawDraft();
      if (dragLight) {
        const i = store.scene.lights.findIndex(l => l.id === dragLight);
        if (i >= 0) {
          setStore('scene', 'lights', i, 'pos', { x: Math.round(w.x * 2) / 2, y: Math.round(w.y * 2) / 2 });
        }
        return;
      }
      if (panning) {
        vx = viewStart.x + (e.global.x - panStart.x);
        vy = viewStart.y + (e.global.y - panStart.y);
        applyView();
      }
    });

    app.stage.on('pointerup', () => {
      if (dragLight) { dragLight = null; persist(); }
      panning = false;
    });
    app.stage.on('pointerupoutside', () => { dragLight = null; panning = false; });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = app.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const before = toWorld(mx, my);
      scale = Math.max(1.5, Math.min(40, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      vx = mx - before.x * scale;
      vy = my - before.y * scale;
      applyView();
    };
    app.canvas.addEventListener('wheel', onWheel, { passive: false });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') closePolygon();
      if (e.key === 'Escape') { setDraftPoints([]); setTool('select'); }
    };
    window.addEventListener('keydown', onKey);

    const onResize = () => drawCompass();
    window.addEventListener('resize', onResize);

    onCleanup(() => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      app.destroy(true);
    });
    }); // runWithOwner
    })();
  });

  return <div ref={host} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />;
}
