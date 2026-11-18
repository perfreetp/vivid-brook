import { useStore, TECHNICIANS } from '../store/store';

const STATUS_NAME = { pending: '待派单', assigned: '待处理', submitted: '待质检', done: '已完成' };

export default function Dashboard() {
  const orders = useStore((s) => s.orders);

  const rows = TECHNICIANS.map((name) => {
    const mine = orders.filter((o) => o.assignee === name);
    const done = mine.filter((o) => o.status === 'done').length;
    const submits = mine.reduce((a, o) => a + o.submitCount, 0);
    const rejects = mine.reduce((a, o) => a + o.rejectCount, 0);
    return {
      name,
      dispatched: mine.length,
      done,
      doing: mine.filter((o) => o.status === 'assigned' || o.status === 'submitted').length,
      submits,
      rejects,
      reworkRate: submits > 0 ? ((rejects / submits) * 100).toFixed(1) : '0.0',
    };
  });
  const maxDone = Math.max(1, ...rows.map((r) => r.done));

  const counts = Object.keys(STATUS_NAME).map((k) => ({
    key: k, name: STATUS_NAME[k], n: orders.filter((o) => o.status === k).length,
  }));

  return (
    <div className="dashboard">
      <div className="stat-chips">
        {counts.map((c) => (
          <div key={c.key} className={`chip p-${c.key}`}>
            <div className="n">{c.n}</div>
            <div>{c.name}</div>
          </div>
        ))}
      </div>
      <table className="dash-table">
        <thead>
          <tr><th>师傅</th><th>派单数</th><th>完成量</th><th>在途</th><th>提交次数</th><th>打回次数</th><th>返工率</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.dispatched}</td>
              <td>
                <div className="bar-cell">
                  <div className="bar" style={{ width: `${(r.done / maxDone) * 100}%` }} />
                  <span>{r.done}</span>
                </div>
              </td>
              <td>{r.doing}</td>
              <td>{r.submits}</td>
              <td>{r.rejects}</td>
              <td className={parseFloat(r.reworkRate) > 30 ? 'bad' : ''}>{r.reworkRate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint" style={{ marginTop: 8 }}>返工率 = 质检打回次数 ÷ 师傅提交次数</div>
    </div>
  );
}
