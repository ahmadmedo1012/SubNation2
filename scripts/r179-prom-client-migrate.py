#!/usr/bin/env python3
"""R179 — prom-client → @prometheus-io/client mechanical migration.

Swaps the import specifier `"prom-client"` for `"@prometheus-io/client"`
in the 8 importing modules plus the 5 inline `import("prom-client")` type
assertions in alerting.service.ts. Verifies nothing is left behind.
"""
from pathlib import Path

REPO = Path("/home/z/my-project/SubNation2")

FILES = [
    "backend/src/lib/metrics.ts",
    "backend/src/lib/redis-client.ts",
    "backend/src/lib/db-instrumentation.ts",
    "backend/src/lib/copilot/rate-limit.ts",
    "backend/src/lib/socket/rejections.ts",
    "backend/src/lib/risk-metrics.ts",
    "backend/src/lib/forecast/metrics.ts",
    "backend/src/routes/admin/copilot/ask.ts",
    "backend/src/services/alerting.service.ts",
]

OLD = '"prom-client"'
NEW = '"@prometheus-io/client"'

changed = []
for rel in FILES:
    p = REPO / rel
    src = p.read_text(encoding="utf-8")
    n = src.count(OLD)
    if n == 0:
        print(f"  [WARN] no occurrences in {rel}")
        continue
    p.write_text(src.replace(OLD, NEW), encoding="utf-8")
    changed.append((rel, n))
    print(f"  [OK] {rel}: {n} site(s) rewritten")

# Verify: zero code-level specifiers remain (comments excluded by pattern).
import re
leftovers = []
for rel in FILES:
    src = (REPO / rel).read_text(encoding="utf-8")
    for m in re.finditer(r"""(?:from|import\()\s*['"]prom-client['"]""", src):
        leftovers.append((rel, src[: m.start()].count("\n") + 1))
if leftovers:
    print(f"  [FAIL] leftover specifiers: {leftovers}")
    raise SystemExit(1)
print(f"\nDone: {sum(n for _, n in changed)} sites across {len(changed)} files. No leftovers.")
