(() => {
  'use strict';

  // Public marketing pages only. Never include account routes or URL payloads.
  const pages = new Set(['/', '/index.html', '/parents.html', '/text-messages.html', '/contact.html', '/community-guidelines.html', '/privacy-policy.html', '/terms.html']);
  if (location.hostname !== 'validapp.lol' || !pages.has(location.pathname)) return;
  if (navigator.globalPrivacyControl || navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

  const measurementId = 'G-49LKQ62956';
  const pagePath = location.pathname === '/index.html' ? '/' : location.pathname;
  let referrer = '';
  try { referrer = document.referrer ? new URL(document.referrer).origin + '/' : ''; } catch {}
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag('js', new Date());
  gtag('config', measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_expires: 86400,
    cookie_update: false,
    page_location: 'https://validapp.lol' + pagePath,
    page_referrer: referrer,
    page_title: document.title,
  });
  gtag('event', 'page_view');

  const tag = document.createElement('script');
  tag.async = true;
  tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
  document.head.appendChild(tag);

  const events = new Set(['download_ios', 'download_android', 'parent_faq_click']);
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[data-analytics-event]');
    const name = link?.dataset.analyticsEvent;
    if (events.has(name)) gtag('event', name, { transport_type: 'beacon' });
  });
})();
