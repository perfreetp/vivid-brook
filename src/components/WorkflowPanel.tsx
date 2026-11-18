import { useState } from 'react';
import { store, useEditor } from '../state/store';
import { KIND_META } from '../lib/factory';
import type { FeatureKind, WorkStatus } from '../types';
import { exportPackage } from '../lib/export';

const STATUS_META: Record<WorkStatus, { label: string; cls: string }> = {
  pending: { label: '待加工', cls: 'st-pending' },
  in_progress: { label: '加工中', cls: 'st-progress' },
  rework: { label: '退回返工', cls: 'st-rework' },
  submitted: { label: '待审核', cls: 'st-submitted' },
  approved: { label: '审核通过', cls: 'st-approved' },
  rejected: { label: '已退回', cls: 'st-rework' },
};

function deadlineState(iso: string): { text: string; overdue: boolean } {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return { text: `已逾期 ${Math.ceil(-ms / 864e5)} 天`, overdue: true };
  const days = Math.floor(ms / 864e5);
  const hours = Math.floor((ms % 864e5) / 36e5);
  return { text: `剩余 ${days}天${hours}时`, overdue: days < 1 };
}

export default function WorkflowPanel() {
  const s = useEditor();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<FeatureKind>('intake');
  const [assignee, setAssignee] = useState('制作员A');
  const defaultDeadline = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 16);
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [reviewNote, setReviewNote] = useState('');

  const role = s.role;

  const createOrder = () => {
    if (!title.trim()) {
      alert('请填写工单标题');
      return;
    }
    store.createEntry(
      title.trim(),
      kind,
      assignee.trim() || '未分配',
      new Date(deadline).toISOString(),
      [...s.selectedIds],
    );
    setTitle('');
  };

  return (
    <div className="panel workflow">
      <div className="panel-head">
        <h3>工单流程</h3>
        <span className="role-tag">视角：{role === 'customer' ? '客户' : role === 'maker' ? '制作员' : '主管'}</span>
      </div>

      {/* 客户下单 */}
      {role === 'customer' && (
        <div className="order-form">
          <p className="muted small">客户下单建立工单，可勾选画布要素关联（当前选中 {s.selectedIds.length} 个）。</p>
          <input placeholder="工单标题，如：二号卤水池池埂修整" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="form-row">
            <select value={kind} onChange={(e) => setKind(e.target.value as FeatureKind)}>
              {Object.entries(KIND_META).map(([k, m]) => (
                <option key={k} value={k}>{m.label}</option>
              ))}
            </select>
            <input placeholder="制作员" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
          </div>
          <label className="prop-field">
            <span>截止时间</span>
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
          <button className="tb-btn wide primary" onClick={createOrder}>下单</button>
        </div>
      )}

      <div className="entry-list">
        {s.entries.map((e) => {
          const dl = deadlineState(e.deadline);
          const st = STATUS_META[e.status];
          const linked = e.featureIds
            .map((id) => s.features.find((f) => f.id === id)?.name)
            .filter(Boolean)
            .join('、');
          return (
            <div key={e.id} className={`entry-card ${st.cls}`}>
              <div className="entry-title">
                <strong>{e.title}</strong>
                <span className={`status-pill ${st.cls}`}>{st.label}</span>
              </div>
              <div className="entry-meta">
                <span>类型：{KIND_META[e.kind].label}</span>
                <span>负责人：{e.assignee}</span>
                <span className={dl.overdue ? 'overdue' : ''}>截止：{new Date(e.deadline).toLocaleString('zh-CN')}（{dl.text}）</span>
                <span className="rework">返工次数：{e.reworkCount}</span>
                {linked && <span className="linked">关联要素：{linked}</span>}
                {e.reviewNote && <span className="review-note">审核意见：{e.reviewNote}</span>}
              </div>
              <div className="entry-actions">
                {role === 'maker' && (
                  <>
                    {e.status === 'pending' && (
                      <button className="mini-btn" onClick={() => store.updateEntryStatus(e.id, 'in_progress')}>开始加工</button>
                    )}
                    {e.status === 'rework' && (
                      <button className="mini-btn" onClick={() => store.updateEntryStatus(e.id, 'in_progress')}>重新加工（第 {e.reworkCount + 1} 次）</button>
                    )}
                    {(e.status === 'in_progress' || e.status === 'rework') && (
                      <button className="mini-btn primary" onClick={() => store.updateEntryStatus(e.id, 'submitted')}>提交审核</button>
                    )}
                    {e.status === 'submitted' && <span className="muted small">已提交，等待主管审核</span>}
                  </>
                )}
                {role === 'supervisor' && (
                  <>
                    {e.status === 'submitted' && (
                      <>
                        <textarea
                          rows={2}
                          placeholder="审核意见（退回时必填提示）"
                          value={reviewNote}
                          onChange={(ev) => setReviewNote(ev.target.value)}
                        />
                        <button
                          className="mini-btn danger"
                          onClick={() => {
                            if (!reviewNote.trim()) { alert('退回需填写审核意见'); return; }
                            store.updateEntryStatus(e.id, 'rejected', reviewNote.trim());
                            setReviewNote('');
                          }}
                        >
                          退回（返工 +1）
                        </button>
                        <button
                          className="mini-btn primary"
                          onClick={() => {
                            store.updateEntryStatus(e.id, 'approved', reviewNote.trim() || '审核通过');
                            setReviewNote('');
                          }}
                        >
                          审核通过
                        </button>
                      </>
                    )}
                    {e.status === 'approved' && (
                      <button className="mini-btn primary" onClick={() => void exportPackage(s)}>打包交付 ZIP</button>
                    )}
                    {e.status !== 'submitted' && e.status !== 'approved' && (
                      <span className="muted small">仅“待审核”工单可执行审核操作</span>
                    )}
                  </>
                )}
                {role === 'customer' && <span className="muted small">客户视角：可在顶部切换角色跟踪加工进度</span>}
              </div>
            </div>
          );
        })}
        {s.entries.length === 0 && <p className="muted small">暂无工单。切换到“客户”角色下单。</p>}
      </div>
    </div>
  );
}
