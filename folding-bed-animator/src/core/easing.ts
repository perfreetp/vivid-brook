import type { Keyframe, EasingKind } from '../types.js';
import { clamp, lerp } from './math.js';

/** 三次贝塞尔（与 CSS cubic-bezier 同形），x 为时间进度 -> y 为值进度 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // 牛顿迭代求参数 u，使 bezierX(u) = x
  let u = x;
  const bx = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const dbx = (t: number) =>
    3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
  for (let i = 0; i < 8; i++) {
    const err = bx(u) - x;
    const d = dbx(u);
    if (Math.abs(err) < 1e-6) break;
    if (Math.abs(d) < 1e-8) break;
    u = clamp(u - err / d, 0, 1);
  }
  const by =
    3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
  return by;
}

const EASE_BEZIER: Record<Exclude<EasingKind, 'custom' | 'linear'>, [number, number, number, number]> = {
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

export function easingProgress(kind: EasingKind, t: number): number {
  if (kind === 'linear') return t;
  if (kind === 'custom') return t; // custom 走 Hermite 分支
  const [x1, y1, x2, y2] = EASE_BEZIER[kind];
  return cubicBezier(x1, y1, x2, y2, t);
}

/** 单条轨道在指定帧采样局部角度（度），无关键帧时回退 fallback */
export function sampleTrack(track: Keyframe[] | undefined, frame: number, fallback: number): number {
  if (!track || track.length === 0) return fallback;
  const keys = [...track].sort((a, b) => a.frame - b.frame);
  if (frame <= keys[0].frame) return keys[0].angle;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last.angle;

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].frame <= frame) i++;
  const k0 = keys[i];
  const k1 = keys[i + 1];
  const span = Math.max(1, k1.frame - k0.frame);
  const t = (frame - k0.frame) / span;

  if (k0.easing === 'custom') {
    // 三次 Hermite：切线单位为“角度/帧”
    const u = t;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    return (
      h00 * k0.angle +
      h10 * span * k0.outTangent +
      h01 * k1.angle +
      h11 * span * k1.inTangent
    );
  }
  const p = easingProgress(k0.easing, t);
  return lerp(k0.angle, k1.angle, p);
}

/** 轨道曲线（用于时间轴曲线编辑器的预览折线） */
export function trackCurve(track: Keyframe[] | undefined, samples = 120): { frame: number; angle: number }[] {
  if (!track || track.length === 0) return [];
  const keys = [...track].sort((a, b) => a.frame - b.frame);
  const out: { frame: number; angle: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const frame = keys[0].frame + ((keys[keys.length - 1].frame - keys[0].frame) * i) / samples;
    out.push({ frame, angle: sampleTrack(track, frame, keys[0].angle) });
  }
  return out;
}

/** 新增/更新关键帧（同帧覆盖），返回排序后的新数组 */
export function upsertKeyframe(track: Keyframe[], kf: Keyframe): Keyframe[] {
  const rest = track.filter((k) => k.frame !== kf.frame);
  return [...rest, kf].sort((a, b) => a.frame - b.frame);
}

export function defaultTangents(prev: Keyframe | undefined, next: Keyframe | undefined) {
  const inTangent = prev && next ? (next.angle - prev.angle) / Math.max(1, next.frame - prev.frame) : 0;
  return { inTangent, outTangent: inTangent };
}
