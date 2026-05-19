# Changesets

This folder is used by
[changesets](https://github.com/changesets/changesets) to track
pending releases for `@getflute/sdk`.

When you make a user-facing change, run:

```bash
npx changeset
```

…and follow the prompts. The generated markdown file in this folder
describes what changed and which semver bump it deserves (`patch`,
`minor`, `major`). Commit it together with your code change.

The release workflow will pick these up automatically when a version
PR is merged to `main`.
