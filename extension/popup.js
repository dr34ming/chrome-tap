const statusEl = document.getElementById('status');
const tokenSection = document.getElementById('token-section');
const tokenEl = document.getElementById('token');
const copyBtn = document.getElementById('copy-btn');
const tabsSection = document.getElementById('tabs-section');
const tabList = document.getElementById('tab-list');

chrome.runtime.sendMessage({ type: 'getStatus' }, (res) => {
  if (!res) {
    statusEl.textContent = 'Extension error';
    statusEl.className = 'status disconnected';
    return;
  }

  if (res.connected) {
    statusEl.textContent = 'Connected';
    statusEl.className = 'status connected';
    tokenSection.style.display = 'block';
    tokenEl.textContent = '••••••••';

    // Read token path hint
    tokenEl.title = '~/.chrome-tap/token';
  } else {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'status disconnected';
  }

  if (res.attachedTabs?.length > 0) {
    tabsSection.style.display = 'block';
    res.attachedTabs.forEach((tabId) => {
      const li = document.createElement('li');
      li.textContent = `Tab ${tabId}`;
      tabList.appendChild(li);
    });
  }
});

copyBtn.addEventListener('click', async () => {
  // Can't read the file directly from extension, show path instead
  try {
    await navigator.clipboard.writeText('cat ~/.chrome-tap/token');
    copyBtn.textContent = 'Copied cmd!';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  } catch (_) {
    copyBtn.textContent = 'Failed';
  }
});
