/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | string[]
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 应急演练总结提交内容：评价、讲评、撤离结果同进同出，一次原子写入。 */
export type DrillSummaryPayload = {
  演练评价: string
  讲评: string
  撤离结果: string
}

/** 中断续办记录：写入失败时把操作、负载和失败步骤记下来，重新进入后从失败点继续。 */
export type PendingTx = {
  op: 'prepare' | 'roster' | 'implement' | 'summarize'
  drillId: number
  drillCode: string
  payload: string[] | DrillSummaryPayload | null
  failedStep: string
  at: string
}
