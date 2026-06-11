# DevMap — Agent

When working in this repository:

- Create a branch before making changes unless the user explicitly asks to work on the current branch.
- Use branch names with the `codex/` prefix, for example `codex/fix-analyzer`.
- Keep changes scoped to the user request.
- Do not revert unrelated user changes.
- Prefer opening a pull request instead of pushing directly to `main`, unless the user explicitly asks to push to `main`.

## Commits

- Commit AI-authored work as:

  ```bash
  git -c user.name="devmap-agent" -c user.email="238585242+devmap-agent@users.noreply.github.com" commit -m "Clear commit message"
  ```

- Do not change global or repository Git config for the author identity unless the user explicitly asks.
- If the user wants their own account as the main author, keep their author identity and add this trailer to the commit message:

  ```text
  Co-authored-by: devmap-agent <238585242+devmap-agent@users.noreply.github.com>
  ```

- Keep commit messages short, specific, and focused on the user-visible fix or feature.


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
