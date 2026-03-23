function escapeCsv(value) {
  const v = String(value ?? '');
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function download(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function normaliseHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

async function extractLinksAdvanced() {
  const linkMap = new Map();

  const classifyNode = (a, injected) => {
    const href = (a.href || '').trim();
    if (!href) return;

    const style = getComputedStyle(a);
    const hiddenByStyle = style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || a.offsetParent === null;
    const hiddenByAttr = a.hidden || a.getAttribute('aria-hidden') === 'true';
    const isHidden = hiddenByStyle || hiddenByAttr;

    const inCommonHiddenUi = !!a.closest('nav, menu, [role="menu"], [role="navigation"], [hidden], [aria-hidden="true"], .menu, .nav, .dropdown, .offcanvas, .sr-only, .visually-hidden');
    const hasActiveTriggerSignal = a.hasAttribute('onclick') || a.getAttribute('role') === 'button' || a.tabIndex >= 0 || a.hasAttribute('data-action') || href.toLowerCase().startsWith('javascript:');

    const suspiciousInvisibleTrigger = isHidden && !inCommonHiddenUi && hasActiveTriggerSignal;

    const existing = linkMap.get(href);
    const meta = {
      url: href,
      targetBlank: a.target === '_blank',
      rel: (a.rel || '').toLowerCase(),
      dynamicInjected: !!injected,
      hidden: isHidden,
      hiddenInCommonUi: inCommonHiddenUi,
      suspiciousInvisibleTrigger,
    };

    if (!existing) {
      linkMap.set(href, meta);
    } else {
      // merge strongest signal
      existing.dynamicInjected = existing.dynamicInjected || meta.dynamicInjected;
      existing.hidden = existing.hidden || meta.hidden;
      existing.suspiciousInvisibleTrigger = existing.suspiciousInvisibleTrigger || meta.suspiciousInvisibleTrigger;
      existing.targetBlank = existing.targetBlank || meta.targetBlank;
      existing.rel = existing.rel || meta.rel;
    }
  };

  document.querySelectorAll('a').forEach((a) => classifyNode(a, false));

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (!m.addedNodes || !m.addedNodes.length) continue;
      m.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.tagName && node.tagName.toLowerCase() === 'a') classifyNode(node, true);
        node.querySelectorAll?.('a').forEach((a) => classifyNode(a, true));
      });
    }
  });

  observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  await new Promise((resolve) => setTimeout(resolve, 650));
  observer.disconnect();

  return Array.from(linkMap.values());
}

function classifyLink(meta, pageHost, workerData) {
  const out = {
    ...meta,
    scheme: 'invalid',
    host: '',
    isHttpLike: false,
    isExternal: false,
    isRisky: false,
    riskBucket: 'safe', // safe | technical-debt | catastrophic
    riskLabel: '',
    reasons: [],
  };

  let parsed;
  try {
    parsed = new URL(meta.url);
  } catch {
    out.isRisky = true;
    out.riskBucket = 'catastrophic';
    out.reasons.push('Invalid URL');
    out.riskLabel = 'Catastrophic: Invalid URL';
    return out;
  }

  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  const host = normaliseHost(parsed.hostname);
  const baseHost = normaliseHost(pageHost);
  const isHttpLike = scheme === 'http' || scheme === 'https';
  const isExternal = isHttpLike && !!host && !!baseHost ? !(host === baseHost || host.endsWith(`.${baseHost}`)) : false;

  out.scheme = scheme;
  out.host = host;
  out.isHttpLike = isHttpLike;
  out.isExternal = isExternal;

  // Core catastrophic rules
  if (!isHttpLike) {
    out.isRisky = true;
    out.riskBucket = 'catastrophic';
    out.reasons.push(`Non-web scheme: ${scheme}`);
  }

  if (/\.(exe|msi|bat|cmd|scr|ps1|jar)(\?|#|$)/i.test(parsed.pathname)) {
    out.isRisky = true;
    out.riskBucket = 'catastrophic';
    out.reasons.push('Executable file link');
  }

  if (meta.targetBlank && !(meta.rel.includes('noopener') || meta.rel.includes('noreferrer'))) {
    out.isRisky = true;
    out.riskBucket = 'catastrophic';
    out.reasons.push('Tabnabbing risk (_blank without noopener/noreferrer)');
  }

  if (meta.suspiciousInvisibleTrigger) {
    out.isRisky = true;
    out.riskBucket = 'catastrophic';
    out.reasons.push('Suspicious: Invisible trigger');
  }

  // Worker analysis signals
  const w = workerData?.[meta.url] || {};
  if (w.piiLeak) {
    out.isRisky = true;
    out.riskBucket = 'catastrophic';
    out.reasons.push('PII or key material found in URL');
  }

  if (w.phishingLikeHost) {
    out.isRisky = true;
    out.riskBucket = 'catastrophic';
    out.reasons.push('Domain pattern resembles phishing infrastructure');
  }

  // Technical debt side
  if (scheme === 'http') {
    out.isRisky = true;
    if (out.riskBucket !== 'catastrophic') out.riskBucket = 'technical-debt';
    out.reasons.push('HTTP downgrade');
  }

  if (w.redirectLike) {
    out.isRisky = true;
    if (out.riskBucket !== 'catastrophic') out.riskBucket = 'technical-debt';
    out.reasons.push('Redirect chain parameter detected');
  }

  if (meta.dynamicInjected) {
    out.isRisky = true;
    if (out.riskBucket !== 'catastrophic') out.riskBucket = 'technical-debt';
    out.reasons.push('Injected dynamically via JavaScript');
  }

  if (w.headerStatus === 'missing-basic-security') {
    out.isRisky = true;
    if (out.riskBucket !== 'catastrophic') out.riskBucket = 'technical-debt';
    out.reasons.push('Fragile destination: missing basic security headers');
  }

  if (out.isRisky) {
    const prefix = out.riskBucket === 'catastrophic' ? 'Catastrophic' : 'Technical debt';
    out.riskLabel = `${prefix}: ${out.reasons[0] || 'Risk detected'}`;
  }

  return out;
}

function applyFilter(linkObjs, filterMode, viewAll) {
  let base = linkObjs;
  if (!viewAll) {
    base = base.filter((l) => l.isRisky);
  }

  if (filterMode === 'internal') return base.filter((l) => l.isHttpLike && !l.isExternal);
  if (filterMode === 'external') return base.filter((l) => l.isHttpLike && l.isExternal);
  if (filterMode === 'risky') return base.filter((l) => l.isRisky);
  if (filterMode === 'catastrophic') return base.filter((l) => l.riskBucket === 'catastrophic');
  if (filterMode === 'technical') return base.filter((l) => l.riskBucket === 'technical-debt');
  return base;
}

function applySort(linkObjs, sortMode) {
  const out = [...linkObjs];
  if (sortMode === 'alphabetical') out.sort((a, b) => a.url.localeCompare(b.url));
  else if (sortMode === 'domain') out.sort((a, b) => (a.host || '').localeCompare(b.host || '') || a.url.localeCompare(b.url));
  else if (sortMode === 'pathlen') out.sort((a, b) => {
    const ap = (() => { try { return new URL(a.url).pathname.length; } catch { return 0; } })();
    const bp = (() => { try { return new URL(b.url).pathname.length; } catch { return 0; } })();
    return bp - ap;
  });
  return out;
}

function setActiveFilterButton(mode) {
  document.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.classList.toggle('active-filter', btn.getAttribute('data-filter') === mode);
  });
}

function getSummary(linkObjs, visible) {
  const catastrophic = linkObjs.filter((l) => l.riskBucket === 'catastrophic').length;
  const technical = linkObjs.filter((l) => l.riskBucket === 'technical-debt').length;
  const risky = linkObjs.filter((l) => l.isRisky).length;
  const safe = linkObjs.length - risky;
  return {
    total: linkObjs.length,
    visible: visible.length,
    catastrophic,
    technical,
    risky,
    safe,
  };
}

function renderSummary(summary, viewAll) {
  const summaryEl = document.getElementById('summary');
  summaryEl.innerHTML = `
    <div><strong>Total:</strong> ${summary.total}</div>
    <div><strong>Shown:</strong> ${summary.visible}</div>
    <div><strong>Catastrophic:</strong> ${summary.catastrophic}</div>
    <div><strong>Technical debt:</strong> ${summary.technical}</div>
    <div><strong>Risky total:</strong> ${summary.risky}</div>
    <div><strong>Safe ${viewAll ? '(shown)' : '(hidden)'}:</strong> ${summary.safe}</div>
  `;
}

function renderLinks(linkObjs, filterMode, sortMode, viewAll) {
  const linkList = document.getElementById('linkList');
  const title = document.getElementById('title');
  linkList.innerHTML = '';

  const filteredSorted = applySort(applyFilter(linkObjs, filterMode, viewAll), sortMode);
  title.textContent = `Links on This Page (${filteredSorted.length} shown)`;

  if (filteredSorted.length === 0) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'No links match the current filter.';
    linkList.appendChild(div);
    return filteredSorted;
  }

  const fragment = document.createDocumentFragment();

  filteredSorted.forEach((linkObj) => {
    const li = document.createElement('li');
    if (linkObj.isExternal) li.classList.add('external-link');
    if (linkObj.riskBucket === 'catastrophic') li.classList.add('risky-link-catastrophic');
    else if (linkObj.riskBucket === 'technical-debt') li.classList.add('risky-link-technical');

    const row = document.createElement('div');
    row.className = 'row';

    const a = document.createElement('a');
    a.className = 'link-text';
    a.href = linkObj.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = linkObj.url;

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(linkObj.url); } catch (_) {}
    });

    row.appendChild(a);
    row.appendChild(btn);
    li.appendChild(row);

    if (linkObj.isRisky) {
      const risk = document.createElement('div');
      risk.className = 'risk-note';
      risk.textContent = `⚠ ${linkObj.riskLabel}`;
      li.appendChild(risk);

      if (linkObj.reasons.length > 1) {
        const detail = document.createElement('div');
        detail.className = 'risk-note detail';
        detail.textContent = linkObj.reasons.slice(1).join(' | ');
        li.appendChild(detail);
      }
    }

    fragment.appendChild(li);
  });

  linkList.appendChild(fragment);
  return filteredSorted;
}

function setupExportButtons(getVisibleLinks) {
  document.getElementById('copyAllBtn').onclick = async () => {
    const visible = getVisibleLinks();
    try { await navigator.clipboard.writeText(visible.map((l) => l.url).join('\n')); } catch (_) {}
  };

  document.getElementById('exportTxtBtn').onclick = () => {
    const visible = getVisibleLinks();
    download('links.txt', `${visible.map((l) => l.url).join('\n')}\n`, 'text/plain');
  };

  document.getElementById('exportCsvBtn').onclick = () => {
    const visible = getVisibleLinks();
    const rows = ['url,scheme,host,external,risky,bucket,reasons'];
    visible.forEach((l) => {
      rows.push([
        escapeCsv(l.url),
        escapeCsv(l.scheme),
        escapeCsv(l.host),
        escapeCsv(l.isExternal),
        escapeCsv(l.isRisky),
        escapeCsv(l.riskBucket),
        escapeCsv((l.reasons || []).join('; ')),
      ].join(','));
    });
    download('links.csv', `${rows.join('\n')}\n`, 'text/csv');
  };
}

async function analyseUrlsInBackground(urls) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'analyseUrls', urls });
    return res?.ok ? (res.results || {}) : {};
  } catch {
    return {};
  }
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;

    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: extractLinksAdvanced,
      },
      async (results) => {
        if (chrome.runtime.lastError) return;

        const links = results?.[0]?.result || [];
        const pageUrl = tabs?.[0]?.url || '';
        const pageHost = (() => {
          try { return new URL(pageUrl).hostname; } catch { return ''; }
        })();

        const workerData = await analyseUrlsInBackground(links.map((x) => x.url));
        const linkObjs = links.map((m) => classifyLink(m, pageHost, workerData));

        let filterMode = 'all';
        let sortMode = 'first';
        let viewAll = false; // 90/10 rule: safe hidden by default
        let visibleLinks = [];

        const rerender = () => {
          visibleLinks = renderLinks(linkObjs, filterMode, sortMode, viewAll);
          renderSummary(getSummary(linkObjs, visibleLinks), viewAll);
          setActiveFilterButton(filterMode);
        };

        setupExportButtons(() => visibleLinks);

        document.querySelectorAll('[data-filter]').forEach((btn) => {
          btn.addEventListener('click', () => {
            filterMode = btn.getAttribute('data-filter') || 'all';
            rerender();
          });
        });

        const sortSelect = document.getElementById('sortMode');
        sortSelect.addEventListener('change', () => {
          sortMode = sortSelect.value;
          rerender();
        });

        const viewAllToggle = document.getElementById('viewAllToggle');
        if (viewAllToggle) {
          viewAllToggle.addEventListener('change', () => {
            viewAll = !!viewAllToggle.checked;
            rerender();
          });
        }

        rerender();
      },
    );
  });
});
