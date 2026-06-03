# Release Notes

## npm

1. update `version` in `package.json` (the CLI reads it at runtime, so no other edit is needed)
2. run `npm test`
3. run `npm pack --dry-run` to confirm the tarball contents
4. publish with `npm publish --access public`
5. tag the release: `git tag vX.Y.Z && git push origin vX.Y.Z`

### Authentication

Publishing requires a token with **write** access. With 2FA enabled, pass an OTP
(`--otp <code>`) or use a granular access token created with **Read and write** on
**All packages** (a token scoped to "select packages" cannot create a brand-new
package). Store it without exposing it interactively:

```sh
echo "//registry.npmjs.org/:_authToken=<token>" >> ~/.npmrc
```
