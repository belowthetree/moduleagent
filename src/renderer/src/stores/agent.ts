// ---------------------------------------------------------------------------
// renderer/src/stores/agent.ts — Agent Pinia Store
// 管理模块 Agent 和角色 Agent 的运行状态、聊天消息、流式响应
// ---------------------------------------------------------------------------

import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { AgentStatus, ChatMsg, RoleConfigData } from '../../../types/shared'

export const useAgentStore = defineStore('agent', () => {
  // ── 状态 ──
  const runningAgents = shallowRef(new Map<string, AgentStatus>())
  const contextMap = ref(new Map<string, ChatMsg[]>())
  const sendingLock = ref(false)
  const crossContextCleanup = ref<(() => void) | null>(null)
  const selectedModuleName = ref<string | null>(null)

  // ── 角色 Agent 状态 ──
  const roles = ref<RoleConfigData[]>([])
  const rolesLoaded = ref(false)
  const selectedRoleAgent = ref<string | null>(null)
  const roleContextMap = ref(new Map<string, ChatMsg[]>())
  const roleRunningAgents = shallowRef(new Map<string, AgentStatus>())
  const roleSendingLock = ref(false)

  // ── 内部清理引用（不对外暴露） ──
  let statusListenerCleanup: (() => void) | null = null
  let roleStatusListenerCleanup: (() => void) | null = null
  let streamCleanup: (() => void) | null = null
  let roleStreamCleanup: (() => void) | null = null

  // ── 工作区 Diff 状态 ──
  const pendingDiffModule = ref<string | null>(null)
  const pendingDiffCount = ref(0)
  const showDiffPanel = ref(false)
  let diffListenerCleanup: (() => void) | null = null

  function ensureDiffListener(): void {
    if (diffListenerCleanup) return
    diffListenerCleanup = window.moduleAgent.onWorkspaceDiffReady((data) => {
      if (data.summary) {
        pendingDiffModule.value = data.moduleName
        pendingDiffCount.value = data.summary.files.length
      }
    })
  }

  function openDiffPanel(): void {
    showDiffPanel.value = true
  }

  function closeDiffPanel(): void {
    showDiffPanel.value = false
  }

  function clearDiffNotification(): void {
    pendingDiffModule.value = null
    pendingDiffCount.value = 0
  }

  // ── 辅助方法 ──
  function now(): string {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  function getMsgs(name: string): ChatMsg[] {
    if (!contextMap.value.has(name)) {
      contextMap.value.set(name, [])
    }
    return contextMap.value.get(name)!
  }

  // ── 通过 IPC 持久化上下文 ──
  async function restoreContext(moduleName: string): Promise<void> {
    // 不要用过时的持久化数据覆盖内存中的实时数据
    if (contextMap.value.has(moduleName) && (contextMap.value.get(moduleName)?.length ?? 0) > 0) {
      return
    }
    try {
      const msgs = await window.moduleAgent.getContext(moduleName)
      if (msgs.length > 0) {
        for (const msg of msgs) {
          if (msg.status === 'executing') {
            msg.status = 'interrupted'
          }
        }
        contextMap.value.set(moduleName, msgs)
      }
    } catch {
      // 静默忽略——上下文可能尚不存在
    }
  }

  async function clearContext(moduleName: string): Promise<void> {
    await window.moduleAgent.clearContext(moduleName)
    contextMap.value.set(moduleName, [])
  }

  async function clearAllContexts(): Promise<void> {
    await window.moduleAgent.clearAllContexts()
    contextMap.value.clear()
    selectedModuleName.value = null
    if (crossContextCleanup.value) {
      crossContextCleanup.value()
      crossContextCleanup.value = null
    }
  }

  // ── 跨上下文监听器 ──
  function ensureCrossContextListener(): void {
    if (crossContextCleanup.value) return
    crossContextCleanup.value = window.moduleAgent.onCrossContext(({ moduleName, crossModule, direction, phase, content, time }) => {
      const msgs = getMsgs(moduleName)
      const last = msgs[msgs.length - 1]

      // 目标模块接收到跨模块请求：推送一个 executing 占位消息，
      // 以便流监听器有 Agent 消息可以更新
      if (direction === 'received' && phase === 'request') {
        if (last && last.role === 'agent' && last.status === 'executing') return // 已经在流中
        msgs.push({
          id: 'x' + Date.now() + Math.random().toString(36).slice(2, 6),
          role: 'agent',
          content: '',
          thinking: '',
          tools: '',
          timeline: [],
          time,
          status: 'executing',
          moduleName,
          agentCmd: '',
        })
        return
      }

      // 目标模块的响应：将占位消息标记为已完成
      if (direction === 'sent' && phase === 'response') {
        if (last && last.role === 'agent' && last.status === 'executing') {
          last.status = 'completed'
          last.time = time
        }
        return
      }

      // 请求模块：增强匹配到的跨模块 tool_call
      if (!last || last.role !== 'agent' || last.status !== 'executing') return
      if (!last.timeline || last.timeline.length === 0) return

      for (let i = last.timeline.length - 1; i >= 0; i--) {
        const ev = last.timeline[i]!
        if (ev.type === 'tool_call' && (ev.content.includes('module_call') || ev.content.includes('module_query'))) {
          if (!ev.crossModule) {
            ev.crossDirection = direction
            ev.crossModule = crossModule
            ev.crossPhase = phase
            ev.detail = content
          } else {
            ev.crossPhase = phase
            if (ev.detail) {
              ev.detail = ev.detail + '\n\n---\n\n' + content
            }
          }
          return
        }
      }
    })
  }

  // ── Agent 生命周期 ──
  async function cancelAgent(moduleName: string): Promise<void> {
    const result = await window.moduleAgent.cancelAgent(moduleName).catch(() => undefined)
    const msgs = getMsgs(moduleName)
    const idx = msgs.findLastIndex(m => m.role === 'agent' && m.status === 'executing')
    if (idx !== -1) {
      const acc = result?.accumulated
      if (acc) {
        if (acc.reply) msgs[idx]!.content = acc.reply
        if (acc.thinking) msgs[idx]!.thinking = acc.thinking
        if (acc.tools) msgs[idx]!.tools = acc.tools
        if (acc.timeline) msgs[idx]!.timeline = acc.timeline
      }
      msgs[idx]!.status = 'interrupted'
      msgs[idx]!.time = now()
    }
  }

  async function sendMessage(moduleName: string, text: string, cwd: string): Promise<void> {
    if (sendingLock.value) return
    sendingLock.value = true

    ensureStreamListener()

    // 立即推送用户消息以获得即时 UI 反馈
    getMsgs(moduleName).push({
      id: 'm' + Date.now(),
      role: 'user',
      content: text,
      thinking: '',
      tools: '',
      time: now(),
      status: 'sent',
      moduleName,
      agentCmd: '',
    })

    // 推送 Agent 占位消息——由流监听器实时更新
    const agentIdx = getMsgs(moduleName).length
    getMsgs(moduleName).push({
      id: 'm' + Date.now(),
      role: 'agent',
      content: '',
      thinking: '',
      tools: '',
      timeline: [],
      time: now(),
      status: 'executing',
      moduleName,
      agentCmd: '',
    })

    try {
      const result = await window.moduleAgent.sendMessage(moduleName, text, cwd)
      const agentMsg = getMsgs(moduleName)[agentIdx]
      if (agentMsg) {
        if (result.result) {
          agentMsg.content = result.result.reply || ''
          agentMsg.thinking = result.result.thinking || ''
          agentMsg.tools = result.result.tools || ''
          agentMsg.timeline = mergeTimeline(agentMsg.timeline, result.result.timeline)
          agentMsg.status = 'completed'
          agentMsg.time = now()
        } else if (result.error) {
          agentMsg.status = 'error'
          agentMsg.content = result.error
        }
      }
    } catch (err) {
      const agentMsg = getMsgs(moduleName)[agentIdx]
      if (agentMsg) {
        agentMsg.status = 'error'
        agentMsg.content = `通信错误: ${(err as Error).message}`
      }
    } finally {
      sendingLock.value = false
    }
  }

  // ── 推送式 Agent 状态监听器 ──
  function ensureStatusListener(): void {
    if (statusListenerCleanup) return
    statusListenerCleanup = window.moduleAgent.onAgentStatus(({ name, status }) => {
      const next = new Map(runningAgents.value)
      if (status === 'stopped') {
        next.delete(name)
      } else {
        next.set(name, status)
      }
      runningAgents.value = next
    })
  }

  // ── 跨时间线保留跨上下文修改
  function mergeTimeline(oldTimeline: ChatMsg['timeline'], newTimeline: ChatMsg['timeline']): ChatMsg['timeline'] {
    if (!newTimeline) return newTimeline
    if (!oldTimeline) return newTimeline
    const oldMap = new Map<string, (typeof oldTimeline)[number]>()
    for (const t of oldTimeline) {
      if (t.toolCallId && (t.detail || t.crossModule)) oldMap.set(t.toolCallId, t)
    }
    if (oldMap.size === 0) return newTimeline
    return newTimeline.map(t => {
      if (t.toolCallId && oldMap.has(t.toolCallId)) {
        const old = oldMap.get(t.toolCallId)!
        return { ...t, detail: old.detail, crossDirection: old.crossDirection, crossModule: old.crossModule, crossPhase: old.crossPhase }
      }
      return t
    })
  }

  // ── 用于实时 Agent 输出的流监听器 ──
  function ensureStreamListener(): void {
    if (streamCleanup) return
    streamCleanup = window.moduleAgent.onAgentStream((data) => {
      const msgs = contextMap.value.get(data.moduleName)
      if (!msgs || msgs.length === 0) return
      const last = msgs[msgs.length - 1]
      if (!last || last.role !== 'agent' || last.status !== 'executing') return
      if (data.reply !== undefined) last.content = data.reply
      if (data.thinking !== undefined) last.thinking = data.thinking
      if (data.tools !== undefined) last.tools = data.tools
      if (data.timeline !== undefined) last.timeline = mergeTimeline(last.timeline, data.timeline)
    })
  }

  function ensureRoleStreamListener(): void {
    if (roleStreamCleanup) return
    roleStreamCleanup = window.moduleAgent.onRoleAgentStream((data) => {
      const msgs = roleContextMap.value.get(data.moduleName)
      if (!msgs || msgs.length === 0) return
      const last = msgs[msgs.length - 1]
      if (!last || last.role !== 'agent' || last.status !== 'executing') return
      if (data.reply !== undefined) last.content = data.reply
      if (data.thinking !== undefined) last.thinking = data.thinking
      if (data.tools !== undefined) last.tools = data.tools
      if (data.timeline !== undefined) last.timeline = mergeTimeline(last.timeline, data.timeline)
    })
  }

  function stopRunningPoll(): void {
    if (statusListenerCleanup) {
      statusListenerCleanup()
      statusListenerCleanup = null
    }
    if (streamCleanup) {
      streamCleanup()
      streamCleanup = null
    }
    runningAgents.value = new Map()
  }

  // ── 角色 Agent 辅助方法 ──
  function getRoleMsgs(name: string): ChatMsg[] {
    if (!roleContextMap.value.has(name)) {
      roleContextMap.value.set(name, [])
    }
    return roleContextMap.value.get(name)!
  }

  // ── 角色 Agent 生命周期 ──
  async function fetchRoles(): Promise<void> {
    if (rolesLoaded.value) return
    await refreshRoles()
  }

  async function refreshRoles(): Promise<void> {
    try {
      roles.value = await window.moduleAgent.getRoles()
      rolesLoaded.value = true
    } catch {
      roles.value = []
    }
  }

  async function saveRole(role: RoleConfigData): Promise<void> {
    // 深度克隆为普通对象：Vue 响应式代理不可通过 IPC 克隆
    const plain = JSON.parse(JSON.stringify(role))
    await window.moduleAgent.saveRole(plain)
    await refreshRoles()
  }

  async function deleteRole(name: string): Promise<void> {
    await window.moduleAgent.deleteRole(name)
    if (selectedRoleAgent.value === name) {
      selectedRoleAgent.value = null
    }
    await refreshRoles()
  }

  async function startRoleAgent(roleName: string): Promise<void> {
    const result = await window.moduleAgent.startRoleAgent(roleName)
    if (result.error) {
      console.error(`Failed to start role agent ${roleName}: ${result.error}`)
    }
  }

  async function selectRoleAgentAndStart(name: string): Promise<void> {
    selectedRoleAgent.value = name
    await restoreRoleContext(name)
    await startRoleAgent(name)
  }

  async function sendRoleMessage(roleName: string, text: string): Promise<void> {
    if (roleSendingLock.value) return
    roleSendingLock.value = true

    ensureRoleStreamListener()

    getRoleMsgs(roleName).push({
      id: 'r' + Date.now(),
      role: 'user',
      content: text,
      thinking: '',
      tools: '',
      time: now(),
      status: 'sent',
      moduleName: `workrole:${roleName}`,
      agentCmd: '',
    })

    // 推送 Agent 占位消息——由流监听器实时更新
    const agentIdx = getRoleMsgs(roleName).length
    getRoleMsgs(roleName).push({
      id: 'r' + Date.now(),
      role: 'agent',
      content: '',
      thinking: '',
      tools: '',
      timeline: [],
      time: now(),
      status: 'executing',
      moduleName: `workrole:${roleName}`,
      agentCmd: '',
    })

    try {
      const result = await window.moduleAgent.sendRoleMessage(roleName, text)
      const agentMsg = getRoleMsgs(roleName)[agentIdx]
      if (agentMsg) {
        if (result.result) {
          agentMsg.content = result.result.reply || ''
          agentMsg.thinking = result.result.thinking || ''
          agentMsg.tools = result.result.tools || ''
          agentMsg.timeline = mergeTimeline(agentMsg.timeline, result.result.timeline)
          agentMsg.status = 'completed'
          agentMsg.time = now()
        } else if (result.error) {
          agentMsg.status = 'error'
          agentMsg.content = result.error
        }
      }
    } catch (err) {
      const agentMsg = getRoleMsgs(roleName)[agentIdx]
      if (agentMsg) {
        agentMsg.status = 'error'
        agentMsg.content = `通信错误: ${(err as Error).message}`
      }
    } finally {
      roleSendingLock.value = false
    }
  }

  async function cancelRoleAgent(roleName: string): Promise<void> {
    const result = await window.moduleAgent.cancelRoleAgent(roleName).catch(() => undefined)
    const msgs = getRoleMsgs(roleName)
    const idx = msgs.findLastIndex(m => m.role === 'agent' && m.status === 'executing')
    if (idx !== -1) {
      const acc = result?.accumulated
      if (acc) {
        if (acc.reply) msgs[idx]!.content = acc.reply
        if (acc.thinking) msgs[idx]!.thinking = acc.thinking
        if (acc.tools) msgs[idx]!.tools = acc.tools
        if (acc.timeline) msgs[idx]!.timeline = acc.timeline
      }
      msgs[idx]!.status = 'interrupted'
      msgs[idx]!.time = now()
    }
  }

  async function stopRoleAgent(roleName: string): Promise<void> {
    await window.moduleAgent.stopRoleAgent(roleName)
  }

  async function restoreRoleContext(roleName: string): Promise<void> {
    if (roleContextMap.value.has(roleName) && (roleContextMap.value.get(roleName)?.length ?? 0) > 0) {
      return
    }
    try {
      const msgs = await window.moduleAgent.getRoleContext(roleName)
      if (msgs.length > 0) {
        for (const msg of msgs) {
          if (msg.status === 'executing') {
            msg.status = 'interrupted'
          }
        }
        roleContextMap.value.set(roleName, msgs)
      }
    } catch {
      // 静默忽略——上下文可能尚不存在
    }
  }

  async function clearRoleContext(roleName: string): Promise<void> {
    await window.moduleAgent.clearRoleContext(roleName)
    roleContextMap.value.set(roleName, [])
  }

  function ensureRoleStatusListener(): void {
    if (roleStatusListenerCleanup) return
    roleStatusListenerCleanup = window.moduleAgent.onRoleAgentStatus(({ name, status }) => {
      const next = new Map(roleRunningAgents.value)
      if (status === 'stopped') {
        next.delete(name)
      } else {
        next.set(name, status)
      }
      roleRunningAgents.value = next
    })
  }

  function stopRoleRunningPoll(): void {
    if (roleStatusListenerCleanup) {
      roleStatusListenerCleanup()
      roleStatusListenerCleanup = null
    }
    if (roleStreamCleanup) {
      roleStreamCleanup()
      roleStreamCleanup = null
    }
    roleRunningAgents.value = new Map()
  }

  return {
    // 模块 Agent
    runningAgents,
    contextMap,
    sendingLock,
    selectedModuleName,
    getMsgs,
    restoreContext,
    clearContext,
    clearAllContexts,
    ensureCrossContextListener,
    cancelAgent,
    sendMessage,
    ensureStatusListener,
    stopRunningPoll,
    // 角色 Agent
    roles,
    rolesLoaded,
    selectedRoleAgent,
    roleContextMap,
    roleRunningAgents,
    roleSendingLock,
    getRoleMsgs,
    fetchRoles,
    refreshRoles,
    saveRole,
    deleteRole,
    selectRoleAgentAndStart,
    sendRoleMessage,
    cancelRoleAgent,
    stopRoleAgent,
    restoreRoleContext,
    clearRoleContext,
    ensureRoleStatusListener,
    stopRoleRunningPoll,

    // 工作区 Diff
    pendingDiffModule,
    pendingDiffCount,
    showDiffPanel,
    ensureDiffListener,
    openDiffPanel,
    closeDiffPanel,
    clearDiffNotification,
  }
})
