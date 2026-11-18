import { useStore, USERS } from '../store/store';
import { PARK } from '../data/surveyData';

const LEVELS = [
  { key: 'park', name: '全园' },
  { key: 'zone', name: '片区' },
  { key: 'pool', name: '池体' },
];

export default function TopBar() {
  const viewLevel = useStore((s) => s.viewLevel);
  const mapApi = useStore((s) => s.mapApi);
  const userKey = useStore((s) => s.userKey);
  const setUserKey = useStore((s) => s.setUserKey);
  const requestExport = useStore((s) => s.requestExport);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">🌊</span>
        <span>{PARK.name} · 园区总图与检修派单系统</span>
      </div>
      <nav className="breadcrumb">
        {LEVELS.map((l) => (
          <button
            key={l.key}
            className={viewLevel === l.key ? 'crumb active' : 'crumb'}
            onClick={() => mapApi?.flyToLevel(l.key)}
          >
            {l.name}
          </button>
        ))}
        <span className="hint">滚轮缩放 / 拖拽平移 / 双击放大 / Shift+拖拽框选 / 全园点击池体进入片区</span>
      </nav>
      <div className="top-actions">
        <label className="role-label">当前角色</label>
        <select value={userKey} onChange={(e) => setUserKey(e.target.value)}>
          {USERS.map((u) => (
            <option key={u.key} value={u.key}>{u.name}({u.role})</option>
          ))}
        </select>
        <button className="btn primary" onClick={requestExport}>导出当前视口平面图</button>
      </div>
    </header>
  );
}
