# DeepCode Release Checklist

## Pre-release (one-time setup)

- [ ] Register/own `@deepcode-ai` npm scope
  - If user owns `@deepcode-ai`: confirm `npm whoami` + `npm org ls`
  - If user does not own it: register via npm CLI or web; document decision here
- [ ] Configure GitHub Actions npm publishing
  - Option A (token-based): create npm automation token and add it to repo secrets
  - Option B (trusted publishing OIDC): configure on npm org/package settings; no token needed
- [ ] Decide publishing strategy: token vs OIDC
- [ ] Verify `packages/deep-code/package.json` metadata is correct
- [ ] Verify `packages/deep-code/LICENSE.md` is present and current

## Per-release

- [ ] Bump version in `packages/deep-code/package.json`
- [ ] Update `CHANGELOG.md`
- [ ] Commit + push to `main`
- [ ] Tag: `git tag -a v<version> -m "..."`
- [ ] Push tag: `git push origin v<version>`
- [ ] Release workflow runs: pack + publish (after P3.1.c enables it)
- [ ] Verify on npm: <https://www.npmjs.com/package/@deepcode-ai/deep-code>

## Decision Points (Require User Input Before P3.1.c)

- [ ] `@deepcode-ai` org ownership confirmed?
- [ ] Initial publish version (`0.3.0` recommended to align with `v0.3.0-feature-parity`)
- [ ] Publishing strategy (token vs OIDC)
- [ ] First publish or release candidate (`0.3.0` vs `0.3.0-rc.1`)?

## Post-release Smoke

- [ ] `npm install -g @deepcode-ai/deep-code@<version>`
- [ ] `deepcode --version` returns correct version
- [ ] `deepcode doctor` passes all checks
