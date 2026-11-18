import { useStore, COMP_BY_ID } from '../store/store';
import { TYPES, POOL_BY_ID, ZONE_BY_ID } from '../data/surveyData';

export default function InfoPanel() {
  const focused = useStore((s) => s.focused);
  const flyTo = useStore((s) => s.flyTo);
  const setDispatchPrefill = useStore((s) => s.setDispatchPrefill);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const statusVersion = useStore((s) => s.statusVersion); // 状态变更时重渲染

  if (!focused || !COMP_BY_ID[focused]) {
    return <div className="info-panel empty">点击地图上的构件查看详情;Shift+拖拽可框选批量操作。</div>;
  }
  const c = COMP_BY_ID[focused];
  void statusVersion;
  const status = useStore.getState().statusOverrides[c.id] ?? c.status;
  const pool = POOL_BY_ID[c.poolId];
  const zone = ZONE_BY_ID[c.zoneId];

  return (
    <div className="info-panel">
      <div className="info-title">
        <span className="dot" style={{ background: TYPES[c.type].color }} />
        {c.id}
        <span className={`status s-${status}`}>{status}</span>
      </div>
      <table>
        <tbody>
          <tr><td>类型</td><td>{TYPES[c.type].name}</td></tr>
          <tr><td>所属片区</td><td>{zone?.name}</td></tr>
          <tr><td>所属池体</td><td>{pool?.name ?? '—'}</td></tr>
          <tr><td>上次检修</td><td>{c.lastMaintenance}</td></tr>
          {c.angle !== undefined && <tr><td>朝向角</td><td>{c.angle}°</td></tr>}
        </tbody>
      </table>
      <div className="info-actions">
        <button className="btn" onClick={() => flyTo({ x: c.x, y: c.y, worldWidth: 80 })}>飞到构件</button>
        <button className="btn warn" onClick={() => { setDispatchPrefill({ componentId: c.id }); setSidebarTab('dispatch'); }}>
          登记故障
        </button>
      </div>
    </div>
  );
}
