<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import type { AgentStreamData } from '../types/preload'
import ChatInput from './ChatInput.vue'
import { useConfigStore } from '../stores/config'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const configStore = useConfigStore()

interface LocalMsg {
  id: string
  role: 'user' | 'agent'
  content: string
  time: string
  status: 'sent' | 'streaming' | 'completed' | 'error'
}

const messages = ref<LocalMsg[]>([])
const sendingLock = ref(false)
const generatingModules = ref(false)
const messagesContainer = ref<HTMLElement | null>(null)
let streamCleanup: (() => void) | null = null
streamCleanup = window.moduleAgent.onAgentStream(handleStream)

const projectName = computed(() => {
  const p = configStore.projectPath
  if (!p) return ''
  return p.split(/[/\\]/).pop() || p
})

function now(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function scrollToBottom(): void {
  nextTick(() => {
    const el = messagesContainer.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function handleStream(data: AgentStreamData): void {
  if (data.moduleName !== '__project__') return

  const msgs = messages.value
  if (msgs.length === 0) return

  const last = msgs[msgs.length - 1]
  if (last!.role !== 'agent') return

  const updateType = data.update
  const content = (data.data as Record<string, unknown>)?.content as { type?: string; text?: string } | undefined

  if ((updateType === 'agent_message_chunk' || updateType === 'agent_thought_chunk') && content?.text) {
    last!.content += content.text
    last!.status = 'streaming'
    scrollToBottom()
  }
}

async function handleSend(text: string): Promise<void> {
  if (sendingLock.value) return
  sendingLock.value = true

  messages.value.push({
    id: 'm' + Date.now(),
    role: 'user',
    content: text,
    time: now(),
    status: 'sent',
  })

  const agentMsg: LocalMsg = {
    id: 'm' + (Date.now() + 1),
    role: 'agent',
    content: '',
    time: now(),
    status: 'streaming',
  }
  messages.value.push(agentMsg)
  scrollToBottom()

  try {
    const result = await window.moduleAgent.sendProjectMessage(text)
    if (result.error) {
      agentMsg.status = 'error'
      agentMsg.content = result.error
    } else {
      agentMsg.status = 'completed'
    }
  } catch (err) {
    agentMsg.status = 'error'
    agentMsg.content = `Error: ${(err as Error).message}`
  } finally {
    sendingLock.value = false
  }
}

async function handleGenerateModules(): Promise<void> {
  generatingModules.value = true

  const { content: formatContent, error } = await window.moduleAgent.readProjectFile('config/knowledge/MODULE_FORMAT.md')

  let instruction: string
  if (formatContent && !error) {
    instruction = `请阅读以下 module.md 文件格式规范，严格按照规范扫描项目源码目录，为每个需要模块化的目录在 .module-agent/module/ 下生成对应的 module.md 文件。

=== MODULE_FORMAT.md 规范 ===
${formatContent}

要求：
1. 严格按照上述规范生成所有 module.md
2. module.md 文件统一放在 .module-agent/module/<相对路径>/module.md
3. 目录结构与项目源码目录一致
4. 不要在源码目录中创建 module.md 文件`
  } else {
    instruction = `请扫描项目源码目录，为每个需要模块化的目录在 .module-agent/module/ 下生成对应的 module.md 文件。请确保包含正确的 name、description 和 submodules 信息。`
  }

  messages.value.push({
    id: 'm' + Date.now(),
    role: 'user',
    content: instruction,
    time: now(),
    status: 'sent',
  })

  const agentMsg: LocalMsg = {
    id: 'm' + (Date.now() + 1),
    role: 'agent',
    content: '',
    time: now(),
    status: 'streaming',
  }
  messages.value.push(agentMsg)
  scrollToBottom()

  try {
    await window.moduleAgent.sendProjectMessage(instruction)
    agentMsg.status = 'completed'
  } catch (err) {
    agentMsg.status = 'error'
    agentMsg.content = `Error: ${(err as Error).message}`
  } finally {
    generatingModules.value = false
  }
}

async function beforeClose(done: () => void): Promise<void> {
  done()
}

async function handleStop(): Promise<void> {
  try {
    await window.moduleAgent.cancelProjectAgent()
  } catch {}
  messages.value = []
}

</script>

<template>
  <el-dialog
    :model-value="visible"
    width="700px"
    :close-on-click-modal="false"
    :before-close="beforeClose"
    @update:model-value="emit('update:visible', $event)"
  >
    <template #header>
      <div class="pc-header">
        <span class="pc-header-title">项目对话 — {{ projectName }}</span>
        <div class="pc-header-actions">
          <el-button
            size="small"
            type="primary"
            :loading="generatingModules"
            @click="handleGenerateModules"
          >
            🤖 生成模块
          </el-button>
          <el-button
            size="small"
            type="danger"
            @click="handleStop"
          >
            停止
          </el-button>
        </div>
      </div>
    </template>
    <div class="project-chat-body">
      <div
        v-if="messages.length === 0"
        class="project-chat-empty"
      >
        <p>向项目级 Agent 发送消息，获取代码分析、重构建议等帮助。</p>
        <p>Agent 拥有对整个项目的完整访问权限。</p>
      </div>

      <div
        ref="messagesContainer"
        class="project-chat-messages"
      >
        <div
          v-for="msg in messages"
          :key="msg.id"
          class="pc-message"
          :class="[`pc-msg-${msg.role}`, `pc-status-${msg.status}`]"
        >
          <div class="pc-msg-meta">
            <span class="pc-msg-role">{{ msg.role === 'user' ? '你' : 'Agent' }}</span>
            <span class="pc-msg-time">{{ msg.time }}</span>
            <span v-if="msg.status === 'streaming'" class="pc-msg-streaming-dot" />
          </div>
          <div class="pc-msg-content">{{ msg.content }}</div>
        </div>
      </div>

      <div class="project-chat-input">
        <ChatInput
          module-name="__project__"
          :disabled="sendingLock"
          @send="handleSend"
        />
      </div>
    </div>

    <template #footer>
      <span />
    </template>
  </el-dialog>
</template>

<style scoped>
.pc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.pc-header-title {
  font-size: 16px;
  font-weight: 600;
}

.pc-header-actions {
  display: flex;
  gap: 8px;
}

.project-chat-body {
  display: flex;
  flex-direction: column;
  height: 500px;
  overflow: hidden;
}

.project-chat-empty {
  padding: 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
}

.project-chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 8px 4px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pc-message {
  display: flex;
  flex-direction: column;
  max-width: 85%;
}

.pc-msg-user {
  align-self: flex-end;
  align-items: flex-end;
}

.pc-msg-agent {
  align-self: flex-start;
  align-items: flex-start;
}

.pc-msg-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  margin-bottom: 4px;
}

.pc-msg-role {
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.pc-msg-time {
  color: var(--el-text-color-placeholder);
}

.pc-msg-streaming-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-primary);
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.pc-msg-content {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.pc-msg-user .pc-msg-content {
  background: var(--el-color-primary);
  color: var(--el-color-white);
}

.pc-msg-agent .pc-msg-content {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
  border: 1px solid var(--el-border-color-light);
}

.pc-status-error .pc-msg-content {
  color: var(--el-color-danger);
}

.project-chat-input {
  flex-shrink: 0;
  border-top: 1px solid var(--el-border-color);
  padding-top: 8px;
}
</style>
