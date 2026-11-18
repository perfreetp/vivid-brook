import type { ProjectData, ScheduleKey } from '../types';
import { store } from './store';
import type { Grid } from './engine';
import { DIM_THRESHOLD } from './engine';
import { download } from './geometry';
import { scheduleName } from '../components/side-panel';

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  // 加 BOM 保证 Excel 识别 UTF-8 中文
  return '﻿' + [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

/** 灯具台账 CSV：型号库带出功率与数量 */
export function exportLedgerCsv(project: ProjectData): void {
  const headers = ['型号编号', '厂商', '名称', '额定功率W', '光效lm/W', '防护等级', '光源尺寸m', '使用数量', '实际功率合计W'];
  const rows = project.lampModels.map((m) => {
    const used = project.lamps.filter((l) => l.modelId === m.id);
    return [
      m.id, m.manufacturer, m.name, m.ratedPower, m.efficacy, m.ip,
      m.sourceSize || '点光源', used.length, used.reduce((s, l) => s + l.power, 0).toFixed(1),
    ];
  });
  download(`${project.name}-灯具台账.csv`, toCsv(headers, rows), 'text/csv;charset=utf-8');
}

/** 照度统计 CSV：1m 网格逐单元 + 低照度区清单（分两段） */
export function exportIlluminanceCsv(grid: Grid, schedule: ScheduleKey, projectName: string): void {
  const headers = ['网格中心X', '网格中心Y', '地面高程m', '是否步道面', '照度lx', `是否低于${DIM_THRESHOLD}lx`];
  const rows: (string | number)[][] = [];
  for (const c of grid.cells) {
    rows.push([
      c.x.toFixed(2), c.y.toFixed(2), c.z.toFixed(2),
      c.onTrail ? '是' : '否', c.illuminance.toFixed(3),
      c.onTrail && c.illuminance < DIM_THRESHOLD ? '是' : '否',
    ]);
  }
  const result = store.get().result;
  const dimCols = ['编号', '中心X', '中心Y', '面积㎡', '最低lx', '平均lx'];
  const dimRows = (result?.dimZones ?? []).map((z) => [
    z.id, z.centroid[0].toFixed(2), z.centroid[1].toFixed(2),
    z.areaM2.toFixed(1), z.minLux.toFixed(3), z.meanLux.toFixed(3),
  ]);
  const csv =
    `# ${projectName} - ${scheduleName(schedule)} 照度统计（1m 网格）\r\n` +
    toCsv(headers, rows) +
    '\r\n\r\n' +
    `# 低于 ${DIM_THRESHOLD}lx 连通区清单\r\n` +
    toCsv(dimCols, dimRows);
  download(`${projectName}-照度统计.csv`, csv, 'text/csv;charset=utf-8');
}

/** 把地图 SVG 序列化为 PNG 布光图 */
export async function exportMapPng(svgEl: SVGSVGElement, filename: string): Promise<void> {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const rect = svgEl.getBoundingClientRect();
  clone.setAttribute('width', String(Math.round(rect.width)));
  clone.setAttribute('height', String(Math.round(rect.height)));
  // 暗底
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#0c1118');
  clone.insertBefore(bg, clone.firstChild);
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG 栅格化失败'));
      img.src = url;
    });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rect.width * scale);
    canvas.height = Math.round(rect.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0c1118';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    await new Promise<void>((resolve) =>
      canvas.toBlob((b) => {
        if (b) download(filename, b, 'image/png');
        resolve();
      }, 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 导出完整项目 JSON（矢量数据 + 灯具） */
export function exportProjectJson(project: ProjectData): void {
  download(`${project.name}-方案.json`, JSON.stringify(project, null, 2), 'application/json');
}

/** 导入 JSON：根据顶层字段识别项目数据或型号库 */
export async function importJsonFile(input: HTMLInputElement, kind: 'project' | 'models', appStore: typeof store): Promise<void> {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (kind === 'models') {
      if (!Array.isArray(data)) throw new Error('型号库应为数组');
      appStore.setLampModels(data);
      alert(`型号库已导入：${data.length} 个型号`);
    } else {
      if (!data.centerline || !Array.isArray(data.centerline.geometry?.coordinates)) {
        throw new Error('缺少 centerline 中线数据');
      }
      appStore.loadProject(normalizeProject(data));
      alert(`项目“${data.name ?? file.name}”已导入`);
    }
  } catch (e) {
    alert(`导入失败：${(e as Error).message}`);
  } finally {
    input.value = '';
  }
}

function normalizeProject(data: ProjectData): ProjectData {
  return {
    name: data.name ?? '导入项目',
    centerline: data.centerline,
    steps: data.steps ?? [],
    walls: data.walls ?? [],
    canopies: data.canopies ?? [],
    buildings: data.buildings ?? [],
    lampModels: data.lampModels ?? [],
    lamps: data.lamps ?? [],
  };
}
