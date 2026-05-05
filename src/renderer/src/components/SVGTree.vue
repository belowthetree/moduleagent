<template>
  <div
    ref="panelRef"
    class="tree-panel"
    @contextmenu.prevent
    @mousedown="onMouseDown"
    @wheel.prevent="onWheel"
  >
    <svg
      v-if="root"
      ref="svgRef"
      class="tree-svg"
      :viewBox="viewBox"
      :width="svgWidth"
      :height="svgHeight"
      :style="svgStyle"
    >
      <!-- Edge lines -->
      <path
        v-for="edge in edgePaths"
        :key="edge.key"
        :d="edge.path"
        class="edge-line"
      />

      <!-- Node groups -->
      <g
        v-for="node in visibleNodes"
        :key="node.data.name"
        style="cursor: pointer"
        @click.stop="onNodeClick(node)"
      >
        <rect
          :x="node.x"
          :y="node.y"
          :width="NODE_W"
          :height="NODE_H"
          :class="rectClasses(node)"
        />
        <text
          :x="node.x + 10"
          :y="node.y + 20"
          class="node-text"
        >{{ node.data.name }}</text>
        <text
          :x="node.x + 10"
          :y="node.y + 36"
          class="node-subtext"
        >{{ subText(node) }}</text>

        <!-- Agent status dot -->
        <circle
          v-if="agentState(node)"
          :cx="node.x + NODE_W - 10"
          :cy="node.y + 10"
          r="5"
          :class="['node-status-dot', 'dot-' + agentState(node)]"
        />

        <!-- Collapse/expand button -->
        <template v-if="node.data.children.length > 0">
          <circle
            :cx="node.x + NODE_W - 12"
            :cy="node.y + NODE_H - 12"
            r="7"
            class="expand-btn"
            @click.stop="onCollapseClick(node)"
          />
          <text
            :x="node.x + NODE_W - 15"
            :y="node.y + NODE_H - 9"
            fill="#1a1b26"
            font-size="10"
            font-weight="bold"
            pointer-events="none"
          >{{ node.collapsed ? '+' : '\u2212' }}</text>
        </template>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { TreeNode, LayoutNode, AgentStatus } from '../../../types/preload'

// ── Props ──
const props = defineProps<{
  root: TreeNode | null
  selectedNode: TreeNode | null
  runningAgents: Map<string, AgentStatus>
}>()

// ── Emits ──
const emit = defineEmits<{
  select: [node: TreeNode]
  collapse: [node: LayoutNode]
}>()

// ── Constants ──
const NODE_W = 180
const NODE_H = 50
const H_GAP = 80
const V_GAP = 16

// ── Refs ──
const svgRef = ref<SVGSVGElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

// ── Layout state ──
const flattenedNodes = ref<LayoutNode[]>([])
const collapsedRef = ref<Record<string, boolean>>({})

// ── Pan/zoom state ──
const panX = ref(20)
const panY = ref(20)
const scale = ref(1)
const isPanning = ref(false)
const panStartX = ref(0)
const panStartY = ref(0)
const panStartTX = ref(0)
const panStartTY = ref(0)

// ── Helpers ──
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function findParentName(node: TreeNode): string | null {
  for (const n of flattenedNodes.value) {
    if (n.data.children.some(c => c.name === node.name)) return n.data.name
  }
  return null
}

function isCollapsedAncestor(node?: LayoutNode): boolean {
  if (!node) return false
  const pn = findParentName(node.data)
  if (!pn) return false
  const p = flattenedNodes.value.find(n => n.data.name === pn)
  return !p ? false : p.collapsed ? true : isCollapsedAncestor(p)
}

// ── Layout algorithm (exact migration from renderer.ts:904-922) ──
function layoutTree(node: TreeNode, depth: number, stY: number, _isRoot: boolean): LayoutNode {
  const x = depth * (NODE_W + H_GAP)
  const y = stY
  let childY = y + NODE_H + V_GAP
  const kids: LayoutNode[] = []

  for (const c of node.children) {
    const cl = layoutTree(c, depth + 1, childY, false)
    kids.push(cl)
    childY += cl.subtreeHeight + V_GAP
  }

  const sh = node.children.length === 0
    ? NODE_H
    : childY - y - V_GAP

  const self: LayoutNode = {
    data: node, x, y, width: NODE_W, height: NODE_H,
    collapsed: !!collapsedRef.value[node.name],
    subtreeHeight: sh,
  }
  flattenedNodes.value.push(self)
  return self
}

function computeLayout() {
  if (!props.root) return
  flattenedNodes.value = []
  layoutTree(props.root, 0, 0, true)
}

// ── Computed ──
const visibleNodes = computed(() => {
  return flattenedNodes.value.filter(n => !isCollapsedAncestor(n))
})

const svgWidth = computed(() => {
  const vis = visibleNodes.value
  if (vis.length === 0) return 0
  return Math.max(...vis.map(n => n.x)) + NODE_W + 20
})

const svgHeight = computed(() => {
  const rl = flattenedNodes.value.find(n => n.data.name === props.root?.name)
  if (!rl) return 0
  return rl.subtreeHeight + 20
})

const viewBox = computed(() => `0 0 ${svgWidth.value} ${svgHeight.value}`)

const svgStyle = computed(() => ({
  width: svgWidth.value + 'px',
  height: svgHeight.value + 'px',
  minWidth: svgWidth.value + 'px',
  minHeight: svgHeight.value + 'px',
  background: '#1a1b26',
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${scale.value})`,
  transformOrigin: '0 0',
}))

const edgePaths = computed(() => {
  const paths: { key: string; path: string }[] = []
  const vis = visibleNodes.value
  const nameSet = new Set(vis.map(n => n.data.name))

  for (const n of vis) {
    if (n.data.name === props.root?.name) continue
    const pn = findParentName(n.data)
    if (!pn || !nameSet.has(pn)) continue
    const p = flattenedNodes.value.find(x => x.data.name === pn)
    if (!p || !nameSet.has(p.data.name)) continue
    const d = `M${p.x + NODE_W},${p.y + NODE_H / 2} C${(p.x + NODE_W + n.x) / 2},${p.y + NODE_H / 2} ${(p.x + NODE_W + n.x) / 2},${n.y + NODE_H / 2} ${n.x},${n.y + NODE_H / 2}`
    paths.push({ key: sanitizeName(pn) + '->' + sanitizeName(n.data.name), path: d })
  }
  return paths
})

// ── Node helpers ──
function agentState(node: LayoutNode): string | undefined {
  return props.runningAgents.get(node.data.name)
}

function rectClasses(node: LayoutNode): string[] {
  const cls = ['node-rect']
  if (props.selectedNode?.name === node.data.name) cls.push('active')
  const state = agentState(node)
  if (state) cls.push('agent-' + state)
  return cls
}

function subText(node: LayoutNode): string {
  return node.data.children.length > 0
    ? `${node.data.children.length} 子模块`
    : (node.data.description || '').slice(0, 15)
}

// ── Event handlers ──
function onNodeClick(node: LayoutNode) {
  emit('select', node.data)
}

function onCollapseClick(node: LayoutNode) {
  collapsedRef.value = { ...collapsedRef.value, [node.data.name]: !collapsedRef.value[node.data.name] }
  computeLayout()
  emit('collapse', node)
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 1) return
  e.preventDefault()
  isPanning.value = true
  panStartX.value = e.clientX
  panStartY.value = e.clientY
  panStartTX.value = panX.value
  panStartTY.value = panY.value
}

function onMouseMove(e: MouseEvent) {
  if (!isPanning.value) return
  panX.value = panStartTX.value + (e.clientX - panStartX.value)
  panY.value = panStartTY.value + (e.clientY - panStartY.value)
}

function onMouseUp() {
  isPanning.value = false
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const d = e.deltaY > 0 ? 0.9 : 1.1
  const ns = Math.min(2.5, Math.max(0.3, scale.value * d))
  const panel = panelRef.value
  if (!panel) return
  const r = panel.getBoundingClientRect()
  panX.value = (e.clientX - r.left) - ((e.clientX - r.left) - panX.value) * (ns / scale.value)
  panY.value = (e.clientY - r.top) - ((e.clientY - r.top) - panY.value) * (ns / scale.value)
  scale.value = ns
}

// ── Lifecycle ──
onMounted(() => {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})

// ── Watch root for re-layout ──
watch(() => props.root, () => {
  computeLayout()
  panX.value = 20
  panY.value = 20
  scale.value = 1
}, { immediate: true })
</script>

<style scoped>
/* ── SVG tree styling (exact migration from style.css:475-502) ── */
.tree-panel {
  overflow: hidden;
  position: relative;
  background: var(--el-bg-color-page);
}

.tree-svg {
  display: block;
}

.node-rect {
  fill: var(--el-fill-color-blank);
  stroke: var(--el-border-color);
  stroke-width: 1.5;
  rx: 8;
  cursor: pointer;
}
.node-rect:hover {
  fill: var(--el-fill-color-light);
  stroke: var(--el-color-primary);
}
.node-rect.active {
  fill: var(--el-color-primary-light-5);
  stroke: var(--el-color-primary-light-3);
  stroke-width: 2;
}
.node-rect.agent-idle {
  stroke: var(--el-color-primary);
  stroke-width: 2;
  filter: drop-shadow(0 0 4px rgba(122, 162, 247, 0.3));
}
.node-rect.agent-streaming {
  stroke: var(--el-color-success);
  stroke-width: 2;
  filter: drop-shadow(0 0 8px rgba(158, 206, 106, 0.5));
}
.node-rect.agent-error {
  stroke: var(--el-color-danger);
  stroke-width: 2;
  filter: drop-shadow(0 0 4px rgba(247, 118, 142, 0.4));
}

.node-status-dot {
}
.dot-idle {
  fill: var(--el-color-primary);
}
.dot-streaming {
  fill: var(--el-color-success);
  animation: pulse-dot 0.8s ease-in-out infinite;
}
.dot-error {
  fill: var(--el-color-danger);
}

@keyframes pulse-dot {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.node-text {
  font-size: 12px;
  font-weight: 600;
  fill: var(--el-text-color-primary);
  pointer-events: none;
  font-family: inherit;
}

.node-subtext {
  font-size: 10px;
  fill: var(--el-text-color-secondary);
  pointer-events: none;
  font-family: inherit;
}

.edge-line {
  stroke: var(--el-border-color);
  stroke-width: 1.5;
  fill: none;
  opacity: 0.6;
}

.expand-btn {
  fill: var(--el-color-primary);
  cursor: pointer;
}
.expand-btn:hover {
  fill: var(--el-color-primary-light-3);
}
</style>
