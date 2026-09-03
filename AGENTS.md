# DevMap — Agent

When working in this repository:

- Create a branch before making changes unless the user explicitly asks to work on the current branch.
- Keep changes scoped to the user request.
- Do not revert unrelated user changes.
- Prefer opening a pull request instead of pushing directly to `main`, unless the user explicitly asks to push to `main`.

## Workflow

1. Read the relevant documentation.
3. Add or update tests, documentation, and personal development notes.
4. Run the relevant verification gates.
5. Commit and push the verified work, then open a PR.
6. Give the user the PR link so they can review and merge it.

## Commits

* Keep the user's Git identity as the primary author whenever possible.
* For AI-assisted commits, append the configured AI co-author trailer.
* If `.agents/config.local.md` exists, use the configured AI commit identity.
* If no configuration is found, skip the AI co-author trailer instead of guessing an identity.
* Only use the configured AI identity as the primary commit author when explicitly requested.
* Do not modify global Git configuration.

Commit message format: <type>: <description>
No parentheses scope. Examples:
  fix: populate entity feature evidence from scanned files
  feat: extract config and add explainability to featureSimilarity
  refactor: replace name-equality merge with similarity engine

Never use: fix(scope): or feat(scope):


read all documentation first before hands-on.

## Publishing

DevMap ships to npm as `@flaid/devmap` from `packages/cli`. Changes fall
into two categories with different handling:

**Outside the published package** (root docs, `guide/`, landing site,
internal scripts, anything not bundled into the npm tarball):
- Commit and push normally. No version bump, no tag. This does not
  trigger the publish workflow.

**Inside `packages/cli`** (anything shipped in the npm package):
- Do not bump the version, tag, or push on your own. Stop first and ask
  the user to confirm the change is publish-worthy and which bump level
  applies (`patch` / `minor` / `major`).
- Only after explicit user confirmation: run `npm version <level>` in
  `packages/cli`, then `git push --follow-tags`.
- Passing verification gates is not authorization to publish — always
  wait for the user's go-ahead on this step specifically.


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
