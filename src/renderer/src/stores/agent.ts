import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { AgentStatus, ChatMsg, RoleConfigData } from '../../../types/preload'

export const useAgentStore = defineStore('agent', () => {
  // ── State ──
  const runningAgents = shallowRef(new Map<string, AgentStatus>())
  const contextMap = ref(new Map<string, ChatMsg[]>())
  const sendingLock = ref(false)
  const crossContextCleanup = ref<(() => void) | null>(null)
  const selectedModuleName = ref<string | null>(null)

  // ── Role agent state ──
  const roles = ref<RoleConfigData[]>([])
  const rolesLoaded = ref(false)
  const selectedRoleAgent = ref<string | null>(null)
  const roleContextMap = ref(new Map<string, ChatMsg[]>())
  const roleRunningAgents = shallowRef(new Map<string, AgentStatus>())
  const roleSendingLock = ref(false)

  // ── Internal cleanup refs (not exposed) ──
  let statusListenerCleanup: (() => void) | null = null
  let roleStatusListenerCleanup: (() => void) | null = null
  let streamCleanup: (() => void) | null = null
  let roleStreamCleanup: (() => void) | null = null

  // ── Helpers ──
  function now(): string {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  function getMsgs(name: string): ChatMsg[] {
    if (!contextMap.value.has(name)) {
      contextMap.value.set(name, [])
    }
    return contextMap.value.get(name)!
  }

  // ── Context persistence via IPC ──
  async function restoreContext(moduleName: string): Promise<void> {
    // Don't overwrite live in-memory data with stale persisted data
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
      // Silently ignore — context may not exist yet
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

  // ── Cross-context listener ──
  function ensureCrossContextListener(): void {
    if (crossContextCleanup.value) return
    crossContextCleanup.value = window.moduleAgent.onCrossContext(({ moduleName, crossModule, direction, phase, content, time }) => {
      const msg: ChatMsg = {
        id: 'x' + Date.now() + Math.random().toString(36).slice(2, 6),
        role: 'cross',
        content,
        thinking: '',
        tools: '',
        time,
        status: 'completed',
        moduleName,
        agentCmd: '',
        crossDirection: direction,
        crossModule,
        crossPhase: phase,
      }
      getMsgs(moduleName).push(msg)
    })
  }

  // ── Agent lifecycle ──
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
      }
      msgs[idx]!.status = 'interrupted'
      msgs[idx]!.time = now()
    }
  }

  async function sendMessage(moduleName: string, text: string, cwd: string): Promise<void> {
    if (sendingLock.value) return
    sendingLock.value = true

    ensureStreamListener()

    // Push user message immediately for instant UI feedback
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

    // Push agent placeholder — updated in real time by stream listener
    const agentIdx = getMsgs(moduleName).length
    getMsgs(moduleName).push({
      id: 'm' + Date.now(),
      role: 'agent',
      content: '',
      thinking: '',
      tools: '',
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

  // ── Push-based agent status listener ──
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

  // ── Stream listeners for real-time agent output ──
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

  // ── Role agent helpers ──
  function getRoleMsgs(name: string): ChatMsg[] {
    if (!roleContextMap.value.has(name)) {
      roleContextMap.value.set(name, [])
    }
    return roleContextMap.value.get(name)!
  }

  // ── Role agent lifecycle ──
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
    // Deep-clone to plain object: Vue reactive proxies are not IPC-cloneable
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

    // Push agent placeholder — updated in real time by stream listener
    const agentIdx = getRoleMsgs(roleName).length
    getRoleMsgs(roleName).push({
      id: 'r' + Date.now(),
      role: 'agent',
      content: '',
      thinking: '',
      tools: '',
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
      // Silently ignore — context may not exist yet
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
    // Module agent
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
    // Role agent
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
  }
})
