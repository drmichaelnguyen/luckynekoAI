import { execFile, spawn, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = process.cwd();
const LAUNCHD_LABEL = "com.luckyneko.app";

export type GitStatusInfo = {
  branch: string;
  commit: string;
  shortCommit: string;
  describe: string;
  commitDate: string | null;
  subject: string | null;
  dirty: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
};

export type GitUpdateResult = {
  branch: string;
  pullOutput: string;
  buildOutput: string;
  restartQueued: boolean;
};

async function runCommand(command: string, args: string[], options: ExecFileOptions = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: REPO_ROOT,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });

  return {
    stdout: String(stdout ?? ""),
    stderr: String(stderr ?? ""),
  };
}

function trim(output: string) {
  return output.trim();
}

export async function readGitStatusInfo(): Promise<GitStatusInfo> {
  const [branch, commit, shortCommit, describe, commitInfo, statusOutput] = await Promise.all([
    runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    runCommand("git", ["rev-parse", "HEAD"]),
    runCommand("git", ["rev-parse", "--short", "HEAD"]),
    runCommand("git", ["describe", "--tags", "--always", "--dirty", "--abbrev=7"]),
    runCommand("git", ["log", "-1", "--format=%cI%x00%s"]),
    runCommand("git", ["status", "--short"]),
  ]);

  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;

  try {
    const upstreamResult = await runCommand("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    upstream = trim(upstreamResult.stdout) || null;
    if (upstream) {
      const counts = await runCommand("git", ["rev-list", "--left-right", "--count", `${upstream}...HEAD`]);
      const [behindCount, aheadCount] = trim(counts.stdout)
        .split(/\s+/)
        .map((value) => Number.parseInt(value, 10));
      behind = Number.isFinite(behindCount) ? behindCount : null;
      ahead = Number.isFinite(aheadCount) ? aheadCount : null;
    }
  } catch {
    upstream = null;
    ahead = null;
    behind = null;
  }

  const [commitDate, subject] = trim(commitInfo.stdout).split("\u0000");

  return {
    branch: trim(branch.stdout) || "unknown",
    commit: trim(commit.stdout),
    shortCommit: trim(shortCommit.stdout),
    describe: trim(describe.stdout),
    commitDate: commitDate || null,
    subject: subject || null,
    dirty: trim(statusOutput.stdout).length > 0,
    upstream,
    ahead,
    behind,
  };
}

export async function updateFromGitAndRestart(): Promise<GitUpdateResult> {
  const status = await readGitStatusInfo();
  const branch = status.branch === "HEAD" ? "main" : status.branch;

  const pullResult = await runCommand("git", ["pull", "--ff-only", "origin", branch]);
  const installResult = await runCommand("npm", ["ci"]);
  const buildResult = await runCommand("npm", ["run", "build"]);

  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid != null) {
    const restartTarget = `gui/${uid}/${LAUNCHD_LABEL}`;
    const restart = spawn("/bin/sh", ["-lc", `sleep 2; launchctl kickstart -k ${restartTarget}`], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: "ignore",
    });
    restart.unref();
  }

  return {
    branch,
    pullOutput: [pullResult.stdout, pullResult.stderr, installResult.stdout, installResult.stderr]
      .filter(Boolean)
      .map(trim)
      .filter(Boolean)
      .join("\n"),
    buildOutput: [buildResult.stdout, buildResult.stderr].filter(Boolean).map(trim).filter(Boolean).join("\n"),
    restartQueued: uid != null,
  };
}
