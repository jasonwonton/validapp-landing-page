(() => {
  'use strict';

  // Public marketing pages only. Never include account routes or URL payloads.
  const pages = new Set(['/', '/index.html', '/parents.html', '/text-messages.html', '/contact.html', '/community-guidelines.html', '/privacy-policy.html', '/terms.html', '/positive-compliments-at-school.html', '/poll-moderation-and-reporting.html', '/manage-valid-texts-and-invitations.html', '/valid-and-peek-parent-guide.html']);
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
    if (!events.has(name)) return;
    const options = { transport_type: 'beacon' };
    // Give same-tab navigation a bounded opportunity to send its click event.
    // Download links open another tab and do not need to delay navigation.
    if (name === 'parent_faq_click' && !event.defaultPrevented && event.button === 0 &&
        !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      let navigated = false;
      const navigate = () => {
        if (navigated) return;
        navigated = true;
        location.assign(link.href);
      };
      options.event_callback = navigate;
      options.event_timeout = 500;
      setTimeout(navigate, 600);
    }
    gtag('event', name, options);
  });
})();
