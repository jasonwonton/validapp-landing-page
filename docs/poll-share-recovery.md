# Poll share recovery

Public CDN artwork can render in an image element without CORS headers, but the browser cannot copy it into a share canvas. The former implementation silently omitted that artwork.

The PWA now retries known public question-image objects through the existing public-media API, using the configured API base. This is restricted to the known media hosts and public question-image prefixes. Unrecoverable artwork shows an error rather than sharing an incomplete photo; legacy polls with no artwork can still share.

The selected poll option uses the pointing finger in both the detail view and exported image. The release increments the shell to web-v90.

Validation: 16 targeted Android Chromium/WebKit tests passed, six Android layout checks passed, static build/performance and five static-origin/versioning tests passed. A signed-out browser on production reproduced blocked CDN reads and successfully exported the same image through the public-media API. Physical third-party app handoff remains untested.
