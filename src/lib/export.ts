import JSZip from 'jszip';
import type { EditorState, Feature } from '../types';
import { KIND_META } from './factory';
import { polylineLength, polygonArea, findSelfIntersections, worldToScreen, ViewTransform } from './geometry';

function download(filename: string, content: string | Blob, mime = 'text/plain;charset=utf-8'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 导出项目 SVG（矢量路径 + 20m 网格 + 自交标记 + 图例） */
export function exportSVG(state: EditorState): void {
  const margin = 60;
  const all = state.features.filter((f) => f.visible);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of all) {
    for (const p of f.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!isFinite(minX)) {
    minX = -200; minY = -200; maxX = 200; maxY = 200;
  }
  minX -= margin; minY -= margin; maxX += margin; maxY += margin;
  const w = maxX - minX;
  const h = maxY - minY;
  const scale = 2;
  // SVG y 向下，测量 y 向上 → 翻转
  const tx = (x: number) => (x - minX) * scale;
  const ty = (y: number) => (maxY - y) * scale;

  const vt: ViewTransform = { scale, ox: -minX * scale, oy: maxY * scale, width: w * scale, height: h * scale };

  const gridLines: string[] = [];
  for (let gx = Math.ceil(minX / 20) * 20; gx <= maxX; gx += 20) {
    gridLines.push(`<line x1="${tx(gx)}" y1="0" x2="${tx(gx)}" y2="${h * scale}" stroke="#e2e8f0" stroke-width="1"/>`);
  }
  for (let gy = Math.ceil(minY / 20) * 20; gy <= maxY; gy += 20) {
    gridLines.push(`<line x1="0" y1="${ty(gy)}" x2="${w * scale}" y2="${ty(gy)}" stroke="#e2e8f0" stroke-width="1"/>`);
  }

  const featureXml = all
    .map((f) => {
      const color = KIND_META[f.kind].color;
      const d = f.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${tx(p.x).toFixed(1)},${ty(p.y).toFixed(1)}`)
        .join(' ') + (f.pathType === 'closed' ? ' Z' : '');
      const holes = f.holes
        .map(
          (ring) =>
            `<path d="${ring.map((p, i) => `${i === 0 ? 'M' : 'L'}${tx(p.x).toFixed(1)},${ty(p.y).toFixed(1)}`).join(' ')} Z" fill="${KIND_META[f.kind].fill}" fill-rule="evenodd"/>`,
        )
        .join('');
      const dash = f.role === 'bank' ? ' stroke-dasharray="8,5" stroke-width="1.6"' : ' stroke-width="2.5"';
      const fill = f.pathType === 'closed' ? ` fill="${KIND_META[f.kind].fill}" fill-rule="evenodd"` : ' fill="none"';
      const label = f.points[0]
        ? `<text x="${tx(f.points[0].x) + 4}" y="${ty(f.points[0].y) - 5}" font-size="13" fill="#334155" font-family="sans-serif">${f.name}</text>`
        : '';
      return `<g><path d="${d}"${fill} stroke="${color}"${dash} stroke-linejoin="round"/>${holes}${label}</g>`;
    })
    .join('\n  ');

  // 自交标记
  const selfMarks: string[] = [];
  for (const f of all) {
    if (f.pathType !== 'closed') continue;
    for (const hit of findSelfIntersections(f.points)) {
      const sp = worldToScreen(hit.p, vt);
      selfMarks.push(
        `<circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="7" fill="none" stroke="#dc2626" stroke-width="2"/><circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="3" fill="#dc2626"/>`,
      );
    }
  }

  const legend = Object.entries(KIND_META)
    .map(
      ([k, m], i) =>
        `<rect x="16" y="${16 + i * 24}" width="16" height="12" fill="${m.fill}" stroke="${m.color}"/><text x="38" y="${26 + i * 24}" font-size="13" font-family="sans-serif" fill="#334155">${m.label}</text>`,
    )
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w * scale} ${h * scale}">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <g>${gridLines.join('')}</g>
  ${featureXml}
  <g>${selfMarks.join('')}</g>
  <g>${legend}</g>
  <text x="${w * scale - 16}" y="${h * scale - 14}" text-anchor="end" font-size="12" font-family="sans-serif" fill="#64748b">${state.project.name} · 20m网格 · 导出于 ${new Date().toLocaleString('zh-CN')}</text>
</svg>`;
  download(`${state.project.name}-矢量图.svg`, svg, 'image/svg+xml;charset=utf-8');
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 导出要素清单 CSV（带 BOM，Excel 直接打开） */
export function exportFeatureList(state: EditorState): void {
  const header = ['要素ID', '名称', '类型', '路径', '角色', '图层', '顶点数', '长度/周长(m)', '面积(m²)', '宽度(m)', '边坡比', '深度(m)', '自交', '备注'];
  const rows = state.features.map((f: Feature) => {
    const layer = state.layers.find((l) => l.id === f.layerId)?.name ?? '';
    const length = polylineLength(f.points, f.pathType === 'closed');
    const area = f.pathType === 'closed' ? polygonArea(f.points) - f.holes.reduce((s, h) => s + polygonArea(h), 0) : 0;
    const self = f.pathType === 'closed' ? findSelfIntersections(f.points).length : 0;
    return [
      f.id,
      f.name,
      KIND_META[f.kind].label,
      f.pathType === 'closed' ? '闭合' : '开放',
      f.role === 'bank' ? '沟沿' : '主体',
      layer,
      f.points.length,
      length.toFixed(2),
      area.toFixed(2),
      f.width || '-',
      f.slope,
      f.depth,
      self ? `是(${self})` : '否',
      f.note,
    ].map(csvEscape).join(',');
  });
  const csv = '﻿' + [header.join(','), ...rows].join('\r\n');
  download(`${state.project.name}-要素清单.csv`, csv, 'text/csv;charset=utf-8');
}

/** 主管审核通过后打包交付：SVG + 清单 + 项目与工单 JSON */
export async function exportPackage(state: EditorState): Promise<void> {
  const zip = new JSZip();
  const folder = zip.folder(state.project.name)!;

  // 内联 SVG（复用 exportSVG 的构造逻辑，这里直接放项目 JSON）
  folder.file('project.json', JSON.stringify(state.project, null, 2));
  folder.file('features.json', JSON.stringify(state.features, null, 2));
  folder.file('layers.json', JSON.stringify(state.layers, null, 2));
  folder.file('work-entries.json', JSON.stringify(state.entries, null, 2));

  const header = ['要素ID', '名称', '类型', '路径', '角色', '图层', '顶点数', '长度/周长(m)', '面积(m²)', '宽度(m)', '边坡比', '深度(m)', '备注'];
  const rows = state.features.map((f: Feature) => {
    const layer = state.layers.find((l) => l.id === f.layerId)?.name ?? '';
    const length = polylineLength(f.points, f.pathType === 'closed');
    const area = f.pathType === 'closed' ? polygonArea(f.points) : 0;
    return [f.id, f.name, KIND_META[f.kind].label, f.pathType, f.role, layer, f.points.length, length.toFixed(2), area.toFixed(2), f.width, f.slope, f.depth, f.note]
      .map(csvEscape)
      .join(',');
  });
  folder.file('feature-list.csv', '﻿' + [header.join(','), ...rows].join('\r\n'));

  const readme = [
    `项目：${state.project.name}`,
    `客户：${state.project.customer}`,
    `下单时间：${new Date(state.project.createdAt).toLocaleString('zh-CN')}`,
    `交付时间：${new Date().toLocaleString('zh-CN')}`,
    `要素数量：${state.features.length}`,
    `工单数量：${state.entries.length}`,
    '',
    '文件说明：',
    '- project.json：项目信息',
    '- features.json / layers.json：要素与图层矢量数据（顶点可继续编辑）',
    '- work-entries.json：工单、返工次数与审核记录',
    '- feature-list.csv：要素清单',
  ].join('\n');
  folder.file('README.txt', readme);

  const blob = await zip.generateAsync({ type: 'blob' });
  download(`${state.project.name}-交付包.zip`, blob, 'application/zip');
}
