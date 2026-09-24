import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStaticOrigin } from '../serve-production.mjs';

const root = new URL('../../dist/', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('every sitemap URL is packaged, canonical and available without JavaScript', async () => {
  const sitemap = await read('sitemap.xml');
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.includes('https://validapp.lol/text-messages.html'));
  for (const url of urls) {
    const pathname = new URL(url).pathname;
    const html = await read(pathname === '/' ? 'index.html' : pathname.slice(1));
    assert.ok(html.includes(`rel="canonical" href="${url}"`), url);
    assert.match(html, /<h1[\s>]/);
    assert.match(html, /<meta name="description" content="[^\"]+"/);
    assert.doesNotMatch(html, /<meta[^>]+(?:noindex|nosnippet)/i);
    assert.match(html, /<script defer src="\/assets\/public-analytics.js"><\/script>/);
  }
  assert.match(await read('robots.txt'), /Sitemap: https:\/\/validapp\.lol\/sitemap\.xml/);
});

test('analytics excludes app traffic, privacy opt-outs and URL payloads', async () => {
  const source = await read('assets/public-analytics.js');
  function run(overrides = {}) {
    const scripts = [];
    const listeners = {};
    const timers = [];
    const navigations = [];
    const context = {
      location: { hostname: 'validapp.lol', pathname: '/parents.html', search: '?phone=private', hash: '#private', assign: url => navigations.push(url) },
      navigator: {}, window: {}, URL,
      setTimeout: callback => timers.push(callback),
      document: {
        referrer: 'https://example.com/private?phone=private', title: 'Valid App FAQ for Parents',
        head: { appendChild: node => scripts.push(node) }, createElement: () => ({}),
        addEventListener: (name, handler) => { listeners[name] = handler; },
      },
      ...overrides,
    };
    runInNewContext(source, context);
    return { context, scripts, listeners, timers, navigations };
  }
  const { context, scripts, listeners } = run();
  assert.equal(scripts.length, 1);
  assert.equal(context.window.dataLayer[1][2].page_location, 'https://validapp.lol/parents.html');
  assert.equal(context.window.dataLayer[1][2].page_referrer, 'https://example.com/');
  assert.equal(context.window.dataLayer[1][2].allow_google_signals, false);
  assert.equal(Object.prototype.toString.call(context.window.dataLayer[1]), '[object Arguments]');
  for (const analyticsEvent of ['download_ios', 'download_android', 'parent_faq_click', 'unknown']) {
    listeners.click({ target: { closest: () => ({ dataset: { analyticsEvent } }) } });
  }
  assert.deepEqual(Array.from(context.window.dataLayer.filter(item => item[0] === 'event'), item => item[1]), ['page_view', 'download_ios', 'download_android', 'parent_faq_click']);
  for (const overrides of [
    { location: { hostname: 'validapp.lol', pathname: '/app/' } },
    { location: { hostname: 'localhost', pathname: '/' } },
    { navigator: { globalPrivacyControl: true } },
    { navigator: { doNotTrack: '1' } },
  ]) assert.equal(run(overrides).scripts.length, 0);
  const internal = run();
  let prevented = false;
  internal.listeners.click({ button: 0, preventDefault: () => { prevented = true; }, target: { closest: () => ({ href: 'https://validapp.lol/parents.html', dataset: { analyticsEvent: 'parent_faq_click' } }) } });
  assert.equal(prevented, true);
  assert.deepEqual(internal.navigations, []);
  // A blocked tag must never strand the visitor; a later callback cannot navigate twice.
  internal.timers[0]();
  internal.context.window.dataLayer.at(-1)[2].event_callback();
  assert.deepEqual(internal.navigations, ['https://validapp.lol/parents.html']);
  assert.doesNotMatch(await read('app/index.html'), /public-analytics|G-49LKQ62956/);
});

test('homepage identifies the app and accurately separates its platforms', async () => {
  const html = await read('index.html');
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const ios = data['@graph'].find(item => item['@type'] === 'MobileApplication');
  const web = data['@graph'].find(item => item['@type'] === 'WebApplication');
  assert.equal(ios.operatingSystem, 'iOS');
  assert.match(ios.downloadUrl, /id6755367062$/);
  assert.equal(web.url, 'https://validapp.lol/app/');
  assert.match(html, /Valid — Compliment Classmates is a social app/);
  assert.match(html, /Every poll is reviewed by a human moderator/);
  assert.match(html, /Our moderation SLA is under 15 minutes/);
  assert.doesNotMatch(html, /RevueAI|data:image|fonts.googleapis.com/);
});

test('homepage resources exist and remain small with a fixed light Jua theme', async () => {
  const html = await read('index.html');
  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    assert.match(match[0], /width="\d+"/);
    assert.match(match[0], /height="\d+"/);
    const source = match[0].match(/src="\/([^\"]+)"/)[1];
    assert.ok((await stat(new URL(source, root))).size > 0);
  }
  assert.ok((await stat(new URL('assets/Jua-Latin.woff2', root))).size < 25000);
  assert.ok((await stat(new URL('assets/phone-preview.webp', root))).size < 60000);
  const css = await read('assets/landing.css');
  assert.match(css, /color-scheme:only light/);
  assert.match(css, /font-display:swap/);
  assert.doesNotMatch(css, /Jua-Regular.ttf|@import/);
});

test('crawler files are served as text and XML rather than downloads', async t => {
  const server = await createStaticOrigin();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [path, mime] of [['/robots.txt', 'text/plain'], ['/sitemap.xml', 'application/xml'], ['/text-messages.html', 'text/html']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(mime));
  }
});
