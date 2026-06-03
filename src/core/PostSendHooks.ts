// ---------------------------------------------------------------------------
// core/PostSendHooks.ts — Post-send hook factories
//
// Provides factory functions that create `onPostSend` callbacks for
// ModuleAgentSubsystem. Each bridge (Electron/TUI) configures its own
// summarizer + workspace-diff behavior via these factories.
//
// The core is unaware of IPC, SolidJS, or any transport — bridges inject
// notification callbacks to receive diff results.
// ---------------------------------------------------------------------------

import path from 'path';
import * as WorkspaceDiff from './WorkspaceDiff.js';
import type { Logger } from './Logger.js';
import type { ChatMsg, DiffSummary } from '../types/shared.js';
import type { ExperienceSummarizer } from './ExperienceSummarizer.js';
import type { AgentEntry } from './ModuleAgentSubsystem.js';

// ── Options ────────────────────────────────────────────────────────────────

export interface PostSendHookOptions {
  /** Logger instance */
  logger: Logger;
  /** Summarizer instance (may be undefined if summarization is disabled) */
  summarizer?: ExperienceSummarizer;
  /** Whether summarization is enabled (getter, may change after project:scan) */
  getSummarizationEnabled: () => boolean;
  /** Config directory (for summarizer prompt loading) */
  configDir: string;
  /** Project root directory */
  getProjectRoot: () => string;
  /** Diff cache: Map<moduleName, DiffSummary> — shared with bridge */
  diffCache: Map<string, DiffSummary>;
  /** Called when a workspace diff is ready (bridge pushes to UI) */
  onDiffReady?: (moduleName: string, summary: DiffSummary | null) => void;
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create an `onPostSend` hook that triggers summarization and workspace diff.
 *
 * Usage in ElectronBridge/TuiBridge:
 * ```
 * const onPostSend = createPostSendHook({
 *   logger, summarizer, summarizationEnabled, configDir,
 *   getProjectRoot: () => this.core.getProjectRoot(),
 *   diffCache: this.diffCache,
 *   onDiffReady: (name, summary) => { ... IPC push or signal update ... },
 * });
 * const core = new ModuleAgentCore({
 *   ...,
 *   modules: { onPostSend },
 * });
 * ```
 */
export function createPostSendHook(opts: PostSendHookOptions) {
  return (moduleName: string, msgs: ChatMsg[], entry: AgentEntry): void => {
    const projectRoot = opts.getProjectRoot();
    if (!projectRoot) return;

    // ── 1. Summarizer（触发即忘，后台执行） ──
    if (opts.getSummarizationEnabled() && opts.summarizer) {
      const agentConfig = {
        command: entry.agent.config.command,
        args: entry.agent.config.args,
      };
      opts.logger.info(`PostSend: triggering summarizer for [${moduleName}]`);
      opts.summarizer.summarize({
        moduleName,
        chatMsgs: msgs,
        projectRoot,
        configDir: opts.configDir,
        agentConfig,
        agentCwd: entry.agent.cwd,
      }).catch(err => {
        opts.logger.warn(`Summarizer error [${moduleName}]: ${(err as Error).message}`);
      });
    }

    // ── 2. Workspace diff（后台异步） ──
    const workspaceCwd = entry.agent.cwd;
    const sourceDir = entry.sourcePath;
    if (!workspaceCwd || !sourceDir) return;

    // 只处理有工作区隔离的模块
    const workspaceBase = path.join(projectRoot, '.module-agent', 'workspace');
    if (!workspaceCwd.startsWith(workspaceBase)) return;

    // 异步执行 diff，不阻塞 sendMessage 返回
    setImmediate(() => {
      try {
        opts.logger.info(`PostSend: analyzing workspace diff for [${moduleName}]`);
        const summary = WorkspaceDiff.analyze(workspaceCwd, sourceDir);
        summary.moduleName = moduleName;
        opts.diffCache.set(moduleName, summary);
        if (summary.files.length > 0) {
          opts.logger.info(
            `WorkspaceDiff [${moduleName}]: +${summary.addedCount} ~${summary.modifiedCount} -${summary.deletedCount}`,
          );
        }
        opts.onDiffReady?.(moduleName, summary.files.length > 0 ? summary : null);
      } catch (err) {
        opts.logger.error(`WorkspaceDiff error [${moduleName}]: ${(err as Error).message}`);
        opts.onDiffReady?.(moduleName, null);
      }
    });
  };
}
