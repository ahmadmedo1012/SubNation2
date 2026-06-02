# Contract: Finding (single entry inside `security.md`)

**Purpose**: define the canonical shape of a single Finding so two auditors writing about the same observation produce the same structure.

**Stakeholder**: engineer (User Story 2 — "engineers can act on findings without re-investigating") and reviewer (User Story 4).

**Authoritative entity**: see [`../data-model.md` §1 Finding](../data-model.md).

---

## Required structure

Every Finding in `security.md` MUST appear under a level-3 heading and follow this template exactly. Order is significant — the engineer reads top-to-bottom and stops as soon as they have what they need.

```markdown
### F-NNN — <title>

**Severity**: Critical | High | Medium | Low
**Subsystem**: <matrix row ID, e.g. WALLET-1>
**Related subsystems** (optional): <matrix row IDs>
**Affected assets**: <Asset names from data-model §3>
**Crosses trust boundary** (optional): <Trust Boundary names from data-model §4>
**Exploitability**: Direct | Chained | Insider | Theoretical
**Urgency**: urgent | can-wait | deferred
**CVE / CWE** (optional): <e.g. CWE-352>

#### Impact

<Plain-language business impact, ≤ 500 chars. What the user / business loses
if this is exploited. Avoid security jargon where possible — User Story 1 must
also be able to read this.>

#### Claims

- **[proven|likely|hypothesis]** <claim text, ≤ 280 chars> — evidence: EN-NNN, EN-NNN
  - Why not promoted (only for likely / hypothesis): <one sentence>
- **[proven|likely|hypothesis]** <next claim>

#### Reproduction OR Hypothesis (exactly one of the two)

##### Reproduction (use when the Finding is reproducible read-only at the pinned commit)

1. <Read-only step a reviewer can replay>
2. <…>

Pinned commit: <hash, mirrored from quickstart.md so this Finding is independently readable>

##### Hypothesis (use when the Finding cannot be reproduced without state change)

**What would confirm**: <the PoC that would promote the claim>
**Why this audit did not run it**: <typically: would change state / would touch production / requires access auditor lacks>
**Confirmation cost**: cheap | moderate | expensive

#### Recommendation

**Direction**: <design-level change, ≤ 280 chars; not a code diff>
**Size**: quick-win | structural | deferred
**Reversibility**: fully-reversible | reversible-with-care | one-way
**Dependencies** (optional): <prerequisites such as OpenAPI regeneration, key rotation lead time>
**Justification** (REQUIRED iff size is structural or larger): <why a smaller fix is insufficient>

#### Notes (optional)

<Reviewer-relevant context, contradictions resolved, links to other findings.>
```

---

## Validation rules (from `data-model.md` §1 + §9)

A Finding is conformant iff every one of these holds:

- **VR-F-01** — Every required field is present.
- **VR-F-02** — `Severity` matches the calibration in `research.md` §2.
- **VR-F-03** — Every `EN-NNN` cited in `Claims` resolves to an entry in `research.md` §4.
- **VR-F-04** — Every cited path in linked Evidence Notes resolves at the pinned commit.
- **VR-F-05** — A Hypothesis-only Finding is not marked `urgent` unless the worst-case assumption justifies it.
- **VR-F-06** — `Recommendation.Size` is **not** `large rewrite` without an explicit `Justification` for why a smaller fix is insufficient.
- **VR-F-07** — No claim text contains a secret value (entropy-scan clean).
- **VR-F-08** — `Subsystem` value matches a matrix row ID in `research.md` §3 exactly.
- **C-02** — ≥ 1 Evidence Note, ≥ 1 Claim, exactly one Reproduction-or-Hypothesis.

A Finding that fails any of these MUST be fixed before sign-off; a Finding that cannot be fixed (e.g., the path no longer resolves at the pinned commit because of mid-audit drift) MUST be re-pinned and the new commit recorded in `quickstart.md`, not silently dropped.

---

## Anti-patterns this contract is designed to prevent

1. **One-classification-fits-all.** Collapsing per-claim classifications into a single Finding-level label hides exactly the proven/hypothesis split readers need (FR-021).
2. **"Fix this" titles.** Titles state the issue, not the remedy — the remedy lives in `Recommendation`. A title like "Add CSRF to wallet routes" mixes finding and fix and breaks ranking by severity.
3. **Generic security advice.** A Finding without a linked Evidence Note is invalid (FR-022). If you cannot cite a SubNation file path, you do not have a Finding — you have a recommendation looking for an excuse.
4. **Implicit reproduction.** "Just look at the code" is not a reproduction; the steps must be explicit so a reviewer not present at the audit can replay them (User Story 4 / SC-007).
5. **Quiet large rewrites.** Recommendations that imply major rework without an explicit `Justification` violate FR-024 and SC-009. The contract makes the field required so it cannot be omitted by accident.
6. **Severity drift between docs.** A Finding's severity in `security.md` MUST equal its severity entry in `priorities.md` (FR-052 / VR-RS-02). The contract is the single source.
