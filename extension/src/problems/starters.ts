import type { LanguageId } from "../judge/languages";

/** Used when a problem has no starters/<file> of its own. */
export const BUILTIN_STARTERS: Record<LanguageId, string> = {
  cpp: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    // read the input from cin, print the answer to cout

    return 0;
}
`,
  java: `import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        PrintWriter out = new PrintWriter(new BufferedWriter(new OutputStreamWriter(System.out)));

        // read the input from in, print the answer to out

        out.flush();
    }
}
`,
  python: `import sys


def main():
    data = sys.stdin.read().split()
    # read the input from data, print the answer


main()
`,
};
