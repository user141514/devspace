import assert from "node:assert/strict";
import { resolveShellCommand, terminateProcessTree } from "./process-platform.js";

const explicitGitBash = "E:\\git\\Git\\bin\\bash.exe";
const windowsRuntime = {
  exists: (path: string) => path === explicitGitBash,
  whereExecutables: (name: string) =>
    name === "bash.exe"
      ? ["C:\\Windows\\System32\\bash.exe"]
      : name === "git.exe"
        ? ["E:\\git\\Git\\cmd\\git.exe"]
        : [],
};

assert.deepEqual(
  resolveShellCommand(
    "pwd && git status --short --branch",
    "win32",
    { DEVSPACE_GIT_BASH: explicitGitBash },
    windowsRuntime,
  ),
  {
    executable: explicitGitBash,
    args: ["-lc", "pwd && git status --short --branch"],
  },
);

assert.deepEqual(
  resolveShellCommand("echo ok", "win32", {}, windowsRuntime),
  {
    executable: explicitGitBash,
    args: ["-lc", "echo ok"],
  },
  "Windows must ignore the WSL launcher and derive Git Bash from git.exe",
);

assert.throws(
  () =>
    resolveShellCommand(
      "echo ok",
      "win32",
      { DEVSPACE_GIT_BASH: "C:\\Windows\\System32\\bash.exe" },
      {
        exists: () => true,
        whereExecutables: (name: string) =>
          name === "bash.exe" ? ["C:\\Windows\\System32\\bash.exe"] : [],
      },
    ),
  /Git Bash is required.*WSL/i,
);

assert.deepEqual(resolveShellCommand("echo ok", "darwin", { SHELL: "/bin/zsh" }), {
  executable: "/bin/zsh",
  args: ["-lc", "echo ok"],
});

assert.deepEqual(resolveShellCommand("echo ok", "linux", { SHELL: "/bin/dash" }), {
  executable: "/bin/dash",
  args: ["-c", "echo ok"],
});

assert.deepEqual(resolveShellCommand("echo ok", "linux", { SHELL: "/usr/bin/fish" }), {
  executable: "/bin/sh",
  args: ["-c", "echo ok"],
});

const windowsCalls: string[] = [];
terminateProcessTree(
  { pid: 42, kill: (signal) => (windowsCalls.push(`child:${signal}`), true) },
  "SIGTERM",
  false,
  {
    platform: "win32",
    killGroup: () => undefined,
    killWindowsTree: (pid) => (windowsCalls.push(`tree:${pid}`), true),
  },
);
assert.deepEqual(windowsCalls, ["tree:42"]);

const posixCalls: string[] = [];
terminateProcessTree(
  { pid: 43, kill: (signal) => (posixCalls.push(`child:${signal}`), true) },
  "SIGINT",
  true,
  {
    platform: "darwin",
    killGroup: (pid, signal) => posixCalls.push(`group:${pid}:${signal}`),
    killWindowsTree: () => false,
  },
);
assert.deepEqual(posixCalls, ["group:43:SIGINT"]);

const fallbackCalls: string[] = [];
terminateProcessTree(
  { pid: 44, kill: (signal) => (fallbackCalls.push(`child:${signal}`), true) },
  "SIGTERM",
  false,
  {
    platform: "linux",
    killGroup: () => undefined,
    killWindowsTree: () => false,
  },
);
assert.deepEqual(fallbackCalls, ["child:SIGTERM"]);
