import type {
  ProjectMeta,
  ProjectSnapshot,
  SnapshotStats,
  UnfoldResult,
  WorkspaceState
} from '../state/types';
import { sampleSpline, splineLength } from '../math/spline';
import { gridSurfaceArea } from '../math/color';
import type { TerrainGrid } from '../math/terrain';
import { diffStats, type VersionDiff } from './archive';

export function computeStats(state: WorkspaceState, grid: TerrainGrid | null): SnapshotStats {
  const center = sampleSpline(state.lines.center.controlPoints, 24, state.curvature.smoothWindow);
  const left = sampleSpline(state.lines.leftCrest.controlPoints, 24, state.curvature.smoothWindow);
  const right = sampleSpline(state.lines.rightCrest.controlPoints, 24, state.curvature.smoothWindow);

  const maxK = (samples: ReturnType<typeof sampleSpline>) =>
    samples.reduce((m, s) => Math.max(m, s.curvature), 0);
  const hotspotCount = (samples: ReturnType<typeof sampleSpline>) =>
    samples.filter((s) => s.curvature >= state.curvature.threshold).length;

  return {
    centerLength: splineLength(center),
    leftCrestLength: splineLength(left),
    rightCrestLength: splineLength(right),
    terrainArea: grid ? gridSurfaceArea(grid) : 0,
    elevationMin: grid ? grid.zMin : 0,
    elevationMax: grid ? grid.zMax : 0,
    maxSlopeDeg: grid ? grid.slopeMaxDeg : 0,
    maxCurvature: Math.max(maxK(center), maxK(left), maxK(right)),
    hotspotCount: hotspotCount(center) + hotspotCount(left) + hotspotCount(right)
  };
}

export function buildSnapshot(state: WorkspaceState, grid: TerrainGrid | null, note: string): ProjectSnapshot {
  return {
    center: state.lines.center.controlPoints.map((p) => ({ ...p })),
    leftCrest: state.lines.leftCrest.controlPoints.map((p) => ({ ...p })),
    rightCrest: state.lines.rightCrest.controlPoints.map((p) => ({ ...p })),
    offset: { ...state.offset },
    colorMode: state.colorMode,
    terrainSettings: { ...state.terrain },
    curvatureSettings: { ...state.curvature },
    pointCount: state.points.length,
    stats: computeStats(state, grid),
    note
  };
}

function fmt(n: number, d = 2): string {
  if (!isFinite(n)) return '∞';
  return n.toFixed(d);
}

/** 生成 HTML 成果报告（同时作为归档文本保存） */
export function buildReport(
  meta: ProjectMeta,
  version: number,
  snapshot: ProjectSnapshot,
  unfolds: UnfoldResult[],
  prevDiff: VersionDiff | null
): string {
  const s = snapshot.stats;
  const now = new Date().toLocaleString('zh-CN');
  const diffRows = prevDiff
    ? prevDiff.fields
        .map(
          (f) =>
            `<tr class="${f.changed ? 'chg' : ''}"><td>${f.label}</td><td>${f.from}</td><td>${f.to}</td><td>${
              f.changed ? '▲ 变化' : '—'
            }</td></tr>`
        )
        .join('')
    : '';
  const unfoldRows = unfolds
    .map(
      (u) =>
        `<tr><td>${u.side === 'left' ? '左堤坡' : '右堤坡'}</td><td>${fmt(u.stationStart, 1)} ~ ${fmt(
          u.stationEnd,
          1
        )}</td><td>${fmt(u.area, 1)}</td><td>${fmt(u.slopeLength, 2)}</td><td>${fmt(
          u.crestLength,
          1
        )} / ${fmt(u.toeLength, 1)}</td></tr>`
    )
    .join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>河道建模成果报告 ${meta.code} V${version}</title>
<style>
body{font-family:"Microsoft YaHei",sans-serif;margin:32px;color:#1f2937}
h1{font-size:22px;border-bottom:3px solid #1d4ed8;padding-bottom:8px}
h2{font-size:16px;margin-top:26px;color:#1d4ed8}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}
td,th{border:1px solid #cbd5e1;padding:6px 10px;text-align:left}
th{background:#eff6ff}.chg{background:#fef3c7}.meta td:first-child{width:180px;color:#475569}
.tag{display:inline-block;background:#dbeafe;color:#1e40af;border-radius:4px;padding:2px 8px;font-size:12px}
</style></head><body>
<h1>河道地形曲面与堤线建模成果报告 <span class="tag">V${version}</span></h1>
<table class="meta">
<tr><td>项目编号</td><td>${meta.code}</td><td>项目名称</td><td>${meta.name}</td></tr>
<tr><td>河流名称</td><td>${meta.river}</td><td>河段</td><td>${meta.reach}</td></tr>
<tr><td>建档日期</td><td>${new Date(meta.createdAt).toLocaleString('zh-CN')}</td><td>加工时间</td><td>${now}</td></tr>
<tr><td>断面高程点数</td><td>${snapshot.pointCount}</td><td>着色模式</td><td>${
    snapshot.colorMode === 'elevation' ? '高程' : snapshot.colorMode === 'slope' ? '坡度' : '曲率'
  }</td></tr>
<tr><td>栅格分辨率</td><td>${snapshot.terrainSettings.resolution} m</td><td>曲率突变阈值</td><td>${snapshot.curvatureSettings.threshold} 1/m</td></tr>
<tr><td>管理范围偏移</td><td>${snapshot.offset.enabled ? `${snapshot.offset.distance} m（${snapshot.offset.corner === 'round' ? '圆角' : '尖角'}）` : '未启用'}</td><td>备注</td><td>${snapshot.note || '—'}</td></tr>
</table>
<h2>一、成果统计</h2>
<table><tr><th>指标</th><th>数值</th></tr>
<tr><td>中心线长度</td><td>${fmt(s.centerLength)} m</td></tr>
<tr><td>左/右堤顶线长度</td><td>${fmt(s.leftCrestLength)} / ${fmt(s.rightCrestLength)} m</td></tr>
<tr><td>地形曲面面积</td><td>${fmt(s.terrainArea, 1)} m²</td></tr>
<tr><td>高程范围</td><td>${fmt(s.elevationMin)} ~ ${fmt(s.elevationMax)} m</td></tr>
<tr><td>最大坡度</td><td>${fmt(s.maxSlopeDeg)}°</td></tr>
<tr><td>最大曲率 / 曲率突变段</td><td>${fmt(s.maxCurvature, 5)} 1/m ；${s.hotspotCount} 段</td></tr>
</table>
${
  unfolds.length
    ? `<h2>二、堤坡测地线展开成果</h2><table><tr><th>堤坡</th><th>里程区间 (m)</th><th>展开面积 (m²)</th><th>平均坡长 (m)</th><th>堤顶/坡脚长 (m)</th></tr>${unfoldRows}</table>`
    : '<h2>二、堤坡测地线展开成果</h2><p>本次加工未生成展开成果。</p>'
}
${
  prevDiff
    ? `<h2>三、与上一版本比对</h2><table><tr><th>指标</th><th>上一版本</th><th>当前版本</th><th>状态</th></tr>${diffRows}</table>`
    : '<h2>三、版本比对</h2><p>本项目首个归档版本，无历史版本可比对。</p>'
}
<p style="margin-top:32px;color:#64748b;font-size:12px">本报告由河道地形曲面与堤线建模台自动生成 · ${now}</p>
</body></html>`;
}

export function diffForVersion(prev: ProjectSnapshot | null, current: ProjectSnapshot): VersionDiff | null {
  if (!prev) return null;
  return diffStats(prev.stats, current.stats);
}
