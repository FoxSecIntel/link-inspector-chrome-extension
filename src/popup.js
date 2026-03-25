function extractLinks() {
  // Hard cap to keep popup responsive on very large pages.
  const MAX_COLLECT = 2500;
  const seen = new Set();
  const out = [];

  const anchors = document.querySelectorAll('a');
  for (let i = 0; i < anchors.length && out.length < MAX_COLLECT; i += 1) {
    const href = (anchors[i].href || '').trim();
    if (!href) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }

  return out;
}

function escapeCsv(value) {
  let v = String(value ?? '');

  // Prevent CSV formula injection in spreadsheet tools.
  if (/^[=+\-@]/.test(v)) {
    v = `'${v}`;
  }

  if (/[",\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
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

function isSafeNavigableUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function applySafeLinkBehaviour(anchor, url) {
  if (isSafeNavigableUrl(url)) {
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.title = url;
    return;
  }

  // Non-web schemes are shown but not directly navigable from popup.
  anchor.removeAttribute('href');
  anchor.setAttribute('role', 'link');
  anchor.setAttribute('aria-disabled', 'true');
  anchor.classList.add('unsafe-link');
  anchor.title = `${url}\nNavigation disabled for non-web scheme. Use copy if needed.`;
}

function classifyLink(link, pageHost) {
  let parsed = null;
  try {
    parsed = new URL(link);
  } catch {
    return {
      url: link,
      scheme: 'invalid',
      host: '',
      isHttpLike: false,
      isExternal: false,
      isRisky: false,
      riskLabel: '',
      riskExplanation: '',
    };
  }

  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  const host = normaliseHost(parsed.hostname);
  const baseHost = normaliseHost(pageHost);
  const isHttpLike = scheme === 'http' || scheme === 'https';

  const isExternal = isHttpLike && !!host && !!baseHost
    ? !(host === baseHost || host.endsWith(`.${baseHost}`))
    : false;

  let isRisky = false;
  let riskLabel = '';
  let riskExplanation = '';

  const rawUrl = String(link || '');
  const decodedUrl = (() => {
    try { return decodeURIComponent(rawUrl); } catch { return rawUrl; }
  })();

  const piiLeakPattern = /(?:[?&#]|\b)(email|token|session|key|auth|apikey)\s*=/i;
  const executablePattern = /\.(exe|msi|sh|bat|env|config|sql)(?:[?#]|$)/i;

  if (piiLeakPattern.test(rawUrl) || piiLeakPattern.test(decodedUrl)) {
    isRisky = true;
    riskLabel = 'PII Exposure';
    riskExplanation = 'This link contains parameters that may leak your personal identity or active session credentials to external servers.';
  } else if (executablePattern.test(parsed.pathname) || executablePattern.test(rawUrl)) {
    isRisky = true;
    riskLabel = 'Downloadable Files';
    riskExplanation = 'This link leads to a direct download of an executable script or a sensitive configuration file which could compromise your system.';
  } else if (scheme === 'http') {
    isRisky = true;
    riskLabel = 'Insecure HTTP';
    riskExplanation = 'This link uses HTTP instead of HTTPS, which increases interception and tampering risk on untrusted networks.';
  }

  return {
    url: link,
    scheme,
    host,
    isHttpLike,
    isExternal,
    isRisky,
    riskLabel,
    riskExplanation,
  };
}

function getSummary(linkObjs) {
  const httpLike = linkObjs.filter((l) => l.isHttpLike);
  const internal = httpLike.filter((l) => !l.isExternal);
  const external = httpLike.filter((l) => l.isExternal);
  const uniqueDomains = new Set(httpLike.map((l) => l.host).filter(Boolean));

  return {
    total: linkObjs.length,
    internal: internal.length,
    external: external.length,
    risky: linkObjs.filter((l) => l.isRisky).length,
    uniqueDomains: uniqueDomains.size,
  };
}

function applyFilter(linkObjs, filterMode) {
  // Canonical filter behaviour:
  // - all: every URL
  // - internal: all internal links
  // - external: all external links
  // - risky: only risky links
  if (filterMode === 'internal') {
    return linkObjs.filter((l) => l.isHttpLike && !l.isExternal);
  }
  if (filterMode === 'external') {
    return linkObjs.filter((l) => l.isHttpLike && l.isExternal);
  }
  if (filterMode === 'risky') {
    return linkObjs.filter((l) => l.isRisky);
  }
  return linkObjs;
}

function applySort(linkObjs, sortMode) {
  const out = [...linkObjs];

  if (sortMode === 'alphabetical') {
    out.sort((a, b) => a.url.localeCompare(b.url));
  } else if (sortMode === 'domain') {
    out.sort((a, b) => {
      const h = (a.host || '').localeCompare(b.host || '');
      if (h !== 0) return h;
      return a.url.localeCompare(b.url);
    });
  } else if (sortMode === 'pathlen') {
    out.sort((a, b) => {
      const aPath = (() => {
        try { return new URL(a.url).pathname.length; } catch { return 0; }
      })();
      const bPath = (() => {
        try { return new URL(b.url).pathname.length; } catch { return 0; }
      })();
      return bPath - aPath;
    });
  }

  return out;
}

function setActiveFilterButton(mode) {
  document.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.classList.toggle('active-filter', btn.getAttribute('data-filter') === mode);
  });
}

function renderSummary(summary) {
  const summaryEl = document.getElementById('summary');
  summaryEl.innerHTML = `
    <div><strong>Total:</strong> ${summary.total}</div>
    <div><strong>Internal:</strong> ${summary.internal}</div>
    <div><strong>External:</strong> ${summary.external}</div>
    <div><strong>Risky:</strong> ${summary.risky}</div>
    <div><strong>Unique domains:</strong> ${summary.uniqueDomains}</div>
  `;
}

function makeCopyIconButton(url) {
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.type = 'button';
  btn.textContent = '⧉';
  btn.title = 'Copy URL';
  btn.setAttribute('aria-label', `Copy ${url}`);
  btn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = '✓';
      btn.title = 'Copied!';
      setTimeout(() => {
        btn.textContent = '⧉';
        btn.title = 'Copy URL';
      }, 700);
    } catch (_) {
      btn.textContent = '!';
      btn.title = 'Copy failed';
      setTimeout(() => {
        btn.textContent = '⧉';
        btn.title = 'Copy URL';
      }, 700);
    }
  });
  return btn;
}

function renderRiskyGrouped(linkList, riskyLinks) {
  const groups = new Map();
  riskyLinks.forEach((l) => {
    const key = l.riskLabel || 'Risky';
    if (!groups.has(key)) {
      groups.set(key, { label: key, explanation: l.riskExplanation || '', items: [] });
    }
    groups.get(key).items.push(l);
  });

  const holder = document.createElement('div');
  holder.className = 'risk-groups';

  Array.from(groups.values()).forEach((group, idx) => {
    const details = document.createElement('details');
    details.className = 'risk-group';
    details.open = true;

    const isTechnical = /insecure http/i.test(group.label);

    const summary = document.createElement('summary');
    summary.className = `risk-summary ${isTechnical ? 'risk-summary-technical' : 'risk-summary-catastrophic'}`;

    const left = document.createElement('div');
    left.className = 'risk-summary-left';

    const label = document.createElement('span');
    label.className = 'risk-summary-label';
    label.textContent = `${group.label} (${group.items.length})`;

    left.appendChild(label);

    if (group.explanation) {
      const info = document.createElement('span');
      info.className = 'info-dot';
      info.textContent = 'i';
      info.title = group.explanation;
      left.appendChild(info);
    }

    summary.appendChild(left);
    details.appendChild(summary);

    const list = document.createElement('ul');
    list.className = 'risk-list';

    group.items.forEach((linkObj) => {
      const li = document.createElement('li');
      li.className = 'risk-row';

      const a = document.createElement('a');
      a.className = 'risk-url';
      a.textContent = linkObj.url;
      applySafeLinkBehaviour(a, linkObj.url);

      const copyBtn = makeCopyIconButton(linkObj.url);
      li.appendChild(a);
      li.appendChild(copyBtn);
      list.appendChild(li);
    });

    details.appendChild(list);
    holder.appendChild(details);
  });

  linkList.appendChild(holder);
}

function renderLinks(linkObjs, pageHost, filterMode, sortMode) {
  const linkList = document.getElementById('linkList');
  const title = document.getElementById('title');
  linkList.innerHTML = '';

  const filteredSorted = applySort(applyFilter(linkObjs, filterMode), sortMode);
  const MAX_RENDER = 500;
  const visibleSet = filteredSorted.slice(0, MAX_RENDER);
  const truncated = filteredSorted.length > MAX_RENDER;

  title.textContent = `Links on This Page (${visibleSet.length} shown${truncated ? ` of ${filteredSorted.length}` : ''})`;

  if (visibleSet.length === 0) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'No links match the current filter.';
    linkList.appendChild(div);
    return filteredSorted;
  }

  const showRiskDecorations = filterMode === 'risky';

  if (!showRiskDecorations) {
    const first = visibleSet[0]?.url;
    const last = visibleSet[visibleSet.length - 1]?.url;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `First: ${first}\nLast: ${last}${truncated ? `\nShowing first ${MAX_RENDER} for performance.` : ''}`;
    linkList.appendChild(meta);
  }

  if (showRiskDecorations) {
    const riskyHeading = document.createElement('div');
    riskyHeading.className = 'bucket-heading risky-heading';
    riskyHeading.textContent = `Risky (${visibleSet.length}${truncated ? ` of ${filteredSorted.length}` : ''})`;
    linkList.appendChild(riskyHeading);
    renderRiskyGrouped(linkList, visibleSet);
    return visibleSet;
  }

  const fragment = document.createDocumentFragment();
  visibleSet.forEach((linkObj) => {
    const li = document.createElement('li');
    if (linkObj.isExternal) li.classList.add('external-link');

    const row = document.createElement('div');
    row.className = 'row';

    const a = document.createElement('a');
    a.className = 'link-text';
    a.textContent = linkObj.url;
    applySafeLinkBehaviour(a, linkObj.url);

    const btn = makeCopyIconButton(linkObj.url);

    row.appendChild(a);
    row.appendChild(btn);
    li.appendChild(row);
    fragment.appendChild(li);
  });

  linkList.appendChild(fragment);
  return visibleSet;
}

function setupExportButtons(getVisibleLinks) {
  const copyAllBtn = document.getElementById('copyAllBtn');
  const exportTxtBtn = document.getElementById('exportTxtBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');

  copyAllBtn.onclick = async () => {
    const visible = getVisibleLinks();
    try {
      await navigator.clipboard.writeText(visible.map((l) => l.url).join('\n'));
    } catch (err) {
      console.error('Copy all failed:', err);
    }
  };

  exportTxtBtn.onclick = () => {
    const visible = getVisibleLinks();
    download('links.txt', `${visible.map((l) => l.url).join('\n')}\n`, 'text/plain');
  };

  exportCsvBtn.onclick = () => {
    const visible = getVisibleLinks();
    const rows = ['url,scheme,host,external,risky'];
    visible.forEach((l) => {
      rows.push([
        escapeCsv(l.url),
        escapeCsv(l.scheme),
        escapeCsv(l.host),
        escapeCsv(l.isExternal),
        escapeCsv(l.isRisky),
      ].join(','));
    });
    download('links.csv', `${rows.join('\n')}\n`, 'text/csv');
  };
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;

    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: extractLinks,
      },
      (results) => {
        if (chrome.runtime.lastError) {
          console.error('Script execution error:', chrome.runtime.lastError.message);
          return;
        }

        const links = results?.[0]?.result || [];
        const pageUrl = tabs?.[0]?.url || '';
        const pageHost = (() => {
          try {
            return new URL(pageUrl).hostname;
          } catch {
            return '';
          }
        })();

        const linkObjs = links.map((l) => classifyLink(l, pageHost));
        let filterMode = 'all';
        let sortMode = 'first';
        let visibleLinks = [];

        const rerender = () => {
          renderSummary(getSummary(linkObjs));
          visibleLinks = renderLinks(linkObjs, pageHost, filterMode, sortMode);
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

        rerender();
      },
    );
  });
});
