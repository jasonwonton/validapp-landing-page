import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createStaticOrigin } from "../serve-production.mjs";

// validapp.lol/add/<username> (six7 docs/add-links-api.md): one page for
// every username, first name and photo only, no analytics.
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
let root;
let server;
let origin;

before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "add-link-page-"));
    await cp(path.join(repositoryRoot, "_headers"), path.join(root, "_headers"));
    await cp(path.join(repositoryRoot, "add.html"), path.join(root, "add.html"));
    server = await createStaticOrigin({ root });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
});

test("every /add/<username> serves the one add page", async () => {
    for (const pathname of ["/add/maya_k", "/add/Maya_K/", "/add.html"]) {
        const response = await fetch(`${origin}${pathname}`);
        assert.equal(response.status, 200, pathname);
        assert.match(await response.text(), /<title>Add me on Valid<\/title>/);
    }
    assert.equal((await fetch(`${origin}/add/maya_k/extra`)).status, 404);
    assert.equal((await fetch(`${origin}/add/`)).status, 404);
});

test("the page is private by default and loads only same-origin code", async () => {
    const html = await readFile(path.join(repositoryRoot, "add.html"), "utf8");
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, /<meta name="referrer" content="no-referrer">/);
    assert.doesNotMatch(html, /public-analytics|googletagmanager/);
    assert.match(html, /<script defer src="\/assets\/add-link\.js"><\/script>/);
    assert.doesNotMatch(html, /<script>(?!<\/script>)/, "no inline script");

    const script = await readFile(path.join(repositoryRoot, "assets", "add-link.js"), "utf8");
    // Only the public lookup on the same origin, without cookies.
    assert.match(script, /fetch\(`\/api\/v1\/public\/add-links\/\$\{encodeURIComponent\(username\)\}`/);
    assert.match(script, /credentials: 'omit'/);
    // Nothing but the first name and the photo is read from the answer.
    const fields = [...script.matchAll(/body\.([a-z_]+)/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(fields)].sort(), ["first_name", "profile_picture_url"]);
});
