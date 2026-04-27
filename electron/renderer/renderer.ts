interface ModuleAgentApi {
  selectDir(title: string): Promise<string | null>;
  scanProject(projectRoot: string, workspaceRoot: string): Promise<ScanResult>;
  getTree(): Promise<TreeNode | null>;
}

interface ModuleSource { type: string; url?: string; branch?: string; path?: string; }
interface TreeNode {
  name: string; path: string; description: string;
  source: ModuleSource | null; children: TreeNode[];
}
interface ScanResult { root?: string; moduleCount?: number; error?: string; }
interface LayoutNode {
  data: TreeNode;
  x: number; y: number;
  width: number; height: number;
  collapsed: boolean;
  subtreeHeight: number;
}

declare global { interface Window { moduleAgent: ModuleAgentApi; } }

const NODE_W = 180;
const NODE_H = 50;
const H_GAP = 80;
const V_GAP = 16;

let treeRoot: TreeNode | null = null;
let flattenedNodes: LayoutNode[] = [];
let selectedNode: TreeNode | null = null;
let workspacePath = '';
let projectPath = '';

// Pan state
let panX = 0;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartTX = 0;
let panStartTY = 0;
let scale = 1;

function $id(id: string): HTMLElement { return document.getElementById(id)!; }

function show(el: HTMLElement) { el.style.display = ''; }
function hide(el: HTMLElement) { el.style.display = 'none'; }
function setInput(id: string, value: string) { ($id(id) as HTMLInputElement).value = value; }
function getInput(id: string): string { return ($id(id) as HTMLInputElement).value.trim(); }

function checkStartReady() {
  ($id('btn-start') as HTMLButtonElement).disabled = !getInput('workspace-input') || !getInput('project-input');
}

// ── Pan & Zoom ──

function initPan() {
  const panel = $id('tree-panel');

  panel.addEventListener('contextmenu', (e) => e.preventDefault());

  panel.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartTX = panX;
    panStartTY = panY;
    panel.classList.add('panning');
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panX = panStartTX + (e.clientX - panStartX);
    panY = panStartTY + (e.clientY - panStartY);
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      $id('tree-panel').classList.remove('panning');
    }
  });

  panel.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(2.5, Math.max(0.3, scale * delta));
    const mx = e.clientX - panel.getBoundingClientRect().left;
    const my = e.clientY - panel.getBoundingClientRect().top;
    panX = mx - (mx - panX) * (newScale / scale);
    panY = my - (my - panY) * (newScale / scale);
    scale = newScale;
    applyTransform();
  });
}

function applyTransform() {
  const svg = document.getElementById('tree-svg') as unknown as SVGGraphicsElement;
  if (svg) {
    svg.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    svg.style.transformOrigin = '0 0';
  }
}

function resetView() {
  panX = 20;
  panY = 20;
  scale = 1;
  applyTransform();
}

// ── Drawer ──

function openDrawer(node: TreeNode) {
  selectedNode = node;
  $id('drawer-title').textContent = node.name;
  $id('drawer-body').innerHTML = buildDetailHtml(node);
  $id('drawer').classList.add('open');
  $id('drawer-overlay').classList.add('open');
  $id('drawer-overlay').style.display = '';
  layoutAndRender();
}

function closeDrawer() {
  selectedNode = null;
  $id('drawer').classList.remove('open');
  $id('drawer-overlay').classList.remove('open');
  setTimeout(() => { $id('drawer-overlay').style.display = 'none'; }, 300);
  layoutAndRender();
}

function buildDetailHtml(node: TreeNode): string {
  const src = node.source
    ? (node.source.type === 'git'
        ? `Git: ${node.source.url || '?'}${node.source.branch ? '@' + node.source.branch : ''}`
        : `Local: ${node.source.path || node.path}`)
    : '无';

  return `
    <p class="desc">${node.description || '无描述'}</p>
    <div class="info-row"><span class="lbl">路径</span><span class="val">${node.path}</span></div>
    <div class="info-row"><span class="lbl">来源</span><span class="val">${src}</span></div>
    <div class="info-row"><span class="lbl">子模块</span><span class="val">${node.children.length} 个</span></div>
  `;
}

// ── Setup ──

async function selectWorkspace() {
  const dir = await window.moduleAgent.selectDir('选择工作目录');
  if (!dir) return;
  workspacePath = dir;
  setInput('workspace-input', dir);
  checkStartReady();
  localStorage.setItem('lastWorkspace', dir);
}

async function selectProject() {
  const dir = await window.moduleAgent.selectDir('选择模块目录');
  if (!dir) return;
  projectPath = dir;
  setInput('project-input', dir);
  checkStartReady();
  localStorage.setItem('lastProject', dir);
}

async function startScan() {
  if (!workspacePath || !projectPath) return;
  const errEl = $id('setup-error');
  errEl.style.display = 'none';
  try {
    const result = await window.moduleAgent.scanProject(projectPath, workspacePath);
    if (result.error) { errEl.textContent = '扫描失败: ' + result.error; errEl.style.display = ''; return; }
    hide($id('setup-screen'));
    show($id('main-screen'));
    $id('project-name').textContent = projectPath.split(/[/\\]/).pop() || projectPath;
    $id('module-count').textContent = (result.moduleCount ?? 0) + ' 个模块';
    $id('status-path').textContent = '工作区: ' + workspacePath;
    $id('status-text').textContent = '就绪';
    treeRoot = await window.moduleAgent.getTree();
    if (treeRoot) layoutAndRender();
    localStorage.setItem('lastWorkspace', workspacePath);
    localStorage.setItem('lastProject', projectPath);
  } catch (err) { errEl.textContent = '错误: ' + (err as Error).message; errEl.style.display = ''; }
}

function goBack() {
  hide($id('main-screen'));
  show($id('setup-screen'));
  treeRoot = null; flattenedNodes = []; selectedNode = null;
  checkStartReady();
}

// ── Tree layout & render ──

function layoutAndRender() {
  if (!treeRoot) return;
  flattenedNodes = [];
  layoutTree(treeRoot, 0, 0, true);
  renderSvg();
  resetView();
}

function layoutTree(node: TreeNode, depth: number, startY: number, isRoot: boolean): LayoutNode {
  const childrenLayouts: LayoutNode[] = [];
  let runningY = startY;
  for (const child of node.children) {
    const cl = layoutTree(child, depth + 1, runningY + V_GAP, false);
    childrenLayouts.push(cl);
    runningY += V_GAP;
  }
  let subtreeHeight: number;
  if (node.children.length === 0) subtreeHeight = NODE_H;
  else {
    let total = 0;
    for (const c of childrenLayouts) total += c.subtreeHeight + V_GAP;
    subtreeHeight = total - V_GAP;
  }
  const x = 0 + depth * (NODE_W + H_GAP);
  const y = isRoot ? 0 : startY + (subtreeHeight - NODE_H) / 2;
  let currentY = y + NODE_H + V_GAP;
  for (const c of childrenLayouts) { c.y = currentY; currentY += c.subtreeHeight + V_GAP; }
  const self: LayoutNode = { data: node, x, y, width: NODE_W, height: NODE_H, collapsed: false, subtreeHeight };
  flattenedNodes.push(self);
  for (const c of childrenLayouts) flattenedNodes.push(c);
  return self;
}

function renderSvg() {
  if (!treeRoot) { ($id('status-text')!).textContent = '错误: treeRoot 为空'; return; }
  const rootLayout = flattenedNodes.find((n) => n.data.name === treeRoot!.name);
  if (!rootLayout) { ($id('status-text')!).textContent = '错误: rootLayout 未找到'; return; }
  const svg = document.getElementById('tree-svg') as unknown as SVGSVGElement;
  if (!svg) { ($id('status-text')!).textContent = '错误: SVG 元素未找到'; return; }
  svg.innerHTML = '';

  const visible = flattenedNodes.filter((n) => !isCollapsedAncestor(n));
  const totalW = Math.max(...visible.map((n) => n.x)) + NODE_W + 20;
  const totalH = rootLayout.subtreeHeight + 20;

  svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
  svg.setAttribute('width', `${totalW}`);
  svg.setAttribute('height', `${totalH}`);
  svg.style.width = totalW + 'px';
  svg.style.height = totalH + 'px';
  svg.style.minWidth = totalW + 'px';
  svg.style.minHeight = totalH + 'px';
  svg.style.background = '#1a1b26';

  // edges
  for (const node of visible) {
    if (node.data.name === treeRoot.name) continue;
    const pName = findParentName(node.data);
    if (!pName) continue;
    const parent = flattenedNodes.find((n) => n.data.name === pName);
    if (!parent || isCollapsedAncestor(parent)) continue;
    const edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const x1 = parent.x + NODE_W;
    const y1 = parent.y + NODE_H / 2;
    const x2 = node.x;
    const y2 = node.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    edge.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
    edge.setAttribute('class', 'edge-line');
    svg.appendChild(edge);
  }

  // nodes
  for (const node of visible) {
    if (isCollapsedAncestor(node)) continue;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.style.cursor = 'pointer';

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', `${node.x}`);
    rect.setAttribute('y', `${node.y}`);
    rect.setAttribute('width', `${NODE_W}`);
    rect.setAttribute('height', `${NODE_H}`);
    const isActive = selectedNode?.name === node.data.name;
    rect.setAttribute('class', isActive ? 'node-rect active' : 'node-rect');

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', `${node.x + 10}`);
    txt.setAttribute('y', `${node.y + 20}`);
    txt.setAttribute('class', 'node-text');
    txt.textContent = node.data.name;

    const sub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    sub.setAttribute('x', `${node.x + 10}`);
    sub.setAttribute('y', `${node.y + 36}`);
    sub.setAttribute('class', 'node-subtext');
    sub.textContent = node.data.children.length > 0
      ? `${node.data.children.length} 子模块`
      : (node.data.description || '').slice(0, 15);

    g.appendChild(rect);
    g.appendChild(txt);
    g.appendChild(sub);

    // expand/collapse button
    if (node.data.children.length > 0) {
      const cx = node.x + NODE_W - 12;
      const cy = node.y + NODE_H - 12;
      const btn = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      btn.setAttribute('cx', `${cx}`);
      btn.setAttribute('cy', `${cy}`);
      btn.setAttribute('r', '7');
      btn.setAttribute('class', 'expand-btn');
      const btxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      btxt.setAttribute('x', `${cx - 3}`);
      btxt.setAttribute('y', `${cy + 3}`);
      btxt.setAttribute('fill', '#1a1b26');
      btxt.setAttribute('font-size', '10');
      btxt.setAttribute('font-weight', 'bold');
      btxt.setAttribute('pointer-events', 'none');
      btxt.textContent = node.collapsed ? '+' : '\u2212';
      g.appendChild(btn);
      g.appendChild(btxt);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        node.collapsed = !node.collapsed;
        layoutAndRender();
      });
    }

    // click → open drawer
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      openDrawer(node.data);
    });

    svg.appendChild(g);
  }

  ($id('status-text')!).textContent = `已渲染 ${visible.length} 个节点 (${totalW}x${totalH})`;
}

function findParentName(node: TreeNode): string | null {
  for (const n of flattenedNodes) {
    if (n.data.children.some((c) => c.name === node.name)) return n.data.name;
  }
  return null;
}

function isCollapsedAncestor(node?: LayoutNode): boolean {
  if (!node) return false;
  const pName = findParentName(node.data);
  if (!pName) return false;
  const parent = flattenedNodes.find((n) => n.data.name === pName);
  if (!parent) return false;
  if (parent.collapsed) return true;
  return isCollapsedAncestor(parent);
}

// ── Init ──

function init() {
  $id('btn-workspace').addEventListener('click', selectWorkspace);
  $id('btn-project').addEventListener('click', selectProject);
  $id('btn-start').addEventListener('click', startScan);
  $id('btn-back').addEventListener('click', goBack);
  $id('btn-refresh').addEventListener('click', () => { if (treeRoot) layoutAndRender(); });
  $id('drawer-close').addEventListener('click', closeDrawer);
  $id('drawer-overlay').addEventListener('click', closeDrawer);
  initPan();

  const lastWs = localStorage.getItem('lastWorkspace');
  const lastPj = localStorage.getItem('lastProject');
  if (lastWs) { workspacePath = lastWs; setInput('workspace-input', lastWs); }
  if (lastPj) { projectPath = lastPj; setInput('project-input', lastPj); }
  checkStartReady();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
