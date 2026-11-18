import { onCleanup, onMount, createEffect } from 'solid-js';
import { BuildingData, GROUP_META, LayerGroup, ViewState } from '../types';

interface Props {
  data: BuildingData;
  floor: () => number;
  view: () => ViewState | null;
  layers: () => Record<LayerGroup, boolean>;
  onJump: (x: number, y: number) => void;
}

const W = 214;
const PAD = 6;

export default function Minimap(props: Props) {
  let canvas!: HTMLCanvasElement;

  const bounds = () => {
    const rooms = props.data.rooms.filter(r => r.floor === props.floor());
    const maxX = Math.max(...rooms.map(r => r.x + r.w));
    const maxY = Math.max(...rooms.map(r => r.y + r.h));
    return { maxX, maxY };
  };

  const draw = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = 150 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, 150);

    const { maxX, maxY } = bounds();
    const scale = Math.min((W - PAD * 2) / maxX, (150 - PAD * 2) / maxY);
    const ox = PAD, oy = PAD;
    const toX = (x: number) => ox + x * scale;
    const toY = (y: number) => oy + y * scale;

    // 房间轮廓
    ctx.fillStyle = '#e2e8f0';
    for (const r of props.data.rooms) {
      if (r.floor !== props.floor()) continue;
      ctx.fillRect(toX(r.x), toY(r.y), r.w * scale, r.h * scale);
    }
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.5;
    for (const r of props.data.rooms) {
      if (r.floor !== props.floor()) continue;
      ctx.strokeRect(toX(r.x), toY(r.y), r.w * scale, r.h * scale);
    }

    // 设施点（按图层开关）
    for (const f of props.data.facilities) {
      if (f.floor !== props.floor() || !props.layers()[f.group]) continue;
      ctx.fillStyle = GROUP_META[f.group].color;
      ctx.fillRect(toX(f.x) - 1, toY(f.y) - 1, 2, 2);
    }

    // 当前视口框
    const v = props.view();
    if (v && v.floor === props.floor()) {
      const aspect = (canvas.clientWidth || W) / (canvas.clientHeight || 150);
      const halfW = v.halfH * aspect;
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(37,99,235,.12)';
      const x = toX(v.cx - halfW);
      const y = toY(v.cy - v.halfH);
      const w = halfW * 2 * scale;
      const h = v.halfH * 2 * scale;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
  };

  onMount(() => {
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    onCleanup(() => ro.disconnect());
  });

  createEffect(draw);

  const handleClick = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const { maxX, maxY } = bounds();
    const scale = Math.min((W - PAD * 2) / maxX, (150 - PAD * 2) / maxY);
    const wx = (e.clientX - rect.left - PAD) / scale;
    const wy = (e.clientY - rect.top - PAD) / scale;
    props.onJump(wx, wy);
  };

  return (
    <div class="minimap">
      <div class="mm-title">
        <span>小地图 · {props.floor()}F</span>
        <span>点击定位</span>
      </div>
      <canvas ref={canvas} style={{ width: W + 'px', height: '150px' }} onClick={handleClick} />
    </div>
  );
}
