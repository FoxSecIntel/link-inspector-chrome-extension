document.addEventListener('DOMContentLoaded', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: extractLinks,
        }, (results) => {
            if (chrome.runtime.lastError) {
                console.error('Error executing script: ', chrome.runtime.lastError.message);
                return;
            }

            const links = results[0]?.result || [];
            const linkList = document.getElementById('linkList');
            const title = document.getElementById('title');

            // Update the title with the total count of links
            title.textContent = `Links on This Page (${links.length})`;

            // Clear any existing content in the list
            linkList.innerHTML = '';

            if (links.length === 0) {
                const li = document.createElement('li');
                li.textContent = 'No links found on this page.';
                linkList.appendChild(li);
                return;
            }

            const fragment = document.createDocumentFragment(); // Use a fragment to reduce DOM access

            // Display the first link separately
            if (links.length > 0) {
                const firstLi = document.createElement('li');
                firstLi.innerHTML = `<strong>First Link:</strong> 
                    <a href="${links[0]}" target="_blank">${links[0]}</a> 
                    <button class="copyBtn" title="Copy to clipboard" aria-label="Copy this link" style="font-size: 10px; padding: 2px 5px; margin-left: 10px;">Copy</button>`;
                fragment.appendChild(firstLi);
            }

            // Display the last link separately at the top
            if (links.length > 1) {
                const lastLiAtTop = document.createElement('li');
                lastLiAtTop.innerHTML = `<strong>Last Link:</strong> 
                    <a href="${links[links.length - 1]}" target="_blank">${links[links.length - 1]}</a> 
                    <button class="copyBtn" title="Copy to clipboard" aria-label="Copy this link" style="font-size: 10px; padding: 2px 5px; margin-left: 10px;">Copy</button>`;
                fragment.appendChild(lastLiAtTop);
            }

            // Display the full list of links, including the last one again
            links.forEach(link => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <a href="${link}" target="_blank">${link}</a> 
                    <button class="copyBtn" title="Copy to clipboard" aria-label="Copy this link" style="font-size: 10px; padding: 2px 5px; margin-left: 10px;">Copy</button>`;
                fragment.appendChild(li);
            });

            linkList.appendChild(fragment); // Append all items at once

            // Add event listeners to each "Copy" button
            document.querySelectorAll('.copyBtn').forEach(button => {
                button.addEventListener('click', function () {
                    const linkToCopy = this.previousElementSibling.href;
                    navigator.clipboard.writeText(linkToCopy).catch(err => {
                        console.error('Failed to copy text: ', err);
                    });
                });
            });
        });
    });

    // Export all links
    document.getElementById('exportBtn').addEventListener('click', function () {
        const links = Array.from(document.querySelectorAll('li a')).map(a => a.href);
        const blob = new Blob([links.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'links.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });
});

function extractLinks() {
    const links = Array.from(document.querySelectorAll('a')).map(a => a.href);
    return links;
}
