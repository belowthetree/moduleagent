// ---------------------------------------------------------------------------
// tui/components/SetupWizard.tsx — TUI 设置向导组件
// 配置 LLM 提供商（方向键选择）、API 密钥、模型和项目路径
// ---------------------------------------------------------------------------

import { createSignal, createMemo, For, onMount, onCleanup } from "solid-js";
import { useRenderer } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { tuiState } from "../state.js";
import {
  writeModuleAgentJson,
  getDefaultConfig,
} from "../config.js";

interface SetupWizardProps {
  onComplete: () => void;
}

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI (GPT)' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)' },
];

export default function SetupWizard(props: SetupWizardProps) {
  const renderer = useRenderer();
  const defaultConfig = getDefaultConfig();
  const existing = tuiState.setupData();

  const fallbackProvider = existing.provider || defaultConfig.agents.default.provider || 'anthropic';
  const fallbackModel = existing.model || defaultConfig.agents.default.model || '';
  const fallbackApiKey = existing.apiKey || '';
  const fallbackProjectPath = existing.projectPath || tuiState.workingDir() || process.cwd();

  const [provider, setProvider] = createSignal("");
  const [model, setModel] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [projectPath, setProjectPath] = createSignal("");

  const [providerSelIdx, setProviderSelIdx] = createSignal(
    Math.max(0, PROVIDERS.findIndex(p => p.value === (existing.provider || fallbackProvider))),
  );

  // ── 使用 renderer.keyInput 直接监听键盘（绕过 focus 系统）───
  let keyHandler: ((key: KeyEvent) => void) | null = null;

  onMount(() => {
    keyHandler = (key: KeyEvent) => {
      const step = tuiState.setupStep();

      if (step === 0) {
        const max = PROVIDERS.length - 1;
        if (key.name === 'up' || key.name === 'k') {
          setProviderSelIdx(prev => prev > 0 ? prev - 1 : max);
          return;
        }
        if (key.name === 'down' || key.name === 'j') {
          setProviderSelIdx(prev => prev < max ? prev + 1 : 0);
          return;
        }
        if (key.name === 'return' || key.name === 'enter' || key.name === ' ') {
          const idx = providerSelIdx();
          setProvider(PROVIDERS[idx]?.value || fallbackProvider);
          saveStepData(0);
          tuiState.setSetupStep(1);
          return;
        }
        if (key.name === 'escape') {
          props.onComplete();
          return;
        }
      }

      if (step >= 1 && step <= 3) {
        if (key.name === "return" || key.name === "enter") {
          saveStepData(step);
          tuiState.setSetupStep(step + 1);
        } else if (key.name === "escape") {
          saveStepData(step);
          if (step === 1) {
            initProviderIdx();
            tuiState.setSetupStep(0);
          } else {
            tuiState.setSetupStep(step - 1);
          }
        }
      }

      if (step === 4) {
        if (key.name === "return" || key.name === "enter") {
          handleComplete();
        } else if (key.name === "escape") {
          saveStepData(4);
          tuiState.setSetupStep(3);
        }
      }
    };

    renderer.keyInput.on('keypress', keyHandler);
  });

  onCleanup(() => {
    if (keyHandler) {
      renderer.keyInput.removeListener('keypress', keyHandler);
    }
  });

  function initProviderIdx(): void {
    const p = provider() || existing.provider || fallbackProvider;
    const idx = PROVIDERS.findIndex(item => item.value === p);
    setProviderSelIdx(Math.max(0, idx));
  }

  function saveStepData(step: number): void {
    const data = { ...tuiState.setupData() };
    switch (step) {
      case 0:
        data.provider = provider() || PROVIDERS[providerSelIdx()]?.value || fallbackProvider;
        break;
      case 1:
        data.model = model() || fallbackModel;
        break;
      case 2:
        data.apiKey = apiKey() || fallbackApiKey;
        break;
      case 3:
        data.projectPath = projectPath() || fallbackProjectPath;
        break;
    }
    tuiState.setSetupData(data);
  }

  async function handleComplete(): Promise<void> {
    const data = tuiState.setupData();
    const resolvedProjectPath = data.projectPath || fallbackProjectPath;

    const merged = {
      agents: {
        default: {
          provider: data.provider || fallbackProvider,
          model: data.model || fallbackModel,
          apiKey: data.apiKey || fallbackApiKey,
        },
      },
      projectPath: resolvedProjectPath,
    };

    await writeModuleAgentJson(resolvedProjectPath, merged);

    tuiState.setSetupData({ ...data, savedTo: resolvedProjectPath });
    tuiState.setWorkingDir(resolvedProjectPath);
    props.onComplete();
  }

  const step = createMemo(() => tuiState.setupStep());

  const summaryText = createMemo((): string => {
    const data = tuiState.setupData();
    const lines: string[] = [];

    const pVal = data.provider || fallbackProvider;
    const pLabel = PROVIDERS.find(p => p.value === pVal)?.label || pVal;
    lines.push(`Provider: ${pLabel} (${pVal})`);
    lines.push(`Model: ${data.model || fallbackModel || '(default)'}`);
    lines.push(`API Key: ${data.apiKey ? '***configured***' : '(not set)'}`);
    lines.push(`项目目录: ${data.projectPath || fallbackProjectPath}`);

    return lines.join("\n");
  });

  return (
    <box flexDirection="column" padding={1} gap={1}>
      {/* ── Step 0: Provider selector ─────────────────── */}
      {step() === 0 && (
        <box flexDirection="column">
          <text>LLM 提供商 (↑↓ 选择, 空格/回车 确认)</text>
          <text dim>当前: {PROVIDERS.find(p => p.value === (existing.provider || fallbackProvider))?.label || fallbackProvider}</text>
          <box flexDirection="column" padding={0}>
            <For each={PROVIDERS}>
              {(item, i) => {
                const isSel = i() === providerSelIdx();
                return (
                  <box
                    flexDirection="row"
                    height={1}
                    backgroundColor={isSel ? '#1a2538' : 'transparent'}
                  >
                    <text width={2} fg={isSel ? '#58a6ff' : '#555555'}>
                      {isSel ? '▸' : ' '}
                    </text>
                    <text fg={isSel ? '#58a6ff' : '#c9d1d9'} bold={isSel}>
                      {item.label}
                    </text>
                    <text dim>  ({item.value})</text>
                  </box>
                );
              }}
            </For>
          </box>
        </box>
      )}

      {/* ── Step 1: Model ────────────────────────────── */}
      {step() === 1 && (
        <>
          <text>模型</text>
          <text dim>当前: {fallbackModel || '(未设置)'}</text>
          <input
            focused={true}
            value={model()}
            placeholder={fallbackModel || 'claude-sonnet-4-20250514'}
            onInput={(v: string) => setModel(v)}
          />
          <text dim>留空则使用提供商默认模型。按 Enter 继续。</text>
        </>
      )}

      {/* ── Step 2: API Key ──────────────────────────── */}
      {step() === 2 && (
        <>
          <text>API 密钥</text>
          <text dim>当前: {fallbackApiKey ? '***已配置***' : '(未设置)'}</text>
          <input
            focused={true}
            value={apiKey()}
            placeholder="sk-..."
            onInput={(v: string) => setApiKey(v)}
          />
          <text dim>存储于项目 .module-agent.json 中。按 Enter 继续。</text>
        </>
      )}

      {/* ── Step 3: Project path ─────────────────────── */}
      {step() === 3 && (
        <>
          <text>项目目录</text>
          <text dim>输入项目根目录路径。</text>
          <text dim>.module-agent/module/ 和 .module-agent/workspace/ 将自动创建。</text>
          <text dim>当前: {fallbackProjectPath}</text>
          <input
            focused={true}
            value={projectPath()}
            placeholder={fallbackProjectPath}
            onInput={(v: string) => setProjectPath(v)}
          />
          <text dim>按 Enter 继续。</text>
        </>
      )}

      {/* ── Step 4: Confirm ──────────────────────────── */}
      {step() === 4 && (
        <>
          <text>确认设置</text>
          <text>{summaryText()}</text>
          <text>按 Enter 开始，Esc 返回修改</text>
        </>
      )}
    </box>
  );
}
