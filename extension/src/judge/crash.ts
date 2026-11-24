/**
 * Where a C++ program crashed. A C++ crash leaves no stack trace, so C++ solutions are compiled with
 * -g and linked with a tiny reporter (built once per compiler, like memwatch). On a crash it prints
 * the stack's addresses inside the program to stderr, as one "@@dsa-drill-trace" line, and then lets
 * the crash go on exactly as before (same exit code or signal). symbolizeCrash() turns that line
 * into "at f(int) (solution.cpp:12)" lines with addr2line, which ships with every g++.
 *
 * - Windows: an unhandled-exception filter (access violation, stack overflow, division by zero...)
 *   and a SIGABRT handler (abort, failed assert, uncaught exception). The stack is walked with
 *   RtlVirtualUnwind (x64). Addresses are printed relative to the image base (ASLR).
 * - Linux: handlers for SIGSEGV, SIGBUS, SIGFPE, SIGILL and SIGABRT on an alternate stack (so a
 *   stack overflow still gets reported), using backtrace(). Addresses are printed with the
 *   executable's load address (PIE).
 * - Mac: the same signals on an alternate stack, walking the frame-pointer chain (macOS always
 *   keeps frame pointers). Addresses are printed with the executable's load address (ASLR) and
 *   turned into lines with atos (Xcode command line tools), which reads the .dSYM that clang/g++
 *   writes next to the program when it compiles and links with -g in one step.
 */
import { createHash } from "crypto";
import { existsSync, promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { runProcess } from "./runner";

const IS_WIN = process.platform === "win32";

export const CRASH_REPORTER_SOURCE = String.raw`// Crash reporter linked into C++ solutions by DSA Drill. On a crash it prints the addresses on
// the stack to stderr as "@@dsa-drill-trace ...", then the crash continues as it would without it.
#if defined(_WIN32)
#include <windows.h>
#include <signal.h>

namespace {
char* imgBase;
DWORD64 imgSize;
LPTOP_LEVEL_EXCEPTION_FILTER prevFilter;
char buf[4096];

char* cat(char* p, const char* s) { while (*s) *p++ = *s++; return p; }
char* hex(char* p, unsigned long long v) {
  char t[17]; int n = 0;
  do { t[n++] = "0123456789abcdef"[v & 15]; v >>= 4; } while (v);
  while (n) *p++ = t[--n];
  return p;
}

/* Walk the stack from ctx and write the program's own frames (the first one exact, the rest
   return addresses) as offsets from the image base. */
void trace(CONTEXT* start) {
  char* p = cat(buf, "\n@@dsa-drill-trace pe");
#if defined(_WIN64) && (defined(__x86_64__) || defined(_M_X64))
  CONTEXT ctx = *start;
  for (int i = 0; i < 64 && p - buf < 3900; i++) {
    DWORD64 pc = ctx.Rip;
    if (!pc) break;
    if (pc >= (DWORD64)imgBase && pc < (DWORD64)imgBase + imgSize) {
      p = cat(p, i == 0 ? " =" : " ");
      p = hex(p, pc - (DWORD64)imgBase);
    }
    DWORD64 base = 0;
    PRUNTIME_FUNCTION f = RtlLookupFunctionEntry(pc, &base, NULL);
    if (!f) {  /* a leaf function: the return address is on top of the stack */
      ctx.Rip = *(DWORD64*)ctx.Rsp;
      ctx.Rsp += 8;
    } else {
      PVOID data; DWORD64 frame;
      RtlVirtualUnwind(UNW_FLAG_NHANDLER, base, pc, f, &ctx, &data, &frame, NULL);
    }
  }
#else
  (void)start;
#endif
  *p++ = '\n';
  DWORD w;
  WriteFile(GetStdHandle(STD_ERROR_HANDLE), buf, (DWORD)(p - buf), &w, NULL);
}

LONG WINAPI onException(EXCEPTION_POINTERS* ep) {
  trace(ep->ContextRecord);
  return prevFilter ? prevFilter(ep) : EXCEPTION_CONTINUE_SEARCH;
}

void onAbort(int) {
  CONTEXT ctx;
  RtlCaptureContext(&ctx);
  trace(&ctx);
  /* returning lets abort() finish as usual (exit code 3) */
}

struct Init {
  Init() {
    imgBase = (char*)GetModuleHandleW(NULL);
    IMAGE_NT_HEADERS* nt = (IMAGE_NT_HEADERS*)(imgBase + ((IMAGE_DOS_HEADER*)imgBase)->e_lfanew);
    imgSize = nt->OptionalHeader.SizeOfImage;
    ULONG guarantee = 64 * 1024;  /* room for the filter after a stack overflow */
    SetThreadStackGuarantee(&guarantee);
    prevFilter = SetUnhandledExceptionFilter(onException);
    signal(SIGABRT, onAbort);
  }
} init;
}  // namespace

#elif defined(__linux__)
#include <dlfcn.h>
#include <execinfo.h>
#include <signal.h>
#include <stdint.h>
#include <ucontext.h>
#include <unistd.h>

namespace {
uintptr_t exeBase;
char altStack[64 * 1024];

char* cat(char* p, const char* s) { while (*s) *p++ = *s++; return p; }
char* hex(char* p, unsigned long long v) {
  char t[17]; int n = 0;
  do { t[n++] = "0123456789abcdef"[v & 15]; v >>= 4; } while (v);
  while (n) *p++ = t[--n];
  return p;
}
bool inExe(uintptr_t a) {
  Dl_info d;
  return a && dladdr((void*)a, &d) && (uintptr_t)d.dli_fbase == exeBase;
}

void onSignal(int sig, siginfo_t*, void* ucv) {
  char buf[4096];
  char* p = cat(buf, "\n@@dsa-drill-trace elf ");
  p = hex(p, exeBase);
  uintptr_t pc = 0;
#if defined(__x86_64__)
  pc = (uintptr_t)((ucontext_t*)ucv)->uc_mcontext.gregs[REG_RIP];
#elif defined(__aarch64__)
  pc = (uintptr_t)((ucontext_t*)ucv)->uc_mcontext.pc;
#else
  (void)ucv;
#endif
  if (inExe(pc)) { p = cat(p, " ="); p = hex(p, pc); }
  void* frames[64];
  int n = backtrace(frames, 64);
  for (int i = 0; i < n && p - buf < 3900; i++) {
    if (inExe((uintptr_t)frames[i])) { p = cat(p, " "); p = hex(p, (uintptr_t)frames[i]); }
  }
  *p++ = '\n';
  ssize_t ignored = write(2, buf, p - buf);
  (void)ignored;
  /* SA_RESETHAND put the default action back: die by the same signal, as without the reporter. */
  raise(sig);
}

struct Init {
  Init() {
    Dl_info d;
    if (!dladdr((void*)&onSignal, &d)) return;
    exeBase = (uintptr_t)d.dli_fbase;
    void* warm[1];
    backtrace(warm, 1);  /* loads libgcc's unwinder now, not inside the handler */
    stack_t ss = {};
    ss.ss_sp = altStack;
    ss.ss_size = sizeof altStack;
    sigaltstack(&ss, nullptr);  /* a stack overflow leaves no stack for the handler otherwise */
    struct sigaction sa = {};
    sa.sa_sigaction = onSignal;
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK | SA_RESETHAND | SA_NODEFER;
    sigemptyset(&sa.sa_mask);
    const int sigs[] = {SIGSEGV, SIGBUS, SIGFPE, SIGILL, SIGABRT};
    for (int s : sigs) sigaction(s, &sa, nullptr);
  }
} init;
}  // namespace

#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#include <mach-o/getsect.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <sys/ucontext.h>
#include <unistd.h>

namespace {
uintptr_t textLo, textHi;  /* the executable's __TEXT segment (its code), as loaded */
char altStack[64 * 1024];

char* cat(char* p, const char* s) { while (*s) *p++ = *s++; return p; }
char* hex(char* p, unsigned long long v) {
  char t[17]; int n = 0;
  do { t[n++] = "0123456789abcdef"[v & 15]; v >>= 4; } while (v);
  while (n) *p++ = t[--n];
  return p;
}
bool inExe(uintptr_t a) { return a >= textLo && a < textHi; }

/* macOS always keeps frame pointers: each frame record is {caller's fp, return address}. */
void onSignal(int sig, siginfo_t*, void* ucv) {
  char buf[4096];
  char* p = cat(buf, "\n@@dsa-drill-trace macho ");
  p = hex(p, textLo);
  uintptr_t pc = 0, fp = 0, sp = 0;
  ucontext_t* uc = (ucontext_t*)ucv;
#if defined(__x86_64__)
  pc = (uintptr_t)uc->uc_mcontext->__ss.__rip;
  fp = (uintptr_t)uc->uc_mcontext->__ss.__rbp;
  sp = (uintptr_t)uc->uc_mcontext->__ss.__rsp;
#elif defined(__arm64__) || defined(__aarch64__)
  pc = (uintptr_t)__darwin_arm_thread_state64_get_pc(uc->uc_mcontext->__ss);
  fp = (uintptr_t)__darwin_arm_thread_state64_get_fp(uc->uc_mcontext->__ss);
  sp = (uintptr_t)__darwin_arm_thread_state64_get_sp(uc->uc_mcontext->__ss);
#else
  (void)uc;
#endif
  int n = 0;
  if (inExe(pc)) { p = cat(p, " ="); p = hex(p, pc); n++; }
  /* Only follow records inside the used part of this thread's stack, always upwards. */
  uintptr_t top = (uintptr_t)pthread_get_stackaddr_np(pthread_self());
  while (n < 64 && fp >= sp && fp + 16 <= top && !(fp & 7)) {
    uintptr_t next = ((uintptr_t*)fp)[0], ret = ((uintptr_t*)fp)[1];
    if (inExe(ret)) { p = cat(p, " "); p = hex(p, ret); n++; }
    if (next <= fp) break;
    fp = next;
  }
  *p++ = '\n';
  ssize_t ignored = write(2, buf, p - buf);
  (void)ignored;
  /* SA_RESETHAND put the default action back: die by the same signal, as without the reporter. */
  raise(sig);
}

struct Init {
  Init() {
    const struct mach_header_64* mh = (const struct mach_header_64*)_dyld_get_image_header(0);
    unsigned long size = 0;
    uint8_t* text = mh ? getsegmentdata(mh, "__TEXT", &size) : nullptr;
    if (!text || !size) return;
    textLo = (uintptr_t)text;
    textHi = textLo + size;
    stack_t ss = {};
    ss.ss_sp = altStack;
    ss.ss_size = sizeof altStack;
    sigaltstack(&ss, nullptr);  /* a stack overflow leaves no stack for the handler otherwise */
    struct sigaction sa = {};
    sa.sa_sigaction = onSignal;
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK | SA_RESETHAND | SA_NODEFER;
    sigemptyset(&sa.sa_mask);
    const int sigs[] = {SIGSEGV, SIGBUS, SIGFPE, SIGILL, SIGABRT};
    for (int s : sigs) sigaction(s, &sa, nullptr);
  }
} init;
}  // namespace
#endif
`;

const built = new Map<string, Promise<string | undefined>>();

/**
 * The reporter's object file for this compiler, compiling it on first use into the temp folder.
 * Undefined where it isn't supported or can't be built: solutions then compile without it.
 */
export function getCrashReporter(compiler: string): Promise<string | undefined> {
  if (!["win32", "linux", "darwin"].includes(process.platform)) return Promise.resolve(undefined);
  const key = createHash("sha256").update(CRASH_REPORTER_SOURCE).update("\0").update(compiler).update("\0").update(process.platform).digest("hex").slice(0, 16);
  let p = built.get(key);
  if (!p) {
    p = build(compiler, key);
    built.set(key, p);
  }
  return p;
}

async function build(compiler: string, key: string): Promise<string | undefined> {
  const dir = path.join(os.tmpdir(), `dsa-drill-crash-${key}`);
  const obj = path.join(dir, "crash.o");
  if (existsSync(obj)) return obj;
  try {
    await fs.mkdir(dir, { recursive: true });
    const src = path.join(dir, "crash.cpp");
    await fs.writeFile(src, CRASH_REPORTER_SOURCE);
    const tmp = path.join(dir, `crash-${process.pid}-${Date.now()}.o`);
    const r = await runProcess([compiler, "-std=c++17", "-O2", "-c", "-o", tmp, src], "", { timeoutMs: 60_000, cwd: dir });
    if (r.status !== "OK" || !existsSync(tmp)) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      return undefined;
    }
    await fs.rename(tmp, obj).catch(async () => {
      await fs.rm(tmp, { force: true }).catch(() => {}); // another window built it at the same moment
    });
    return existsSync(obj) ? obj : undefined;
  } catch {
    return undefined;
  }
}

/** Extra g++ arguments that link the reporter (with debug info for addr2line / atos). */
export function reporterArgs(obj: string): string[] {
  return ["-g", obj, ...(process.platform === "linux" ? ["-ldl"] : [])];
}

/** addr2line next to the compiler (same prefix, e.g. x86_64-w64-mingw32-), then the one on PATH. */
export function addr2lineFor(compiler: string): string[] {
  const exe = IS_WIN ? ".exe" : "";
  const dir = path.dirname(compiler);
  const base = path.basename(compiler).replace(/\.exe$/i, "");
  const prefix = /^(.*-)?(g\+\+|c\+\+|gcc|clang\+\+)(-\d+)?$/.exec(base)?.[1] ?? "";
  const out: string[] = [];
  if (dir && dir !== ".") {
    if (prefix) out.push(path.join(dir, `${prefix}addr2line${exe}`));
    out.push(path.join(dir, `addr2line${exe}`));
  }
  if (prefix) out.push(`${prefix}addr2line`);
  out.push("addr2line");
  return [...new Set(out)];
}

export interface CrashFrame {
  func: string;
  file: string;
  line: number;
}

const MARKER = /@@dsa-drill-trace (pe|elf|macho)([^\r\n]*)/;
// The reporter writes "\n@@dsa-drill-trace ...\n"; it can fire twice (abort, then the fail-fast).
const MARKER_LINES = /\r?\n?@@dsa-drill-trace [^\r\n]*/g;

/** stderr without the reporter's lines (for any verdict: a crash can also end as MLE). */
export function stripTrace(stderr: string): string {
  return stderr.replace(MARKER_LINES, "");
}

/** A program's stderr with its crash trace turned into lines (or removed) when it has the reporter. */
export function crashOutput(program: { crash?: { exe: string; source: string; addr2line: string[] } }, stderr: string): Promise<string> {
  return program.crash ? symbolizeCrash(stderr, program.crash.exe, program.crash.source, program.crash.addr2line) : Promise.resolve(stripTrace(stderr));
}

const cache = new Map<string, Promise<CrashFrame[]>>();

/**
 * Replace the reporter's line in `stderr` with the frames in `source`, innermost call first:
 *
 *   Crashed at (innermost call first):
 *     at f(int) (solution.cpp:12)  x64
 *     at main (solution.cpp:20)
 *
 * When nothing maps to the source (no addr2line, a crash inside a library only), the line is just
 * removed. Never throws.
 */
export async function symbolizeCrash(stderr: string, exe: string, source: string, addr2line: string[]): Promise<string> {
  const m = MARKER.exec(stderr);
  if (!m) return stderr;
  const rest = stripTrace(stderr);
  const key = `${exe}\0${m[1]}${m[2]}`;
  let p = cache.get(key);
  if (!p) {
    p = (m[1] === "macho" ? atosFrames(m[2].trim(), exe) : resolveFrames(m[1] as "pe" | "elf", m[2].trim(), exe, addr2line)).catch(() => []);
    cache.set(key, p);
  }
  const frames = (await p).filter((f) => samePath(f.file, source));
  if (!frames.length) return rest;
  const lines: string[] = [];
  for (let i = 0; i < frames.length; ) {
    let j = i;
    while (j < frames.length && frames[j].func === frames[i].func && frames[j].line === frames[i].line) j++;
    lines.push(`  at ${frames[i].func} (${path.basename(source)}:${frames[i].line})${j - i > 1 ? `  x${j - i}` : ""}`);
    i = j;
    if (lines.length >= 12) break;
  }
  const head = rest.replace(/\s+$/, "");
  return (head ? head + "\n\n" : "") + "Crashed at (innermost call first):\n" + lines.join("\n") + "\n";
}

function samePath(printed: string, source: string): boolean {
  const norm = (s: string) => path.resolve(s.replace(/\\/g, "/")).toLowerCase();
  return norm(printed) === norm(source) || path.basename(printed.replace(/\\/g, "/")).toLowerCase() === path.basename(source).toLowerCase();
}

async function resolveFrames(kind: "pe" | "elf", tokens: string, exe: string, addr2line: string[]): Promise<CrashFrame[]> {
  const parts = tokens.split(/\s+/).filter(Boolean);
  let toVma: (a: bigint) => bigint;
  const head = await readHead(exe);
  if (kind === "pe") {
    const imageBase = peImageBase(head);
    if (imageBase === undefined) return [];
    toVma = (rva) => imageBase + rva;
  } else {
    const base = BigInt("0x" + (parts.shift() ?? "0"));
    const pie = head.length > 17 && head.readUInt16LE(16) === 3; // ET_DYN
    toVma = (a) => (pie ? a - base : a);
  }
  const addrs: string[] = [];
  for (const t of parts) {
    const exact = t.startsWith("=");
    const v = BigInt("0x" + t.replace(/^=/, ""));
    // A return address points after the call: step back into the call's line.
    addrs.push("0x" + (toVma(v) - (exact ? 0n : 1n)).toString(16));
  }
  if (!addrs.length) return [];
  for (const tool of addr2line) {
    const r = await runProcess([tool, "-e", exe, "-f", "-C", "-i", "-a", ...addrs], "", { timeoutMs: 15_000 });
    if (r.spawnError) continue;
    if (r.status !== "OK") return [];
    return parseAddr2line(r.stdout);
  }
  return [];
}

/**
 * addr2line -f -i -a output: an "0x..." line per address, then (function, file:line) pairs from
 * the innermost inlined call outwards. Each address gives its innermost location in a known file
 * (the caller decides which file counts); frames come back in stack order.
 */
export function parseAddr2line(out: string): CrashFrame[] {
  const lines = out.replace(/\r\n?/g, "\n").split("\n");
  const groups: CrashFrame[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^0x[0-9a-f]+$/i.test(lines[i].trim())) {
      groups.push([]);
      continue;
    }
    if (!groups.length || i + 1 >= lines.length) continue;
    const loc = /^(.*):(\d+)(?: \(discriminator \d+\))?$/.exec(lines[i + 1].trim());
    if (!loc || loc[1] === "??") {
      i++;
      continue;
    }
    groups[groups.length - 1].push({ func: lines[i].trim(), file: loc[1], line: +loc[2] });
    i++;
  }
  return groups.flat();
}

/** Mac: "<load address> =pc ret..." (runtime addresses) through atos, which reads the .dSYM. */
async function atosFrames(tokens: string, exe: string): Promise<CrashFrame[]> {
  const parts = tokens.split(/\s+/).filter(Boolean);
  const base = parts.shift();
  if (!base || !parts.length) return [];
  const addrs = parts.map((t) => "0x" + (BigInt("0x" + t.replace(/^=/, "")) - (t.startsWith("=") ? 0n : 1n)).toString(16));
  for (const cmd of [["atos"], ["xcrun", "atos"]]) {
    const r = await runProcess([...cmd, "-o", exe, "-l", "0x" + base, "-i", ...addrs], "", { timeoutMs: 15_000 });
    if (r.spawnError) continue;
    if (r.status !== "OK") return [];
    return parseAtos(r.stdout);
  }
  return [];
}

/**
 * atos -i output: per address, "func (in exe) (file:line)" lines from the innermost inlined call
 * outwards. Lines without a file ("main (in exe) + 40": no debug info) are dropped.
 */
export function parseAtos(out: string): CrashFrame[] {
  const frames: CrashFrame[] = [];
  for (const l of out.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^(.+?) \(in [^)]*\) \((.+):(\d+)\)$/.exec(l.trim());
    if (m) frames.push({ func: m[1], file: m[2], line: +m[3] });
  }
  return frames;
}

async function readHead(file: string): Promise<Buffer> {
  const h = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await h.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await h.close();
  }
}

/** The ImageBase in a PE file's optional header (what addr2line's addresses are relative to). */
export function peImageBase(head: Buffer): bigint | undefined {
  if (head.length < 0x40 || head.readUInt16LE(0) !== 0x5a4d) return;
  const nt = head.readUInt32LE(0x3c);
  if (nt + 24 + 32 > head.length || head.readUInt32LE(nt) !== 0x4550) return;
  const opt = nt + 24;
  const magic = head.readUInt16LE(opt);
  if (magic === 0x20b) return head.readBigUInt64LE(opt + 24);
  if (magic === 0x10b) return BigInt(head.readUInt32LE(opt + 28));
  return;
}
