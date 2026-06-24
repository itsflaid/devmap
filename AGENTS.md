# DevMap — Agent

When working in this repository:

- Create a branch before making changes unless the user explicitly asks to work on the current branch.
- Keep changes scoped to the user request.
- Do not revert unrelated user changes.
- Prefer opening a pull request instead of pushing directly to `main`, unless the user explicitly asks to push to `main`.

## Workflow

1. Read the PRD and relevant documentation.
3. Add or update tests, documentation, and personal development notes.
4. Run the relevant verification gates.
5. Before committing, pushing, or opening the PR, stop and ask the user to
   create a GitHub issue. Provide a ready-to-use issue title and body.
6. Wait for the user to provide the issue number.
7. Commit and push the verified work, then open a PR that includes
   `Closes #<issue-number>` in the PR body.
8. Give the user the PR link so they can review and merge it. The merge should
   close the linked issue automatically.

## Commits

* Keep the user's Git identity as the primary author whenever possible.
* For AI-assisted commits, append the configured AI co-author trailer.
* If `.agents/config.local.md` exists, use the configured AI commit identity.
* If no configuration is found, skip the AI co-author trailer instead of guessing an identity.
* Only use the configured AI identity as the primary commit author when explicitly requested.
* Do not modify global Git configuration.



read PRD and all documentation first before hands-on.

## Source of Truth

The PRD is the source of truth for product behavior, requirements, and priorities.

If there is any conflict between the PRD and other documents (README, docs, comments, plans, or specifications), follow the PRD.




## Relevant Skills

ECC skills are stored in `.agents/skills/`.

Use these when relevant:

- `coding-standards` — code quality and consistency.
- `verification-loop` — build, lint, typecheck, test, manual verification.
- `documentation-lookup` — check current library docs instead of guessing.
- `backend-patterns` — service/repository/validation patterns.
- `deep-research` — research parser/framework/library behavior.
- `security-review` — secrets, command execution, file access, user input.
- `tdd-workflow` — tests for new analyzers and bug fixes.
- `eval-harness` — benchmark DevMap output on sample repositories.
- `strategic-compact` — keep long agent sessions manageable.
- `agent-introspection-debugging` — recover when the agent loops or gets stuck.

## Personal Development Documentation

Keep the private development notes under `docs/for-me-personal/` current while
working on DevMap.

- Record completed work, current status, important decisions, and remaining
  tasks in `docs/for-me-personal/PROGRESS.md`.
- Record the latest development testing commands, prerequisites, expected
  results, manual test flows, and cross-platform verification steps in
  `docs/for-me-personal/TEST.md`.
- Record meaningful debugging incidents in `docs/for-me-personal/DEBUG.md`,
  including the symptom, root cause, solution, verification, and lesson learned.

Update the relevant document whenever implementation or verification changes
its contents. Do not duplicate these personal notes into the public `docs/`
folder unless the information is intended for users or contributors.

<!-- DevMap Instruction Block -->
## DevMap Context

<<<<<<< HEAD
Before working in this repository, read `DEVMAP.md` for project metadata and available commands.

### Navigation

1. Read `.devmap/index.json`.
2. Pick the relevant feature by name or keywords.
3. Open the matching `.devmap/features/*.json` map.
4. Inspect only files listed in `sourcePriority` first.
5. Fall back to `.devmap/snapshot.json` only when index and feature maps are insufficient.

Do not scan the whole repository. Open source files only when:
- the snapshot is missing or stale
- the snapshot lacks enough detail for the task
- the task requires edit, debug, or refactor
- the user explicitly asks for code changes

When source inspection is needed, inspect the smallest relevant set first.

### Maintenance

- If `.devmap/index.json` is missing, run `devmap analyze`.
- If the snapshot may be stale, run `devmap analyze --fresh`.
- Use `--json` when calling DevMap programmatically.
- Do not edit files inside `.devmap/`.
- Never commit API keys or provider credentials.
=======
Before working in this repository, read `DEVMAP.md` first.
Read `.devmap/index.json` first, then the relevant
`.devmap/features/*.json` map. Inspect files from `sourcePriority` before
exploring broadly. Use `.devmap/snapshot.json` only when those lightweight
navigation files are insufficient. If the navigation files are missing, run
`devmap analyze`.
>>>>>>> 444db40525ffadb7baa3444134b07809a842ad79
<!-- End DevMap Instruction Block -->
