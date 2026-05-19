# Contributing to `@getflute/sdk`

Thanks for your interest! This is the official server-side
TypeScript / Node.js SDK for the Flute payment platform. Patterns
that land here become the contract every other Flute SDK follows, so
we hold this repo to a high bar.

## Prerequisites

- Node.js `>=20.19.0` (the `.nvmrc` pins to `22` — latest LTS major)
- `npm` (lockfile is `package-lock.json`)

```bash
nvm use
npm install
npm run verify
```

## Local workflow

| Goal                      | Command                                       |
| ------------------------- | --------------------------------------------- |
| Build (ESM + CJS + types) | `npm run build`                               |
| Unit tests                | `npm test`                                    |
| Watch tests               | `npm run test:watch`                          |
| Coverage                  | `npm run test:coverage`                       |
| Lint                      | `npm run lint` (auto-fix: `npm run lint:fix`) |
| Format                    | `npm run format`                              |
| Typecheck only            | `npm run typecheck`                           |
| Everything before pushing | `npm run verify`                              |

## Commit style

We use [Conventional Commits](https://www.conventionalcommits.org/).
The `commit-msg` hook validates it. Examples:

- `feat(transactions): implement sale and refund`
- `fix(auth): retry on 401 only once per request`
- `docs(readme): add quickstart for payment sessions`

## Releasing

We use [changesets](https://github.com/changesets/changesets). For any
user-facing change:

```bash
npx changeset
```

Pick `patch`, `minor`, or `major`, write a one-line description, and
commit the generated file together with your code change. Releases are
published to npm by the `release` workflow when a version PR is merged
to `main`.

## Public API contract

Anything re-exported from `src/index.ts` is the public surface and is
covered by SemVer. Internal modules (`src/internal/`) may break
between minor versions. Don't import from internal paths in tests you
intend to ship as examples.

## Security

If you find a vulnerability, please follow the process documented in
[`SECURITY.md`](./SECURITY.md). Do NOT open a public issue.
