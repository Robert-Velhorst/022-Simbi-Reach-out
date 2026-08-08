# Codex checkpoints

| Checkpoint | Resume evidence | State |
|---|---|---|
| C0 starting point | `main` at `6c3c7cb`; remote default `main` | Complete |
| C1 policy boundary | `docs/PROVIDER_COMPLIANCE.md`; no automated provider integration | Complete |
| C2 backend vertical slice | migration, auth, all critical-path endpoints | Complete |
| C3 frontend vertical slice | all product routes and actions wired | Complete |
| C4 automated verification | 8 backend and 5 frontend tests; frontend build | Complete |
| C5 operational packaging | Dockerfile, Compose, PowerShell scripts, CI | Complete; image, readiness and worker verified |
| C6 browser evidence | desktop/mobile critical path and concept comparison | Complete |
| C7 release evidence | fresh clone, no-excuses scan, final report, commit/push | Local gates complete; remote publication pending |

Resume rule: inspect Git status and `FINAL_VERIFICATION_REPORT.md`; do not rerun or send anything through a provider. Continue at the first incomplete checkpoint.
