import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './App.vue';
import OrderListView from './views/OrderListView.vue';
import EditorView from './views/EditorView.vue';
import QcView from './views/QcView.vue';
import DashboardView from './views/DashboardView.vue';
import './styles.css';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/orders' },
    { path: '/orders', component: OrderListView, meta: { title: '需求单' } },
    { path: '/editor/:orderId?', component: EditorView, meta: { title: '生成编辑' } },
    { path: '/qc', component: QcView, meta: { title: '质检' } },
    { path: '/dashboard', component: DashboardView, meta: { title: '看板' } },
  ],
});

createApp(App).use(createPinia()).use(router).mount('#app');
