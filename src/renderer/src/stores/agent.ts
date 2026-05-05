import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { AgentStatus, ChatMsg } from '../../../types/preload'

// FROZEN constants — must match renderer.ts
const LS_STREAM_SNAPSHOT = 'stream_snapshot'
const CTX_PREFIX = 'ctx_'
const POLL_INTERVAL = 3000
const STREAM_SAVE_DEBOUNCE = 2000

export const useAgentStore = defineStore('agent', () => {
  // ── State ──
  const runningAgents = shallowRef(new Map<string, AgentStatus>())
  const streamState = ref(new Map<string, {
    reply: string
    thinking: string
    tools: string
    finished?: boolean
    sections: { thinking: boolean; tools: boolean; reply: boolean }
  }>())
  const contextMap = ref(new Map<string, ChatMsg[]>())
  const sendingLock = ref(false)
  const streamListenerCleanup = ref<(() => void) | null>(null)
  const crossContextCleanup = ref<(() => void) | null>(null)
  const selectedModuleName = ref<string | null>(null)

  // Tracks the msg ID of the currently-streaming agent message per module
  // so stream chunks update the right card in the context list.
  const liveMsgId = ref(new Map<string, string>())

  // Config used by agent lifecycle (mirrors renderer.ts globals agentCmd/agentArgs)
  const agentCmd = ref('opencode')
  const agentArgs = ref('acp')

  // ── Internal timers (not exposed) ──
  let runningPollTimer: ReturnType<typeof setInterval> | null = null
  let streamSaveTimer: ReturnType<typeof setTimeout> | null = null

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

  function getStreamState(moduleName: string) {
    let st = streamState.value.get(moduleName)
    if (!st) {
      st = { reply: '', thinking: '', tools: '', sections: { thinking: false, tools: false, reply: false } }
      streamState.value.set(moduleName, st)
    }
    return st
  }

  // ── Set config (called by component to sync agentCmd/Args) ──
  function setAgentConfig(cmd: string, args: string): void {
    agentCmd.value = cmd
    agentArgs.value = args
  }

  // ── Context persistence (localStorage keys: ctx_<moduleName>) ──
  function saveContext(moduleName: string): void {
    const msgs = contextMap.value.get(moduleName)
    if (msgs && msgs.length > 0) {
      localStorage.setItem(`${CTX_PREFIX}${moduleName}`, JSON.stringify(msgs))
    }
  }

  function loadContext(moduleName: string): ChatMsg[] {
    try {
      const raw = localStorage.getItem(`${CTX_PREFIX}${moduleName}`)
      if (raw) return JSON.parse(raw) as ChatMsg[]
    } catch { /* ignore parse errors */ }
    return []
  }

  function restoreContext(moduleName: string): void {
    const msgs = loadContext(moduleName)
    if (msgs.length > 0) {
      for (const msg of msgs) {
        if (msg.status === 'executing') {
          msg.status = 'interrupted'
        }
      }
      contextMap.value.set(moduleName, msgs)
    }
  }

  function clearContext(moduleName: string): void {
    stopStream(moduleName)
    contextMap.value.set(moduleName, [])
    liveMsgId.value.delete(moduleName)
    localStorage.removeItem(`${CTX_PREFIX}${moduleName}`)
  }

  function clearAllContexts(): void {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(CTX_PREFIX)) keys.push(k)
    }
    keys.forEach(k => localStorage.removeItem(k))
    contextMap.value.clear()
    liveMsgId.value.clear()
    streamState.value.clear()
    clearStreamSnapshot()
    if (streamListenerCleanup.value) {
      streamListenerCleanup.value()
      streamListenerCleanup.value = null
    }
    if (crossContextCleanup.value) {
      crossContextCleanup.value()
      crossContextCleanup.value = null
    }
    selectedModuleName.value = null
  }

  // ── Stream snapshot persistence (localStorage key: stream_snapshot) ──
  function saveStreamSnapshot(): void {
    if (streamState.value.size === 0) return
    const entries: { moduleName: string; reply: string; thinking: string; tools: string; finished?: boolean; time: string }[] = []
    for (const [name, st] of streamState.value) {
      if (st.reply || st.thinking || st.tools) {
        entries.push({ moduleName: name, reply: st.reply, thinking: st.thinking, tools: st.tools, finished: st.finished, time: now() })
      }
    }
    if (entries.length > 0) {
      localStorage.setItem(LS_STREAM_SNAPSHOT, JSON.stringify(entries))
    } else {
      localStorage.removeItem(LS_STREAM_SNAPSHOT)
    }
  }

  function scheduleStreamSave(): void {
    if (streamSaveTimer) return
    streamSaveTimer = setTimeout(() => {
      streamSaveTimer = null
      saveStreamSnapshot()
    }, STREAM_SAVE_DEBOUNCE)
  }

  function clearStreamSnapshot(): void {
    localStorage.removeItem(LS_STREAM_SNAPSHOT)
  }

  function restoreStreamSnapshot(moduleName: string): ChatMsg | null {
    try {
      const raw = localStorage.getItem(LS_STREAM_SNAPSHOT)
      if (!raw) return null
      const entries = JSON.parse(raw) as { moduleName: string; reply: string; thinking: string; tools: string; finished?: boolean; time: string }[]
      const idx = entries.findIndex(e => e.moduleName === moduleName)
      if (idx === -1) return null
      const snap = entries[idx]!
      if (!snap.reply && !snap.thinking && !snap.tools) return null
      entries.splice(idx, 1)
      if (entries.length > 0) {
        localStorage.setItem(LS_STREAM_SNAPSHOT, JSON.stringify(entries))
      } else {
        localStorage.removeItem(LS_STREAM_SNAPSHOT)
      }
      const msg: ChatMsg = {
        id: 's' + Date.now(),
        role: 'agent',
        content: snap.reply || '',
        thinking: snap.thinking || '',
        tools: snap.tools || '',
        time: snap.time,
        status: snap.finished ? 'completed' : 'interrupted',
        moduleName,
        agentCmd: agentCmd.value,
      }
      getMsgs(moduleName).push(msg)
      saveContext(moduleName)
      return msg
    } catch { return null }
  }

  // ── Stream lifecycle ──
  function stopStream(moduleName: string): void {
    const msgId = liveMsgId.value.get(moduleName)
    if (msgId) {
      const msgs = getMsgs(moduleName)
      const idx = msgs.findIndex(m => m.id === msgId && m.status === 'executing')
      if (idx !== -1) {
        msgs[idx]!.status = 'interrupted'
      }
      liveMsgId.value.delete(moduleName)
    }
    streamState.value.delete(moduleName)
    if (streamState.value.size === 0) {
      clearStreamSnapshot()
      if (streamListenerCleanup.value) {
        streamListenerCleanup.value()
        streamListenerCleanup.value = null
      }
    }
  }

  function finishStream(moduleName: string): void {
    const st = streamState.value.get(moduleName)
    const content = (st?.reply || '').trim()
    const thinking = (st?.thinking || '').trim()
    const tools = (st?.tools || '').trim()

    const msgId = liveMsgId.value.get(moduleName)
    if (msgId && (content || thinking || tools)) {
      const msgs = getMsgs(moduleName)
      const idx = msgs.findIndex(m => m.id === msgId)
      if (idx !== -1) {
        msgs[idx]!.content = content
        msgs[idx]!.thinking = thinking
        msgs[idx]!.tools = tools
        msgs[idx]!.time = now()
        msgs[idx]!.status = 'completed'
      }
    } else if (!msgId && (content || thinking || tools)) {
      getMsgs(moduleName).push({
        id: 'm' + Date.now(),
        role: 'agent',
        content,
        thinking,
        tools,
        time: now(),
        status: 'completed',
        moduleName,
        agentCmd: agentCmd.value,
      })
    }
    if (msgId && !content && !thinking && !tools) {
      const msgs = getMsgs(moduleName)
      const idx = msgs.findIndex(m => m.id === msgId)
      if (idx !== -1) msgs.splice(idx, 1)
    }

    liveMsgId.value.delete(moduleName)
    saveStreamSnapshot()
    streamState.value.delete(moduleName)
    saveContext(moduleName)
  }

  // ── Stream listener ──
  function ensureStreamListener(): void {
    if (streamListenerCleanup.value) return
    streamListenerCleanup.value = window.moduleAgent.onAgentStream(({ moduleName, update, data }) => {
      const st = getStreamState(moduleName)
      if (st.finished) return

      if (!liveMsgId.value.has(moduleName)) {
        const msg: ChatMsg = {
          id: 'm' + Date.now(),
          role: 'agent',
          content: '',
          thinking: '',
          tools: '',
          time: now(),
          status: 'executing',
          moduleName,
          agentCmd: agentCmd.value,
        }
        getMsgs(moduleName).push(msg)
        liveMsgId.value.set(moduleName, msg.id)
        saveContext(moduleName)
      }

      const updateLiveMsg = () => {
        const msgId = liveMsgId.value.get(moduleName)
        if (!msgId) return
        const msgs = getMsgs(moduleName)
        const m = msgs.find(m => m.id === msgId)
        if (m) {
          m.content = st.reply
          m.thinking = st.thinking
          m.tools = st.tools
          m.time = now()
        }
      }

      if (update === 'agent_message_chunk') {
        const block = (data as any).content as { type?: string; text?: string } | undefined
        const text = block?.type === 'text' ? block.text : undefined
        if (text) {
          st.reply += text
          if (!st.sections.reply) st.sections.reply = true
          updateLiveMsg()
          scheduleStreamSave()
        }
      } else if (update === 'agent_thought_chunk') {
        const block = (data as any).content as { type?: string; text?: string } | undefined
        const text = block?.type === 'text' ? block.text : undefined
        if (text) {
          st.thinking += text
          if (!st.sections.thinking) st.sections.thinking = true
          updateLiveMsg()
          scheduleStreamSave()
        }
      } else if (update === 'tool_call') {
        const tc = data as any
        const kindLabel = tc.kind ? `[${tc.kind}]` : ''
        const name = tc.title || tc.toolCallId || 'unknown'
        const line = `${kindLabel} ${name} ${tc.status ? `(${tc.status})` : ''}`.trim()
        st.tools += line + '\n'
        if (!st.sections.tools) st.sections.tools = true
        updateLiveMsg()
        scheduleStreamSave()
      } else if (update === 'plan') {
        st.reply += `\n[计划更新]\n`
        updateLiveMsg()
        scheduleStreamSave()
      }
    })
  }

  // ── Selected module sync (set by views when drawer opens/closes) ──
  function setSelectedModuleName(name: string | null): void {
    selectedModuleName.value = name
  }

  // ── Cross-context listener ──
  function ensureCrossContextListener(): void {
    if (crossContextCleanup.value) return
    crossContextCleanup.value = window.moduleAgent.onCrossContext(({ moduleName, crossModule, direction, content, time }) => {
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
      }
      getMsgs(moduleName).push(msg)
      saveContext(moduleName)
    })
  }

  // ── Agent lifecycle ──
  function cancelAgent(moduleName: string): void {
    const msgId = liveMsgId.value.get(moduleName)
    if (msgId) {
      const msgs = getMsgs(moduleName)
      const idx = msgs.findIndex(m => m.id === msgId && m.status === 'executing')
      if (idx !== -1) {
        msgs[idx]!.status = 'interrupted'
        msgs[idx]!.time = now()
      }
      liveMsgId.value.delete(moduleName)
    }
    window.moduleAgent.cancelAgent(moduleName).catch(() => { /* ignore */ })
  }

  async function sendMessage(moduleName: string, text: string, cwd: string): Promise<void> {
    if (sendingLock.value) return
    sendingLock.value = true

    getMsgs(moduleName).push({
      id: 'm' + Date.now(),
      role: 'user',
      content: text,
      thinking: '',
      tools: '',
      time: now(),
      status: 'sent',
      moduleName,
      agentCmd: agentCmd.value,
    })
    saveContext(moduleName)

    try {
      const args = agentArgs.value ? agentArgs.value.split(/\s+/).filter(Boolean) : []
      const startResult = await window.moduleAgent.startAgent(moduleName, agentCmd.value, args, cwd)
      if (startResult.error) {
        console.error(`启动 Agent 失败: ${startResult.error}`)
        stopStream(moduleName)
        return
      }

      ensureStreamListener()
      streamState.value.delete(moduleName)

      const sendResult = await window.moduleAgent.sendMessage(moduleName, text)
      if (sendResult.error) {
        console.error(`发送失败: ${sendResult.error}`)
        stopStream(moduleName)
      } else {
        finishStream(moduleName)
      }
    } catch (err) {
      console.error(`通信错误: ${(err as Error).message}`)
      stopStream(moduleName)
    } finally {
      sendingLock.value = false
    }
  }

  // ── Running agents polling ──
  async function refreshRunningAgents(): Promise<void> {
    try {
      runningAgents.value.clear()
      const list = await window.moduleAgent.getRunningAgents()
      for (const item of list) {
        runningAgents.value.set(item.name, item.status)
      }
    } catch { /* ignore errors during polling */ }
  }

  function startRunningPoll(): void {
    if (runningPollTimer) return
    refreshRunningAgents()
    runningPollTimer = setInterval(refreshRunningAgents, POLL_INTERVAL)
  }

  function stopRunningPoll(): void {
    if (runningPollTimer) {
      clearInterval(runningPollTimer)
      runningPollTimer = null
    }
    runningAgents.value.clear()
  }

  return {
    runningAgents,
    streamState,
    contextMap,
    sendingLock,
    streamListenerCleanup,
    crossContextCleanup,
    selectedModuleName,
    agentCmd,
    agentArgs,
    now,
    getMsgs,
    getStreamState,
    setAgentConfig,
    saveContext,
    loadContext,
    restoreContext,
    clearContext,
    clearAllContexts,
    saveStreamSnapshot,
    scheduleStreamSave,
    clearStreamSnapshot,
    restoreStreamSnapshot,
    stopStream,
    finishStream,
    ensureStreamListener,
    setSelectedModuleName,
    ensureCrossContextListener,
    cancelAgent,
    sendMessage,
    refreshRunningAgents,
    startRunningPoll,
    stopRunningPoll,
  }
})
