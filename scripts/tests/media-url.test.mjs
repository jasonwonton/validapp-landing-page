import assert from "node:assert/strict";
import test from "node:test";
import {
    apiMediaFallbackURL, configureMediaFallback, imageCandidates, isEligiblePublicMediaURL,
    mediaImageAttributes, mediaImageMarkup, publicMediaCandidates,
} from "../../app/media-url.js";

const apiBase = "https://validapp.lol/api/v1";
configureMediaFallback({ apiBase });

test("production public media tries the other CDN host, the worker, then the API", () => {
    assert.deepEqual(publicMediaCandidates("https://media.six7.lol/profile-pictures/u1/thumb.jpg"), [
        "https://media.six7.lol/profile-pictures/u1/thumb.jpg",
        "https://validappcdn.com/profile-pictures/u1/thumb.jpg",
        "https://six7-public-media-fallback.empty-snow-d731.workers.dev/media/profile-pictures/u1/thumb.jpg",
        "https://validapp.lol/api/v1/media/profile-pictures/u1/thumb.jpg",
    ]);
    assert.deepEqual(publicMediaCandidates("https://validappcdn.com/questions/images/q 1.webp").slice(1, 2), [
        "https://media.six7.lol/questions/images/q%201.webp",
    ]);
});

test("staging media only gains the API route, like iOS", () => {
    assert.deepEqual(publicMediaCandidates("https://staging.validappcdn.com/logos/school.png"), [
        "https://staging.validappcdn.com/logos/school.png",
        "https://validapp.lol/api/v1/media/logos/school.png",
    ]);
});

test("private, signed, foreign, and unsafe URLs are never rewritten", () => {
    for (const url of [
        "https://media.six7.lol/chat-media/secret.jpg",
        "https://media.six7.lol/profile-pictures/u1.jpg?X-Amz-Signature=abc&X-Amz-Expires=60",
        "https://media.six7.lol/profile-pictures/u1.jpg?token=abc",
        "http://media.six7.lol/profile-pictures/u1.jpg",
        "https://media.six7.lol:8443/profile-pictures/u1.jpg",
        "https://user:pass@media.six7.lol/profile-pictures/u1.jpg",
        "https://example.com/profile-pictures/u1.jpg",
        "https://media.six7.lol/profile-pictures/../chat-media/x.jpg",
        "https://media.six7.lol/profile-pictures/%2e%2e/x.jpg",
        "blob:https://validapp.lol/1234",
        "../assets/app/anonymous.webp",
    ]) {
        assert.equal(isEligiblePublicMediaURL(url), false, url);
        assert.deepEqual(publicMediaCandidates(url), [url], url);
    }
    assert.equal(apiMediaFallbackURL("https://media.six7.lol/chat-media/secret.jpg"), null);
    assert.deepEqual(publicMediaCandidates(""), []);
});

test("thumbnail and original sources interleave by route and dedupe", () => {
    const list = imageCandidates("https://media.six7.lol/profile-pictures/t.jpg", "https://media.six7.lol/profile-pictures/o.jpg", null);
    assert.equal(list[0], "https://media.six7.lol/profile-pictures/t.jpg");
    assert.equal(list[1], "https://media.six7.lol/profile-pictures/o.jpg");
    assert.equal(list[2], "https://validappcdn.com/profile-pictures/t.jpg");
    assert.equal(list.length, 8);
    assert.deepEqual(imageCandidates("https://a.test/x.jpg", "https://a.test/x.jpg"), ["https://a.test/x.jpg"]);
});

test("markup escapes attributes and tags avatars for initials", () => {
    const attributes = mediaImageAttributes(["https://media.six7.lol/profile-pictures/a.jpg"], { initials: '"><x' });
    assert.match(attributes, /^src="https:\/\/media\.six7\.lol\/profile-pictures\/a\.jpg" data-media-fallbacks="https:\/\/validappcdn\.com\/profile-pictures\/a\.jpg /);
    assert.match(attributes, /data-media-kind="avatar" data-avatar-image data-avatar-initials="&quot;&gt;&lt;x"/);
    const markup = mediaImageMarkup("https://a.test/x.jpg", { alt: 'A "b"', className: "art" });
    assert.equal(markup, '<img class="art" loading="lazy" decoding="async" src="https://a.test/x.jpg" data-media-kind="image" alt="A &quot;b&quot;">');
    assert.equal(mediaImageMarkup(null), "");
});
