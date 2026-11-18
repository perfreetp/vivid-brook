import { store, useEditor } from '../state/store';
import type { BooleanOp, Role, ToolType } from '../types';
import { exportSVG, exportFeatureList, exportPackage } from '../lib/export';

const TOOLS: { id: ToolType; label: string; icon: string }[] = [
  { id: 'select', label: '选择/顶点', icon: '➤' },
  { id: 'intake', label: '纳潮渠(开放)', icon: '〰' },
  { id: 'drain', label: '排淡沟(开放)', icon: '≈' },
  { id: 'pool', label: '卤水池(闭合)', icon: '▱' },
  { id: 'pan', label: '平移画布', icon: '✥' },
];

const ROLES: { id: Role; label: string }[] = [
  { id: 'customer', label: '客户' },
  { id: 'maker', label: '制作员' },
  { id: 'supervisor', label: '主管' },
];

export default function Toolbar() {
  const s = useEditor();
  const selCount = s.selectedIds.length;
  const selected = s.features.filter((f) => s.selectedIds.includes(f.id));
  const allOpen = selected.every((f) => f.pathType === 'open');
  const hasLockedSel = selected.some((f) => f.locked || store.isLayerLocked(f.layerId));

  const btn = (label: string, onClick: () => void, disabled = false, title = '') => (
    <button className="tb-btn" onClick={onClick} disabled={disabled} title={title || label}>
      {label}
    </button>
  );

  return (
    <div className="toolbar">
      <div className="tb-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tb-btn tool ${s.currentTool === t.id ? 'active' : ''}`}
            onClick={() => store.setTool(t.id)}
            title={`${t.label}（双击/回车结束绘制）`}
          >
            <span className="tb-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="tb-sep" />
      <div className="tb-group">
        {btn('撤销', () => store.undo(), !store.history.canUndo, 'Ctrl+Z（历史≥50步）')}
        {btn('重做', () => store.redo(), !store.history.canRedo, 'Ctrl+Y')}
        {btn('反转方向', () => store.reverseSelected(), selCount === 0 || hasLockedSel, '反转选中路径顶点顺序')}
        {btn('合并', () => store.mergeSelected(), selCount < 2 || !allOpen || hasLockedSel, '首尾拼接两条以上开放路径')}
        {btn('删除', () => store.deleteSelected(), selCount === 0, 'Delete')}
      </div>

      <div className="tb-sep" />
      <div className="tb-group">
        <span className={`tb-hint ${selCount >= 2 ? 'ready' : ''}`}>布尔运算（选中 ≥2，差集第 1 条为被减对象）</span>
        {btn('并集 ∪', () => store.applyBoolean('union' as BooleanOp), selCount < 2 || hasLockedSel)}
        {btn('差集 −', () => store.applyBoolean('difference' as BooleanOp), selCount < 2 || hasLockedSel, '渠底轮廓/池埂交线剪出缺口')}
        {btn('交集 ∩', () => store.applyBoolean('intersection' as BooleanOp), selCount < 2 || hasLockedSel)}
      </div>

      <div className="tb-sep" />
      <div className="tb-group">
        {btn('导出 SVG', () => exportSVG(s), s.features.length === 0)}
        {btn('要素清单 CSV', () => exportFeatureList(s), s.features.length === 0)}
        {btn('打包交付 ZIP', () => void exportPackage(s), s.features.length === 0, '含 SVG/JSON/清单/工单记录')}
        {btn('重置演示', () => {
          if (confirm('确定重置全部数据为演示项目？')) store.resetProject();
        })}
      </div>

      <div className="tb-sep" />
      <div className="tb-group role-switch">
        <span className="tb-hint">当前角色：</span>
        {ROLES.map((r) => (
          <button
            key={r.id}
            className={`tb-btn role ${s.role === r.id ? 'active' : ''}`}
            onClick={() => store.setRole(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
