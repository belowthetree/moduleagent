import { createSignal, createMemo } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { tuiState } from "../state.js";
import {
  writeModuleAgentJson,
  getDefaultConfig,
} from "../config.js";

interface SetupWizardProps {
  onComplete: () => void;
}

export default function SetupWizard(props: SetupWizardProps) {
  const defaultConfig = getDefaultConfig();
  const existing = tuiState.setupData();

  // 回退和占位符的现有/默认值
  const fallbackCommand = existing.command || defaultConfig.agents.default.command;
  const fallbackModel = existing.model || '';
  const fallbackArgs = existing.args || (defaultConfig.agents.default.args ?? []).join(" ");
  const fallbackProjectPath = existing.projectPath || tuiState.workingDir() || process.cwd();

  // ── 本地编辑状态（初始为空，用户输入需显式确认） ─────
  const [command, setCommand] = createSignal("");
  const [model, setModel] = createSignal("");
  const [extraArgs, setExtraArgs] = createSignal("");
  const [projectPath, setProjectPath] = createSignal("");

  // ── 键盘导航 ─────────────────────────────────────────────
  useKeyboard((key: { name: string }) => {
    const step = tuiState.setupStep();

    if (key.name === "return") {
      if (step < 4) {
        saveStepData(step);
        tuiState.setSetupStep(step + 1);
      } else if (step === 4) {
        handleComplete();
      }
    } else if (key.name === "escape") {
      if (step === 0) {
        props.onComplete();
      } else {
        saveStepData(step);
        tuiState.setSetupStep(step - 1);
      }
    }
  });

  // ── 数据持久化 ────────────────────────────────────────────────
  function saveStepData(step: number): void {
    const data = { ...tuiState.setupData() };
    switch (step) {
      case 0:
        data.command = command() || fallbackCommand;
        break;
      case 1:
        data.model = model() || fallbackModel;
        break;
      case 2:
        data.args = extraArgs() || fallbackArgs;
        break;
      case 3:
        data.projectPath = projectPath() || fallbackProjectPath;
        break;
    }
    tuiState.setSetupData(data);
  }

  async function handleComplete(): Promise<void> {
    const data = tuiState.setupData();

    // 构建 args：只放额外参数，model 独立字段不混入
    const argsParts: string[] = data.args
      ? data.args.split(/\s+/).filter(Boolean)
      : [];

    const resolvedProjectPath = data.projectPath || fallbackProjectPath;

    const merged = {
      agents: {
        default: {
          command: data.command || defaultConfig.agents.default.command,
          args: argsParts.length > 0 ? argsParts : defaultConfig.agents.default.args,
          ...(data.model ? { model: data.model } : {}),
        },
      },
      projectPath: resolvedProjectPath,
    };

    // 将配置保存到用户指定的项目目录
    await writeModuleAgentJson(resolvedProjectPath, merged);

    // 更新工作目录并通知外部
    tuiState.setSetupData({ ...data, savedTo: resolvedProjectPath });
    tuiState.setWorkingDir(resolvedProjectPath);
    props.onComplete();
  }

  // ── 派生 ─────────────────────────────────────────────────────────
  const step = createMemo(() => tuiState.setupStep());

  const summaryText = createMemo((): string => {
    const data = tuiState.setupData();
    const lines: string[] = [];

    const modelPart = data.model ? ` (model: ${data.model})` : '';
    const argsPart = data.args ? ` [${data.args}]` : '';
    lines.push(
      `Agent: ${data.command || defaultConfig.agents.default.command}${modelPart}${argsPart}`,
    );
    lines.push(`项目目录: ${data.projectPath || fallbackProjectPath}`);
    lines.push(`配置保存目录: ${tuiState.workingDir() || process.cwd()}`);

    return lines.join("\n");
  });

  // ── 渲染 ──────────────────────────────────────────────────────────
  return (
    <box flexDirection="column" padding={1} gap={1}>
      {/* ── 步骤 0：Agent 命令 ──────────────────────────────────────── */}
      {step() === 0 && (
        <>
          <text>Agent 命令</text>
          <text dim>当前: {fallbackCommand}</text>
          <input
            focused={true}
            value={command()}
            placeholder={fallbackCommand}
            onInput={(v: string) => setCommand(v)}
          />
        </>
      )}

      {/* ── 步骤 1：模型 ──────────────────────────────────────── */}
      {step() === 1 && (
        <>
          <text>模型</text>
          <text dim>例如: gpt-4, claude-sonnet-4-20250514, deepseek-v3</text>
          <text dim>当前: {fallbackModel || '(未设置)'}</text>
          <input
            focused={true}
            value={model()}
            placeholder={fallbackModel || 'gpt-4'}
            onInput={(v: string) => setModel(v)}
          />
          <text dim>留空则使用 Agent 默认模型。</text>
        </>
      )}

      {/* ── 步骤 2：额外参数 ──────────────────────────────────────── */}
      {step() === 2 && (
        <>
          <text>额外参数</text>
          <text dim>其他需要传递给 Agent 的命令行参数。</text>
          <text dim>当前: {fallbackArgs || '(无)'}</text>
          <input
            focused={true}
            value={extraArgs()}
            placeholder={fallbackArgs}
            onInput={(v: string) => setExtraArgs(v)}
          />
        </>
      )}

      {/* ── 步骤 3：项目目录 ──────────────────────────────────────── */}
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
        </>
      )}

      {/* ── 步骤 4：确认设置 ────────────────────────────────────────── */}
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
