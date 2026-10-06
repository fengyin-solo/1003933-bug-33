<template>
  <section class="page" data-module="drill-summary">
    <header class="page-head">
      <div>
        <h2>演练总结</h2>
        <p class="page-desc">
          <RouterLink :to="{ name: 'drill' }" class="back-link">← 返回演练列表</RouterLink>
        </p>
      </div>
      <span class="status-badge">{{ drill?.status ?? '—' }}</span>
    </header>

    <div v-if="notFound" class="notice error">没有找到该演练记录，请从列表重新进入。</div>

    <template v-else-if="drill">
      <article class="panel">
        <h3 class="panel-title">基础信息</h3>
        <dl class="info-grid">
          <div><dt>演练编号</dt><dd>{{ drill['演练编号'] }}</dd></div>
          <div><dt>隐患点编号</dt><dd>{{ drill['隐患点编号'] }}</dd></div>
          <div><dt>演练主题</dt><dd>{{ drill['演练主题'] }}</dd></div>
          <div><dt>演练日期</dt><dd>{{ drill['演练日期'] }}</dd></div>
          <div>
            <dt>计划参演人数</dt>
            <dd>{{ plannedCount(drill) === null ? '待补录' : plannedCount(drill) }}</dd>
          </div>
          <div><dt>名单人数</dt><dd>{{ drill.participants.length }}</dd></div>
        </dl>
      </article>

      <!-- 未实施：不能直接写总结 -->
      <div v-if="!canSummarize && !isTerminal" class="notice error">
        当前演练处于「{{ drill.status }}」，需先完成筹备与实施，才能提交总结。
      </div>

      <template v-if="drill.review">
        <!-- 讲评与撤离结果：实施时写入，总结阶段只展示，不允许改动 -->
        <article class="panel">
          <h3 class="panel-title">
            讲评与撤离结果
            <span class="panel-sub">实施阶段记录，总结提交时原样保留</span>
          </h3>
          <dl class="info-grid">
            <div class="span-2">
              <dt>撤离结果</dt>
              <dd>{{ drill.review.evacuationResult || '—' }}</dd>
            </div>
            <div>
              <dt>实际撤离人数</dt>
              <dd>{{ drill.review.evacuatedCount === null ? '待补录' : drill.review.evacuatedCount }}</dd>
            </div>
            <div><dt>实施时间</dt><dd>{{ formatTime(drill.review.implementedAt) }}</dd></div>
            <div class="span-2">
              <dt>现场讲评</dt>
              <dd>{{ drill.review.comment || '—' }}</dd>
            </div>
          </dl>
        </article>

        <!-- 可提交总结 -->
        <article v-if="canSummarize" class="panel">
          <h3 class="panel-title">提交总结</h3>
          <form class="form-stack" @submit.prevent="submit">
            <label class="form-field">
              <span>总体评价</span>
              <select v-model="form.drillRating">
                <option value="" disabled>请选择总体评价</option>
                <option value="优秀">优秀</option>
                <option value="良好">良好</option>
                <option value="合格">合格</option>
                <option value="不合格">不合格</option>
              </select>
            </label>
            <label class="form-field">
              <span>总结补充说明</span>
              <textarea v-model="form.summaryComment" rows="3" placeholder="改进措施、后续计划等（可留空）"></textarea>
            </label>
            <div class="panel-actions">
              <button class="btn primary" type="submit" :disabled="submitting">
                {{ submitting ? '提交中…' : '提交总结' }}
              </button>
              <RouterLink class="btn ghost" :to="{ name: 'drill-detail', params: { id: drill.id } }">
                返回详情
              </RouterLink>
            </div>
          </form>
        </article>

        <!-- 已总结/已归档：历史评价只读保留，重复提交被拒绝 -->
        <article v-else-if="isTerminal" class="panel">
          <h3 class="panel-title">总结与评价（已归档）</h3>
          <dl class="info-grid">
            <div><dt>总体评价</dt><dd class="rating-text">{{ drill.review.drillRating || '—' }}</dd></div>
            <div><dt>总结时间</dt><dd>{{ formatTime(drill.review.summarizedAt) }}</dd></div>
            <div class="span-2">
              <dt>总结补充说明</dt>
              <dd>{{ drill.review.summaryComment || '—' }}</dd>
            </div>
          </dl>
          <p class="readonly-tip">历史总结与评价保留原始记录，不允许重复提交或修改。</p>
        </article>
      </template>

      <div v-if="message" :class="['notice', messageOk ? 'success' : 'error']">{{ message }}</div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  DRILL_STATUS,
  getDrill,
  plannedCount,
  submitSummary,
  type DrillRow,
} from '@/api/drill-service'

const route = useRoute()
const router = useRouter()

const drill = ref<DrillRow | null>(null)
const notFound = ref(false)
const message = ref('')
const messageOk = ref(false)
const submitting = ref(false)
const form = ref({ drillRating: '', summaryComment: '' })

const canSummarize = computed(() => drill.value?.status === DRILL_STATUS.implemented)
const isTerminal = computed(
  () =>
    drill.value?.status === DRILL_STATUS.summarized ||
    drill.value?.status === DRILL_STATUS.archived,
)

function refresh() {
  const id = Number(route.params.id)
  const loaded = getDrill(id)
  if (!loaded) {
    notFound.value = true
    drill.value = null
    return
  }
  drill.value = loaded
  // 重复进入时沿用已有评价占位（终态为只读，不会被覆盖）；未总结时评价字段仍为空。
  form.value.drillRating = loaded.review?.drillRating ?? ''
  form.value.summaryComment = loaded.review?.summaryComment ?? ''
}

function submit() {
  if (!drill.value) {
    return
  }
  submitting.value = true
  const result = submitSummary(drill.value.id, { ...form.value })
  submitting.value = false
  messageOk.value = result.ok
  message.value = result.message
  if (result.ok) {
    refresh()
    setTimeout(() => {
      router.push({ name: 'drill-detail', params: { id: drill.value?.id } })
    }, 800)
  }
}

function formatTime(value: string): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

onMounted(refresh)
</script>
