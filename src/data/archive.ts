import type {
  ProjectMeta,
  ProjectRecord,
  ProjectSnapshot,
  ProjectVersion,
  SnapshotStats
} from '../state/types';

const DB_NAME = 'river-modeler-db';
const STORE = 'projects';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'meta.code' });
        os.createIndex('reach', 'meta.reach', { unique: false });
        os.createIndex('updatedAt', 'meta.updatedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => {
          t.oncomplete = () => {
            db.close();
            resolve(req.result);
          };
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      })
  );
}

export async function saveProject(record: ProjectRecord): Promise<void> {
  await tx('readwrite', (s) => s.put(record));
}

export async function getProject(code: string): Promise<ProjectRecord | undefined> {
  return tx('readonly', (s) => s.get(code));
}

export async function deleteProject(code: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(code));
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return tx('readonly', (s) => s.getAll() as IDBRequest<ProjectRecord[]>);
}

export async function projectExists(code: string): Promise<boolean> {
  const rec = await getProject(code);
  return !!rec;
}

/** 生成项目编号：SL-年份-四位顺序号 */
export async function nextProjectCode(): Promise<string> {
  const year = new Date().getFullYear();
  const all = await listProjects();
  const prefix = `SL-${year}-`;
  let max = 0;
  for (const r of all) {
    if (r.meta.code.startsWith(prefix)) {
      const n = Number(r.meta.code.slice(prefix.length));
      if (isFinite(n)) max = Math.max(max, n);
    }
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** 建档 */
export async function createProject(meta: ProjectMeta): Promise<ProjectRecord> {
  const record: ProjectRecord = { meta, versions: [] };
  await saveProject(record);
  return record;
}

/** 档案加工：追加一个成果版本 */
export async function appendVersion(
  code: string,
  snapshot: ProjectSnapshot,
  report: string
): Promise<ProjectVersion> {
  const record = await getProject(code);
  if (!record) throw new Error(`项目 ${code} 不存在，请先建档`);
  const version: ProjectVersion = {
    version: record.versions.length + 1,
    createdAt: new Date().toISOString(),
    snapshot,
    report
  };
  record.versions.push(version);
  record.meta.updatedAt = version.createdAt;
  await saveProject(record);
  return version;
}

export interface SearchQuery {
  code?: string;
  reach?: string;
  dateFrom?: string; // yyyy-mm-dd
  dateTo?: string;
}

/** 按项目编号 / 河段 / 建模日期检索 */
export async function searchProjects(q: SearchQuery): Promise<ProjectRecord[]> {
  const all = await listProjects();
  return all
    .filter((r) => {
      if (q.code && !r.meta.code.toLowerCase().includes(q.code.toLowerCase())) return false;
      if (q.reach && !r.meta.reach.toLowerCase().includes(q.reach.toLowerCase())) return false;
      const dates = r.versions.map((v) => v.createdAt.slice(0, 10));
      if (q.dateFrom && !dates.some((d) => d >= (q.dateFrom as string))) return false;
      if (q.dateTo && !dates.some((d) => d <= (q.dateTo as string))) return false;
      return true;
    })
    .sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt));
}

// ---------- 版本比对 ----------

export interface VersionDiff {
  fields: { label: string; from: string; to: string; changed: boolean }[];
}

function fmt(n: number, digits = 2): string {
  if (!isFinite(n)) return '∞';
  return n.toFixed(digits);
}

export function diffStats(a: SnapshotStats, b: SnapshotStats): VersionDiff {
  const rows: [string, number, number, string][] = [
    ['中心线长度 (m)', a.centerLength, b.centerLength, '0.01'],
    ['左堤顶线长度 (m)', a.leftCrestLength, b.leftCrestLength, '0.01'],
    ['右堤顶线长度 (m)', a.rightCrestLength, b.rightCrestLength, '0.01'],
    ['地形曲面面积 (m²)', a.terrainArea, b.terrainArea, '0.1'],
    ['最低高程 (m)', a.elevationMin, b.elevationMin, '0.01'],
    ['最高高程 (m)', a.elevationMax, b.elevationMax, '0.01'],
    ['最大坡度 (°)', a.maxSlopeDeg, b.maxSlopeDeg, '0.01'],
    ['最大曲率 (1/m)', a.maxCurvature, b.maxCurvature, '0.0001'],
    ['曲率突变段数', a.hotspotCount, b.hotspotCount, '0']
  ];
  return {
    fields: rows.map(([label, from, to, digits]) => {
      const d = Number(digits);
      const fs = fmt(from, d);
      const ts = fmt(to, d);
      return { label, from: fs, to: ts, changed: fs !== ts };
    })
  };
}
