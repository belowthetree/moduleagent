interface ModuleAgentApi {
  selectDir(title: string): Promise<string | null>;
  scanProject(projectRoot: string, workspaceRoot: string): Promise<ScanResult>;
  getTree(): Promise<TreeNode | null>;
  startAgent(moduleName: string, cmd: string, args: string[], cwd: string): Promise<{ sessionId?: string; error?: string }>;
  sendMessage(moduleName: string, text: string): Promise<{ stopReason?: string; error?: string }>;
  cancelAgent(moduleName: string): Promise<{}>;
  stopAgent(moduleName: string): Promise<{}>;
  isAgentRunning(moduleName: string): Promise<boolean>;
  getRunningAgents(): Promise<{ name: string; status: 'idle' | 'streaming' | 'error' }[]>;
  onAgentStream(callback: (data: { moduleName: string; update: string; data: Record<string, unknown> }) => void): () => void;
  saveAgentConfig(projectRoot: string, cmd: string, args: string[], codeSource?: { type: 'git' | 'local'; url?: string; branch?: string; path?: string }, modulesPath?: string): Promise<{ success: boolean }>;
  getAgentConfig(projectRoot: string): Promise<{ command: string; args: string[]; codeSource?: { type: 'git' | 'local'; url?: string; branch?: string; path?: string }; modulesPath?: string }>;
  onCrossContext(callback: (data: { moduleName: string; crossModule: string; direction: 'sent' | 'received'; phase: 'request' | 'response'; content: string; time: string }) => void): () => void;
}

interface TreeNode { name: string; path: string; description: string; children: TreeNode[]; }
interface ScanResult { root?: string; moduleCount?: number; error?: string; }
interface LayoutNode { data: TreeNode; x: number; y: number; width: number; height: number; collapsed: boolean; subtreeHeight: number; }
interface ChatMsg { id: string; role: 'user' | 'agent' | 'cross'; content: string; thinking: string; tools: string; time: string; status: 'sent' | 'pending' | 'thinking' | 'executing' | 'completed' | 'error' | 'interrupted'; moduleName: string; agentCmd: string; crossDirection?: 'sent' | 'received'; crossModule?: string; }

declare global { interface Window { moduleAgent: ModuleAgentApi; } }

const NODE_W = 180; const NODE_H = 50; const H_GAP = 80; const V_GAP = 16;
const CTX_PAGE = 5;

let treeRoot: TreeNode | null = null;
let flattenedNodes: LayoutNode[] = [];
let selectedNode: TreeNode | null = null;
let workspacePath = ''; let projectPath = ''; let agentCmd = 'opencode'; let agentArgs = 'acp';
let codeSourceType: 'git' | 'local' = 'local'; let codeSourcePath = ''; let codeSourceUrl = ''; let codeSourceBranch = '';
let panX = 0; let panY = 0; let isPanning = false;
let panStartX = 0; let panStartY = 0; let panStartTX = 0; let panStartTY = 0; let scale = 1;
let drawerWidth = 420;

const contextMap = new Map<string, ChatMsg[]>();
let ctxPage = new Map<string, number>();
let runningAgents = new Map<string, 'idle' | 'streaming' | 'error'>();
let runningPollTimer: ReturnType<typeof setInterval> | null = null;

async function refreshRunningAgents() {
  try {
    runningAgents.clear();
    const list = await window.moduleAgent.getRunningAgents();
    for (const item of list) runningAgents.set(item.name, item.status);
  } catch {}
  if (treeRoot) renderSvg();
}

function startRunningPoll() {
  if (runningPollTimer) return;
  refreshRunningAgents();
  runningPollTimer = setInterval(refreshRunningAgents, 3000);
}

function stopRunningPoll() {
  if (runningPollTimer) { clearInterval(runningPollTimer); runningPollTimer = null; }
  runningAgents.clear();
}

function $id(id: string): HTMLElement { return document.getElementById(id)!; }
function show(el: HTMLElement) { el.style.display = ''; }
function hide(el: HTMLElement) { el.style.display = 'none'; }
function setInput(id: string, v: string) { ($id(id) as HTMLInputElement).value = v; }
function getInput(id: string): string { return ($id(id) as HTMLInputElement).value.trim(); }
function now(): string { return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

function checkStartReady() {
  ($id('btn-start') as HTMLButtonElement).disabled = !getInput('workspace-input') || !getInput('project-input');
}

function getMsgs(name: string): ChatMsg[] { if (!contextMap.has(name)) contextMap.set(name, []); return contextMap.get(name)!; }
function getPage(name: string): number { return ctxPage.get(name) ?? 0; }
function setPage(name: string, p: number) { ctxPage.set(name, p); }

// ── Settings ──
function openSettings() {
  const modal = $id('modal-overlay');
  $id('modal-title').textContent = '设置';
  $id('modal-body').innerHTML = `
    <div class="settings-grid">
      <div class="sfield">
        <label>Agent 命令</label>
        <div class="shint">启动 Agent 的可执行文件名或路径</div>
        <input id="s-agent-cmd" value="${escapeHtml(agentCmd)}">
      </div>
      <div class="sfield">
        <label>Agent 参数</label>
        <div class="shint">传给 Agent 的额外参数（空格分隔，如: acp）</div>
        <input id="s-agent-args" value="${escapeHtml(agentArgs)}">
      </div>
      <div class="sfield">
        <label>工作目录</label>
        <div class="shint">Agent 的工作空间</div>
        <div class="input-row">
          <input id="s-workspace" value="${escapeHtml(workspacePath)}" placeholder="输入或点击浏览...">
          <button class="btn" id="s-btn-ws">浏览</button>
        </div>
      </div>
      <div class="sfield">
        <label>模块目录</label>
        <div class="shint">包含 module.md 的项目根目录</div>
        <div class="input-row">
          <input id="s-project" value="${escapeHtml(projectPath)}" placeholder="输入或点击浏览...">
          <button class="btn" id="s-btn-pj">浏览</button>
        </div>
      </div>
      <div class="sfield">
        <label>代码来源类型</label>
        <div class="shint">模块代码的来源：本地目录或 Git 仓库</div>
        <select id="s-code-src-type">
          <option value="local" ${codeSourceType === 'local' ? 'selected' : ''}>本地目录</option>
          <option value="git" ${codeSourceType === 'git' ? 'selected' : ''}>Git 仓库</option>
        </select>
      </div>
      <div class="sfield" id="s-code-local-group">
        <label>本地代码路径</label>
        <div class="shint">代码所在的本地根目录，模块按相对路径从中映射</div>
        <div class="input-row">
          <input id="s-code-path" value="${escapeHtml(codeSourcePath)}" placeholder="输入或点击浏览...">
          <button class="btn" id="s-btn-code-path">浏览</button>
        </div>
      </div>
      <div class="sfield" id="s-code-git-group" style="${codeSourceType === 'git' ? '' : 'display:none'}">
        <label>Git 仓库地址</label>
        <div class="shint">远程 Git 仓库 URL</div>
        <input id="s-code-url" value="${escapeHtml(codeSourceUrl)}" placeholder="https://github.com/user/repo.git">
      </div>
      <div class="sfield" id="s-code-branch-group" style="${codeSourceType === 'git' ? '' : 'display:none'}">
        <label>Git 分支</label>
        <div class="shint">要使用的分支名（默认: main）</div>
        <input id="s-code-branch" value="${escapeHtml(codeSourceBranch)}" placeholder="main">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
        <button class="btn" id="s-btn-cancel">取消</button>
        <button class="btn btn-primary" id="s-btn-save">保存</button>
      </div>
    </div>
  `;
  show(modal);

  document.getElementById('s-btn-ws')!.addEventListener('click', async () => {
    const d = await window.moduleAgent.selectDir('选择工作目录'); if (!d) return;
    setInput('s-workspace', d);
  });
  document.getElementById('s-btn-pj')!.addEventListener('click', async () => {
    const d = await window.moduleAgent.selectDir('选择模块目录'); if (!d) return;
    setInput('s-project', d);
  });
  document.getElementById('s-btn-code-path')!.addEventListener('click', async () => {
    const d = await window.moduleAgent.selectDir('选择代码根目录'); if (!d) return;
    setInput('s-code-path', d);
  });
  document.getElementById('s-code-src-type')!.addEventListener('change', () => {
    const v = getInput('s-code-src-type') as 'git' | 'local';
    document.getElementById('s-code-local-group')!.style.display = v === 'local' ? '' : 'none';
    document.getElementById('s-code-git-group')!.style.display = v === 'git' ? '' : 'none';
    document.getElementById('s-code-branch-group')!.style.display = v === 'git' ? '' : 'none';
  });
  document.getElementById('s-btn-cancel')!.addEventListener('click', closeModal);
  document.getElementById('s-btn-save')!.addEventListener('click', saveSettings);
}

function saveSettings() {
  agentCmd = getInput('s-agent-cmd') || 'opencode';
  agentArgs = getInput('s-agent-args');
  const newWs = getInput('s-workspace');
  const newPj = getInput('s-project');
  codeSourceType = (getInput('s-code-src-type') as 'git' | 'local') || 'local';
  codeSourcePath = getInput('s-code-path');
  codeSourceUrl = getInput('s-code-url');
  codeSourceBranch = getInput('s-code-branch');

  const projectChanged = newPj && newPj !== projectPath;
  if (newWs) { workspacePath = newWs; setInput('workspace-input', newWs); localStorage.setItem('lastWorkspace', newWs); }
  if (newPj) { projectPath = newPj; setInput('project-input', newPj); localStorage.setItem('lastProject', newPj); }

  localStorage.setItem('agentCmd', agentCmd);
  localStorage.setItem('agentArgs', agentArgs);
  localStorage.setItem('codeSourceType', codeSourceType);
  localStorage.setItem('codeSourcePath', codeSourcePath);
  localStorage.setItem('codeSourceUrl', codeSourceUrl);
  localStorage.setItem('codeSourceBranch', codeSourceBranch);

  // Save agent config to project root .module-agent.json
  if (projectPath) {
    const args = agentArgs ? agentArgs.split(/\s+/).filter(Boolean) : [];
    const cs = codeSourceType === 'local'
      ? { type: 'local' as const, path: codeSourcePath }
      : { type: 'git' as const, url: codeSourceUrl, branch: codeSourceBranch || undefined };
    window.moduleAgent.saveAgentConfig(projectPath, agentCmd, args, cs, projectPath);
  }

  checkStartReady();
  updateStatusBar();
  closeModal();

  // Auto-rescan if project directory changed
  if (projectChanged) {
    if (treeRoot) goBack();
    setTimeout(startScan, 200);
  }
}

function updateStatusBar() {
  const parts: string[] = [];
  if (workspacePath) parts.push('工作区: ' + (workspacePath.split(/[/\\]/).pop() || workspacePath));
  parts.push('Agent: ' + agentCmd + (agentArgs ? ' ' + agentArgs : ''));
  $id('status-info').textContent = parts.join('  ·  ');
}

// ── Pan & Zoom ──
function initPan() {
  const p = $id('tree-panel');
  p.addEventListener('contextmenu', e => e.preventDefault());
  p.addEventListener('mousedown', e => {
    if (e.button !== 2) return; e.preventDefault();
    isPanning = true; panStartX = e.clientX; panStartY = e.clientY; panStartTX = panX; panStartTY = panY;
    p.classList.add('panning');
  });
  window.addEventListener('mousemove', e => {
    if (!isPanning) return;
    panX = panStartTX + (e.clientX - panStartX); panY = panStartTY + (e.clientY - panStartY); applyTransform();
  });
  window.addEventListener('mouseup', () => { if (isPanning) { isPanning = false; p.classList.remove('panning'); } });
  p.addEventListener('wheel', e => {
    e.preventDefault();
    const d = e.deltaY > 0 ? 0.9 : 1.1, ns = Math.min(2.5, Math.max(0.3, scale * d));
    const r = p.getBoundingClientRect();
    panX = (e.clientX - r.left) - ((e.clientX - r.left) - panX) * (ns / scale);
    panY = (e.clientY - r.top) - ((e.clientY - r.top) - panY) * (ns / scale);
    scale = ns; applyTransform();
  });
}
function applyTransform() {
  const s = document.getElementById('tree-svg') as unknown as SVGGraphicsElement;
  if (s) { s.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`; s.style.transformOrigin = '0 0'; }
}
function resetView() { panX = 20; panY = 20; scale = 1; applyTransform(); }

function focusOnRoot() {
  const panel = $id('tree-panel');
  const rootNode = flattenedNodes.find(n => n.data.name === treeRoot?.name);
  if (!rootNode || !panel) return;
  panX = panel.clientWidth / 2 - rootNode.x - NODE_W / 2;
  panY = panel.clientHeight / 2 - rootNode.y - NODE_H / 2;
  scale = 1;
  applyTransform();
}

// ── Drawer resize ──
function initDrawerResize() {
  const handle = document.getElementById('drawer-resize-handle');
  const drawer = document.getElementById('drawer');
  if (!handle || !drawer) return;

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startWidth = drawer.getBoundingClientRect().width;
    handle.classList.add('dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = startX - e.clientX;
    const newWidth = Math.min(800, Math.max(280, startWidth + delta));
    drawerWidth = newWidth;
    document.documentElement.style.setProperty('--drawer-width', newWidth + 'px');
  });

  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      handle.classList.remove('dragging');
      localStorage.setItem('drawerWidth', String(drawerWidth));
    }
  });
}

// ── Stream ──
function showStreamStatus(msg: string) {
  const el = document.getElementById('stream-content');
  if (el) el.innerHTML = `<div class="stream-role">状态</div><div class="stream-content">${escapeHtml(msg)}</div>`;
}

function appendStream(text: string) {
  if (!selectedNode || !streamState.has(selectedNode.name)) return;
  if (streamState.get(selectedNode.name)?.finished) return;
  const body = ensureStreamSection(selectedNode.name, 'reply');
  if (!body) return;
  body.appendChild(document.createTextNode(text));
  const area = $id('stream-area');
  if (area) area.scrollTop = area.scrollHeight;
}

function appendThinking(text: string) {
  if (!selectedNode || !streamState.has(selectedNode.name)) return;
  if (streamState.get(selectedNode.name)?.finished) return;
  const body = ensureStreamSection(selectedNode.name, 'thinking');
  if (!body) return;
  body.insertAdjacentHTML('beforeend', `<span class="stream-thinking">${escapeHtml(text)}</span>`);
  const area = $id('stream-area');
  if (area) area.scrollTop = area.scrollHeight;
}

function appendToolCall(line: string) {
  if (!selectedNode || !streamState.has(selectedNode.name)) return;
  if (streamState.get(selectedNode.name)?.finished) return;
  const body = ensureStreamSection(selectedNode.name, 'tools');
  if (!body) return;
  body.insertAdjacentHTML('beforeend', `<span class="stream-tool">\n${escapeHtml(line)}\n</span>`);
  const area = $id('stream-area');
  if (area) area.scrollTop = area.scrollHeight;
}

function finishStream(moduleName: string) {
  if (selectedNode?.name === moduleName) {
    const el = document.getElementById('stream-content');
    if (el) {
      el.classList.remove('stream-active');
      // Collapse thinking spans into toggle
      el.querySelectorAll('.stream-thinking').forEach(span => {
        const text = span.textContent || '';
        if (!text.trim()) return;
        const wrapper = document.createElement('span');
        wrapper.className = 'ctx-thinking-toggle';
        wrapper.innerHTML = `<span class="ctx-tag tag-thinking">思考</span><span class="ctx-thinking-arrow">▶</span>`;
        wrapper.style.cursor = 'pointer';
        wrapper.addEventListener('click', () => {
          const content = wrapper.nextElementSibling as HTMLElement;
          const arrow = wrapper.querySelector('.ctx-thinking-arrow');
          if (content && arrow) {
            const isOpen = content.style.display !== 'none';
            content.style.display = isOpen ? 'none' : '';
            arrow.textContent = isOpen ? '▶' : '▼';
          }
        });
        const contentDiv = document.createElement('div');
        contentDiv.className = 'ctx-thinking-content';
        contentDiv.textContent = text;
        contentDiv.style.display = 'none';
        span.replaceWith(wrapper);
        wrapper.after(contentDiv);
      });
    }
  }
  const st = streamState.get(moduleName);
  const content = (st?.reply || '').trim();
  const thinking = (st?.thinking || '').trim();
  const tools = (st?.tools || '').trim();
  if (content || thinking || tools) {
    getMsgs(moduleName).push({
      id: 'm' + Date.now(), role: 'agent',
      content, thinking, tools,
      time: now(), status: 'completed', moduleName, agentCmd,
    });
    setPage(moduleName, Math.max(0, Math.ceil(getMsgs(moduleName).length / CTX_PAGE) - 1));
    saveContext(moduleName);
    renderContextCards(moduleName);
  }
  if (st) { st.finished = true; }
  saveStreamSnapshot();
}

function showCancelButton() {
  const btn = document.getElementById('btn-cancel-stream');
  if (btn) btn.style.display = '';
}
function hideCancelButton() {
  const btn = document.getElementById('btn-cancel-stream');
  if (btn) btn.style.display = 'none';
}
async function cancelStream(moduleName: string) {
  hideCancelButton();
  try { await window.moduleAgent.cancelAgent(moduleName); } catch {}
}

function stopStream() {
  hideCancelButton();
  const el = document.getElementById('stream-content');
  if (el) el.innerHTML = '<div class="stream-empty">等待 Agent 响应...</div>';
  if (selectedNode) streamState.delete(selectedNode.name);
  if (streamState.size === 0) clearStreamSnapshot();
}

// ── Drawer ──
function openDrawer(node: TreeNode) {
  selectedNode = node;
  $id('drawer-title').textContent = node.name;
  buildDrawerContent(node);
  $id('drawer').classList.add('open');
  $id('drawer-overlay').classList.add('open');
  $id('drawer-overlay').style.display = '';
  const savedPanX = panX, savedPanY = panY, savedScale = scale;
  layoutAndRender();
  panX = savedPanX; panY = savedPanY; scale = savedScale;
  applyTransform();
}
function closeDrawer() {
  hideCancelButton();
  selectedNode = null;
  $id('drawer').classList.remove('open');
  $id('drawer-overlay').classList.remove('open');
  setTimeout(() => $id('drawer-overlay').style.display = 'none', 300);
  const savedPanX = panX, savedPanY = panY, savedScale = scale;
  layoutAndRender();
  panX = savedPanX; panY = savedPanY; scale = savedScale;
  applyTransform();
}
function buildDrawerContent(node: TreeNode) {
  const name = node.name;

  // Restore saved context if not already loaded
  if (!contextMap.has(name) || getMsgs(name).length === 0) {
    const saved = loadContext(name);
    if (saved.length > 0) contextMap.set(name, saved);
  }

  // Restore interrupted stream snapshot (only if not currently streaming to this module)
  if (!streamState.has(name)) {
    const snapMsg = restoreStreamSnapshot(name);
    if (snapMsg) {
      getMsgs(name).push(snapMsg);
      setPage(name, Math.max(0, Math.ceil(getMsgs(name).length / CTX_PAGE) - 1));
      saveContext(name);
    }
  }

  const agentCwd = node.path === '.'
    ? projectPath
    : (workspacePath || projectPath) + '/' + node.path.replace(/^\.\//, '');

  const isStreaming = streamState.has(name) && !streamState.get(name)?.finished;
  const st = streamState.get(name);
  let streamContentHtml = '';
  if (st) {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (st.thinking) {
      streamContentHtml += `<div class="stream-section stream-section-thinking"><div class="stream-section-header"><span class="stream-section-icon">💭</span><span class="stream-section-label">思考过程</span></div><div class="stream-section-body"><span class="stream-thinking">${escapeHtml(st.thinking)}</span></div></div>`;
    }
    if (st.tools) {
      const toolLines = st.tools.split('\n').filter(Boolean).map(l => `<span class="stream-tool">\n${escapeHtml(l)}\n</span>`).join('');
      streamContentHtml += `<div class="stream-section stream-section-tools"><div class="stream-section-header"><span class="stream-section-icon">🔧</span><span class="stream-section-label">工具调用</span></div><div class="stream-section-body">${toolLines}</div></div>`;
    }
    if (st.reply) {
      streamContentHtml += `<div class="stream-section stream-section-reply"><div class="stream-section-header"><span class="stream-section-icon">💬</span><span class="stream-section-label">回复</span></div><div class="stream-section-body">${escapeHtml(st.reply)}</div></div>`;
    }
    st.sections = {
      thinking: !!st.thinking,
      tools: !!st.tools,
      reply: !!st.reply,
    };
  }
  const streamPlaceholder = streamContentHtml || '<div class="stream-empty">等待 Agent 响应...</div>';
  const streamClass = isStreaming ? 'stream-active' : (st ? '' : 'stream-empty');

  $id('drawer-body').innerHTML = `
    <div class="info-compact">
      <span class="ic-item"><span class="ic-label">路径</span><span class="ic-value">${node.path}</span></span>
      <span class="ic-item"><span class="ic-label">子模块</span><span class="ic-value">${node.children.length} 个</span></span>
      <span class="ic-item"><span class="ic-label">Agent CWD</span><span class="ic-value">${escapeHtml(agentCwd)}</span></span>
    </div>
    <div class="desc">${node.description || '无描述'}</div>
    <div class="ctx-top-controls">
      <span class="section-title">对话上下文</span>
      <button class="btn-sm" id="ctx-clear-btn">清空</button>
    </div>
    <div class="split-zone">
      <div id="stream-area" class="stream-area">
        <div id="stream-content" class="${streamClass}">${streamPlaceholder}</div>
      </div>
      <button class="btn-cancel-stream" id="btn-cancel-stream" style="${isStreaming ? '' : 'display:none'}">取消</button>
      <div class="splitter" id="drawer-splitter"></div>
      <div class="ctx-bottom">
        <div id="ctx-cards" class="ctx-card-list"></div>
        <div id="ctx-paginator" class="paginator"></div>
      </div>
    </div>
    <div class="ctx-chat">
      <input id="ctx-chat-input" placeholder="输入消息发送给 Agent..." onkeydown="if(event.key==='Enter'){event.preventDefault();window.sendMsgClick('${name}')}">
      <button class="btn-send" id="ctx-send-btn" type="button" onclick="window.sendMsgClick('${name}')">发送</button>
    </div>
  `;
  $id('ctx-clear-btn').addEventListener('click', () => clearContext(name));
  renderContextCards(name);
  initSplitter();
}

// Global handlers for inline onclick
(window as any).sendMsgClick = (moduleName: string) => sendContextMsg(moduleName);
(window as any).clearContextClick = (moduleName: string) => clearContext(moduleName);
(window as any).cancelStreamClick = (moduleName: string) => cancelStream(moduleName);

// ── Context ──
function renderContextCards(moduleName: string) {
  const msgs = getMsgs(moduleName);
  const cur = getPage(moduleName);
  const totalPg = Math.max(1, Math.ceil(msgs.length / CTX_PAGE));
  if (cur >= totalPg) setPage(moduleName, totalPg - 1);
  const pg = getPage(moduleName);
  const start = pg * CTX_PAGE, pageMsgs = msgs.slice(start, start + CTX_PAGE);
  const cardsEl = document.getElementById('ctx-cards'), pagEl = document.getElementById('ctx-paginator');
  if (!cardsEl || !pagEl) return;

  if (msgs.length === 0) { cardsEl.innerHTML = '<div class="ctx-empty">暂无对话，发送消息开始</div>'; pagEl.innerHTML = ''; return; }

  cardsEl.innerHTML = pageMsgs.map(m => {
    let extra = '';
    if (m.thinking) extra += `
      <div class="ctx-thinking-toggle" data-action="toggle-thinking" data-id="${m.id}">
        <span class="ctx-tag tag-thinking">思考</span>
        <span class="ctx-thinking-arrow">▶</span>
        <span class="ctx-thinking-preview">${escapeHtml(m.thinking.slice(0, 40))}...</span>
      </div>
      <div class="ctx-thinking-content" id="thinking-${m.id}" style="display:none">${escapeHtml(m.thinking)}</div>`;
    if (m.tools) {
      const toolCount = (m.tools.match(/\[工具调用:/g) || []).length;
      extra += `<div class="ctx-tools"><span class="ctx-tag tag-tools">工具</span>${toolCount} 个工具调用</div>`;
    }
    let roleHtml: string;
    if (m.role === 'cross') {
      const dirIcon = m.crossDirection === 'sent' ? '📤' : '📥';
      const dirLabel = m.crossDirection === 'sent' ? `→ ${m.crossModule || ''}` : `← ${m.crossModule || ''}`;
      roleHtml = `<span class="ctx-role cross">${dirIcon} 跨模块 ${dirLabel}</span>`;
    } else {
      roleHtml = `<span class="ctx-role ${m.role}">${m.role === 'user' ? '👤 用户' : '🤖 Agent'}</span>`;
    }
    return `
    <div class="ctx-card" data-id="${m.id}">
      <div class="ctx-card-top">
        ${roleHtml}
        <span class="ctx-status st-${m.status}">${statusLabel(m.status)}</span>
      </div>
      ${extra}
      <div class="ctx-preview">${escapeHtml(m.content.slice(0, 100)) || '<span class="ctx-empty-preview">(无文本回复)</span>'}</div>
      <div class="ctx-time">${m.time}</div>
    </div>`;
  }).join('');

  cardsEl.querySelectorAll('.ctx-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id')!;
      const msg = msgs.find(m => m.id === id);
      if (msg) showModal(msg);
    });
  });

  cardsEl.querySelectorAll('.ctx-thinking-toggle').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = toggle.getAttribute('data-id')!;
      const content = document.getElementById('thinking-' + id);
      const arrow = toggle.querySelector('.ctx-thinking-arrow');
      if (content && arrow) {
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : '';
        arrow.textContent = isOpen ? '▶' : '▼';
      }
    });
  });

  let h = '';
  if (totalPg > 1) {
    h += `<button class="pg-btn" ${pg <= 0 ? 'disabled' : ''}>◀</button>`;
    for (let i = 0; i < totalPg; i++) h += `<button class="pg-btn ${i === pg ? 'active' : ''}">${i + 1}</button>`;
    h += `<button class="pg-btn" ${pg >= totalPg - 1 ? 'disabled' : ''}>▶</button>`;
  }
  h += `<span class="pg-info">${msgs.length} 条</span>`;
  pagEl.innerHTML = h;

  let idx = 0;
  pagEl.querySelectorAll('.pg-btn').forEach(btn => {
    const i = idx++;
    btn.addEventListener('click', () => {
      const pgs = Math.max(1, Math.ceil(getMsgs(moduleName).length / CTX_PAGE));
      if (i === 0) setPage(moduleName, Math.max(0, pg - 1));
      else if (i === pgs + 1) setPage(moduleName, Math.min(pgs - 1, pg + 1));
      else setPage(moduleName, i - 1);
      renderContextCards(moduleName);
    });
  });
}

let splitRatio = 0.4;
let splitDragging = false;

function initSplitter() {
  const splitter = document.getElementById('drawer-splitter');
  const streamArea = document.getElementById('stream-area');
  const ctxBottom = document.querySelector('.ctx-bottom') as HTMLElement;
  if (!splitter || !streamArea || !ctxBottom) return;

  applySplitRatio(streamArea, ctxBottom);

  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    splitDragging = true;
    splitter.classList.add('dragging');
  });

  document.addEventListener('mousemove', (e) => {
    if (!splitDragging) return;
    const zone = document.querySelector('.split-zone') as HTMLElement;
    if (!zone) return;
    const rect = zone.getBoundingClientRect();
    const y = e.clientY - rect.top;
    splitRatio = Math.min(0.75, Math.max(0.15, y / rect.height));
    applySplitRatio(streamArea, ctxBottom);
  });

  document.addEventListener('mouseup', () => {
    if (splitDragging) {
      splitDragging = false;
      splitter.classList.remove('dragging');
    }
  });
}

function applySplitRatio(streamArea: HTMLElement, ctxBottom: HTMLElement) {
  streamArea.style.flex = `0 0 ${(splitRatio * 100).toFixed(1)}%`;
  ctxBottom.style.flex = `0 0 ${((1 - splitRatio) * 100).toFixed(1)}%`;
}

let sendingLock = false;

function sendContextMsg(moduleName: string) {
  if (sendingLock) return;
  const input = document.getElementById('ctx-chat-input') as HTMLInputElement; if (!input) return;
  const text = input.value.trim(); if (!text) return;
  input.value = '';
  input.disabled = true;
  sendingLock = true;

  getMsgs(moduleName).push({ id: 'm' + Date.now(), role: 'user', content: text, thinking: '', tools: '', time: now(), status: 'sent', moduleName, agentCmd });
  setPage(moduleName, Math.max(0, Math.ceil(getMsgs(moduleName).length / CTX_PAGE) - 1));
  saveContext(moduleName);
  renderContextCards(moduleName);

  (async () => {
    try {
      const isRoot = selectedNode?.path === '.';
      const cwd = isRoot ? projectPath : (workspacePath || (selectedNode ? selectedNode.path : '.'));
      const args = agentArgs ? agentArgs.split(/\s+/).filter(Boolean) : [];
      const startResult = await window.moduleAgent.startAgent(moduleName, agentCmd, args, cwd);
      if (startResult.error) {
        showStreamStatus(`启动 Agent 失败: ${startResult.error}`);
        return;
      }

      ensureStreamListener();
      streamState.delete(moduleName);
      showStreamStatus('等待 Agent 响应...');
      showCancelButton();

      const sendResult = await window.moduleAgent.sendMessage(moduleName, text);
      hideCancelButton();
      if (sendResult.error) {
        showStreamStatus(`发送失败: ${sendResult.error}`);
      } else if (sendResult.stopReason === 'end_turn') {
        finishStream(moduleName);
      }
    } catch (err) {
      hideCancelButton();
      showStreamStatus(`通信错误: ${(err as Error).message}`);
    } finally {
      hideCancelButton();
      sendingLock = false;
      input.disabled = false;
      input.focus();
    }
  })();
}

let streamListenerCleanup: (() => void) | null = null;
const streamState = new Map<string, { reply: string; thinking: string; tools: string; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } }>();
let streamSaveTimer: ReturnType<typeof setTimeout> | null = null;

function getStreamState(moduleName: string) {
  let st = streamState.get(moduleName);
  if (!st) { st = { reply: '', thinking: '', tools: '', sections: { thinking: false, tools: false, reply: false } }; streamState.set(moduleName, st); }
  return st;
}

function saveStreamSnapshot() {
  if (streamState.size === 0) return;
  const entries: { moduleName: string; reply: string; thinking: string; tools: string; finished?: boolean; time: string }[] = [];
  for (const [name, st] of streamState) {
    if (st.reply || st.thinking || st.tools) {
      entries.push({ moduleName: name, reply: st.reply, thinking: st.thinking, tools: st.tools, finished: st.finished, time: now() });
    }
  }
  if (entries.length > 0) localStorage.setItem('stream_snapshot', JSON.stringify(entries));
}

function scheduleStreamSave() {
  if (streamSaveTimer) return;
  streamSaveTimer = setTimeout(() => {
    streamSaveTimer = null;
    saveStreamSnapshot();
  }, 2000);
}

function clearStreamSnapshot() {
  localStorage.removeItem('stream_snapshot');
}

function restoreStreamSnapshot(moduleName: string): ChatMsg | null {
  try {
    const raw = localStorage.getItem('stream_snapshot');
    if (!raw) return null;
    const entries = JSON.parse(raw) as { moduleName: string; reply: string; thinking: string; tools: string; finished?: boolean; time: string }[];
    const idx = entries.findIndex(e => e.moduleName === moduleName);
    if (idx === -1) return null;
    const snap = entries[idx]!;
    if (!snap.reply && !snap.thinking && !snap.tools) return null;
    entries.splice(idx, 1);
    if (entries.length > 0) localStorage.setItem('stream_snapshot', JSON.stringify(entries));
    else localStorage.removeItem('stream_snapshot');
    return {
      id: 's' + Date.now(),
      role: 'agent',
      content: snap.reply || '',
      thinking: snap.thinking || '',
      tools: snap.tools || '',
      time: snap.time,
      status: snap.finished ? 'completed' : 'interrupted',
      moduleName,
      agentCmd,
    };
  } catch { return null; }
}

function ensureStreamListener() {
  if (streamListenerCleanup) return;
  streamListenerCleanup = window.moduleAgent.onAgentStream(({ moduleName, update, data }) => {
    const st = getStreamState(moduleName);
    if (st.finished) return;
    if (update === 'agent_message_chunk') {
      const block = (data as any).content as { type?: string; text?: string } | undefined;
      const text = block?.type === 'text' ? block.text : undefined;
      if (text) { st.reply += text; if (selectedNode?.name === moduleName) appendStream(text); scheduleStreamSave(); }
    } else if (update === 'agent_thought_chunk') {
      const block = (data as any).content as { type?: string; text?: string } | undefined;
      const text = block?.type === 'text' ? block.text : undefined;
      if (text) { st.thinking += text; if (selectedNode?.name === moduleName) appendThinking(text); scheduleStreamSave(); }
    } else if (update === 'tool_call') {
      const tc = data as any;
      const line = `[工具调用: ${tc.title || tc.toolCallId} | ${tc.status}]`;
      st.tools += line + '\n';
      if (selectedNode?.name === moduleName) appendToolCall(line);
      scheduleStreamSave();
    } else if (update === 'plan') {
      if (selectedNode?.name === moduleName) appendStream(`\n[计划更新]\n`);
    }
  });
}

function saveContext(moduleName: string) {
  const msgs = contextMap.get(moduleName);
  if (msgs && msgs.length > 0) {
    localStorage.setItem(`ctx_${moduleName}`, JSON.stringify(msgs));
  }
}

function loadContext(moduleName: string): ChatMsg[] {
  try {
    const raw = localStorage.getItem(`ctx_${moduleName}`);
    if (raw) return JSON.parse(raw) as ChatMsg[];
  } catch {}
  return [];
}

function clearContext(moduleName: string) {
  stopStream(); contextMap.set(moduleName, []); setPage(moduleName, 0);
  localStorage.removeItem(`ctx_${moduleName}`);
  renderContextCards(moduleName);
}

function clearAllContexts() {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('ctx_')) keys.push(k);
  }
  keys.forEach(k => localStorage.removeItem(k));
  contextMap.clear();
}

// ── Modal ──
function showModal(msg: ChatMsg) {
  if (msg.role === 'cross') {
    $id('modal-title').textContent = msg.crossDirection === 'sent' ? `跨模块发送 → ${msg.crossModule || ''}` : `跨模块接收 ← ${msg.crossModule || ''}`;
  } else {
    $id('modal-title').textContent = msg.role === 'user' ? '用户消息详情' : 'Agent 回复详情';
  }

  let sections = '';
  if (msg.thinking) {
    sections += `
    <div class="modal-section">
      <div class="modal-section-title modal-thinking-toggle" data-action="toggle-modal-thinking">💭 思考过程 <span class="ctx-thinking-arrow">▶</span></div>
      <div class="content-text thinking-text modal-thinking-content" style="display:none">${escapeHtml(msg.thinking)}</div>
    </div>`;
  }
  if (msg.tools) {
    sections += `
    <div class="modal-section">
      <div class="modal-section-title">🔧 工具调用</div>
      <div class="content-text tools-text">${escapeHtml(msg.tools)}</div>
    </div>`;
  }
  sections += `
    <div class="modal-section">
      <div class="modal-section-title">💬 回复</div>
      <div class="content-text">${msg.content ? escapeHtml(msg.content) : '<span style="color:var(--text-dim)">(无文本回复)</span>'}</div>
    </div>`;

  $id('modal-body').innerHTML = `
    <div class="modal-status-row">
      <span class="modal-status-badge st-${msg.status}">${statusLabel(msg.status)}</span>
      <span class="modal-st-label">${msg.role === 'user' ? '用户' : 'Agent'}</span>
    </div>
    <div class="modal-info-grid">
      <div class="mg-item"><span class="mg-lbl">时间</span><span class="mg-val">${msg.time}</span></div>
      <div class="mg-item"><span class="mg-lbl">模块</span><span class="mg-val">${msg.moduleName}</span></div>
      <div class="mg-item"><span class="mg-lbl">Agent</span><span class="mg-val">${msg.agentCmd}</span></div>
      <div class="mg-item"><span class="mg-lbl">角色</span><span class="mg-val">${msg.role === 'user' ? '输入' : '回复'}</span></div>
    </div>
    ${sections}`;
  show($id('modal-overlay'));

  const modalToggle = $id('modal-body').querySelector('.modal-thinking-toggle');
  if (modalToggle) {
    modalToggle.addEventListener('click', () => {
      const content = $id('modal-body').querySelector('.modal-thinking-content') as HTMLElement;
      const arrow = modalToggle.querySelector('.ctx-thinking-arrow');
      if (content && arrow) {
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : '';
        arrow.textContent = isOpen ? '▶' : '▼';
      }
    });
  }
}
function closeModal() { hide($id('modal-overlay')); }

function statusLabel(s: string): string {
  const map: Record<string, string> = { sent: '已发送', pending: '等待中', thinking: '思考中', executing: '执行中', completed: '已完成', error: '失败', interrupted: '中断' };
  return map[s] || s;
}
function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── Setup ──
async function selectWorkspace() { const d = await window.moduleAgent.selectDir('选择工作目录'); if (!d) return; workspacePath = d; setInput('workspace-input', d); checkStartReady(); localStorage.setItem('lastWorkspace', d); }
async function selectProject() { const d = await window.moduleAgent.selectDir('选择模块目录'); if (!d) return; projectPath = d; setInput('project-input', d); checkStartReady(); localStorage.setItem('lastProject', d); }

async function startScan() {
  if (!workspacePath || !projectPath) return;
  const e = $id('setup-error'); e.style.display = 'none';
  agentCmd = getInput('agent-cmd-input') || 'opencode';
  agentArgs = getInput('agent-args-input');
  codeSourceType = (getInput('setup-code-src-type') as 'git' | 'local') || 'local';
  codeSourcePath = getInput('setup-code-path');
  localStorage.setItem('agentCmd', agentCmd);
  localStorage.setItem('agentArgs', agentArgs);
  localStorage.setItem('codeSourceType', codeSourceType);
  localStorage.setItem('codeSourcePath', codeSourcePath);

  // Write agent config to project root .module-agent.json
  const args = agentArgs ? agentArgs.split(/\s+/).filter(Boolean) : [];
  const cs = codeSourceType === 'local'
    ? { type: 'local' as const, path: codeSourcePath }
    : { type: 'git' as const, url: codeSourceUrl, branch: codeSourceBranch || undefined };
  await window.moduleAgent.saveAgentConfig(projectPath, agentCmd, args, cs);

  try {
    const r = await window.moduleAgent.scanProject(projectPath, workspacePath);
    if (r.error) { e.textContent = '扫描失败: ' + r.error; e.style.display = ''; return; }
    hide($id('setup-screen')); show($id('main-screen'));
    $id('status-text').textContent = `已加载 ${r.moduleCount ?? 0} 个模块`;
    $id('status-path').textContent = (projectPath.split(/[/\\]/).pop() || projectPath) || '';
    updateStatusBar();
    treeRoot = await window.moduleAgent.getTree();
    if (treeRoot) { layoutAndRender(); focusOnRoot(); }
    startRunningPoll();
    localStorage.setItem('lastWorkspace', workspacePath); localStorage.setItem('lastProject', projectPath);
  } catch (err) { e.textContent = '错误: ' + (err as Error).message; e.style.display = ''; }
}
function goBack() {
  if (streamListenerCleanup) { streamListenerCleanup(); streamListenerCleanup = null; }
  stopStream(); hide($id('main-screen')); show($id('setup-screen'));
  treeRoot = null; flattenedNodes = []; selectedNode = null; checkStartReady();
  stopRunningPoll();
}

// ── Tree ──
function layoutAndRender() { if (!treeRoot) return; flattenedNodes = []; layoutTree(treeRoot, 0, 0, true); renderSvg(); resetView(); }
function layoutTree(node: TreeNode, depth: number, stY: number, _isRoot: boolean): LayoutNode {
  const x = depth * (NODE_W + H_GAP);
  const y = stY;
  let childY = y + NODE_H + V_GAP;
  const kids: LayoutNode[] = [];

  for (const c of node.children) {
    const cl = layoutTree(c, depth + 1, childY, false);
    kids.push(cl);
    childY += cl.subtreeHeight + V_GAP;
  }

  const sh = node.children.length === 0
    ? NODE_H
    : childY - y - V_GAP;

  const self: LayoutNode = { data: node, x, y, width: NODE_W, height: NODE_H, collapsed: false, subtreeHeight: sh };
  flattenedNodes.push(self);
  return self;
}
function renderSvg() {
  if (!treeRoot) return; const rl = flattenedNodes.find(n => n.data.name === treeRoot!.name); if (!rl) return;
  const svg = document.getElementById('tree-svg') as unknown as SVGSVGElement; if (!svg) return;
  svg.innerHTML = '';
  const vis = flattenedNodes.filter(n => !isCollapsedAncestor(n));
  const tw = Math.max(...vis.map(n => n.x)) + NODE_W + 20, th = rl.subtreeHeight + 20;
  svg.setAttribute('viewBox', `0 0 ${tw} ${th}`);
  ['width','height'].forEach(a => svg.setAttribute(a, `${a==='width'?tw:th}`));
  Object.assign(svg.style, { width: tw+'px', height: th+'px', minWidth: tw+'px', minHeight: th+'px', background: '#1a1b26' });

  for (const n of vis) {
    if (n.data.name === treeRoot!.name) continue;
    const pn = findParentName(n.data); if (!pn) continue;
    const p = flattenedNodes.find(x => x.data.name === pn); if (!p || isCollapsedAncestor(p)) continue;
    const e = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    e.setAttribute('d', `M${p.x+NODE_W},${p.y+NODE_H/2} C${(p.x+NODE_W+n.x)/2},${p.y+NODE_H/2} ${(p.x+NODE_W+n.x)/2},${n.y+NODE_H/2} ${n.x},${n.y+NODE_H/2}`);
    e.setAttribute('class', 'edge-line'); svg.appendChild(e);
  }
  for (const n of vis) {
    if (isCollapsedAncestor(n)) continue;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.style.cursor = 'pointer';
    const isNodeActive = selectedNode?.name === n.data.name;
    const agentState = runningAgents.get(n.data.name);
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', `${n.x}`); r.setAttribute('y', `${n.y}`); r.setAttribute('width', `${NODE_W}`); r.setAttribute('height', `${NODE_H}`);
    const cls = ['node-rect'];
    if (isNodeActive) cls.push('active');
    if (agentState) cls.push('agent-' + agentState);
    r.setAttribute('class', cls.join(' '));
    const t1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t1.setAttribute('x', `${n.x+10}`); t1.setAttribute('y', `${n.y+20}`); t1.setAttribute('class', 'node-text'); t1.textContent = n.data.name;
    const t2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t2.setAttribute('x', `${n.x+10}`); t2.setAttribute('y', `${n.y+36}`); t2.setAttribute('class', 'node-subtext');
    t2.textContent = n.data.children.length > 0 ? `${n.data.children.length} 子模块` : (n.data.description||'').slice(0, 15);
    g.append(r, t1, t2);
    if (agentState) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', `${n.x + NODE_W - 10}`); dot.setAttribute('cy', `${n.y + 10}`); dot.setAttribute('r', '5');
      dot.setAttribute('class', 'node-status-dot dot-' + agentState);
      g.append(dot);
    }
    if (n.data.children.length > 0) {
      const cx = n.x + NODE_W - 12, cy = n.y + NODE_H - 12;
      const cb = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      cb.setAttribute('cx', `${cx}`); cb.setAttribute('cy', `${cy}`); cb.setAttribute('r', '7'); cb.setAttribute('class', 'expand-btn');
      const ct = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      ct.setAttribute('x', `${cx-3}`); ct.setAttribute('y', `${cy+3}`); ct.setAttribute('fill', '#1a1b26'); ct.setAttribute('font-size', '10');
      ct.setAttribute('font-weight', 'bold'); ct.setAttribute('pointer-events', 'none'); ct.textContent = n.collapsed ? '+' : '\u2212';
      g.append(cb, ct); cb.addEventListener('click', e => { e.stopPropagation(); n.collapsed = !n.collapsed; layoutAndRender(); });
    }
    g.addEventListener('click', e => { e.stopPropagation(); openDrawer(n.data); });
    svg.appendChild(g);
  }
  $id('status-text').textContent = `已渲染 ${vis.length} 个节点 (${tw}x${th})`;
}
function findParentName(node: TreeNode): string | null { for (const n of flattenedNodes) if (n.data.children.some(c => c.name === node.name)) return n.data.name; return null; }
function isCollapsedAncestor(node?: LayoutNode): boolean { if (!node) return false; const pn = findParentName(node.data); if (!pn) return false; const p = flattenedNodes.find(n => n.data.name === pn); return !p ? false : p.collapsed ? true : isCollapsedAncestor(p); }

// ── Init ──
function init() {
  agentCmd = localStorage.getItem('agentCmd') || 'opencode';
  agentArgs = localStorage.getItem('agentArgs') || 'acp';
  codeSourceType = (localStorage.getItem('codeSourceType') as 'git' | 'local') || 'local';
  codeSourcePath = localStorage.getItem('codeSourcePath') || '';
  codeSourceUrl = localStorage.getItem('codeSourceUrl') || '';
  codeSourceBranch = localStorage.getItem('codeSourceBranch') || '';
  $id('agent-cmd-input').setAttribute('value', agentCmd);
  ($id('agent-cmd-input') as HTMLInputElement).value = agentCmd;
  ($id('agent-args-input') as HTMLInputElement).value = agentArgs;

  $id('btn-workspace').addEventListener('click', selectWorkspace);
  $id('btn-project').addEventListener('click', selectProject);
  $id('btn-setup-code-path').addEventListener('click', async () => {
    const d = await window.moduleAgent.selectDir('选择代码根目录'); if (!d) return;
    setInput('setup-code-path', d);
  });
  $id('setup-code-src-type').addEventListener('change', () => {
    const v = getInput('setup-code-src-type');
    document.getElementById('setup-code-local-group')!.style.display = v === 'local' ? '' : 'none';
  });
  $id('btn-start').addEventListener('click', startScan);
  $id('btn-back').addEventListener('click', goBack);
  $id('btn-settings').addEventListener('click', openSettings);
  $id('btn-rescan').addEventListener('click', () => { goBack(); setTimeout(startScan, 200); });
  $id('btn-clear-all').addEventListener('click', () => {
    clearAllContexts();
    contextMap.clear();
    if (selectedNode) { setPage(selectedNode.name, 0); renderContextCards(selectedNode.name); }
  });
  $id('drawer-close').addEventListener('click', closeDrawer);
  $id('drawer-overlay').addEventListener('click', closeDrawer);
  $id('modal-close').addEventListener('click', closeModal);
  $id('modal-overlay').addEventListener('click', e => { if (e.target === $id('modal-overlay')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeDrawer(); } });
  initPan();
  initDrawerResize();

  const savedWidth = localStorage.getItem('drawerWidth');
  if (savedWidth) {
    drawerWidth = parseInt(savedWidth, 10) || 420;
    document.documentElement.style.setProperty('--drawer-width', drawerWidth + 'px');
  }

  // Cross-module context listener
  window.moduleAgent.onCrossContext(({ moduleName, crossModule, direction, phase, content, time }) => {
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
    };
    getMsgs(moduleName).push(msg);
    saveContext(moduleName);
    // If this drawer is open, refresh
    if (selectedNode?.name === moduleName) {
      setPage(moduleName, Math.max(0, Math.ceil(getMsgs(moduleName).length / CTX_PAGE) - 1));
      renderContextCards(moduleName);
    }
  });

  const lw = localStorage.getItem('lastWorkspace'), lp = localStorage.getItem('lastProject');
  if (lw) { workspacePath = lw; setInput('workspace-input', lw); }
  if (lp) { projectPath = lp; setInput('project-input', lp); }
  if (codeSourcePath) { setInput('setup-code-path', codeSourcePath); }
  (document.getElementById('setup-code-src-type') as HTMLSelectElement).value = codeSourceType;
  checkStartReady();

  // Auto-start if all settings are already configured
  if (workspacePath && projectPath && agentCmd) {
    startScan();
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
