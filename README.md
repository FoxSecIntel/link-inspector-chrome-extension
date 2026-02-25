![Version](https://img.shields.io/badge/version-1.1.0-blue)

# Link Inspector Chrome Extension

A Chrome extension that extracts unique HTTP(S) links from the current tab and helps with quick link triage.

## Features

- Extracts anchor links from the active page
- Filters to HTTP(S) links only
- Deduplicates links
- Shows first and last observed links
- Copy single link or copy all links
- Export as `links.txt` or `links.csv`
- Lightweight with no tracking

## Chrome Web Store

https://chromewebstore.google.com/detail/link-inspector/mhddppopjnmclolaonnimfenhfepjmpd

## Installation

### Option 1: Chrome Web Store

Install directly from:
https://chromewebstore.google.com/detail/link-inspector/mhddppopjnmclolaonnimfenhfepjmpd

### Option 2: Load unpacked

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `src` folder

## Folder structure

```text
src/
├── manifest.json
├── popup.html
├── popup.js
└── images/
    └── icon128.png
```

## Permissions

- `activeTab`: read links from the currently active tab
- `scripting`: execute extraction logic in the active tab context

## Security notes

- The extension does not send data to external services.
- Links are processed locally in the browser popup context.
- `innerHTML` is avoided for URL rendering to reduce injection risk.

## Licence

MIT
