<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAgentStore } from '../stores/agent'
import { useConfigStore } from '../stores/config'
import ContextCards from './ContextCards.vue'
import ChatInput from './ChatInput.vue'
import RoleConfigDialog from './RoleConfigDialog.vue'

const agentStore = useAgentStore()
const configStore = useConfigStore()

const showConfigDialog = ref(false)
const editingRole = ref<import('../../../types/preload').RoleConfigData | null>(null)

const selectedRole = computed(() => {
  if (!agentStore.selectedRoleAgent) return null
  return agentStore.roles.find(r => r.name === agentStore.selectedRoleAgent) || null
})

onMounted(() => {
  agentStore.fetchRoles()
  agentStore.ensureRoleStatusListener()
})

function openAddDialog(): void {
  editingRole.value = {
    name: '',
    description: '',
    visibleModulePaths: [],
    agents: {
      default: {
        command: configStore.agentCmd || 'opencode',
        args: configStore.agentArgs ? [configStore.agentArgs] : ['acp'],
      },
    },
  }
  showConfigDialog.value = true
}

function openEditDialog(role: import('../../../types/preload').RoleConfigData): void {
  editingRole.value = { ...role }
  showConfigDialog.value = true
}

async function onSaveRole(role: import('../../../types/preload').RoleConfigData): Promise<void> {
  await agentStore.saveRole(role)
  showConfigDialog.value = false
  editingRole.value = null
}

async function onDeleteRole(name: string): Promise<void> {
  await agentStore.deleteRole(name)
}

function selectRole(name: string): void {
  agentStore.selectRoleAgentAndStart(name)
}

function deselectRole(): void {
  agentStore.selectedRoleAgent = null
}

async function handleSendMessage(text: string): Promise<void> {
  if (!agentStore.selectedRoleAgent) return
  await agentStore.sendRoleMessage(agentStore.selectedRoleAgent, text)
}
</script>

<template>
  <div class="role-panel">
    <!-- Role detail view -->
    <template v-if="selectedRole">
      <div class="role-detail-header">
        <button class="btn-back" @click="deselectRole">← 返回</button>
        <span class="role-detail-name">{{ selectedRole.name }}</span>
        <button class="btn-edit" @click="openEditDialog(selectedRole)">✎</button>
      </div>

      <div class="role-detail-body">
        <div class="role-info">
          <div class="role-desc">{{ selectedRole.description || '无描述' }}</div>
          <div class="role-paths">
            <span class="paths-label">可见模块:</span>
            <span class="paths-value">{{ selectedRole.visibleModulePaths.join(', ') || '(全部)' }}</span>
          </div>
          <div class="role-cmd">
            Agent: {{ selectedRole.agents.default.command }} {{ (selectedRole.agents.default.args || []).join(' ') }}
          </div>
        </div>

        <div class="role-ctx-area">
          <ContextCards v-if="agentStore.selectedRoleAgent" :module-name="agentStore.selectedRoleAgent" context-type="role" />
        </div>

        <div class="role-chat">
          <ChatInput
            v-if="agentStore.selectedRoleAgent"
            :module-name="agentStore.selectedRoleAgent"
            @send="handleSendMessage"
          />
        </div>
      </div>
    </template>

    <!-- Role list view -->
    <template v-else>
      <div class="role-list-header">
        <span class="role-list-title">角色 Agent</span>
        <button class="btn-add" @click="openAddDialog">+ 添加</button>
      </div>

      <div class="role-cards">
        <div
          v-for="role in agentStore.roles"
          :key="role.name"
          class="role-card"
          @click="selectRole(role.name)"
        >
          <div class="role-card-header">
            <span class="role-card-name">{{ role.name }}</span>
            <div class="role-card-actions">
              <button class="btn-card-edit" @click.stop="openEditDialog(role)">✎</button>
              <button class="btn-card-delete" @click.stop="onDeleteRole(role.name)">✕</button>
            </div>
          </div>
          <div class="role-card-desc">{{ role.description || '无描述' }}</div>
          <div class="role-card-paths">
            {{ role.visibleModulePaths.length > 0 ? role.visibleModulePaths.join(', ') : '全部模块可见' }}
          </div>
        </div>

        <div v-if="agentStore.roles.length === 0" class="role-empty">
          <p>暂无角色 Agent</p>
          <p class="role-empty-hint">点击"添加"创建新的角色 Agent</p>
        </div>
      </div>
    </template>

    <!-- Config dialog -->
    <RoleConfigDialog
      v-if="showConfigDialog && editingRole"
      :visible="showConfigDialog"
      :role="editingRole"
      @close="showConfigDialog = false; editingRole = null"
      @save="onSaveRole"
    />
  </div>
</template>

<style scoped>
.role-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ── Detail view ── */
.role-detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.role-detail-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--el-color-primary);
  flex: 1;
}

.btn-back, .btn-edit {
  width: 32px;
  height: 28px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.btn-back {
  width: auto;
  padding: 0 8px;
  font-size: 12px;
}

.btn-back:hover, .btn-edit:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.role-detail-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 16px;
}

.role-info {
  flex-shrink: 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color);
}

.role-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
}

.role-paths {
  font-size: 11px;
  margin-bottom: 4px;
}

.paths-label {
  color: var(--el-text-color-secondary);
  font-weight: 600;
}

.paths-value {
  color: var(--el-text-color-primary);
}

.role-cmd {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.role-ctx-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-bottom: 12px;
}

.role-chat {
  display: flex;
  gap: 6px;
  padding: 12px 0 0;
  border-top: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

/* ── List view ── */
.role-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.role-list-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.btn-add {
  padding: 4px 12px;
  border: 1px solid var(--el-color-primary);
  border-radius: 6px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-add:hover {
  opacity: 0.85;
}

.role-cards {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.role-card {
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.role-card:hover {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.role-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.role-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.role-card-actions {
  display: flex;
  gap: 4px;
}

.btn-card-edit, .btn-card-delete {
  width: 24px;
  height: 24px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-card-edit:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}

.btn-card-delete:hover {
  color: var(--el-color-danger);
  border-color: var(--el-color-danger);
}

.role-card-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.role-card-paths {
  font-size: 10px;
  color: var(--el-text-color-placeholder);
}

.role-empty {
  text-align: center;
  padding: 40px 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.role-empty-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-top: 4px;
}
</style>
