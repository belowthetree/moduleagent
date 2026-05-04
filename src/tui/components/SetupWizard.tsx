import { createSignal, createMemo } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { tuiState } from "../state.js";
import {
  writeModuleAgentJson,
  getDefaultConfig,
} from "../config.js";
import type { CodeSourceConfig } from "../../config/defaults.js";

interface SetupWizardProps {
  onComplete: () => void;
}

export default function SetupWizard(props: SetupWizardProps) {
  const defaultConfig = getDefaultConfig();
  const existing = tuiState.setupData();

  // Existing/default values for fallback and placeholders
  const fallbackCommand = existing.command || defaultConfig.agents.default.command;
  const fallbackArgs = existing.args || (defaultConfig.agents.default.args ?? []).join(" ");
  const fallbackWorkspacePath = existing.workspacePath || defaultConfig.workspace.path;
  const fallbackModulesPath = existing.modulesPath || "";
  const fallbackCodeSourcePath = existing.codeSourcePath || "";
  const fallbackCodeSourceUrl = existing.codeSourceUrl || "";
  const fallbackCodeSourceBranch = existing.codeSourceBranch || "main";

  // ── local editing state (start empty, user input is explicit) ─────
  const [command, setCommand] = createSignal("");
  const [args, setArgs] = createSignal("");
  const [workspacePath, setWorkspacePath] = createSignal("");
  const [modulesPath, setModulesPath] = createSignal("");
  const [codeSourceType, setCodeSourceType] = createSignal<string>(
    existing.codeSourceType || "local",
  );
  const [codeSourcePath, setCodeSourcePath] = createSignal("");
  const [codeSourceUrl, setCodeSourceUrl] = createSignal("");
  const [codeSourceBranch, setCodeSourceBranch] = createSignal("");

  // ── keyboard navigation ─────────────────────────────────────────────
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
    } else if (key.name === "tab" && step === 3) {
      setCodeSourceType((prev) => (prev === "local" ? "git" : "local"));
    }
  });

  // ── data persistence ────────────────────────────────────────────────
  function saveStepData(step: number): void {
    const data = { ...tuiState.setupData() };
    switch (step) {
      case 0:
        data.command = command() || fallbackCommand;
        data.args = args() || fallbackArgs;
        break;
      case 1:
        data.modulesPath = modulesPath() || fallbackModulesPath;
        break;
      case 2:
        data.workspacePath = workspacePath() || fallbackWorkspacePath;
        break;
      case 3:
        data.codeSourceType = codeSourceType() || "local";
        data.codeSourcePath = codeSourcePath() || fallbackCodeSourcePath;
        data.codeSourceUrl = codeSourceUrl() || fallbackCodeSourceUrl;
        data.codeSourceBranch = codeSourceBranch() || fallbackCodeSourceBranch;
        break;
    }
    tuiState.setSetupData(data);
  }

  async function handleComplete(): Promise<void> {
    const data = tuiState.setupData();

    const codeSource: CodeSourceConfig = {
      type: (data.codeSourceType as "git" | "local") || "local",
    };
    if (codeSource.type === "local") {
      codeSource.path = data.codeSourcePath || "";
    } else {
      codeSource.url = data.codeSourceUrl || "";
      codeSource.branch = data.codeSourceBranch || "main";
    }

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
      workspace: {
        path: data.workspacePath || defaultConfig.workspace.path,
      },
      codeSource,
      modulesPath: data.modulesPath || "",
    };

    const root = tuiState.workingDir() || process.cwd();
    await writeModuleAgentJson(root, merged);
    props.onComplete();
  }

  // ── derived ─────────────────────────────────────────────────────────
  const step = createMemo(() => tuiState.setupStep());

  const summaryText = createMemo((): string => {
    const data = tuiState.setupData();
    const lines: string[] = [];

    lines.push(
      `Agent 命令: ${data.command || defaultConfig.agents.default.command} ${data.args || (defaultConfig.agents.default.args ?? []).join(" ")}`,
    );
    lines.push(`模块文件夹: ${data.modulesPath || "(未指定)"}`);
    lines.push(`工作区: ${data.workspacePath || defaultConfig.workspace.path}`);
    lines.push(`配置保存目录: ${tuiState.workingDir() || process.cwd()}`);

    if ((data.codeSourceType || "local") === "local") {
      lines.push(
        `代码来源: 本地目录 (${data.codeSourcePath || "(未指定)"})`,
      );
    } else {
      lines.push(`代码来源: Git 仓库`);
      lines.push(`  URL: ${data.codeSourceUrl || "(未指定)"}`);
      lines.push(`  分支: ${data.codeSourceBranch || "main"}`);
    }

    return lines.join("\n");
  });

  // ── render ──────────────────────────────────────────────────────────
  return (
    <box flexDirection="column" padding={1} gap={1}>
      {/* ── Step 0: Agent 配置 ──────────────────────────────────────── */}
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

      {/* ── Step 1: 模块文件夹 (module.md 所在路径) ────────────────── */}
      {step() === 1 && (
        <>
          <text>模块文件夹</text>
          <text dim>module.md 文件所在的目录。留空则仅扫描项目目录。</text>
          <text dim>当前: {fallbackModulesPath || "(未配置)"}</text>
          <input
            focused={true}
            value={modulesPath()}
            placeholder={fallbackModulesPath || "留空则仅扫描项目目录"}
            onInput={(v: string) => setModulesPath(v)}
          />
        </>
      )}

      {/* ── Step 2: 工作区目录 ──────────────────────────────────────── */}
      {step() === 2 && (
        <>
          <text>工作区目录</text>
          <text dim>当前: {fallbackWorkspacePath}</text>
          <input
            focused={true}
            value={workspacePath()}
            placeholder={fallbackWorkspacePath}
            onInput={(v: string) => setWorkspacePath(v)}
          />
        </>
      )}

      {/* ── Step 3: 代码来源 ───────────────────────────────────────── */}
      {step() === 3 && (
        <>
          <text>代码来源 (Tab 切换)</text>
          <text
            fg={
              codeSourceType() === "local" ? "#00FF00" : undefined
            }
          >
            {codeSourceType() === "local" ? "▶ " : "  "}本地目录
          </text>
          <text
            fg={
              codeSourceType() === "git" ? "#00FF00" : undefined
            }
          >
            {codeSourceType() === "git" ? "▶ " : "  "}Git 仓库
          </text>
          {codeSourceType() === "local" && (
            <>
              <text dim>当前: {fallbackCodeSourcePath || "(未配置)"}</text>
              <text>路径:</text>
              <input
                focused={true}
                value={codeSourcePath()}
                placeholder={fallbackCodeSourcePath}
                onInput={(v: string) => setCodeSourcePath(v)}
              />
            </>
          )}
          {codeSourceType() === "git" && (
            <>
              <text dim>当前: {fallbackCodeSourceUrl || "(未配置)"} @ {fallbackCodeSourceBranch}</text>
              <text>URL:</text>
              <input
                focused={true}
                value={codeSourceUrl()}
                placeholder={fallbackCodeSourceUrl}
                onInput={(v: string) => setCodeSourceUrl(v)}
              />
              <text>分支:</text>
              <input
                value={codeSourceBranch()}
                placeholder={fallbackCodeSourceBranch}
                onInput={(v: string) => setCodeSourceBranch(v)}
              />
            </>
          )}
        </>
      )}

      {/* ── Step 4: 确认设置 ───────────────────────────────────────── */}
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
