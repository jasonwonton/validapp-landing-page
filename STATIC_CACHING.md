# Public web caching

The production frontend is published from the committed `dist/` directory.
Run `npm run build` and commit the resulting artifact with each frontend change.

The build assigns all app JavaScript and CSS a shared content-derived release
URL under `/app/_static/<20-hex-release>/`. HTML points to those URLs; relative
module imports, including lazy route and LiveKit imports, stay in that release.
CSS artwork/font URLs point to the existing public `/assets/` files. The build
also versions the service-worker precache list and cache name automatically.
The production local-config placeholder is precached; LiveKit remains on demand.

App HTML, service-worker.js, manifest, build-manifest.json and legacy unversioned
files must remain revalidated. Never cache `/api/` or tracked share-link routes
with this policy. Only existing release JS/CSS may receive a long immutable TTL.

The build retains old `dist/app/_static/` directories. Commit these along with
the new release: already-open clients can still load old lazy modules from a
cold edge after deployment. Do not prune released directories as routine build
cleanup, and never modify their contents. A future retention policy needs an
explicit installed-client compatibility decision. Pre-release local artifacts
that were never pushed or deployed may be removed before committing.

Cloudflare configuration for validapp.lol:

- Seven exact public page paths (/, /index.html, /about.html, /contact.html,
  /community-guidelines.html, /privacy-policy.html, /terms.html): 300-second edge
  TTL, GET/HEAD only, no Authorization or Cookie request headers; browser TTL
  respects origin. Redirects/errors (>=300) are not stored.
- Existing public images/fonts rule stays in place.
- Add an exception after the rollout bypass only for `/app/_static/` JS/CSS:
  GET/HEAD, no Authorization, long edge TTL, responses >=300 not stored.
  These files are public and identical even when a browser sends a session cookie.
  The existing /app/ security headers must continue to apply. Browser no-cache
  from that rule is acceptable: revalidation reaches the cached edge, and the
  service worker maintains its explicit public offline cache.

Validate release URLs and hashes in production before enabling the immutable
rule. Validate a legacy-worker upgrade, offline reload, pending-send persistence,
and rollback with `tests/service-worker-update.spec.js`. Static-origin and asset
version tests run with `npm run test:static-origin`; staging isolation remains in
`npm run test:staging`.

Roll back by disabling only the new immutable cache rule and deploying a forward
revert of the source/build changes while retaining published `_static` directories.
HTML and the worker can update normally. Do not purge all caches or use a blanket
cache-everything rule.
