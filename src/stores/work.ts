import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { FieldOrder, OrderStatus, TerrainParams, TerrainSnapshot, UserProfile } from '../types';
import type { QcResult } from '../types';

const USERS: UserProfile[] = [
  { name: '张前台', role: 'sales', label: '前台 · 建单' },
  { name: '李建模', role: 'modeler', label: '建模员' },
  { name: '王建模', role: 'modeler', label: '建模员' },
  { name: '赵质检', role: 'qc', label: '质检' },
];

const STORAGE_KEY = 'rfte-orders-v1';
const USER_KEY = 'rfte-user';

function loadOrders(): FieldOrder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FieldOrder[];
  } catch {
    return [];
  }
}

export const useWorkStore = defineStore('work', () => {
  const orders = ref<FieldOrder[]>(loadOrders());
  const currentUser = ref<UserProfile>(
    USERS.find((u) => u.name === localStorage.getItem(USER_KEY)) ?? USERS[0],
  );

  const users = computed(() => USERS);
  const modelers = computed(() => USERS.filter((u) => u.role === 'modeler'));

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders.value));
  }

  function switchUser(name: string) {
    const u = USERS.find((x) => x.name === name);
    if (u) {
      currentUser.value = u;
      localStorage.setItem(USER_KEY, name);
    }
  }

  function nextOrderId(): string {
    const n = orders.value.length + 1;
    const d = new Date();
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    return `RO-${ym}-${String(n).padStart(3, '0')}`;
  }

  function createOrder(input: {
    title: string;
    requirement: string;
    seed: number;
    params: TerrainParams;
    assignee: string | null;
  }): FieldOrder {
    const now = Date.now();
    const order: FieldOrder = {
      id: nextOrderId(),
      title: input.title,
      requirement: input.requirement,
      seed: input.seed,
      params: { ...input.params },
      status: input.assignee ? 'modeling' : 'pending',
      createdBy: currentUser.value.name,
      assignee: input.assignee,
      createdAt: now,
      updatedAt: now,
      reworkCount: 0,
      history: [{ at: now, user: currentUser.value.name, action: '建单' }],
      submittedSnapshot: null,
      qcResult: null,
    };
    if (input.assignee) {
      order.history.push({
        at: now,
        user: currentUser.value.name,
        action: '派单',
        detail: `指派给 ${input.assignee}`,
      });
    }
    orders.value.unshift(order);
    persist();
    return order;
  }

  function logEvent(order: FieldOrder, action: string, detail?: string) {
    order.history.push({ at: Date.now(), user: currentUser.value.name, action, detail });
    order.updatedAt = Date.now();
  }

  function assignOrder(id: string, assignee: string) {
    const o = orders.value.find((x) => x.id === id);
    if (!o) return;
    o.assignee = assignee;
    o.status = 'modeling';
    logEvent(o, '派单', `指派给 ${assignee}`);
    persist();
  }

  function submitForQc(id: string, snapshot: TerrainSnapshot) {
    const o = orders.value.find((x) => x.id === id);
    if (!o) return;
    o.submittedSnapshot = snapshot;
    o.status = 'qc';
    logEvent(o, '提交质检', `快照校验和 ${snapshot.checksum}`);
    persist();
  }

  /** 质检结论：通过 / 打回（打回累加返工次数） */
  function qcDecide(id: string, result: QcResult, pass: boolean, note: string) {
    const o = orders.value.find((x) => x.id === id);
    if (!o) return;
    o.qcResult = result;
    if (pass) {
      o.status = 'passed';
      logEvent(o, '质检通过', note);
    } else {
      o.status = 'rejected';
      o.reworkCount += 1;
      logEvent(o, '质检打回', note);
    }
    persist();
  }

  /** 建模员返工后重新提交，回到质检队列 */
  function resubmit(id: string, snapshot: TerrainSnapshot) {
    const o = orders.value.find((x) => x.id === id);
    if (!o) return;
    o.submittedSnapshot = snapshot;
    o.status = 'qc';
    o.qcResult = null;
    logEvent(o, '返工后重新提交', `快照校验和 ${snapshot.checksum}`);
    persist();
  }

  function markDone(id: string) {
    const o = orders.value.find((x) => x.id === id);
    if (!o) return;
    o.status = 'done';
    logEvent(o, '关闭归档');
    persist();
  }

  const myTasks = computed(() =>
    orders.value.filter((o) => o.assignee === currentUser.value.name && (o.status === 'modeling' || o.status === 'rejected')),
  );

  const qcQueue = computed(() => orders.value.filter((o) => o.status === 'qc'));

  function byStatus(s: OrderStatus) {
    return computed(() => orders.value.filter((o) => o.status === s));
  }

  return {
    orders,
    currentUser,
    users,
    modelers,
    myTasks,
    qcQueue,
    switchUser,
    createOrder,
    assignOrder,
    submitForQc,
    qcDecide,
    resubmit,
    markDone,
    byStatus,
  };
});
