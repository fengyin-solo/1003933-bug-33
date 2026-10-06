<template>
  <section class="page" data-module="drill">
    <header class="page-head">
      <div>
        <h2>应急演练管理</h2>
        <p class="page-desc">维护演练记录，围绕演练编号、隐患点编号、演练主题、演练日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记演练记录</button>
        <button class="btn" type="button" @click="exportRows">导出应急演练清单</button>
      </div>
    </header>

    <div v-if="pendingTxs.length" class="banner warn">
      <div v-for="tx in pendingTxs" :key="tx.drillId" class="banner-row">
        <span>
          演练 {{ tx.drillCode }} 的「{{ opLabel(tx.op) }}」在写入「{{ tx.failedStep }}」时中断，可从失败点继续。
        </span>
        <span class="banner-actions">
          <button class="link" type="button" @click="resumeTx(tx.drillId)">从失败点继续</button>
          <button class="link" type="button" @click="dismissTx(tx.drillId)">忽略</button>
        </span>
      </div>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <span v-if="column === '参演人数'" :class="{ 'pending-text': headcountOf(row) === null }">
              {{ headcountText(row) }}
            </span>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="goDetail(row)">详情</button>
            <button v-if="row.status === '待筹备'" class="link" type="button" @click="startPrepare(row)">
              开始筹备
            </button>
            <button v-if="row.status === '筹备中'" class="link" type="button" @click="goDetail(row)">
              继续筹备
            </button>
            <button
              v-if="row.status === '待筹备' || row.status === '筹备中'"
              class="link"
              type="button"
              @click="implement(row)"
            >
              实施演练
            </button>
            <button v-if="row.status === '已实施'" class="link" type="button" @click="goSummary(row)">
              提交总结
            </button>
            <button v-if="row.status === '已总结'" class="link" type="button" @click="goSummary(row)">
              查看总结
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无应急演练数据，可先登记演练记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条应急演练记录</span>
      <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  dismissPendingTx,
  headcountOf,
  implementDrill,
  listPendingTx,
  opLabel,
  resumePendingTx,
  startPrepare as startPrepareService,
} from '@/api/drill-service'
import type { EntryRow, PendingTx } from '@/data/types'

const meta = moduleMeta('drill')
const router = useRouter()
const columns = ["演练编号", "隐患点编号", "演练主题", "演练日期", "参演人数", "演练类型", "演练评价", "演练状态"]
const statuses = ["待筹备", "筹备中", "已实施", "已总结", "已归档"]
const stats = [{"label": "年度演练次数", "value": 0}, {"label": "已实施场次", "value": 0}, {"label": "待筹备计划", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const pendingTxs = ref<PendingTx[]>([])
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function headcountText(row: EntryRow): string {
  const headcount = headcountOf(row)
  return headcount === null ? '待补录' : String(headcount)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '演练记录登记入口尚未接入审批流'
}

function goDetail(row: EntryRow) {
  router.push({ name: 'drill-detail', params: { id: Number(row.id) } })
}

function goSummary(row: EntryRow) {
  router.push({ name: 'drill-summary', params: { id: Number(row.id) } })
}

function applyResult(result: { ok: boolean; message: string }) {
  reload()
  if (result.ok) {
    noticeMessage.value = result.message
  } else {
    errorMessage.value = result.message
  }
}

function startPrepare(row: EntryRow) {
  applyResult(startPrepareService(Number(row.id)))
}

function implement(row: EntryRow) {
  applyResult(implementDrill(Number(row.id)))
}

function resumeTx(drillId: number) {
  applyResult(resumePendingTx(drillId))
}

function dismissTx(drillId: number) {
  dismissPendingTx(drillId)
  reload()
}

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    pendingTxs.value = listPendingTx()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '应急演练列表读取失败'
  }
}

onMounted(reload)
</script>
