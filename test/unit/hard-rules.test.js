import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isHardRule,
  extractBannedNames,
  checkHardRule,
  evaluateHardRules,
} from '../../src/hard-rules.js';

const SORT_BAN =
  'Do not call a library sort function: `std::sort`, `std::stable_sort`, `std::ranges::sort`, `qsort`.';
const LOOP_BAN = 'Do not use loop statements: `for`, `while`, `do`-`while`, `goto`.';
const CONTAINER_BAN = 'Do not use any of these standard containers: `std::vector`, `std::string`.';
const REVERSE_BAN = 'Do not use `std::reverse` or reverse iterators (`rbegin`, `rend`).';

test('isHardRule and extractBannedNames identify ban-list constraints', () => {
  assert.equal(isHardRule(SORT_BAN), true);
  assert.equal(isHardRule(LOOP_BAN), true);
  assert.equal(isHardRule('Sort with a merge sort you wrote yourself.'), false);
  assert.deepEqual(extractBannedNames(SORT_BAN), [
    'std::sort',
    'std::stable_sort',
    'std::ranges::sort',
    'qsort',
  ]);
});

test('traps do not fire: comments, strings, raw strings, and #include <algorithm> for std::swap', () => {
  const code = `
#include <algorithm>
#include <iostream>
// Never call std::sort or std::stable_sort here!
/* Also do not use qsort */
int main() {
  const char* msg = "std::sort(a, a + n);";
  const char* raw = R"(std::ranges::sort(v))";
  int x = 1, y = 2;
  std::swap(x, y);
  return 0;
}
`;
  const res = checkHardRule(code, SORT_BAN);
  assert.equal(res.decided, true);
  assert.equal(res.verdict, 'pass');
  assert.deepEqual(res.evidence, []);
});

test('traps do not fire: student-defined sort function even with using namespace std', () => {
  const code = `
#include <iostream>
using namespace std;

void sort(int a[], int n) {
  if (n <= 1) return;
}

namespace custom {
  void sort(int* l, int* r) {}
}

int main() {
  int a[3] = {3, 1, 2};
  sort(a, 3);
  custom::sort(a, a + 3);
  return 0;
}
`;
  const res = checkHardRule(code, SORT_BAN);
  assert.equal(res.decided, true);
  assert.equal(res.verdict, 'pass');
});

test('detects qualified, using-namespace, namespace-alias, and macro-alias violations with exact line', () => {
  const qualified = `#include <algorithm>\nint main() {\n  int a[2] = {2, 1};\n  std::sort(a, a + 2);\n}`;
  const r1 = checkHardRule(qualified, SORT_BAN);
  assert.equal(r1.verdict, 'violation');
  assert.deepEqual(r1.evidence, [{ line: 4, text: 'std::sort(a, a + 2);' }]);

  const viaUsing = `#include <algorithm>\nusing namespace std;\nint main() {\n  int a[2] = {2, 1};\n  sort(a, a + 2);\n}`;
  const r2 = checkHardRule(viaUsing, SORT_BAN);
  assert.equal(r2.verdict, 'violation');
  assert.equal(r2.evidence?.[0].line, 5);

  const viaAlias = `#include <algorithm>\nnamespace rg = std::ranges;\nint main() {\n  int a[2] = {2, 1};\n  rg::sort(a);\n}`;
  const r3 = checkHardRule(viaAlias, SORT_BAN);
  assert.equal(r3.verdict, 'violation');
  assert.equal(r3.evidence?.[0].line, 5);

  const viaMacro = `#include <algorithm>\n#define MY_SORT std::stable_sort\nint main() {\n  int a[2];\n  MY_SORT(a, a + 2);\n}`;
  const r4 = checkHardRule(viaMacro, SORT_BAN);
  assert.equal(r4.verdict, 'violation');
  assert.equal(r4.evidence?.[0].line, 2);
});

test('detects banned keywords, containers, and reverse iterators without false positives', () => {
  const cleanRec = `// for while goto\nvoid rec(int n) { if (n > 0) rec(n - 1); }`;
  assert.equal(checkHardRule(cleanRec, LOOP_BAN).verdict, 'pass');

  const withLoop = `void f() {\n  for (int i = 0; i < 5; i++) {}\n}`;
  const rl = checkHardRule(withLoop, LOOP_BAN);
  assert.equal(rl.verdict, 'violation');
  assert.equal(rl.evidence?.[0].line, 2);

  const withVec = `#include <vector>\nusing namespace std;\nint main() {\n  vector<int> v;\n}`;
  assert.equal(checkHardRule(withVec, CONTAINER_BAN).verdict, 'violation');

  const withRbegin = `int main() {\n  int x = v.rbegin();\n}`;
  assert.equal(checkHardRule(withRbegin, REVERSE_BAN).verdict, 'violation');
});

test('evaluateHardRules resolves ban-list constraints and leaves semantic ones for the model', () => {
  const code = `void merge_sort(int a[], int n) {}\nint main() { return 0; }`;
  const constraints = [
    { id: 'C1', text: SORT_BAN },
    { id: 'C2', text: 'Sort with a merge sort you wrote yourself.' },
  ];
  const { hardVerdicts, remainingConstraints } = evaluateHardRules(code, constraints);
  assert.equal(hardVerdicts.length, 1);
  assert.equal(hardVerdicts[0].constraint.id, 'C1');
  assert.equal(hardVerdicts[0].verdict, 'pass');
  assert.equal(remainingConstraints.length, 1);
  assert.equal(remainingConstraints[0].id, 'C2');
});
