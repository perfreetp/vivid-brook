import { createSignal, For, Show } from 'solid-js';
import { FacilityType, TYPE_META } from '../types';
import { Store } from '../state/store';

interface Props {
  store: Store;
  data: { facilities: { id: string; type: FacilityType; floor: number; code: string; roomName: string }[] };
}

const ALL_TYPES: FacilityType[] = ['gasCabinet', 'fumeHood', 'eyeWash', 'pipeline'];

export default function QuizPanel(props: Props) {
  return (
    <aside class="right-panel">
      <Show when={props.store.role() === 'teacher'} fallback={<StudentPanel store={props.store} />}>
        <TeacherBuilder store={props.store} />
        <TeacherReview store={props.store} data={props.data} />
      </Show>
    </aside>
  );
}

/* ---------------- 老师：出题 ---------------- */

function TeacherBuilder(props: { store: Store }) {
  const s = props.store;
  const [title, setTitle] = createSignal('实验室安全设施识图考核 ' + new Date().toLocaleDateString());
  const [rows, setRows] = createSignal<{ type: FacilityType; count: number; floor: number }[]>([
    { type: 'eyeWash', count: 3, floor: 1 },
    { type: 'gasCabinet', count: 5, floor: 3 }
  ]);

  const update = (i: number, patch: Partial<{ type: FacilityType; count: number; floor: number }>) => {
    setRows(rows().map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const submit = () => {
    const valid = rows().filter(r => r.count > 0);
    if (!valid.length) return;
    const p = s.createPaper(title(), valid);
    alert(`试卷《${p.title}》已生成，共 ${p.questions.length} 题，学员可在学员端作答。`);
  };

  return (
    <div class="card">
      <h4>老师出题（指定设施类型与数量）</h4>
      <input class="mb8" style={{ width: '100%' }} value={title()} onInput={e => setTitle(e.currentTarget.value)} />
      <For each={rows()}>
        {(row, i) => (
          <div class="q-builder-row">
            <select value={row.type} onChange={e => update(i(), { type: e.currentTarget.value as FacilityType })}>
              <For each={ALL_TYPES}>{t => <option value={t}>{TYPE_META[t].name}</option>}</For>
            </select>
            <input
              type="number" min={1} max={50} style={{ width: '64px' }}
              value={row.count}
              onInput={e => update(i(), { count: +e.currentTarget.value })}
            />
            <span class="muted">个 ·</span>
            <select value={row.floor} onChange={e => update(i(), { floor: +e.currentTarget.value })}>
              <For each={[1, 2, 3, 4, 5, 6, 7, 8]}>{fl => <option value={fl}>{fl}F</option>}</For>
            </select>
            <button class="danger" onClick={() => setRows(rows().filter((_, idx) => idx !== i()))}>删</button>
          </div>
        )}
      </For>
      <div class="flex-between mt8">
        <button onClick={() => setRows([...rows(), { type: 'fumeHood', count: 2, floor: 1 }])}>+ 加一题</button>
        <button class="primary" onClick={submit}>生成试卷</button>
      </div>
    </div>
  );
}

/* ---------------- 老师：复核与班级汇总 ---------------- */

function TeacherReview(props: Props) {
  const s = props.store;
  const [paperId, setPaperId] = createSignal('');
  const [className, setClassName] = createSignal('应化2401');
  const [student, setStudent] = createSignal('');

  const paper = () => s.papers().find(p => p.id === paperId());
  const students = () => {
    const p = paper();
    if (!p?.submissions[className()]) return [];
    return Object.keys(p.submissions[className()]);
  };
  const records = () => {
    const p = paper();
    const st = student();
    if (!p || !st) return [];
    return p.submissions[className()]?.[st] ?? [];
  };

  return (
    <div class="card">
      <h4>复核打分与班级汇总</h4>
      <Show when={s.papers().length === 0}>
        <div class="hint">暂无试卷，请先在上方出题。</div>
      </Show>
      <Show when={s.papers().length > 0}>
        <select data-testid="review-paper" class="mb8" style={{ width: '100%' }} value={paperId()} onChange={e => setPaperId(e.currentTarget.value)}>
          <option value="">— 选择试卷 —</option>
          <For each={s.papers()}>{p => <option value={p.id}>{p.title}</option>}</For>
        </select>
        <input class="mb8" style={{ width: '100%' }} value={className()} onInput={e => setClassName(e.currentTarget.value)} placeholder="班级" />

        <Show when={paper()}>
          <h4 style={{ margin: '6px 0' }}>班级成绩汇总</h4>
          <table>
            <thead><tr><th>学员</th><th>自动初判</th><th>复核终评</th><th>错题</th><th>状态</th></tr></thead>
            <tbody>
              <For each={s.classSummary(paperId(), className())}>
                {row => (
                  <tr style={{ cursor: 'pointer' }} onClick={() => setStudent(row.student)}>
                    <td>{row.student}</td>
                    <td>{row.autoScore}/{row.full}</td>
                    <td>{row.finalScore === null ? '—' : `${row.finalScore}/${row.full}`}</td>
                    <td>{row.wrongCount}</td>
                    <td><span class={`pill ${row.reviewed ? 'ok' : 'wait'}`}>{row.reviewed ? '已复核' : '待复核'}</span></td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>

          <Show when={students().length > 0}>
            <h4 style={{ margin: '10px 0 6px' }}>逐题复核 · {student()}</h4>
            <select class="mb8" style={{ width: '100%' }} value={student()} onChange={e => setStudent(e.currentTarget.value)}>
              <For each={students()}>{st => <option value={st}>{st}</option>}</For>
            </select>
            <For each={records()}>
              {rec => {
                const q = paper()!.questions.find(x => x.id === rec.questionId)!;
                const fac = (id: string) => props.data.facilities.find(f => f.id === id);
                return (
                  <div class="card" style={{ background: '#f8fafc', padding: '10px', margin: '6px 0' }}>
                    <div style={{ 'font-weight': 600 }}>
                      {q.id}：{TYPE_META[q.type].name} × {q.count}（{q.floor}F）
                    </div>
                    <div class="hint mt8">
                      学员点选 {rec.pickedIds.length} 个 · 系统按坐标+类型自动命中
                      <strong style={{ color: '#15803d' }}> {rec.autoCorrect} </strong>个
                    </div>
                    <div class="hint">
                      已选：
                      <For each={rec.pickedIds}>{id => <span class="tag">{fac(id)?.code ?? id}</span>}</For>
                    </div>
                    <div class="hint">
                      标准答案：
                      <For each={q.answerIds}>{id => <span class="tag" style={{ background: '#dcfce7', color: '#15803d' }}>{fac(id)?.code ?? id}</span>}</For>
                    </div>
                    <ReviewEditor
                      initial={rec.finalScore ?? rec.autoCorrect}
                      note={rec.reviewNote}
                      max={q.count}
                      onSave={(score, note) => {
                        s.reviewAnswer(paperId(), className(), student(), q.id, score, note);
                      }}
                    />
                  </div>
                );
              }}
            </For>
          </Show>
          <Show when={students().length === 0}>
            <div class="hint mt8">该班级暂无学员提交记录。</div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

function ReviewEditor(props: { initial: number; note: string; max: number; onSave: (score: number, note: string) => void }) {
  const [score, setScore] = createSignal(props.initial);
  const [note, setNote] = createSignal(props.note);
  return (
    <div class="mt8">
      <div class="q-builder-row">
        <span class="muted">复核分</span>
        <input type="number" min={0} max={props.max} value={score()} onInput={e => setScore(+e.currentTarget.value)} style={{ width: '70px' }} />
        <span class="muted">/ {props.max}</span>
      </div>
      <input class="mb8" style={{ width: '100%' }} placeholder="复核备注（错题原因等）" value={note()} onInput={e => setNote(e.currentTarget.value)} />
      <button class="primary" onClick={() => props.onSave(score(), note())}>保存复核</button>
    </div>
  );
}

/* ---------------- 学员端 ---------------- */

function StudentPanel(props: { store: Store }) {
  const s = props.store;
  const [name, setName] = createSignal(localStorage.getItem('lsmp-student') || '学员01');
  const [cls, setCls] = createSignal('应化2401');

  const enter = (paperId: string) => {
    localStorage.setItem('lsmp-student', name());
    localStorage.setItem('lsmp-class', cls());
    s.startQuiz(paperId);
  };

  return (
    <div class="card">
      <h4>学员信息</h4>
      <div class="q-builder-row">
        <span class="muted">姓名</span>
        <input value={name()} onInput={e => setName(e.currentTarget.value)} />
      </div>
      <div class="q-builder-row">
        <span class="muted">班级</span>
        <input value={cls()} onInput={e => setCls(e.currentTarget.value)} />
      </div>

      <h4 class="mt8">可参加的识图考核</h4>
      <Show when={s.papers().length === 0}>
        <div class="hint">老师尚未发布试卷。</div>
      </Show>
      <For each={s.papers()}>
        {p => {
          const done = () => !!p.submissions[cls()]?.[name()]?.length;
          return (
            <div class="card" style={{ background: '#f8fafc', margin: '6px 0' }}>
              <div style={{ 'font-weight': 600 }}>{p.title}</div>
              <div class="hint mt8">{p.questions.length} 题 · {p.questions.map(q => `${TYPE_META[q.type].name}×${q.count}`).join('，')}</div>
              <div class="flex-between mt8">
                <span class={`pill ${done() ? 'ok' : 'wait'}`}>{done() ? '已提交（可重考）' : '未作答'}</span>
                <button class="primary" onClick={() => enter(p.id)}>{done() ? '重新作答' : '开始识图作答'}</button>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}
