> **DEPRECATED (2026-10-07, R122 docs reorg).** Moved from `docs/project-plan/04-critical-path.md`; superseded/completed — kept for reference only, not current state.

# 04 — Critical Path

The single path that determines "commercially usable SubNation":

1. **Deployment authority** (Wave 1) — without it every other wave deploys by hand and evidence
   rots. Everything depends on this.
2. **WhatsApp OTP up** (Wave 2) — one of three auth paths is fully down; WhatsApp is the primary
   Libyan-market channel. Control plane is ours; final pairing is the operator's 2-minute scan.
3. **Sellable supply** (Waves 3/4/6 + operator) — store cannot sell with 6 units. Architecture must
   be ready for Embronic the day creds land; restock is operator-side until then.
4. **Money-path integrity** (continuous) — M1–M14 + refund/reconciliation verified on every change.
5. **Google login** (Wave 5) — currently off; enable the moment service-account creds exist.
6. **Security + QA gates** (Waves 7/8) — the difference between "works" and "production-ready".

Fastest route: Wave 1 → deploy → Wave 2 control-plane + Wave 7 in parallel → Wave 8 → Waves 3/4/6
(prep) → Wave 10. Waves 5/9 interleave where credentials/measurement allow.
