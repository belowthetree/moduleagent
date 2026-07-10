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

import type { Logger } from './Logger.js';
import type { ChatMsg } from '../types/shared.js';
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


  };
}
