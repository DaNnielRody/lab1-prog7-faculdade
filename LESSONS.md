# Lessons — unresolved one-off symptoms

Only symptoms with no clear owner live here. Everything with an owner is a positive rule in the
responsible artifact instead.

## `df-design` points at a file that does not exist

`.claude/skills/df-design/SKILL.md` instructs the agent to read
`~/.claude/skills/darkdesign/HUMAN-INFERENCE.md` before its rule stages. That file is not in the
darkdesign checkout, which ships `RULES-SPEC.md`, `RULES-FIGMA.md`, `RULES-REVIEW.md`,
`RULES-MOTION.md`, `GRILL-DESIGN.md` and `DESIGN-FORMAT.md`. The design agent worked around it
silently and the run still produced a green design gate.

Not converted into a rule because the fix belongs to whoever owns the global darkdesign skill: either
the file was renamed and `df-design` must point at its replacement, or the file was never written and
the reference must go. Guessing which, from inside a project run, would encode the wrong answer.

Observed: run `audio-filter-preview`, PR #29.
