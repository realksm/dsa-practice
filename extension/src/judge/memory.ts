/**
 * Peak memory and the memory limit. Node can't see a child's memory use, so solutions run under a
 * tiny helper ("memwatch") compiled once with the user's g++:
 *
 * - Windows: the program runs in a Job Object. The limit is enforced by the kernel (an allocation
 *   past it fails, and the job reports it); the peak is the job's peak committed memory. Killing the
 *   helper (time limit, Stop) kills the job.
 * - Linux / Mac: the peak is the child's max resident set (wait4). Over the limit = MLE afterwards;
 *   the time limit stops a runaway. On Linux the child dies with the helper (PR_SET_PDEATHSIG).
 *   The helper also raises the stack limit to 256 MB (or the hard limit), as Windows does with a
 *   linker flag.
 *
 * Without g++ nothing is measured and the limit isn't checked (JudgeReport.memoryChecked = false).
 * Java gets -Xmx<limit>m instead of a hard cap on the whole JVM (its own overhead would count).
 */
import { createHash } from "crypto";
import { existsSync, promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { DEFAULT_TOOLS, Program } from "./languages";
import { runProcess, RunOptions, RunResult } from "./runner";

const IS_WIN = process.platform === "win32";

export const MEMWATCH_SOURCE = String.raw`// memwatch: run a program, report its peak memory. Written by DSA Drill.
// usage: memwatch <limitMB, 0 = none> <report file> <program...>
// On Windows the program is given as one already-quoted command line.
// The report is "<peak bytes> <limit hit 0|1> <wall ms>", or "spawn_error <code>".
#ifdef _WIN32
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

static void report(const wchar_t* file, const char* text) {
  FILE* f = _wfopen(file, L"wb");
  if (f) { fputs(text, f); fclose(f); }
}

int wmain(int argc, wchar_t** argv) {
  if (argc < 4) { fputs("usage: memwatch <limitMB> <report> <command line>\n", stderr); return 125; }
  double limitMb = _wtof(argv[1]);
  SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);

  HANDLE job = CreateJobObjectW(NULL, NULL);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION li;
  ZeroMemory(&li, sizeof li);
  li.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
  if (limitMb > 0) {
    li.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
    li.JobMemoryLimit = (SIZE_T)(limitMb * 1024.0 * 1024.0);
  }
  SetInformationJobObject(job, JobObjectExtendedLimitInformation, &li, sizeof li);
  HANDLE port = CreateIoCompletionPort(INVALID_HANDLE_VALUE, NULL, 0, 1);
  JOBOBJECT_ASSOCIATE_COMPLETION_PORT acp;
  acp.CompletionKey = job;
  acp.CompletionPort = port;
  SetInformationJobObject(job, JobObjectAssociateCompletionPortInformation, &acp, sizeof acp);

  STARTUPINFOW si;
  ZeroMemory(&si, sizeof si);
  si.cb = sizeof si;
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  SetHandleInformation(si.hStdInput, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
  SetHandleInformation(si.hStdOutput, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
  SetHandleInformation(si.hStdError, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);

  size_t n = wcslen(argv[3]);
  wchar_t* cmd = (wchar_t*)malloc((n + 1) * sizeof(wchar_t));
  wcscpy(cmd, argv[3]);
  PROCESS_INFORMATION pi;
  LARGE_INTEGER freq, t0, t1;
  QueryPerformanceFrequency(&freq);
  if (!CreateProcessW(NULL, cmd, NULL, NULL, TRUE, CREATE_SUSPENDED, NULL, NULL, &si, &pi)) {
    char buf[64];
    sprintf(buf, "spawn_error %lu\n", GetLastError());
    report(argv[2], buf);
    return 126;
  }
  AssignProcessToJobObject(job, pi.hProcess);
  QueryPerformanceCounter(&t0);
  ResumeThread(pi.hThread);
  CloseHandle(pi.hThread);
  WaitForSingleObject(pi.hProcess, INFINITE);
  QueryPerformanceCounter(&t1);
  DWORD code = 0;
  GetExitCodeProcess(pi.hProcess, &code);

  int hit = 0;
  DWORD msg;
  ULONG_PTR key;
  LPOVERLAPPED ov;
  while (GetQueuedCompletionStatus(port, &msg, &key, &ov, 200)) {
    if (msg == JOB_OBJECT_MSG_JOB_MEMORY_LIMIT || msg == JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT) hit = 1;
    if (msg == JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO) break;
  }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION info;
  ZeroMemory(&info, sizeof info);
  QueryInformationJobObject(job, JobObjectExtendedLimitInformation, &info, sizeof info, NULL);
  char buf[128];
  sprintf(buf, "%llu %d %.3f\n", (unsigned long long)info.PeakJobMemoryUsed, hit,
          (double)(t1.QuadPart - t0.QuadPart) * 1000.0 / (double)freq.QuadPart);
  report(argv[2], buf);
  return (int)code;
}
#else
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/prctl.h>
#endif

static void report(const char* file, const char* text) {
  FILE* f = fopen(file, "wb");
  if (f) { fputs(text, f); fclose(f); }
}

int main(int argc, char** argv) {
  if (argc < 4) { fputs("usage: memwatch <limitMB> <report> <program> [args...]\n", stderr); return 125; }
  double limitMb = atof(argv[1]);
  struct timespec t0, t1;
  clock_gettime(CLOCK_MONOTONIC, &t0);
  pid_t pid = fork();
  if (pid < 0) return 126;
  if (pid == 0) {
#ifdef __linux__
    prctl(PR_SET_PDEATHSIG, SIGKILL);
#endif
    /* 256 MB stack like the judges (the default is 8 MB); exec keeps it. Capped at the hard limit. */
    struct rlimit st;
    if (getrlimit(RLIMIT_STACK, &st) == 0) {
      rlim_t want = (rlim_t)256 * 1024 * 1024;
      if (st.rlim_max != RLIM_INFINITY && st.rlim_max < want) want = st.rlim_max;
      if (st.rlim_cur != RLIM_INFINITY && st.rlim_cur < want) { st.rlim_cur = want; setrlimit(RLIMIT_STACK, &st); }
    }
    execvp(argv[3], argv + 3);
    char buf[64];
    sprintf(buf, "spawn_error %d\n", errno);
    report(argv[2], buf);
    _exit(126);
  }
  int status = 0;
  struct rusage ru;
  while (wait4(pid, &status, 0, &ru) < 0 && errno == EINTR) {}
  clock_gettime(CLOCK_MONOTONIC, &t1);
#ifdef __APPLE__
  unsigned long long peak = (unsigned long long)ru.ru_maxrss;
#else
  unsigned long long peak = (unsigned long long)ru.ru_maxrss * 1024ULL;
#endif
  FILE* f = fopen(argv[2], "rb");
  if (f) { /* the child could not exec and already wrote spawn_error */
    int c = fgetc(f);
    fclose(f);
    if (c == 's') return 126;
  }
  int hit = limitMb > 0 && (double)peak > limitMb * 1024.0 * 1024.0;
  char buf[128];
  sprintf(buf, "%llu %d %.3f\n", peak, hit, (t1.tv_sec - t0.tv_sec) * 1000.0 + (t1.tv_nsec - t0.tv_nsec) / 1e6);
  report(argv[2], buf);
  if (WIFSIGNALED(status)) {
    signal(WTERMSIG(status), SIG_DFL);
    kill(getpid(), WTERMSIG(status));
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
#endif
`;

const compiled = new Map<string, Promise<string | undefined>>();

/**
 * The memwatch executable for this g++, compiling it on first use into the temp folder (kept
 * across sessions). Undefined if it can't be built (no g++): memory then isn't measured.
 */
export function getMemwatch(cpp?: string): Promise<string | undefined> {
  const compiler = cpp?.trim() || DEFAULT_TOOLS.cpp;
  const key = createHash("sha256").update(MEMWATCH_SOURCE).update("\0").update(compiler).update("\0").update(process.platform).digest("hex").slice(0, 16);
  let p = compiled.get(key);
  if (!p) {
    p = build(compiler, key);
    compiled.set(key, p);
  }
  return p;
}

async function build(compiler: string, key: string): Promise<string | undefined> {
  const dir = path.join(os.tmpdir(), `dsa-drill-memwatch-${key}`);
  const exe = path.join(dir, IS_WIN ? "memwatch.exe" : "memwatch");
  if (existsSync(exe)) return exe;
  try {
    await fs.mkdir(dir, { recursive: true });
    const src = path.join(dir, "memwatch.cpp");
    await fs.writeFile(src, MEMWATCH_SOURCE);
    const tmp = path.join(dir, `memwatch-${process.pid}-${Date.now()}${IS_WIN ? ".exe" : ""}`);
    const args = IS_WIN ? ["-O2", "-municode", "-static", "-o", tmp, src] : ["-O2", "-o", tmp, src];
    const r = await runProcess([compiler, ...args], "", { timeoutMs: 60_000, cwd: dir });
    if (r.status !== "OK" || !existsSync(tmp)) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      return undefined;
    }
    await fs.rename(tmp, exe).catch(async () => {
      // another window built it at the same moment
      await fs.rm(tmp, { force: true }).catch(() => {});
    });
    return existsSync(exe) ? exe : undefined;
  } catch {
    return undefined;
  }
}

/** Quote one argument for a Windows command line (the rules CommandLineToArgvW reads back). */
export function quoteWindowsArg(arg: string): string {
  if (arg !== "" && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let slashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      slashes++;
      continue;
    }
    out += ch === '"' ? "\\".repeat(slashes * 2 + 1) + '"' : "\\".repeat(slashes) + ch;
    slashes = 0;
  }
  return out + "\\".repeat(slashes * 2) + '"';
}

export interface MeasuredRun extends RunResult {
  /** Peak memory in bytes, when it was measured. */
  peakBytes?: number;
  /** The program went over the memory limit. */
  memoryExceeded?: boolean;
}

let reportSeq = 0;

/**
 * The command a program runs with. Java's heap is capped with -Xmx under a limit; a small starting
 * heap and the serial GC keep the JVM at ~50 MB instead of committing ~350 MB up front (same speed).
 */
export function commandFor(program: Program, memoryLimitMb?: number): string[] {
  if (program.language !== "java") return program.command;
  const flags = ["-Xms16m", "-XX:+UseSerialGC", ...(memoryLimitMb ? [`-Xmx${Math.max(16, Math.floor(memoryLimitMb))}m`] : [])];
  return [program.command[0], ...flags, ...program.command.slice(1)];
}

/**
 * Run a program, measuring its peak memory with memwatch when given one. Falls back to a plain
 * run if memwatch can't start the program, so "not installed" errors read the same as before.
 */
export async function runMeasured(
  program: Program,
  input: string,
  opts: RunOptions & { memoryLimitMb?: number; memwatch?: string },
): Promise<MeasuredRun> {
  const cmd = commandFor(program, opts.memoryLimitMb);
  const runOpts: RunOptions = { timeoutMs: opts.timeoutMs, cwd: opts.cwd, env: program.env, maxOutputBytes: opts.maxOutputBytes, signal: opts.signal };
  if (!opts.memwatch) return runProcess(cmd, input, runOpts);

  // Java: the -Xmx cap does the limiting; a hard cap on the whole JVM would count its own overhead.
  const hardLimit = program.language === "java" ? 0 : opts.memoryLimitMb ?? 0;
  const reportFile = path.join(os.tmpdir(), `dsa-drill-mem-${process.pid}-${++reportSeq}.txt`);
  const args = IS_WIN ? [String(hardLimit), reportFile, cmd.map(quoteWindowsArg).join(" ")] : [String(hardLimit), reportFile, ...cmd];
  try {
    const r = await runProcess([opts.memwatch, ...args], input, runOpts);
    const text = await fs.readFile(reportFile, "utf8").catch(() => "");
    if (text.startsWith("spawn_error")) return runProcess(cmd, input, runOpts);
    const m = text.trim().split(/\s+/);
    if (m.length < 3 || r.spawnError) return r.spawnError ? runProcess(cmd, input, runOpts) : r; // killed (time limit / stop): no report
    const peakBytes = Number(m[0]);
    const wallMs = Number(m[2]);
    const javaOom = program.language === "java" && /java\.lang\.OutOfMemoryError/.test(r.stderr);
    return {
      ...r,
      ...(Number.isFinite(wallMs) && wallMs >= 0 ? { timeMs: wallMs } : {}),
      peakBytes,
      memoryExceeded: m[1] === "1" || javaOom,
    };
  } finally {
    await fs.rm(reportFile, { force: true }).catch(() => {});
  }
}
