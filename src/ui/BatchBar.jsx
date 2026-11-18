import { useStore } from '../store/store';

// 框选一批构件后的批量操作条
export default function BatchBar() {
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const setCompStatus = useStore((s) => s.setCompStatus);
  const batchDispatch = useStore((s) => s.batchDispatch);
  const setSidebarTab = useStore((s) => s.setSidebarTab);

  if (selection.length < 2) return null;
  return (
    <div className="batch-bar">
      <span>已框选 <b>{selection.length}</b> 个构件</span>
      <button className="btn small" onClick={() => setCompStatus(selection, '正常')}>标记正常</button>
      <button className="btn small warn" onClick={() => setCompStatus(selection, '待修')}>标记待修</button>
      <button className="btn small gray" onClick={() => setCompStatus(selection, '停用')}>标记停用</button>
      <button className="btn small primary" onClick={() => { batchDispatch(selection, '批量巡检登记故障'); setSidebarTab('dispatch'); }}>
        整组生成派工单
      </button>
      <button className="btn small" onClick={() => setSelection([])}>清除选择</button>
    </div>
  );
}
