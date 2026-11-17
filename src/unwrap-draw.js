/**
 * unwrap-draw.js — 柱面展开平面标签稿绘制（纯 Canvas2D，可在 Worker / 主线程运行）
 * 输入世界坐标单位 mm，内部按 mmScale 映射到像素。
 */
import { labelZones } from './geometry.js';

const HEAT = [
  { t: 0.0, c: [37, 120, 205] },   // 蓝（收缩）
  { t: 0.5, c: [240, 240, 235] },  // 中性
  { t: 1.0, c: [214, 62, 48] },    // 红（拉伸）
];

function heatColor(x) {
  const v = Math.min(1, Math.max(0, (x + 1) / 2)); // -100%..+100% → 0..1
  let a = HEAT[0], b = HEAT[HEAT.length - 1];
  for (let i = 0; i < HEAT.length - 1; i++) {
    if (v >= HEAT[i].t && v <= HEAT[i + 1].t) { a = HEAT[i]; b = HEAT[i + 1]; break; }
  }
  const k = (v - a.t) / Math.max(1e-9, b.t - a.t);
  return [0, 1, 2].map(i => Math.round(a.c[i] + (b.c[i] - a.c[i]) * k));
}

/**
 * @param ctx 任意 CanvasRenderingContext2D（含 OffscreenCanvas 的）
 * @param cssW/cssH 逻辑像素尺寸
 * @param dpr 设备像素比
 */
export function drawUnwrap(ctx, cssW, cssH, dpr, payload) {
  const { controlPoints, label } = payload;
  const zones = labelZones(controlPoints, label);
  const { trim, safe, bleed, stats } = zones;
  const padL = 78, padR = 30, padT = 46, padB = 64;
  const worldW = bleed.x < 0 ? trim.w - bleed.x * 2 : trim.w + 80;
  const worldH = bleed.h + 40;
  const mmScale = Math.min(
    (cssW - padL - padR) / worldW,
    (cssH - padT - padB) / worldH,
  );
  const originX = padL + (worldW - trim.w) / 2 - Math.min(0, bleed.x);
  const originY = padT + (worldH - bleed.h) / 2 - Math.min(0, bleed.y - label.yMin);

  const X = mm => originX + mm * mmScale;
  const Y = mm => originY + (mm - (bleed.y < label.yMin ? bleed.y : label.yMin - 10)) * mmScale;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);

  /* 标题信息 */
  ctx.fillStyle = '#1c2733';
  ctx.font = '600 13px "Segoe UI", sans-serif';
  ctx.fillText(`柱面展开标签稿  |  参考半径 r₀=${stats.rRef.toFixed(2)}mm  |  展开宽度=${trim.w.toFixed(1)}mm`, padL, 24);

  /* 1. 伸长率热力带（覆盖出血区全宽） */
  const bandRows = stats.rows;
  const bandX = X(bleed.x < 0 ? bleed.x : 0);
  const bandW = (bleed.x < 0 ? bleed.w : trim.w) * mmScale;
  for (let i = 0; i < bandRows.length - 1; i++) {
    const [r, g, b] = heatColor(bandRows[i].e);
    ctx.fillStyle = `rgba(${r},${g},${b},0.28)`;
    const y0 = Y(bandRows[i].y), y1 = Y(bandRows[i + 1].y);
    ctx.fillRect(bandX, y0, bandW, Math.max(1, y1 - y0 + 0.6));
  }

  /* 2. 出血框（红色虚线） */
  ctx.strokeStyle = '#d9382e';
  ctx.setLineDash([7, 5]);
  ctx.lineWidth = 1.4;
  ctx.strokeRect(X(bleed.x), Y(bleed.y), bleed.w * mmScale, bleed.h * mmScale);
  ctx.setLineDash([]);
  ctx.fillStyle = '#d9382e';
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.fillText(`出血 +${label.bleedMm}mm`, X(bleed.x), Y(bleed.y) - 5);

  /* 3. 刀版/裁切线（黑色实线） */
  ctx.strokeStyle = '#1c2733';
  ctx.lineWidth = 1.8;
  ctx.strokeRect(X(trim.x), Y(trim.y), trim.w * mmScale, trim.h * mmScale);
  ctx.fillStyle = '#1c2733';
  ctx.fillText('刀版线（成品边界）', X(trim.x), Y(trim.y + trim.h) + 16);

  /* 4. 安全区（绿色点线） */
  ctx.strokeStyle = '#1f9d57';
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1.3;
  ctx.strokeRect(X(safe.x), Y(safe.y), safe.w * mmScale, safe.h * mmScale);
  ctx.setLineDash([]);
  ctx.fillStyle = '#1f9d57';
  ctx.fillText(`安全区 −${label.safeMm}mm`, X(safe.x), Y(safe.y) - 5);

  /* 5. 网格 10mm */
  ctx.strokeStyle = 'rgba(100,118,138,0.18)';
  ctx.lineWidth = 0.7;
  const x0 = Math.ceil(0 / 10) * 10;
  for (let gx = x0; gx <= trim.w; gx += 10) {
    ctx.beginPath();
    ctx.moveTo(X(gx), Y(trim.y));
    ctx.lineTo(X(gx), Y(trim.y + trim.h));
    ctx.stroke();
  }
  for (let gy = Math.ceil(trim.y / 10) * 10; gy <= trim.y + trim.h; gy += 10) {
    ctx.beginPath();
    ctx.moveTo(X(trim.x), Y(gy));
    ctx.lineTo(X(trim.x + trim.w), Y(gy));
    ctx.stroke();
  }

  /* 6. 接缝位置（x=0 与 x=周长 重合，画醒目的搭接标记） */
  const seamX = X(0);
  ctx.strokeStyle = '#7a4fd0';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(seamX, Y(bleed.y) - 8);
  ctx.lineTo(seamX, Y(bleed.y + bleed.h) + 8);
  ctx.stroke();
  // 搭接翼（8mm 贴标搭接量示意）
  ctx.fillStyle = 'rgba(122,79,208,0.16)';
  ctx.fillRect(seamX - 8 * mmScale, Y(trim.y), 8 * mmScale, trim.h * mmScale);
  ctx.strokeStyle = '#7a4fd0';
  ctx.lineWidth = 1;
  ctx.strokeRect(seamX - 8 * mmScale, Y(trim.y), 8 * mmScale, trim.h * mmScale);
  ctx.fillStyle = '#7a4fd0';
  ctx.font = '600 11px Consolas, monospace';
  ctx.save();
  ctx.translate(seamX - 14, Y(trim.y) - 10);
  ctx.fillText('接缝 SEAM', 0, 0);
  ctx.restore();
  // 末端接缝重合标记
  const seamX2 = X(trim.w);
  ctx.strokeStyle = '#7a4fd0';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(seamX2, Y(trim.y));
  ctx.lineTo(seamX2, Y(trim.y + trim.h));
  ctx.stroke();
  ctx.setLineDash([]);

  /* 7. 尺寸标注 */
  ctx.strokeStyle = '#5b6b7c';
  ctx.fillStyle = '#5b6b7c';
  ctx.lineWidth = 1;
  ctx.font = '11px Consolas, monospace';
  const dimY = Y(trim.y + trim.h) + 34;
  ctx.beginPath();
  ctx.moveTo(X(0), dimY); ctx.lineTo(X(trim.w), dimY);
  ctx.moveTo(X(0), dimY - 4); ctx.lineTo(X(0), dimY + 4);
  ctx.moveTo(X(trim.w), dimY - 4); ctx.lineTo(X(trim.w), dimY + 4);
  ctx.stroke();
  ctx.fillText(`${trim.w.toFixed(1)} mm`, X(trim.w / 2) - 32, dimY - 5);
  // 高度标注（左侧）
  const dimX = padL - 22;
  ctx.beginPath();
  ctx.moveTo(dimX, Y(trim.y)); ctx.lineTo(dimX, Y(trim.y + trim.h));
  ctx.moveTo(dimX - 4, Y(trim.y)); ctx.lineTo(dimX + 4, Y(trim.y));
  ctx.moveTo(dimX - 4, Y(trim.y + trim.h)); ctx.lineTo(dimX + 4, Y(trim.y + trim.h));
  ctx.stroke();
  ctx.save();
  ctx.translate(dimX - 8, Y(trim.y + trim.h / 2) + 34);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`${trim.h.toFixed(1)} mm`, 0, 0);
  ctx.restore();

  /* 8. 伸长率曲线（沿高度）叠加在右侧 */
  const chartX = cssW - 128, chartY = padT + 6, chartW = 104, chartH = 120;
  ctx.fillStyle = 'rgba(240,243,247,0.92)';
  ctx.strokeStyle = 'rgba(120,140,160,0.4)';
  ctx.beginPath();
  ctx.roundRect(chartX - 8, chartY - 18, chartW + 16, chartH + 30, 8);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#1c2733';
  ctx.font = '600 11px "Segoe UI", sans-serif';
  ctx.fillText('伸长率分布 ε(y)', chartX, chartY - 4);
  ctx.strokeStyle = 'rgba(120,140,160,0.5)';
  ctx.beginPath();
  ctx.moveTo(chartX, chartY + chartH / 2);
  ctx.lineTo(chartX + chartW, chartY + chartH / 2);
  ctx.stroke();
  const ext = Math.max(0.02, Math.abs(stats.minE), Math.abs(stats.maxE));
  ctx.beginPath();
  bandRows.forEach((row, i) => {
    const px = chartX + (i / (bandRows.length - 1)) * chartW;
    const py = chartY + chartH / 2 - (row.e / ext) * (chartH / 2);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.strokeStyle = '#1769e0';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = '#5b6b7c';
  ctx.font = '10px Consolas, monospace';
  ctx.fillText(`+${(ext * 100).toFixed(1)}%`, chartX + chartW + 1, chartY + 8);
  ctx.fillText(`${(-ext * 100).toFixed(1)}%`, chartX + chartW + 1, chartY + chartH);
  ctx.fillText(`max +${(stats.maxE * 100).toFixed(2)}%`, chartX, chartY + chartH + 22);
  ctx.fillText(`min ${(stats.minE * 100).toFixed(2)}%`, chartX, chartY + chartH + 12);

  return {
    trimWidth: trim.w,
    trimHeight: trim.h,
    rRef: stats.rRef,
    minE: stats.minE,
    maxE: stats.maxE,
    meanE: stats.meanE,
  };
}
