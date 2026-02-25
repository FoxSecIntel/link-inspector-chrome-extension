![Version](https://img.shields.io/badge/version-1.1.0-blue)

# Link Inspector Chrome Extension

Link Inspector is a lightweight Chrome extension for fast link triage on the active tab.

It extracts unique HTTP(S) URLs, lets you copy results quickly, and exports clean TXT or CSV output for investigation workflows.

## Why this tool exists

During web investigations, analysts often need to:
- quickly enumerate all links on a page
- remove duplicates and noise
- pivot into domain analysis
- export evidence into case notes

Link Inspector keeps that flow fast inside the browser.

## Features

- Extracts anchor links from the active page
- Filters to HTTP(S) links only
- Deduplicates links
- Shows first and last observed links
- Copy single link or copy all links
- Export as `links.txt` or `links.csv`
- Local-only processing, no outbound telemetry

## Chrome Web Store

https://chromewebstore.google.com/detail/link-inspector/mhddppopjnmclolaonnimfenhfepjmpd

## Installation

### Option 1: Chrome Web Store

Install directly from:
https://chromewebstore.google.com/detail/link-inspector/mhddppopjnmclolaonnimfenhfepjmpd

### Option 2: Load unpacked (developer)

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `src` folder

## Packaging note for store uploads

The extension package root must be the `src` folder contents so that `manifest.json` is at the ZIP root.

Example:

```bash
cd src
zip -r ../link-inspector-upload.zip .
```

Do not upload the repository root as the extension bundle.

## Project structure

```text
README.md
src/
├── manifest.json
├── popup.html
├── popup.js
└── images/
    └── icon128.png
```

## Permissions

- `activeTab`: read links from the active tab only
- `scripting`: run extraction logic in the active tab context

## Security model

- No data is sent to external services by the extension.
- URLs are rendered with safe DOM APIs, avoiding risky HTML injection patterns.
- Clipboard and export actions are user-triggered.

## Troubleshooting

- **No links found**: page may be script-rendered post-load or has no anchor tags.
- **Extension fails on protected pages**: Chrome blocks script injection on some internal/system pages.
- **Store upload rejects package**: ensure `manifest.json` is at ZIP root, not nested.

## Licence

MIT
