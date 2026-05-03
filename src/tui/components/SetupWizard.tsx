import { createSignal, createEffect, createMemo } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { tuiState } from "../state.js";
import {
  validateModuleAgentJson,
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

  // ── local editing state ────────────────────────────────────────────
  const [command, setCommand] = createSignal(
    existing.command || defaultConfig.agents.default.command,
  );
  const [args, setArgs] = createSignal(
    existing.args ||
      (defaultConfig.agents.default.args ?? []).join(" "),
  );
  const [projectRoot, setProjectRoot] = createSignal(
    existing.projectRoot || process.cwd(),
  );
  const [workspacePath, setWorkspacePath] = createSignal(
    existing.workspacePath || defaultConfig.workspace.path,
  );
  const [codeSourceType, setCodeSourceType] = createSignal<string>(
    existing.codeSourceType || "local",
  );
  const [codeSourcePath, setCodeSourcePath] = createSignal(
    existing.codeSourcePath || "",
  );
  const [codeSourceUrl, setCodeSourceUrl] = createSignal(
    existing.codeSourceUrl || "",
  );
  const [codeSourceBranch, setCodeSourceBranch] = createSignal(
    existing.codeSourceBranch || "main",
  );

  // ── validation ──────────────────────────────────────────────────────
  const [projectValid, setProjectValid] = createSignal<boolean | null>(null);
  const [validating, setValidating] = createSignal(false);

  createEffect(() => {
    if (tuiState.setupStep() !== 1) return;
    const root = projectRoot();
    if (!root) {
      setProjectValid(null);
      setValidating(false);
      return;
    }
    setValidating(true);
    validateModuleAgentJson(root)
      .then((ok) => {
        setProjectValid(ok);
        setValidating(false);
      })
      .catch(() => {
        setProjectValid(false);
        setValidating(false);
      });
  });

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
        data.command = command();
        data.args = args();
        break;
      case 1:
        data.projectRoot = projectRoot();
        break;
      case 2:
        data.workspacePath = workspacePath();
        break;
      case 3:
        data.codeSourceType = codeSourceType();
        data.codeSourcePath = codeSourcePath();
        data.codeSourceUrl = codeSourceUrl();
        data.codeSourceBranch = codeSourceBranch();
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
    };

    const root = data.projectRoot || process.cwd();
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
    lines.push(`项目目录: ${data.projectRoot || process.cwd()}`);
    lines.push(`工作区: ${data.workspacePath || defaultConfig.workspace.path}`);

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
          <text>命令:</text>
          <input
            focused={true}
            value={command()}
            onInput={(v: string) => setCommand(v)}
          />
          <text>参数 (空格分隔):</text>
          <input
            value={args()}
            onInput={(v: string) => setArgs(v)}
          />
        </>
      )}

      {/* ── Step 1: 项目目录 ────────────────────────────────────────── */}
      {step() === 1 && (
        <>
          <text>项目目录</text>
          <input
            focused={true}
            value={projectRoot()}
            onInput={(v: string) => setProjectRoot(v)}
          />
          {validating() && <text>检查中…</text>}
          {!validating() && projectValid() === true && (
            <text fg="#00FF00">✅ 已找到 .module-agent.json</text>
          )}
          {!validating() && projectValid() === false && (
            <text fg="#FFFF00">
              ⚠️ 未找到 .module-agent.json
            </text>
          )}
        </>
      )}

      {/* ── Step 2: 工作区目录 ──────────────────────────────────────── */}
      {step() === 2 && (
        <>
          <text>工作区目录</text>
          <input
            focused={true}
            value={workspacePath()}
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
              <text>路径:</text>
              <input
                focused={true}
                value={codeSourcePath()}
                onInput={(v: string) => setCodeSourcePath(v)}
              />
            </>
          )}
          {codeSourceType() === "git" && (
            <>
              <text>URL:</text>
              <input
                focused={true}
                value={codeSourceUrl()}
                onInput={(v: string) => setCodeSourceUrl(v)}
              />
              <text>分支:</text>
              <input
                value={codeSourceBranch()}
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
