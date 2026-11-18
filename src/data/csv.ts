import type { Boundary, ElevationPoint, Vec2 } from '../state/types';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const push = () => {
    row.push(cell.trim());
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      push();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      push();
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  push();
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

const num = (s: string): number => Number(s.replace(/[^\d.\-eE+]/g, ''));

/**
 * 断面高程点 CSV：表头可识别 x,y,z / 北坐标,东坐标,高程 / 点号,x,y,z 等。
 * 至少包含三个数值列，依次按 (x, y, z) 取值。
 */
export function parseElevationCsv(text: string): ElevationPoint[] {
  const rows = parseCsv(text).filter((r) => r.some((c) => c !== ''));
  if (rows.length === 0) return [];
  const first = rows[0];
  const headerLike = first.some((c) => /[一-龥a-zA-Z]/.test(c));
  const dataRows = headerLike ? rows.slice(1) : rows;

  const out: ElevationPoint[] = [];
  for (const r of dataRows) {
    const nums = r.map(num).filter((v) => isFinite(v));
    if (nums.length < 3) continue;
    // 若有 4 列数值（点号+x+y+z），取后三列
    const [x, y, z] = nums.length >= 4 ? nums.slice(1, 4) : nums;
    out.push({ x, y, z });
  }
  return out;
}

/** 河道边界 CSV：name,x,y 或纯 x,y（默认名称“河道边界”） */
export function parseBoundaryCsv(text: string): Boundary[] {
  const rows = parseCsv(text).filter((r) => r.some((c) => c !== ''));
  if (rows.length === 0) return [];
  const groups = new Map<string, Vec2[]>();
  let order: string[] = [];
  const headerLike = rows[0].some((c) => /[一-龥a-zA-Z]/.test(c));
  const dataRows = headerLike ? rows.slice(1) : rows;

  for (const r of dataRows) {
    let name = '河道边界';
    let nums = r.map(num).filter((v) => isFinite(v));
    if (nums.length === 3 && isNaN(Number(r[1]))) {
      name = r[0] || name;
      nums = r.slice(1).map(num).filter((v) => isFinite(v));
    } else if (r.length >= 3 && isNaN(Number(r[0]))) {
      name = r[0] || name;
      nums = r.slice(1).map(num).filter((v) => isFinite(v));
    }
    if (nums.length < 2) continue;
    if (!groups.has(name)) {
      groups.set(name, []);
      order.push(name);
    }
    groups.get(name)!.push({ x: nums[0], y: nums[1] });
  }
  if (order.length === 0) order = ['河道边界'];
  return order.map((name, idx) => ({
    id: `bnd-${idx}-${name}`,
    name,
    points: groups.get(name)!
  }));
}

export async function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'utf-8');
  });
}
