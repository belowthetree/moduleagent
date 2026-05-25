import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { TreeNode, LayoutNode, ScanResult } from '../types/preload'

const NODE_W = 180
const NODE_H = 50
const H_GAP = 80
const V_GAP = 16

export const useProjectStore = defineStore('project', () => {
  // ── 状态 ──
  const treeRoot = ref<TreeNode | null>(null)
  const flattenedNodes = ref<LayoutNode[]>([])
  const selectedNode = ref<TreeNode | null>(null)
  const moduleCount = ref(0)

  // ── 辅助方法 ──
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

  // ── 布局 ──
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

    const self: LayoutNode = { data: node, x, y, width: NODE_W, height: NODE_H, collapsed: false, subtreeHeight: sh, parentName: '' }
    flattenedNodes.value.push(self)
    return self
  }

  function layoutAndRender() {
    if (!treeRoot.value) return
    flattenedNodes.value = []
    layoutTree(treeRoot.value, 0, 0, true)
  }

  // ── 操作 ──
  async function scanProject(projectRoot: string, _workspaceRoot?: string): Promise<void> {
    const result: ScanResult = await window.moduleAgent.scanProject(projectRoot)
    if (result.error) throw new Error(result.error)
    moduleCount.value = result.moduleCount ?? 0
    await getTree()
  }

  async function getTree(): Promise<void> {
    const tree = await window.moduleAgent.getTree()
    treeRoot.value = tree
    if (tree) {
      layoutAndRender()
    }
  }

  function selectNode(node: TreeNode): void {
    selectedNode.value = node
  }

  function collapseNode(node: LayoutNode): void {
    node.collapsed = !node.collapsed
    layoutAndRender()
  }

  return {
    // 状态
    treeRoot,
    flattenedNodes,
    selectedNode,
    moduleCount,
    // 操作
    scanProject,
    getTree,
    selectNode,
    collapseNode,
    layoutAndRender,
    layoutTree,
    // 辅助方法
    findParentName,
    isCollapsedAncestor,
  }
})
