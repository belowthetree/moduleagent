import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { AgentStatus, ChatMsg } from '../../../types/preload'

export const useAgentStore = defineStore('agent', () => {
  // ── State ──
  const runningAgents = shallowRef(new Map<string, AgentStatus>())
  const contextMap = ref(new Map<string, ChatMsg[]>())
  const sendingLock = ref(false)
  const crossContextCleanup = ref<(() => void) | null>(null)
  const selectedModuleName = ref<string | null>(null)

  // ── Internal cleanup refs (not exposed) ──
  let statusListenerCleanup: (() => void) | null = null

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

    try {
      const result = await window.moduleAgent.sendMessage(moduleName, text, cwd)
      if (result.result) {
        // Push agent message from consolidated IPC result
        getMsgs(moduleName).push({
          id: 'm' + Date.now(),
          role: 'agent',
          content: result.result.reply || '',
          thinking: result.result.thinking || '',
          tools: result.result.tools || '',
          time: now(),
          status: 'completed',
          moduleName,
          agentCmd: '',
        })
      } else if (result.error) {
        console.error(`发送失败: ${result.error}`)
      }
    } catch (err) {
      console.error(`通信错误: ${(err as Error).message}`)
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

  function stopRunningPoll(): void {
    if (statusListenerCleanup) {
      statusListenerCleanup()
      statusListenerCleanup = null
    }
    runningAgents.value = new Map()
  }

  return {
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
  }
})
