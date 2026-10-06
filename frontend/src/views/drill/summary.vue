<template>
  <section class="page" data-module="drill-summary">
    <header class="page-head">
      <div>
        <h2>演练总结 · {{ drill?.['演练编号'] ?? '未找到' }}</h2>
        <p class="page-desc">讲评与撤离结果随演练记录一次原子写入；已总结的演练保留原评价，重复提交不生效。</p>
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" @click="goBack">返回列表</button>
        <button v-if="drill" class="btn" type="button" @click="goDetail">查看详情</button>
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
      <!-- 历史已总结：只读展示，原评价、讲评、撤离结果一律保留 -->
      <section v-if="summarized" class="panel">
        <header class="panel-head">
          <h3>总结结果</h3>
          <span class="panel-note">该演练已总结，原评价已保留，不可重复提交</span>
        </header>
        <dl class="detail-grid">
          <div class="detail-item">
            <dt>演练评价</dt>
            <dd>{{ drill['演练评价'] || '—' }}</dd>
          </div>
          <div class="detail-item">
            <dt>参演人数</dt>
            <dd :class="{ 'pending-text': headcount === null }">
              {{ headcount === null ? '待补录' : `${headcount} 人` }}
            </dd>
          </div>
          <div class="detail-item span-all">
            <dt>讲评</dt>
            <dd>{{ drill['讲评'] || '—' }}</dd>
          </div>
          <div class="detail-item span-all">
            <dt>撤离结果</dt>
            <dd>{{ drill['撤离结果'] || '—' }}</dd>
          </div>
        </dl>
      </section>

      <!-- 已实施：填写并提交总结 -->
      <section v-else-if="drill.status === '已实施'" class="panel">
        <header class="panel-head">
          <h3>填写总结</h3>
          <span class="panel-note">参演 {{ headcount === null ? '人数待补录' : `${headcount} 人` }}</span>
        </header>
        <form class="form-col" @submit.prevent="submit">
          <label class="form-row">
            <span>演练评价</span>
            <select v-model="form.演练评价">
              <option v-for="option in evaluationOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
          <label class="form-row">
            <span>讲评</span>
            <textarea v-model="form.讲评" rows="4" placeholder="记录演练组织、响应速度、存在问题与改进要求"></textarea>
          </label>
          <label class="form-row">
            <span>撤离结果</span>
            <textarea v-model="form.撤离结果" rows="3" placeholder="记录应撤户数人数、实撤情况与安置去向"></textarea>
          </label>
          <div class="form-actions">
            <button class="btn primary" type="submit" :disabled="submitting">
              {{ submitting ? '提交中…' : '提交总结' }}
            </button>
          </div>
        </form>
      </section>

      <p v-else class="empty-state">演练尚未实施，不能提交总结，请先在详情页完成实施。</p>
    </template>

    <p v-else class="empty-state">没有找到该演练记录，可能已被删除。</p>

    <footer class="page-foot">
      <span></span>
      <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
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
  opLabel,
  resumePendingTx,
  submitSummary,
} from '@/api/drill-service'
import type { EntryRow, PendingTx } from '@/data/types'

const route = useRoute()
const router = useRouter()
const drillId = Number(route.params.id)

const evaluationOptions = ['优秀', '良好', '合格', '不合格']

const drill = ref<EntryRow | null>(null)
const pendingTx = ref<PendingTx | null>(null)
const form = ref({ 演练评价: '良好', 讲评: '', 撤离结果: '' })
const submitting = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')

const summarized = computed(() => {
  const status = String(drill.value?.status ?? '')
  return status === '已总结' || status === '已归档'
})

const headcount = computed(() => (drill.value ? headcountOf(drill.value) : null))

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  drill.value = getDrill(drillId)
  pendingTx.value = getPendingTx(drillId)
}

function submit() {
  if (submitting.value) {
    return
  }
  submitting.value = true
  try {
    const result = submitSummary(drillId, form.value)
    if (result.ok) {
      reload()
      noticeMessage.value = result.message
      return
    }
    // 写入失败：表单内容保留不清空，可重试或从失败点继续，记录里不会留下半份讲评。
    errorMessage.value = result.message
    noticeMessage.value = ''
    drill.value = getDrill(drillId)
    pendingTx.value = getPendingTx(drillId)
  } finally {
    submitting.value = false
  }
}

function resumeTx() {
  const result = resumePendingTx(drillId)
  reload()
  if (result.ok) {
    noticeMessage.value = result.message
  } else {
    errorMessage.value = result.message
  }
}

function dismissTx() {
  dismissPendingTx(drillId)
  reload()
}

function goBack() {
  router.push({ name: 'drill' })
}

function goDetail() {
  router.push({ name: 'drill-detail', params: { id: drillId } })
}

onMounted(reload)
</script>
