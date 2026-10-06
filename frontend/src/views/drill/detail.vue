<template>
  <section class="page" data-module="drill-detail">
    <header class="page-head">
      <div>
        <h2>演练详情</h2>
        <p class="page-desc">
          <RouterLink :to="{ name: 'drill' }" class="back-link">← 返回演练列表</RouterLink>
        </p>
      </div>
      <span class="status-badge">{{ drill?.status ?? '—' }}</span>
    </header>

    <div v-if="notFound" class="notice error">没有找到该演练记录，请从列表重新进入。</div>

    <template v-else-if="drill">
      <!-- 基础信息 -->
      <article class="panel">
        <h3 class="panel-title">基础信息</h3>
        <dl class="info-grid">
          <div><dt>演练编号</dt><dd>{{ drill['演练编号'] }}</dd></div>
          <div><dt>隐患点编号</dt><dd>{{ drill['隐患点编号'] }}</dd></div>
          <div><dt>演练主题</dt><dd>{{ drill['演练主题'] }}</dd></div>
          <div><dt>演练日期</dt><dd>{{ drill['演练日期'] }}</dd></div>
          <div><dt>演练类型</dt><dd>{{ drill['演练类型'] }}</dd></div>
          <div>
            <dt>计划参演人数</dt>
            <dd>
              <span v-if="plannedHeadcount !== ''">{{ plannedHeadcount }}</span>
              <span v-else class="warn-tag">待补录</span>
            </dd>
          </div>
        </dl>
      </article>

      <!-- 中断恢复提示 -->
      <div v-if="hint" class="notice info">{{ hint }}</div>
      <div v-if="message" :class="['notice', messageOk ? 'success' : 'error']">{{ message }}</div>

      <!-- 筹备：参与人员名单 -->
      <article class="panel">
        <h3 class="panel-title">
          参与人员名单
          <span class="panel-sub">（名单与状态同事务保存；空名单将阻止实施）</span>
        </h3>

        <table v-if="canPrepare" class="data-table roster-table">
          <thead>
            <tr><th>姓名</th><th>角色/分工</th><th>所属单位</th><th>联系电话</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="(person, index) in rosterDraft" :key="index">
              <td><input v-model="person.name" placeholder="参演人员姓名" /></td>
              <td><input v-model="person.role" placeholder="如：总指挥、预警员" /></td>
              <td><input v-model="person.unit" placeholder="所属单位/村组" /></td>
              <td><input v-model="person.phone" placeholder="联系电话" /></td>
              <td>
                <button class="link danger" type="button" @click="removePerson(index)">移除</button>
              </td>
            </tr>
            <tr v-if="!rosterDraft.length">
              <td colspan="5" class="empty-state">名单为空：请添加参演人员后保存，空名单不能实施演练。</td>
            </tr>
          </tbody>
        </table>

        <table v-else class="data-table roster-table">
          <thead>
            <tr><th>姓名</th><th>角色/分工</th><th>所属单位</th><th>联系电话</th></tr>
          </thead>
          <tbody>
            <tr v-for="(person, index) in drill.participants" :key="index">
              <td>{{ person.name }}</td>
              <td>{{ person.role || '—' }}</td>
              <td>{{ person.unit || '—' }}</td>
              <td>{{ person.phone || '—' }}</td>
            </tr>
            <tr v-if="!drill.participants.length">
              <td colspan="4" class="empty-state">无名单记录</td>
            </tr>
          </tbody>
        </table>

        <div v-if="canPrepare" class="panel-actions">
          <label class="inline-field">
            <span>计划参演人数</span>
            <input v-model="plannedHeadcount" type="number" min="0" placeholder="可先留空，标注待补录" />
            <small class="field-hint">缺少人数不拦截实施，列表将显示「待补录」</small>
          </label>
          <button class="btn" type="button" @click="addPerson">添加参演人员</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="saveRosterDraft">
            {{ submitting ? '保存中…' : '保存名单' }}
          </button>
          <button
            v-if="drill.status === DRILL_STATUS.pending"
            class="btn"
            type="button"
            :disabled="submitting"
            @click="startPreparing"
          >
            开始筹备
          </button>
        </div>
      </article>

      <!-- 实施演练 -->
      <article v-if="canPrepare || drill.status === DRILL_STATUS.implemented" class="panel">
        <h3 class="panel-title">
          {{ canPrepare ? '实施演练' : '实施情况（讲评与撤离结果）' }}
          <span v-if="!canPrepare" class="panel-sub">实施内容已归档保留</span>
        </h3>

        <div v-if="canPrepare" class="implement-guard">
          <p :class="implementCheck.ok ? 'guard-pass' : 'guard-block'">
            <strong>实施前检查：</strong>{{ implementCheck.ok ? '通过' : implementCheck.reason }}
            <template v-if="implementCheck.ok && implementCheck.reason">（{{ implementCheck.reason }}）</template>
          </p>
          <form class="form-stack" @submit.prevent="submitImplementation">
            <label class="form-field">
              <span>撤离结果</span>
              <textarea v-model="implForm.evacuationResult" rows="2" placeholder="如：应撤离 42 人，实际撤离 42 人，无人员伤亡"></textarea>
            </label>
            <label class="form-field">
              <span>实际撤离人数（可留空，留空按待补录处理）</span>
              <input v-model="implForm.evacuatedCount" type="number" min="0" placeholder="暂不确定可先留空" />
            </label>
            <label class="form-field">
              <span>现场讲评</span>
              <textarea v-model="implForm.comment" rows="3" placeholder="演练过程讲评：亮点、问题与改进方向"></textarea>
            </label>
            <div class="panel-actions">
              <button class="btn primary" type="submit" :disabled="submitting || !implementCheck.ok">
                {{ submitting ? '提交中…' : '实施演练并保存讲评' }}
              </button>
            </div>
          </form>
        </div>

        <template v-else-if="drill.review">
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
          <div class="panel-actions">
            <button class="btn primary" type="button" @click="goSummary">继续提交总结</button>
          </div>
        </template>
      </article>

      <!-- 已总结/已归档：只读指引 -->
      <article v-if="isTerminal" class="panel">
        <h3 class="panel-title">总结归档</h3>
        <p class="readonly-tip">该演练已总结，讲评、撤离结果与总体评价按历史记录保留。</p>
        <button class="btn" type="button" @click="goSummary">查看总结</button>
      </article>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  beginPreparation,
  checkImplementable,
  DRILL_STATUS,
  getDrill,
  implementDrill,
  resumeHint,
  saveRoster,
  type DrillParticipant,
  type DrillRow,
} from '@/api/drill-service'

const route = useRoute()
const router = useRouter()

const drill = ref<DrillRow | null>(null)
const notFound = ref(false)
const message = ref('')
const messageOk = ref(false)
const submitting = ref(false)

const rosterDraft = ref<DrillParticipant[]>([])
const plannedHeadcount = ref('')
const implForm = ref({ evacuationResult: '', evacuatedCount: '', comment: '' })

const canPrepare = computed(
  () =>
    drill.value !== null &&
    (drill.value.status === DRILL_STATUS.pending || drill.value.status === DRILL_STATUS.preparing),
)
const isTerminal = computed(
  () =>
    drill.value !== null &&
    (drill.value.status === DRILL_STATUS.summarized ||
      drill.value.status === DRILL_STATUS.archived),
)
const implementCheck = computed(() =>
  drill.value ? checkImplementable(drill.value) : { ok: false, reason: '' },
)
const hint = computed(() => (drill.value ? resumeHint(drill.value) : ''))

function emptyPerson(): DrillParticipant {
  return { name: '', role: '', unit: '', phone: '' }
}

function addPerson() {
  rosterDraft.value.push(emptyPerson())
}

function removePerson(index: number) {
  rosterDraft.value.splice(index, 1)
}

function notify(result: { ok: boolean; message: string }) {
  messageOk.value = result.ok
  message.value = result.message
}

function refresh() {
  const id = Number(route.params.id)
  const loaded = getDrill(id)
  if (!loaded) {
    notFound.value = true
    drill.value = null
    return
  }
  notFound.value = false
  drill.value = loaded
  // 中断恢复：草稿直接取事务里最后一次成功落盘的名单，从事务失败点继续，而不是清空重来。
  rosterDraft.value = loaded.participants.map((person) => ({ ...person }))
  plannedHeadcount.value = loaded['参演人数'] === '' || loaded['参演人数'] === undefined
    ? ''
    : String(loaded['参演人数'])
}

function startPreparing() {
  if (!drill.value) {
    return
  }
  submitting.value = true
  const result = beginPreparation(drill.value.id)
  submitting.value = false
  notify(result)
  if (result.ok) {
    refresh()
  }
}

function saveRosterDraft() {
  if (!drill.value) {
    return
  }
  submitting.value = true
  const count = plannedHeadcount.value.trim() === '' ? null : Number(plannedHeadcount.value)
  const result = saveRoster(
    drill.value.id,
    rosterDraft.value,
    count !== null && Number.isFinite(count) ? count : null,
  )
  submitting.value = false
  notify(result)
  if (result.ok) {
    refresh()
  }
}

function submitImplementation() {
  if (!drill.value) {
    return
  }
  const count = implForm.value.evacuatedCount.trim() === ''
    ? null
    : Number(implForm.value.evacuatedCount)
  submitting.value = true
  const result = implementDrill(drill.value.id, {
    evacuationResult: implForm.value.evacuationResult,
    evacuatedCount: count !== null && Number.isFinite(count) ? count : null,
    comment: implForm.value.comment,
  })
  submitting.value = false
  notify(result)
  if (result.ok) {
    refresh()
  }
}

function goSummary() {
  if (!drill.value) {
    return
  }
  router.push({ name: 'drill-summary', params: { id: drill.value.id } })
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
