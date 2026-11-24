/**
 * <bits/stdc++.h> for Mac. Apple's g++ is clang with libc++, which has no bits/stdc++.h, so the
 * usual competitive-programming first line doesn't compile there. On a Mac, C++ is compiled with
 * -idirafter pointing at a folder with one that includes the standard headers. -idirafter is
 * searched after the system folders, so a real GCC (Homebrew g++-14) still uses its own.
 */
import { createHash } from "crypto";
import { existsSync, promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

export const STDCPP_SHIM = `// <bits/stdc++.h> for compilers that lack it (Apple clang), written by DSA Drill.
#pragma once
#include <cassert>
#include <cctype>
#include <cerrno>
#include <cfenv>
#include <cfloat>
#include <cinttypes>
#include <climits>
#include <clocale>
#include <cmath>
#include <csetjmp>
#include <csignal>
#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <cwchar>
#include <cwctype>

#include <algorithm>
#include <any>
#include <array>
#include <atomic>
#include <bitset>
#include <charconv>
#include <chrono>
#include <complex>
#include <condition_variable>
#include <deque>
#include <exception>
#include <forward_list>
#include <fstream>
#include <functional>
#include <future>
#include <initializer_list>
#include <iomanip>
#include <ios>
#include <iosfwd>
#include <iostream>
#include <istream>
#include <iterator>
#include <limits>
#include <list>
#include <locale>
#include <map>
#include <memory>
#include <mutex>
#include <new>
#include <numeric>
#include <optional>
#include <ostream>
#include <queue>
#include <random>
#include <ratio>
#include <regex>
#include <scoped_allocator>
#include <set>
#include <shared_mutex>
#include <sstream>
#include <stack>
#include <stdexcept>
#include <streambuf>
#include <string>
#include <string_view>
#include <system_error>
#include <thread>
#include <tuple>
#include <type_traits>
#include <typeindex>
#include <typeinfo>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <valarray>
#include <variant>
#include <vector>

#if __cplusplus > 201703L
#if __has_include(<bit>)
#include <bit>
#endif
#if __has_include(<compare>)
#include <compare>
#endif
#if __has_include(<concepts>)
#include <concepts>
#endif
#if __has_include(<numbers>)
#include <numbers>
#endif
#if __has_include(<ranges>)
#include <ranges>
#endif
#if __has_include(<span>)
#include <span>
#endif
#endif
`;

let dir: Promise<string | undefined> | undefined;

/** Extra C++ compiler arguments: on a Mac, the -idirafter folder above; elsewhere none. */
export async function stdcppArgs(): Promise<string[]> {
  if (process.platform !== "darwin") return [];
  dir ??= write();
  const d = await dir;
  return d ? ["-idirafter", d] : [];
}

async function write(): Promise<string | undefined> {
  const key = createHash("sha256").update(STDCPP_SHIM).digest("hex").slice(0, 16);
  const root = path.join(os.tmpdir(), `dsa-drill-include-${key}`);
  const file = path.join(root, "bits", "stdc++.h");
  if (existsSync(file)) return root;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, STDCPP_SHIM);
    await fs.rename(tmp, file).catch(async () => {
      await fs.rm(tmp, { force: true }).catch(() => {}); // another window wrote it at the same moment
    });
    return existsSync(file) ? root : undefined;
  } catch {
    return undefined;
  }
}
