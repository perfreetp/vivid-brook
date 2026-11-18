import { useStore, COMP_BY_ID } from '../store/store';
import { TYPES, POOL_BY_ID } from '../data/surveyData';

// 点选构件后的浮动气泡:编号 / 所属池体 / 上次检修日期
export default function Popup() {
  const popup = useStore((s) => s.popup);
  const setFocused = useStore((s) => s.setFocused);
  const setPopup = useStore((s) => s.setPopup);
  if (!popup) return null;
  const c = COMP_BY_ID[popup.id];
  if (!c) return null;
  const pool = POOL_BY_ID[c.poolId];
  return (
    <div className="popup" style={{ left: popup.sx + 12, top: popup.sy - 10 }}>
      <div className="popup-head">
        <span className="dot" style={{ background: TYPES[c.type].color }} />
        <b>{c.id}</b>
        <button className="close" onClick={() => setPopup(null)}>×</button>
      </div>
      <div>类型:{TYPES[c.type].name}</div>
      <div>所属池体:{pool?.name ?? '—'}</div>
      <div>上次检修:{c.lastMaintenance}</div>
      <button className="btn small" onClick={() => { setFocused(c.id); setPopup(null); }}>详情 / 派单</button>
    </div>
  );
}
