# Critical path and state model

## Operator path

1. **Define product purpose:** create a campaign with purpose, lawful context, daily limit, and cooldown.
2. **Complete compliance review:** an owner/admin acknowledges current provider terms, no scraping, manual sending, and suppression handling.
3. **Add an authorized prospect:** manually enter or preview/import a bounded CSV with an HTTPS source URL and consent context.
4. **Create a template:** use only `{name}`, `{organization}`, `{campaign}`, and `{notes}` placeholders.
5. **Prepare a draft:** local deterministic rendering calculates a transparent quality score and review signals.
6. **Human review:** inspect the source, edit the draft, and complete all four safety checks.
7. **Approve:** only an active, unpaused, compliant workspace can approve.
8. **Prepare handoff:** a unique idempotency key, daily limit, cooldown, suppression check, and provider-host check must pass.
9. **Send manually:** copy the exact approved content and explicitly open the provider. The app performs no provider action.
10. **Record outcome:** sent, not sent, or ambiguous. Ambiguous outcomes must be manually verified and can be reopened after refresh.
11. **Track reply:** record only the needed reply/summary; open reminders for that draft are cancelled.
12. **Review reminders and reports:** the local worker creates one decision reminder after seven days without a reply.

## Draft state machine

```text
needs_review -> approved -> handoff_created -> sent -> replied
      |            |              |             |
      v            v              v             v
   declined     needs_review    ambiguous    suppressed
      |                           |   |
      +-> needs_review            |   +-> approved
                                  +----> sent
```

`suppressed` and `replied` are terminal. Editing an approved draft resets it to `needs_review`. A cancelled handoff returns to `approved`. There is no automatic retry.

## Smoke-test assertion

`backend/tests/test_critical_path.py::test_complete_assisted_critical_path` executes the entire path through local APIs, asserts missing approval/idempotency gates fail, confirms idempotent replay, records a manual send, records a reply, verifies reporting, and checks audit evidence.
