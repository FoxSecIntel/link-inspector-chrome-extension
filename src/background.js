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
