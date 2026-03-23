function extractLinks() {
  const raw = Array.from(document.querySelectorAll('a'))
    .map((a) => (a.href || '').trim())
    .filter(Boolean);

  return Array.from(new Set(raw));
}

function escapeCsv(value) {
  const v = String(value ?? '');
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
    riskLabel = 'High Priority: Data Exposure Risk';
    riskExplanation = 'This link contains parameters that may leak your personal identity or active session credentials to external servers.';
  } else if (executablePattern.test(parsed.pathname) || executablePattern.test(rawUrl)) {
    isRisky = true;
    riskLabel = 'High Priority: Security Risk';
    riskExplanation = 'This link leads to a direct download of an executable script or a sensitive configuration file which could compromise your system.';
  } else if (scheme === 'http') {
    isRisky = true;
    riskLabel = 'Technical Debt: Insecure HTTP';
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

function renderLinks(linkObjs, pageHost, filterMode, sortMode) {
  const linkList = document.getElementById('linkList');
  const title = document.getElementById('title');
  linkList.innerHTML = '';

  const filteredSorted = applySort(applyFilter(linkObjs, filterMode), sortMode)
    .sort((a, b) => Number(b.isRisky) - Number(a.isRisky));
  title.textContent = `Links on This Page (${filteredSorted.length} shown)`;

  if (filteredSorted.length === 0) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'No links match the current filter.';
    linkList.appendChild(div);
    return filteredSorted;
  }

  const first = filteredSorted[0]?.url;
  const last = filteredSorted[filteredSorted.length - 1]?.url;

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `First: ${first}\nLast: ${last}`;
  linkList.appendChild(meta);

  const fragment = document.createDocumentFragment();

  const riskyItems = filteredSorted.filter((l) => l.isRisky);
  const safeItems = filteredSorted.filter((l) => !l.isRisky);

  if (riskyItems.length > 0) {
    const riskyHeading = document.createElement('div');
    riskyHeading.className = 'bucket-heading risky-heading';
    riskyHeading.textContent = `Risky (${riskyItems.length})`;
    fragment.appendChild(riskyHeading);
  }

  const orderedItems = [...riskyItems, ...safeItems];
  let safeHeadingAdded = false;

  orderedItems.forEach((linkObj) => {
    if (!linkObj.isRisky && riskyItems.length > 0 && !safeHeadingAdded) {
      const safeHeading = document.createElement('div');
      safeHeading.className = 'bucket-heading';
      safeHeading.textContent = `Other links (${safeItems.length})`;
      fragment.appendChild(safeHeading);
      safeHeadingAdded = true;
    }
    const li = document.createElement('li');

    if (linkObj.isExternal) li.classList.add('external-link');
    if (linkObj.isRisky) li.classList.add('risky-link');

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
    btn.setAttribute('aria-label', `Copy ${linkObj.url}`);
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(linkObj.url);
      } catch (err) {
        console.error('Clipboard copy failed:', err);
      }
    });

    row.appendChild(a);
    row.appendChild(btn);
    li.appendChild(row);

    if (linkObj.isRisky) {
      const risk = document.createElement('div');
      risk.className = 'risk-note';
      risk.textContent = `⚠ ${linkObj.riskLabel}`;
      if (linkObj.riskExplanation) {
        risk.title = linkObj.riskExplanation;
      }
      li.appendChild(risk);

      if (linkObj.riskExplanation) {
        const riskSub = document.createElement('div');
        riskSub.className = 'risk-subtext';
        riskSub.textContent = linkObj.riskExplanation;
        li.appendChild(riskSub);
      }
    }

    fragment.appendChild(li);
  });

  linkList.appendChild(fragment);
  return filteredSorted;
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
