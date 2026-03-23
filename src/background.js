function extractLinkCount() {
  try {
    const raw = Array.from(document.querySelectorAll('a'))
      .map((a) => (a.href || '').trim())
      .filter(Boolean);
    const unique = new Set(raw);
    return unique.size;
  } catch {
    return 0;
  }
}

function formatBadgeCount(count) {
  if (!Number.isFinite(count) || count <= 0) return '';
  if (count > 99) return '99+';
  return String(count);
}

async function setBadgeForTab(tabId) {
  if (!tabId) return;

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractLinkCount,
    });

    const count = Number(result?.result || 0);
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#1f7a3f' });
    await chrome.action.setBadgeText({ tabId, text: formatBadgeCount(count) });
  } catch {
    // For restricted pages (chrome:// etc.), clear the badge silently.
    await chrome.action.setBadgeText({ tabId, text: '' });
  }
}

async function refreshActiveTabBadge() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];
  if (!tab?.id) return;
  await setBadgeForTab(tab.id);
}

chrome.tabs.onActivated.addListener(async () => {
  await refreshActiveTabBadge();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab?.active) return;
  await setBadgeForTab(tabId);
});

chrome.windows.onFocusChanged.addListener(async () => {
  await refreshActiveTabBadge();
});

chrome.runtime.onInstalled.addListener(async () => {
  await refreshActiveTabBadge();
});

function looksLikePiiLeak(url) {
  const text = decodeURIComponent(String(url || '')).toLowerCase();
  const patterns = [
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
    /(api[_-]?key|access[_-]?token|auth[_-]?token|session[_-]?id|password|secret|jwt)=/i,
    /\b(ghp_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|akia[0-9a-z]{16})\b/i,
  ];
  return patterns.some((re) => re.test(text));
}

function looksLikeRedirect(url) {
  const text = String(url || '').toLowerCase();
  return /[?&](redirect|redirect_uri|url|next|dest|destination|continue)=/.test(text);
}

function looksLikePhishingHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  if (h.includes('xn--')) return true;
  const suspiciousTlds = ['.zip', '.mov', '.top', '.click', '.gq', '.tk', '.work'];
  if (suspiciousTlds.some((tld) => h.endsWith(tld))) return true;
  // Excessive hyphenated subdomain chains can indicate throwaway infra
  if ((h.match(/-/g) || []).length >= 4) return true;
  return false;
}

async function checkHeaders(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { headerStatus: 'n/a' };
    }

    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const xfo = res.headers.get('x-frame-options');
    const csp = res.headers.get('content-security-policy');
    const hsts = res.headers.get('strict-transport-security');

    if (!xfo && !csp) {
      return { headerStatus: 'missing-basic-security', xfo: false, csp: false, hsts: !!hsts };
    }
    return { headerStatus: 'ok', xfo: !!xfo, csp: !!csp, hsts: !!hsts };
  } catch {
    return { headerStatus: 'unknown' };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'analyseUrls') return;

  (async () => {
    const urls = Array.isArray(msg.urls) ? msg.urls.slice(0, 300) : [];
    const results = {};

    await Promise.all(urls.map(async (u) => {
      try {
        const parsed = new URL(u);
        const host = parsed.hostname;
        const headers = await checkHeaders(u);
        results[u] = {
          piiLeak: looksLikePiiLeak(u),
          redirectLike: looksLikeRedirect(u),
          phishingLikeHost: looksLikePhishingHost(host),
          ...headers,
        };
      } catch {
        results[u] = {
          piiLeak: looksLikePiiLeak(u),
          redirectLike: looksLikeRedirect(u),
          phishingLikeHost: false,
          headerStatus: 'invalid',
        };
      }
    }));

    sendResponse({ ok: true, results });
  })();

  return true;
});
