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
  const fallbackArgs = existing.args || (defaultConfig.agents.default.args ?? []).join(" ");
  const fallbackProjectPath = existing.projectPath || tuiState.workingDir() || process.cwd();

  // ── 本地编辑状态（初始为空，用户输入需显式确认） ─────
  const [command, setCommand] = createSignal("");
  const [args, setArgs] = createSignal("");
  const [projectPath, setProjectPath] = createSignal("");

  // ── 键盘导航 ─────────────────────────────────────────────
  useKeyboard((key: { name: string }) => {
    const step = tuiState.setupStep();

    if (key.name === "return") {
      if (step < 2) {
        saveStepData(step);
        tuiState.setSetupStep(step + 1);
      } else if (step === 2) {
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
        data.args = args() || fallbackArgs;
        break;
      case 1:
        data.projectPath = projectPath() || fallbackProjectPath;
        break;
    }
    tuiState.setSetupData(data);
  }

  async function handleComplete(): Promise<void> {
    const data = tuiState.setupData();

    const merged = {
      agents: {
        default: {
          command:
            data.command || defaultConfig.agents.default.command,
          args: (data.args || "")
            .split(/\s+/)
            .filter(Boolean),
        },
      },
      projectPath: data.projectPath || fallbackProjectPath,
    };

    const root = tuiState.workingDir() || process.cwd();
    await writeModuleAgentJson(root, merged);
    props.onComplete();
  }

  // ── 派生 ─────────────────────────────────────────────────────────
  const step = createMemo(() => tuiState.setupStep());

  const summaryText = createMemo((): string => {
    const data = tuiState.setupData();
    const lines: string[] = [];

    lines.push(
      `Agent 命令: ${data.command || defaultConfig.agents.default.command} ${data.args || (defaultConfig.agents.default.args ?? []).join(" ")}`,
    );
    lines.push(`项目目录: ${data.projectPath || fallbackProjectPath}`);
    lines.push(`配置保存目录: ${tuiState.workingDir() || process.cwd()}`);

    return lines.join("\n");
  });

  // ── 渲染 ──────────────────────────────────────────────────────────
  return (
    <box flexDirection="column" padding={1} gap={1}>
      {/* ── 步骤 0：Agent 配置 ──────────────────────────────────────── */}
      {step() === 0 && (
        <>
          <text>Agent 配置</text>
          <text dim>当前: {fallbackCommand} {fallbackArgs}</text>
          <text>命令:</text>
          <input
            focused={true}
            value={command()}
            placeholder={fallbackCommand}
            onInput={(v: string) => setCommand(v)}
          />
          <text>参数 (空格分隔):</text>
          <input
            value={args()}
            placeholder={fallbackArgs}
            onInput={(v: string) => setArgs(v)}
          />
        </>
      )}

      {/* ── 步骤 1：项目目录 ──────────────────────────────────────── */}
      {step() === 1 && (
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

      {/* ── 步骤 2：确认设置 ───────────────────────────────────────── */}
      {step() === 2 && (
        <>
          <text>确认设置</text>
          <text>{summaryText()}</text>
          <text>按 Enter 开始，Esc 返回修改</text>
        </>
      )}
    </box>
  );
}
