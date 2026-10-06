<template>
  <section class="page" data-module="drill">
    <header class="page-head">
      <div>
        <h2>应急演练管理</h2>
        <p class="page-desc">维护演练记录，围绕筹备、实施、总结做名单登记与状态流转；状态、名单、讲评同事务保存，中断后可继续。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记演练记录</button>
        <button class="btn" type="button" @click="exportRows">导出应急演练清单</button>
      </div>
    </header>

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
          <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.status === DRILL_STATUS.preparing && rosterEmpty(row)" class="warn-tag">空名单</span>
            <span v-else-if="row.status === DRILL_STATUS.preparing && plannedCount(row) === null" class="warn-tag">人数待补录</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">
              {{ primaryAction(row) }}
            </button>
            <button
              v-if="row.status === DRILL_STATUS.implemented"
              class="link"
              type="button"
              @click="openSummary(row)"
            >
              提交总结
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
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { cellText, downloadCsv } from '@/api/local-service'
import {
  DRILL_STATUS,
  drillMeta,
  isRosterEmpty,
  listDrills,
  plannedCount,
  type DrillRow,
} from '@/api/drill-service'

const router = useRouter()
const meta = drillMeta()
const columns = ["演练编号", "隐患点编号", "演练主题", "演练日期", "参演人数", "演练类型"]
const filterFields = ["演练编号", "隐患点编号", "演练主题"]
const IMPLEMENTED_STATUSES = new Set<string>([
  DRILL_STATUS.implemented,
  DRILL_STATUS.summarized,
  DRILL_STATUS.archived,
])

const rows = ref<DrillRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const stats = computed(() => [
  { label: '年度演练次数', value: rows.value.length },
  { label: '已实施场次', value: rows.value.filter((row) => IMPLEMENTED_STATUSES.has(row.status)).length },
  { label: '待筹备计划', value: rows.value.filter((row) => row.status === DRILL_STATUS.pending).length },
])

const statusSummary = computed(() =>
  (['待筹备', '筹备中', '已实施', '已总结', '已归档'] as const).map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

function rosterEmpty(row: DrillRow): boolean {
  return isRosterEmpty(row)
}

function displayCell(row: DrillRow, column: string): string {
  if (column === '参演人数') {
    return plannedCount(row) === null ? '待补录' : String(plannedCount(row))
  }
  const text = cellText(row[column]).trim()
  return text === '' ? '—' : text
}

/** 空名单不能实施：筹备中且名单为空时，主操作仍是补录名单而不是实施演练。 */
function primaryAction(row: DrillRow): string {
  switch (row.status) {
    case DRILL_STATUS.pending:
      return '开始筹备'
    case DRILL_STATUS.preparing:
      return isRosterEmpty(row) ? '补录名单' : '继续筹备 / 实施'
    case DRILL_STATUS.implemented:
      return '查看实施 / 总结'
    case DRILL_STATUS.summarized:
    case DRILL_STATUS.archived:
      return '查看总结'
    default:
      return '查看详情'
  }
}

function openDetail(row: DrillRow) {
  router.push({ name: 'drill-detail', params: { id: row.id } })
}

function openSummary(row: DrillRow) {
  router.push({ name: 'drill-summary', params: { id: row.id } })
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  const header = ['编号', ...columns, '名单人数', '当前状态']
  const lines = [header.join(',')]
  for (const row of rows.value) {
    lines.push([
      row.id,
      ...columns.map((column) => displayCell(row, column)),
      row.participants.length,
      row.status,
    ].join(','))
  }
  downloadCsv(`${meta.name}-清单.csv`, `﻿${lines.join('\n')}`)
}

function openCreate() {
  errorMessage.value = '演练记录登记入口尚未接入审批流'
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listDrills(filters.value)
    rows.value = payload.items as DrillRow[]
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '应急演练列表读取失败'
  }
}

onMounted(reload)
</script>
