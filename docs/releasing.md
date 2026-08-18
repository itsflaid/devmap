# Releasing DevMap

This document defines the release process for the npm package in
`packages/cli`.

## Release Policy

- Package name: `@flaid/devmap`
- Initial beta version: `0.2.0`
- Git tag format: `v<version>`
- npm dist-tag for `0.2.0`: `latest`
- Source of package version: `packages/cli/package.json`
- Do not publish from the private workspace root

Benchmarking and external feedback are post-launch beta activities. Public
claims must continue to say DevMap is designed to reduce repeated exploration
until benchmark evidence is recorded.

## Required Checks

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm test:cli
pnpm build:cli
pnpm build:web
pnpm test:package-e2e
git diff --check
```

Confirm:

- live Groq `init`, `analyze`, streaming, and `doctor` were tested;
- GitHub Actions is green on Windows, macOS, and Linux;
- `packages/cli/package.json` and CLI `--version` both report `0.2.0`;
- no API key, `.env`, `.devmap`, source test fixture, or local artifact is in
  the package;
- README, changelog, and release notes describe the same version and limits.

## Inspect The Package

```bash
pnpm --filter @flaid/devmap pack --pack-destination artifacts
npm pack ./packages/cli --dry-run
```

The package should contain only the compiled `dist` tree plus npm-managed
metadata such as `package.json`, `README.md`, and `LICENSE`.

Install the tarball in a temporary or external project:

```bash
npm install --save-dev /absolute/path/to/flaid-devmap-0.2.0.tgz
npx @flaid/devmap --version
npx @flaid/devmap --help
npx @flaid/devmap analyze --fresh
npx @flaid/devmap doctor
```

## First npm Publish

The first publish establishes package ownership:

```bash
npm login
npm whoami
pnpm --filter @flaid/devmap publish --access public
```

Before confirming, verify npm displays:

```text
@flaid/devmap@0.2.0
```

After publishing:

```bash
npm view @flaid/devmap version
npx --yes @flaid/devmap@0.2.0 --version
```

Create GitHub tag `v0.2.0` and a matching GitHub Release using the changelog.

## Automated Releases

After the first package exists on npm, configure npm Trusted Publishing for
this repository and add a release workflow. The workflow should:

1. Trigger from a published GitHub Release or `v*` tag.
2. Verify the tag matches `packages/cli/package.json`.
3. Run the full required checks.
4. Publish only `packages/cli`.
5. Use a protected GitHub Environment with manual approval.
6. Use short-lived OIDC credentials instead of a long-lived npm token.
