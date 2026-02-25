function extractLinks() {
  const raw = Array.from(document.querySelectorAll('a')).map((a) => a.href || '').filter(Boolean);
  const filtered = raw.filter((u) => /^https?:\/\//i.test(u));
  const unique = Array.from(new Set(filtered));
  return unique;
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

function renderLinks(links) {
  const linkList = document.getElementById('linkList');
  const title = document.getElementById('title');
  linkList.innerHTML = '';

  title.textContent = `Links on This Page (${links.length} unique)`;

  if (links.length === 0) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'No HTTP(S) links found on this page.';
    linkList.appendChild(div);
    return;
  }

  const first = links[0];
  const last = links[links.length - 1];

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `First: ${first}\nLast: ${last}`;
  linkList.appendChild(meta);

  const fragment = document.createDocumentFragment();

  links.forEach((link) => {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'row';

    const a = document.createElement('a');
    a.className = 'link-text';
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = link;

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', `Copy ${link}`);
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
      } catch (err) {
        console.error('Clipboard copy failed:', err);
      }
    });

    row.appendChild(a);
    row.appendChild(btn);
    li.appendChild(row);
    fragment.appendChild(li);
  });

  linkList.appendChild(fragment);
}

function setupExportButtons(links) {
  const copyAllBtn = document.getElementById('copyAllBtn');
  const exportTxtBtn = document.getElementById('exportTxtBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');

  copyAllBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(links.join('\n'));
    } catch (err) {
      console.error('Copy all failed:', err);
    }
  };

  exportTxtBtn.onclick = () => {
    download('links.txt', `${links.join('\n')}\n`, 'text/plain');
  };

  exportCsvBtn.onclick = () => {
    const rows = ['url', ...links.map((u) => escapeCsv(u))];
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
        renderLinks(links);
        setupExportButtons(links);
      },
    );
  });
});
