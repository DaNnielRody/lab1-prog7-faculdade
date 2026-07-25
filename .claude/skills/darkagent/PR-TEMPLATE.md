## Summary

<what + why. For bug fixes: root cause in one sentence — what existed and was correct vs what was
missing.>

## Changes

### <Group by concern>
- `path/file.cs`: <specific — names the types/methods added or changed>

### Tests
- `tests/AudioApi.Tests/<File>.cs`: <behaviours covered>

### Docs
- `docs/<file>.md`: <what it explains>

## Manual Verification

```bash
# unit + integration tests
dotnet test --nologo

# sandbox gate (no network, non-root)
docker compose -f docker-compose.dark-factory.yml up unit-tests \
  --build --abort-on-container-exit --exit-code-from unit-tests

docker compose -f docker-compose.dark-factory.yml --profile integration up integration \
  --build --abort-on-container-exit --exit-code-from integration
```

<plus the runnable commands specific to this change>

## ⚠️ Not Validated

<explicit untested paths. End with a direct reviewer-attention request — or "No known gaps.">

## Checklist

- [ ] Sandbox gate green (`unit-tests` + `integration`)
- [ ] `.claude/contexts/<area>/CONTEXT.md` updated for every area touched
- [ ] No new dependency (or: ADR linked)
- [ ] Schema change → DB wipe instructions in the Summary (`EnsureCreated()`, no migrations)

<only check what is true; leave pending items visible and unchecked>

## Focus of review

<2-4 real technical questions — where you are genuinely unsure, not rhetorical ones>
