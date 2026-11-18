import { useEffect, useState } from 'react';
import { useStore, USERS, TECHNICIANS, COMP_BY_ID } from '../store/store';
import { TYPES } from '../data/surveyData';

const STATUS_NAME = {
  pending: '待派单', assigned: '待处理', submitted: '待质检', done: '已完成',
};

function OrderCard({ o, children }) {
  const [open, setOpen] = useState(false);
  const c = COMP_BY_ID[o.componentId];
  return (
    <div className={`order-card st-${o.status}`}>
      <div className="order-head" onClick={() => setOpen(!open)}>
        <b>{o.id}</b>
        <span className="mono">{o.componentId}</span>
        {c && <span className="dot" style={{ background: TYPES[c.type].color }} title={TYPES[c.type].name} />}
        <span className={`pill p-${o.status}`}>{STATUS_NAME[o.status]}</span>
        {o.priority === '紧急' && <span className="pill urgent">紧急</span>}
        {o.rejectCount > 0 && <span className="pill rework">返工×{o.rejectCount}</span>}
      </div>
      <div className="order-desc">{o.desc}</div>
      <div className="order-meta">
        登记:{o.reporter} {o.createdAt}
        {o.assignee && <> · 师傅:{o.assignee}</>}
        {o.finishedAt && <> · 完成:{o.finishedAt}</>}
      </div>
      {children}
      {open && (
        <ol className="history">
          {o.history.map((h, i) => <li key={i}>[{h.t}] {h.actor} — {h.action}</li>)}
        </ol>
      )}
    </div>
  );
}

// ---------- 前台:登记故障 + 派单 ----------
function FrontDesk() {
  const prefill = useStore((s) => s.dispatchPrefill);
  const setPrefill = useStore((s) => s.setDispatchPrefill);
  const reportFault = useStore((s) => s.reportFault);
  const dispatchOrder = useStore((s) => s.dispatchOrder);
  const orders = useStore((s) => s.orders);
  const userKey = useStore((s) => s.userKey);
  const [componentId, setComponentId] = useState('');
  const [desc, setDesc] = useState('');
  const [priority, setPriority] = useState('普通');
  const [assignTo, setAssignTo] = useState({});

  useEffect(() => {
    if (prefill?.componentId) { setComponentId(prefill.componentId); setPrefill(null); }
  }, [prefill, setPrefill]);

  const isFrontdesk = USERS.find((u) => u.key === userKey)?.role === '前台';
  const pending = orders.filter((o) => o.status === 'pending');

  return (
    <div>
      <div className="form">
        <div className="form-title">故障登记{!isFrontdesk && <span className="hint">(当前角色非前台,仍可演示登记)</span>}</div>
        <input placeholder="构件编号(从地图点选可自动带入)" value={componentId}
          onChange={(e) => setComponentId(e.target.value.toUpperCase())} />
        {componentId && !COMP_BY_ID[componentId] && <div className="miss">编号不存在</div>}
        <textarea placeholder="故障描述" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div className="row">
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option>普通</option><option>紧急</option>
          </select>
          <button className="btn primary" disabled={!COMP_BY_ID[componentId] || !desc.trim()}
            onClick={() => { reportFault({ componentId, desc: desc.trim(), priority }); setComponentId(''); setDesc(''); }}>
            登记
          </button>
        </div>
      </div>
      <div className="form-title">待派单({pending.length})</div>
      {pending.map((o) => (
        <OrderCard key={o.id} o={o}>
          <div className="row">
            <select value={assignTo[o.id] || ''} onChange={(e) => setAssignTo({ ...assignTo, [o.id]: e.target.value })}>
              <option value="">选择师傅…</option>
              {TECHNICIANS.map((t) => <option key={t}>{t}</option>)}
            </select>
            <button className="btn small primary" disabled={!assignTo[o.id]}
              onClick={() => dispatchOrder(o.id, assignTo[o.id])}>派单</button>
          </div>
        </OrderCard>
      ))}
      {pending.length === 0 && <div className="empty-tip">没有待派单的故障</div>}
    </div>
  );
}

// ---------- 师傅:我的工单,提交维修结果 ----------
function Technician() {
  const orders = useStore((s) => s.orders);
  const submitOrder = useStore((s) => s.submitOrder);
  const userKey = useStore((s) => s.userKey);
  const me = USERS.find((u) => u.key === userKey);
  const [note, setNote] = useState({});
  const mine = orders.filter((o) => o.status === 'assigned' && (me?.role !== '维修师傅' || o.assignee === me.name));

  return (
    <div>
      <div className="form-title">
        待处理工单({mine.length}){me?.role !== '维修师傅' && <span className="hint">(切换到师傅角色可只看自己的单)</span>}
      </div>
      {mine.map((o) => (
        <OrderCard key={o.id} o={o}>
          {o.rejectCount > 0 && <div className="reject-tip">⚠ 该单被质检打回 {o.rejectCount} 次,请重做后重新提交</div>}
          <div className="row">
            <input placeholder="维修结果说明" value={note[o.id] || ''}
              onChange={(e) => setNote({ ...note, [o.id]: e.target.value })} />
            <button className="btn small primary" onClick={() => submitOrder(o.id, note[o.id])}>提交结果</button>
          </div>
        </OrderCard>
      ))}
      {mine.length === 0 && <div className="empty-tip">暂无待处理工单</div>}
    </div>
  );
}

// ---------- 质检:抽查 ----------
function QC() {
  const orders = useStore((s) => s.orders);
  const qcPass = useStore((s) => s.qcPass);
  const qcReject = useStore((s) => s.qcReject);
  const userKey = useStore((s) => s.userKey);
  const [note, setNote] = useState({});
  const isQC = USERS.find((u) => u.key === userKey)?.role === '质检员';
  const waiting = orders.filter((o) => o.status === 'submitted');

  return (
    <div>
      <div className="form-title">待抽查工单({waiting.length}){!isQC && <span className="hint">(建议切换到质检员角色)</span>}</div>
      {waiting.map((o) => (
        <OrderCard key={o.id} o={o}>
          {o.resultNote && <div className="result-note">师傅说明:{o.resultNote}</div>}
          <div className="row">
            <input placeholder="打回原因(不合格时填写)" value={note[o.id] || ''}
              onChange={(e) => setNote({ ...note, [o.id]: e.target.value })} />
            <button className="btn small primary" onClick={() => qcPass(o.id)}>抽查合格</button>
            <button className="btn small warn" onClick={() => qcReject(o.id, note[o.id])}>不合格打回</button>
          </div>
        </OrderCard>
      ))}
      {waiting.length === 0 && <div className="empty-tip">暂无待抽查工单</div>}
    </div>
  );
}

export default function DispatchPanel() {
  const [tab, setTab] = useState('front');
  return (
    <div className="dispatch">
      <div className="sub-tabs">
        <button className={tab === 'front' ? 'on' : ''} onClick={() => setTab('front')}>登记/派单</button>
        <button className={tab === 'tech' ? 'on' : ''} onClick={() => setTab('tech')}>师傅工单</button>
        <button className={tab === 'qc' ? 'on' : ''} onClick={() => setTab('qc')}>质检抽查</button>
      </div>
      {tab === 'front' && <FrontDesk />}
      {tab === 'tech' && <Technician />}
      {tab === 'qc' && <QC />}
    </div>
  );
}
