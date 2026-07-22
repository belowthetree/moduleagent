<!--
  RolePanel.vue — 角色 Agent 面板
  显示角色 Agent 卡片列表，支持启动/停止/发送消息
-->

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Delete, Edit, Plus, User } from '@element-plus/icons-vue'
import { useAgentStore } from '../stores/agent'
import { useConfigStore } from '../stores/config'
import RoleConfigDialog from './RoleConfigDialog.vue'

const agentStore = useAgentStore()
const configStore = useConfigStore()

const emit = defineEmits<{
  select: [roleName: string]
}>()

const showConfigDialog = ref(false)
const editingRole = ref<import('../../../types/shared').RoleConfigData | null>(null)

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

function openEditDialog(role: import('../../../types/shared').RoleConfigData): void {
  editingRole.value = { ...role }
  showConfigDialog.value = true
}

async function onSaveRole(role: import('../../../types/shared').RoleConfigData): Promise<void> {
  await agentStore.saveRole(role)
  showConfigDialog.value = false
  editingRole.value = null
}

async function onDeleteRole(name: string): Promise<void> {
  await agentStore.deleteRole(name)
}

function selectRole(name: string): void {
  emit('select', name)
}
</script>

<template>
  <div class="role-panel">
    <div class="role-list-header">
      <span class="role-list-title">角色 Agent</span>
      <button class="btn-add" @click="openAddDialog">
        <el-icon><Plus /></el-icon>添加
      </button>
    </div>

    <div class="role-cards">
      <div
        v-for="role in agentStore.roles"
        :key="role.name"
        class="role-card"
        :class="{ active: agentStore.selectedRoleAgent === role.name }"
        @click="selectRole(role.name)"
      >
        <div class="role-card-header">
          <span class="role-card-name">{{ role.name }}</span>
          <div class="role-card-actions">
            <el-tooltip content="编辑" placement="top">
              <button class="btn-card-edit" aria-label="编辑" @click.stop="openEditDialog(role)">
                <el-icon><Edit /></el-icon>
              </button>
            </el-tooltip>
            <el-tooltip content="删除" placement="top">
              <button class="btn-card-delete" aria-label="删除" @click.stop="onDeleteRole(role.name)">
                <el-icon><Delete /></el-icon>
              </button>
            </el-tooltip>
          </div>
        </div>
        <div class="role-card-desc">{{ role.description || '无描述' }}</div>
        <div class="role-card-paths">
          {{ role.visibleModulePaths.length > 0 ? role.visibleModulePaths.join(', ') : '全部模块可见' }}
        </div>
        <div v-if="role.knowledgeRefs?.length" class="role-card-knowledge">
          知识: {{ role.knowledgeRefs.map(k => k.name).join(', ') }}
        </div>
      </div>

      <div v-if="agentStore.roles.length === 0" class="role-empty">
        <el-icon class="empty-icon"><User /></el-icon>
        <p>暂无角色 Agent</p>
        <p class="role-empty-hint">点击"添加"创建新的角色 Agent</p>
        <button class="btn-empty-add" @click="openAddDialog">
          <el-icon><Plus /></el-icon>添加角色
        </button>
      </div>
    </div>

    <!-- 配置对话框 -->
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
  font-weight: 600;
  color: var(--el-text-color-primary);
}

/* ── 主操作按钮：主色软背景，无重色块 ── */
.btn-add {
  display: inline-flex;
  align-items: center;
  gap: var(--app-space-1);
  padding: 5px 12px;
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: var(--app-radius-md);
  background: var(--app-accent-soft);
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--app-transition-fast), border-color var(--app-transition-fast);
}

.btn-add:hover {
  border-color: var(--el-color-primary);
}

.btn-add:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}

.role-cards {
  flex: 1;
  overflow-y: auto;
  padding: var(--app-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--app-space-2);
}

/* ── 条目卡片：圆角 + 1px 边框 + hover 微浮起 ── */
.role-card {
  padding: var(--app-space-3);
  border: 1px solid var(--el-border-color);
  border-radius: var(--app-radius-lg);
  background: var(--el-bg-color);
  cursor: pointer;
  transition: border-color var(--app-transition-fast), box-shadow var(--app-transition-fast), transform var(--app-transition-fast), background var(--app-transition-fast);
}

.role-card:hover {
  border-color: var(--el-border-color-dark);
  box-shadow: var(--app-shadow-1);
  transform: translateY(-1px);
}

.role-card.active {
  border-color: var(--el-color-primary);
  background: var(--app-accent-soft);
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
  gap: var(--app-space-1);
}

/* ── 卡片操作图标按钮 ── */
.btn-card-edit, .btn-card-delete {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--app-transition-fast), color var(--app-transition-fast);
}

.btn-card-edit:hover {
  background: var(--app-accent-soft);
  color: var(--el-color-primary);
}

.btn-card-delete:hover {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.btn-card-edit:focus-visible,
.btn-card-delete:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}

.role-card-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
  margin-bottom: var(--app-space-1);
}

.role-card-paths {
  font-size: 10px;
  color: var(--el-text-color-placeholder);
}

.role-card-knowledge {
  font-size: 10px;
  color: var(--el-color-primary);
  margin-top: 2px;
}

/* ── 空态：图标 + 文案 + 引导按钮 ── */
.role-empty {
  text-align: center;
  padding: 48px 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.empty-icon {
  font-size: 32px;
  color: var(--el-text-color-placeholder);
  margin-bottom: var(--app-space-3);
}

.role-empty p {
  margin: 0;
}

.role-empty-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-top: var(--app-space-1) !important;
}

.btn-empty-add {
  display: inline-flex;
  align-items: center;
  gap: var(--app-space-1);
  margin-top: var(--app-space-4);
  padding: 6px 14px;
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: var(--app-radius-md);
  background: var(--app-accent-soft);
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--app-transition-fast), border-color var(--app-transition-fast);
}

.btn-empty-add:hover {
  border-color: var(--el-color-primary);
}
</style>
