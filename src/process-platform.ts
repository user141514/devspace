import { existsSync } from "node:fs";
import { basename, delimiter, dirname, win32 } from "node:path";
import { spawnSync } from "node:child_process";

export interface ShellCommand {
  executable: string;
  args: string[];
}

export interface KillableProcess {
  pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface ShellResolutionRuntime {
  exists(path: string): boolean;
  whereExecutables(name: string): string[];
}

interface ProcessTreeRuntime {
  platform: NodeJS.Platform;
  killGroup(pid: number, signal: NodeJS.Signals): void;
  killWindowsTree(pid: number): boolean;
}

const defaultShellResolutionRuntime: ShellResolutionRuntime = {
  exists: existsSync,
  whereExecutables: (name) => {
    const result = spawnSync("where.exe", [name], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return [];
    return (result.stdout ?? "")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
  },
};

const defaultProcessTreeRuntime: ProcessTreeRuntime = {
  platform: process.platform,
  killGroup: (pid, signal) => process.kill(-pid, signal),
  killWindowsTree: (pid) => {
    const result = spawnSync("taskkill.exe", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return !result.error && result.status === 0;
  },
};

const LOGIN_SHELLS = new Set(["bash", "ksh", "zsh"]);

export function exposeDevspaceSiblingExecutables(
  environment: NodeJS.ProcessEnv,
  devspaceExecutable: string | undefined = process.argv[1],
): NodeJS.ProcessEnv {
  if (!devspaceExecutable) return { ...environment };

  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const executableDirectory = dirname(devspaceExecutable);
  const entries = (environment[pathKey] ?? "").split(delimiter).filter(Boolean);
  const normalize = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  if (!entries.some((entry) => normalize(entry) === normalize(executableDirectory))) {
    entries.unshift(executableDirectory);
  }

  return { ...environment, [pathKey]: entries.join(delimiter) };
}
const POSIX_SHELLS = new Set(["ash", "dash", "sh"]);

function normalizeWindowsExecutable(path: string): string {
  return win32.normalize(path.trim().replace(/^"(.*)"$/u, "$1"));
}

function isWslBashLauncher(path: string, environment: NodeJS.ProcessEnv): boolean {
  const normalized = normalizeWindowsExecutable(path).toLowerCase();
  const systemRoot = normalizeWindowsExecutable(
    environment.SystemRoot ?? environment.SYSTEMROOT ?? "C:\\Windows",
  ).toLowerCase();
  return (
    normalized === win32.join(systemRoot, "System32", "bash.exe").toLowerCase() ||
    normalized.includes("\\windowsapps\\")
  );
}

function gitBashCandidatesFromGit(gitPath: string): string[] {
  const executable = normalizeWindowsExecutable(gitPath);
  const directory = win32.dirname(executable);
  const directoryName = win32.basename(directory).toLowerCase();
  if (directoryName === "cmd") {
    const root = win32.dirname(directory);
    return [win32.join(root, "bin", "bash.exe"), win32.join(root, "usr", "bin", "bash.exe")];
  }
  if (directoryName === "bin") {
    const root = win32.dirname(directory);
    return [win32.join(directory, "bash.exe"), win32.join(root, "usr", "bin", "bash.exe")];
  }
  return [];
}

function isGitForWindowsBash(path: string, runtime: ShellResolutionRuntime): boolean {
  const executable = normalizeWindowsExecutable(path);
  if (win32.basename(executable).toLowerCase() !== "bash.exe") return false;

  const binDirectory = win32.dirname(executable);
  const parent = win32.dirname(binDirectory);
  const root =
    win32.basename(parent).toLowerCase() === "usr" ? win32.dirname(parent) : parent;
  return (
    runtime.exists(win32.join(root, "cmd", "git.exe")) ||
    runtime.exists(win32.join(root, "bin", "git.exe"))
  );
}

function resolveWindowsGitBash(
  environment: NodeJS.ProcessEnv,
  runtime: ShellResolutionRuntime,
): string {
  const configured = environment.DEVSPACE_GIT_BASH;
  if (configured) {
    const candidate = normalizeWindowsExecutable(configured);
    if (isWslBashLauncher(candidate, environment)) {
      throw new Error(
        "Git Bash is required on Windows; the WSL bash launcher is not supported. Set DEVSPACE_GIT_BASH to Git for Windows bash.exe.",
      );
    }
    if (!runtime.exists(candidate)) {
      throw new Error(`Configured DEVSPACE_GIT_BASH does not exist: ${candidate}`);
    }
    return candidate;
  }

  const candidates: Array<{ path: string; trustedLayout: boolean }> = [];
  for (const gitPath of runtime.whereExecutables("git.exe")) {
    for (const path of gitBashCandidatesFromGit(gitPath)) {
      candidates.push({ path, trustedLayout: true });
    }
  }

  const installRoots = [
    environment.ProgramW6432,
    environment.ProgramFiles,
    environment["ProgramFiles(x86)"],
    environment.LocalAppData ? win32.join(environment.LocalAppData, "Programs") : undefined,
  ].filter((value): value is string => Boolean(value));
  for (const root of installRoots) {
    candidates.push(
      { path: win32.join(root, "Git", "bin", "bash.exe"), trustedLayout: true },
      { path: win32.join(root, "Git", "usr", "bin", "bash.exe"), trustedLayout: true },
    );
  }

  for (const path of runtime.whereExecutables("bash.exe")) {
    candidates.push({ path, trustedLayout: false });
  }

  const seen = new Set<string>();
  for (const entry of candidates) {
    const candidate = normalizeWindowsExecutable(entry.path);
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (isWslBashLauncher(candidate, environment) || !runtime.exists(candidate)) continue;
    if (entry.trustedLayout || isGitForWindowsBash(candidate, runtime)) return candidate;
  }

  throw new Error(
    "Git Bash is required on Windows; WSL bash.exe and cmd.exe are not supported. Install Git for Windows or set DEVSPACE_GIT_BASH.",
  );
}

export function resolveShellCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  runtime: ShellResolutionRuntime = defaultShellResolutionRuntime,
): ShellCommand {
  if (platform === "win32") {
    return {
      executable: resolveWindowsGitBash(environment, runtime),
      args: ["-lc", command],
    };
  }

  const configuredShell = environment.SHELL;
  const shellName = configuredShell ? basename(configuredShell) : "";
  if (configuredShell && LOGIN_SHELLS.has(shellName)) {
    return { executable: configuredShell, args: ["-lc", command] };
  }
  if (configuredShell && POSIX_SHELLS.has(shellName)) {
    return { executable: configuredShell, args: ["-c", command] };
  }

  return { executable: "/bin/sh", args: ["-c", command] };
}

export function terminateProcessTree(
  child: KillableProcess,
  signal: NodeJS.Signals,
  detached: boolean,
  runtime: ProcessTreeRuntime = defaultProcessTreeRuntime,
): void {
  if (runtime.platform === "win32" && child.pid) {
    if (runtime.killWindowsTree(child.pid)) return;
  } else if (detached && child.pid) {
    try {
      runtime.killGroup(child.pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    }
  }

  child.kill(signal);
}
