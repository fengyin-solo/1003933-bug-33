<template>
  <section class="page" data-module="drill-detail">
    <header class="page-head">
      <div>
        <h2>演练详情 · {{ drill?.['演练编号'] ?? '未找到' }}</h2>
        <p class="page-desc">筹备阶段在此维护参演名单；名单与演练记录同存同取，中断后重新进入不丢失。</p>
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" @click="goBack">返回列表</button>
        <button v-if="drill && drill.status === '已实施'" class="btn primary" type="button" @click="goSummary">
          去提交总结
        </button>
        <button v-if="drill && drill.status === '已总结'" class="btn" type="button" @click="goSummary">
          查看总结
        </button>
      </div>
    </header>

    <div v-if="pendingTx" class="banner warn">
      <div class="banner-row">
        <span>
          上次「{{ opLabel(pendingTx.op) }}」在写入「{{ pendingTx.failedStep }}」时中断，可从失败点继续。
        </span>
        <span class="banner-actions">
          <button class="link" type="button" @click="resumeTx">从失败点继续</button>
          <button class="link" type="button" @click="dismissTx">忽略</button>
        </span>
      </div>
    </div>

    <template v-if="drill">
      <dl class="detail-grid">
        <div v-for="item in infoItems" :key="item.label" class="detail-item">
          <dt>{{ item.label }}</dt>
          <dd :class="{ 'pending-text': item.pending }">{{ item.value }}</dd>
        </div>
      </dl>

      <section class="panel">
        <header class="panel-head">
          <h3>参演名单（{{ roster.length }} 人）</h3>
          <span v-if="rosterLocked" class="panel-note">演练已实施，名单已锁定</span>
        </header>

        <template v-if="!rosterLocked">
          <form class="roster-add" @submit.prevent="addName">
            <input v-model="newName" placeholder="输入参演人员姓名" />
            <button class="btn" type="submit">添加</button>
            <button class="btn primary" type="button" :disabled="saving" @click="saveRosterNow">
              {{ saving ? '保存中…' : '保存名单' }}
            </button>
          </form>
          <p v-if="!roster.length" class="empty-hint">名单为空，暂不能实施演练；参演人数待补录。</p>
        </template>

        <ul v-if="roster.length" class="roster-list">
          <li v-for="(name, index) in roster" :key="`${name}-${index}`" class="roster-item">
            <span>{{ name }}</span>
            <button v-if="!rosterLocked" class="link" type="button" @click="removeName(index)">移除</button>
          </li>
        </ul>
        <p v-else-if="rosterLocked" class="empty-hint">该演练未登记参演名单。</p>
      </section>

      <footer class="page-foot">
        <span>
          <button
            v-if="drill.status === '待筹备'"
            class="btn primary"
            type="button"
            @click="startPrepareNow"
          >
            开始筹备
          </button>
          <button
            v-if="drill.status === '待筹备' || drill.status === '筹备中'"
            class="btn primary"
            type="button"
            :disabled="!roster.length"
            :title="roster.length ? '' : '参演名单为空，不能实施演练'"
            @click="implementNow"
          >
            实施演练
          </button>
        </span>
        <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>

    <p v-else class="empty-state">没有找到该演练记录，可能已被删除。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  dismissPendingTx,
  getDrill,
  getPendingTx,
  headcountOf,
  implementDrill,
  opLabel,
  resumePendingTx,
  rosterOf,
  saveRoster,
  startPrepare,
} from '@/api/drill-service'
import type { EntryRow, PendingTx } from '@/data/types'

const route = useRoute()
const router = useRouter()
const drillId = Number(route.params.id)

const drill = ref<EntryRow | null>(null)
const pendingTx = ref<PendingTx | null>(null)
const roster = ref<string[]>([])
const newName = ref('')
const saving = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')

const rosterLocked = computed(() => {
  const status = String(drill.value?.status ?? '')
  return status === '已实施' || status === '已总结' || status === '已归档'
})

const infoItems = computed(() => {
  if (!drill.value) {
    return []
  }
  const headcount = headcountOf(drill.value)
  return [
    { label: '演练编号', value: String(drill.value['演练编号'] ?? '—') },
    { label: '隐患点编号', value: String(drill.value['隐患点编号'] ?? '—') },
    { label: '演练主题', value: String(drill.value['演练主题'] ?? '—') },
    { label: '演练日期', value: String(drill.value['演练日期'] ?? '—') },
    { label: '演练类型', value: String(drill.value['演练类型'] ?? '—') },
    { label: '参演人数', value: headcount === null ? '待补录' : `${headcount} 人`, pending: headcount === null },
    { label: '演练评价', value: String(drill.value['演练评价'] ?? '') || '—' },
    { label: '当前状态', value: String(drill.value.status) },
  ]
})

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  drill.value = getDrill(drillId)
  roster.value = drill.value ? rosterOf(drill.value) : []
  pendingTx.value = getPendingTx(drillId)
}

function applyResult(result: { ok: boolean; message: string }) {
  reload()
  if (result.ok) {
    noticeMessage.value = result.message
  } else {
    errorMessage.value = result.message
  }
}

function addName() {
  const name = newName.value.trim()
  if (name === '') {
    return
  }
  if (!roster.value.includes(name)) {
    roster.value = [...roster.value, name]
  }
  newName.value = ''
}

function removeName(index: number) {
  roster.value = roster.value.filter((_, i) => i !== index)
}

function saveRosterNow() {
  saving.value = true
  try {
    const result = saveRoster(drillId, roster.value)
    if (result.ok) {
      applyResult(result)
      return
    }
    // 保存失败：本地名单草稿保留不清空，等用户重试或从失败点继续。
    errorMessage.value = result.message
    noticeMessage.value = ''
    drill.value = getDrill(drillId)
    pendingTx.value = getPendingTx(drillId)
  } finally {
    saving.value = false
  }
}

function startPrepareNow() {
  applyResult(startPrepare(drillId))
}

function implementNow() {
  applyResult(implementDrill(drillId))
}

function resumeTx() {
  applyResult(resumePendingTx(drillId))
}

function dismissTx() {
  dismissPendingTx(drillId)
  reload()
}

function goBack() {
  router.push({ name: 'drill' })
}

function goSummary() {
  router.push({ name: 'drill-summary', params: { id: drillId } })
}

onMounted(reload)
</script>
