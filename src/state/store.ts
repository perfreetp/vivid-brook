import { createSignal } from 'solid-js';
import {
  AnswerRecord,
  BuildingData,
  Cluster,
  Facility,
  FacilityType,
  LayerGroup,
  LayerVisibility,
  QuizPaper,
  QuizQuestion,
  Role,
  TYPE_META,
  ViewState
} from '../types';
import { ZoomLevel } from '../engine/mapEngine';

const PAPER_KEY = 'lsmp-papers-v1';
const ROLE_KEY = 'lsmp-role-v1';

export interface BoxStat {
  rect: { xmin: number; ymin: number; xmax: number; ymax: number };
  total: number;
  byType: Record<FacilityType, number>;
  ids: string[];
}

export interface ClassRow {
  className: string;
  student: string;
  total: number;
  full: number;
  autoScore: number;
  finalScore: number | null;
  wrongCount: number;
  reviewed: boolean;
}

function loadPapers(): QuizPaper[] {
  try {
    return JSON.parse(localStorage.getItem(PAPER_KEY) || '[]');
  } catch {
    return [];
  }
}

export function createStore(data: BuildingData) {
  const [role, setRole] = createSignal<Role>((localStorage.getItem(ROLE_KEY) as Role) || 'teacher');
  const [layers, setLayers] = createSignal<LayerVisibility>({
    fire: true, gas: true, chem: true, util: true
  });
  const [floor, setFloor] = createSignal(1);
  const [view, setView] = createSignal<ViewState | null>(null);
  const [zoom, setZoom] = createSignal<ZoomLevel>('building');
  const [selected, setSelected] = createSignal<Facility | null>(null);
  const [highlightIds, setHighlightIds] = createSignal<string[]>([]);
  const [boxStat, setBoxStat] = createSignal<BoxStat | null>(null);
  const [papers, setPapers] = createSignal<QuizPaper[]>(loadPapers());
  const [activePaperId, setActivePaperId] = createSignal<string | null>(null);
  const [activeQuestionIdx, setActiveQuestionIdx] = createSignal(0);
  const [pickedIds, setPickedIds] = createSignal<string[]>([]);
  const [quizMode, setQuizMode] = createSignal(false);
  const [boxMode, setBoxMode] = createSignal(false);

  const persist = (list: QuizPaper[]) => {
    setPapers(list);
    localStorage.setItem(PAPER_KEY, JSON.stringify(list));
  };

  const saveRole = (r: Role) => {
    setRole(r);
    localStorage.setItem(ROLE_KEY, r);
  };

  const toggleLayer = (g: LayerGroup) => {
    const next = { ...layers(), [g]: !layers()[g] };
    setLayers(next);
  };

  /** 点选设施：信息卡 + 同编号关联设备高亮 */
  const selectFacility = (f: Facility | null) => {
    if (quizMode() && f && role() === 'student') {
      // 考核作答中：点选计入答案
      if (pickedIds().includes(f.id)) {
        setPickedIds(pickedIds().filter(id => id !== f.id));
      } else {
        setPickedIds([...pickedIds(), f.id]);
      }
      return;
    }
    setSelected(f);
    if (!f) {
      setHighlightIds([]);
      return;
    }
    const linked = data.facilities
      .filter(x => x.linkedCode === f.linkedCode && x.floor === floor())
      .map(x => x.id);
    setHighlightIds(linked);
  };

  const selectCluster = (c: Cluster) => {
    // 点聚合块：放大到该区域，展开为单图标
    setBoxStat({
      rect: { xmin: c.x - 8, ymin: c.y - 8, xmax: c.x + 8, ymax: c.y + 8 },
      total: c.count,
      byType: { gasCabinet: 0, fumeHood: 0, eyeWash: 0, pipeline: 0, ...{ [c.type]: c.count } } as Record<FacilityType, number>,
      ids: c.ids
    });
  };

  const applyBoxSelect = (list: Facility[], rect: BoxStat['rect']) => {
    const byType = { gasCabinet: 0, fumeHood: 0, eyeWash: 0, pipeline: 0 } as Record<FacilityType, number>;
    for (const f of list) byType[f.type]++;
    setBoxStat({ rect, total: list.length, byType, ids: list.map(f => f.id) });
  };

  const clearBox = () => setBoxStat(null);

  // ---------- 试卷 ----------

  const createPaper = (title: string, questions: { type: FacilityType; count: number; floor: number }[]) => {
    const rnd = mulberry32(Date.now() & 0xffffffff);
    const qs: QuizQuestion[] = questions.map((q, i) => {
      const pool = data.facilities.filter(f => f.type === q.type && f.floor === q.floor);
      // 洗牌取参考标准答案
      const shuffled = [...pool].sort(() => rnd() - 0.5);
      const answer = shuffled.slice(0, Math.min(q.count, shuffled.length));
      return {
        id: `Q${i + 1}`,
        type: q.type,
        count: q.count,
        floor: q.floor,
        answerIds: answer.map(f => f.id),
        label: `在 ${q.floor}F 平面图上点选出 ${q.count} 个${TYPE_META[q.type].name}`
      };
    });
    const paper: QuizPaper = {
      id: `P${Date.now()}`,
      title,
      createdBy: 'teacher',
      createdAt: Date.now(),
      questions: qs,
      submissions: {}
    };
    persist([paper, ...papers()]);
    return paper;
  };

  const startQuiz = (paperId: string) => {
    setActivePaperId(paperId);
    setActiveQuestionIdx(0);
    setPickedIds([]);
    setQuizMode(true);
    setSelected(null);
    setHighlightIds([]);
    setBoxMode(false);
    setBoxStat(null);
    const p = papers().find(x => x.id === paperId);
    if (p) setFloor(p.questions[0].floor);
  };

  const gotoQuestion = (idx: number) => {
    const p = activePaper();
    if (!p) return;
    setActiveQuestionIdx(idx);
    setPickedIds([]);
    setFloor(p.questions[idx].floor);
  };

  const exitQuiz = () => {
    setQuizMode(false);
    setActivePaperId(null);
    setPickedIds([]);
  };

  const activePaper = () => papers().find(p => p.id === activePaperId()) || null;
  const activeQuestion = (): QuizQuestion | null => {
    const p = activePaper();
    return p ? p.questions[activeQuestionIdx()] ?? null : null;
  };

  /** 系统自动判分：坐标(同一设施id即同一坐标) + 类型 双匹配 */
  const autoJudge = (q: QuizQuestion, picks: string[]) => {
    const answer = new Set(q.answerIds);
    const correctType = new Set(
      data.facilities.filter(f => f.type === q.type && f.floor === q.floor).map(f => f.id)
    );
    const validPicks = picks.filter(id => correctType.has(id));
    const autoCorrect = validPicks.filter(id => answer.has(id)).length;
    return { autoCorrect, validCount: validPicks.length };
  };

  /** 提交单题作答，自动判一部分，等待老师复核 */
  const submitAnswer = (className: string, student: string) => {
    const p = activePaper();
    const q = activeQuestion();
    if (!p || !q) return;
    const { autoCorrect } = autoJudge(q, pickedIds());
    const rec: AnswerRecord = {
      questionId: q.id,
      pickedIds: [...pickedIds()],
      autoCorrect,
      finalScore: null,
      reviewNote: '',
      reviewed: false
    };
    const list = structuredClone(papers());
    const paper = list.find(x => x.id === p.id)!;
    paper.submissions[className] ??= {};
    const cur = paper.submissions[className][student] ?? [];
    const idx = cur.findIndex(r => r.questionId === q.id);
    if (idx >= 0) cur[idx] = rec;
    else cur.push(rec);
    paper.submissions[className][student] = cur;
    persist(list);
    setPickedIds([]);
    if (activeQuestionIdx() < p.questions.length - 1) {
      const next = activeQuestionIdx() + 1;
      setActiveQuestionIdx(next);
      setFloor(p.questions[next].floor);
    }
  };

  /** 老师复核打分 */
  const reviewAnswer = (
    paperId: string, className: string, student: string,
    questionId: string, finalScore: number, note: string
  ) => {
    const list = structuredClone(papers());
    const paper = list.find(p => p.id === paperId)!;
    const rec = paper.submissions[className][student].find(r => r.questionId === questionId)!;
    rec.finalScore = finalScore;
    rec.reviewNote = note;
    rec.reviewed = true;
    persist(list);
  };

  /** 按班级汇总成绩与错题 */
  const classSummary = (paperId: string, className: string): ClassRow[] => {
    const paper = papers().find(p => p.id === paperId);
    if (!paper || !paper.submissions[className]) return [];
    const full = paper.questions.reduce((s, q) => s + q.count, 0);
    return Object.entries(paper.submissions[className]).map(([student, recs]) => {
      const autoScore = recs.reduce((s, r) => s + r.autoCorrect, 0);
      const finalScores = recs.filter(r => r.reviewed).map(r => r.finalScore ?? 0);
      const finalScore = finalScores.length === recs.length
        ? finalScores.reduce((a, b) => a + b, 0)
        : null;
      const wrongCount = recs.reduce((s, r) => {
        const q = paper.questions.find(x => x.id === r.questionId)!;
        const missed = q.answerIds.filter(id => !r.pickedIds.includes(id)).length;
        const extra = r.pickedIds.filter(id => !q.answerIds.includes(id)).length;
        return s + missed + extra;
      }, 0);
      return {
        className, student, total: recs.length, full,
        autoScore, finalScore, wrongCount,
        reviewed: recs.every(r => r.reviewed)
      };
    });
  };

  const searchFacility = (keyword: string): Facility | undefined => {
    const k = keyword.trim().toUpperCase();
    if (!k) return undefined;
    return data.facilities.find(f => f.code.toUpperCase() === k)
      ?? data.facilities.find(f => f.code.toUpperCase().includes(k));
  };

  return {
    // state
    role, layers, floor, view, zoom, selected, highlightIds, boxStat,
    papers, activePaperId, activeQuestionIdx, pickedIds, quizMode, boxMode,
    // actions
    saveRole, setLayers, toggleLayer, setFloor, setView, setZoom,
    selectFacility, selectCluster, applyBoxSelect, clearBox,
    setHighlightIds, setBoxMode,
    createPaper, startQuiz, exitQuiz, activePaper, activeQuestion, gotoQuestion,
    submitAnswer, autoJudge, reviewAnswer, classSummary,
    setActiveQuestionIdx, setPickedIds, searchFacility
  };
}

export type Store = ReturnType<typeof createStore>;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
