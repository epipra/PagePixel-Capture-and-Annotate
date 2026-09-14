const modeRadios = document.querySelectorAll('input[name="mode"]');
const delayInput = document.getElementById('delay');
const bottomToTopWrap = document.getElementById('bottomToTopWrap');
const bottomToTopCheckbox = document.getElementById('bottomToTop');
const captureBtn = document.getElementById('captureBtn');
const statusEl = document.getElementById('status');
const helpLink = document.getElementById('helpLink');

function currentMode() {
  return [...modeRadios].find((r) => r.checked)?.value || 'visible';
}

function syncFullPageOptions() {
  bottomToTopWrap.style.display = currentMode() === 'fullpage' ? 'flex' : 'none';
}

// Remember the user's last-used options across popup opens (chrome.storage.local).
const PREFS_KEY = 'pp_prefs';

async function loadPrefs() {
  try {
    const { [PREFS_KEY]: prefs } = await chrome.storage.local.get(PREFS_KEY);
    if (!prefs) return;
    if (prefs.mode) {
      const radio = [...modeRadios].find((r) => r.value === prefs.mode);
      if (radio) radio.checked = true;
    }
    if (typeof prefs.delayMs === 'number') delayInput.value = String(prefs.delayMs);
    if (typeof prefs.bottomToTop === 'boolean') bottomToTopCheckbox.checked = prefs.bottomToTop;
  } catch (err) {
    console.warn('[PagePixel] Could not load saved preferences', err);
  }
}

function savePrefs() {
  chrome.storage.local
    .set({
      [PREFS_KEY]: {
        mode: currentMode(),
        delayMs: clampDelay(delayInput.value),
        bottomToTop: bottomToTopCheckbox.checked,
      },
    })
    .catch((err) => console.warn('[PagePixel] Could not save preferences', err));
}

modeRadios.forEach((r) =>
  r.addEventListener('change', () => {
    syncFullPageOptions();
    savePrefs();
  })
);
delayInput.addEventListener('change', savePrefs);
bottomToTopCheckbox.addEventListener('change', savePrefs);

loadPrefs().then(syncFullPageOptions);

helpLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('help/help.html') });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'PP_PROGRESS') return;
  if (message.phase === 'capture') {
    setStatus(`Capturing slice ${message.current} of ${message.total}…`);
  } else if (message.phase === 'stitch') {
    setStatus('Stitching image…');
  }
});

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('status--error', isError);
}

function setBusy(busy) {
  captureBtn.disabled = busy;
  modeRadios.forEach((r) => (r.disabled = busy));
  delayInput.disabled = busy;
  bottomToTopCheckbox.disabled = busy;
}

function clampDelay(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return 150;
  return Math.min(5000, Math.max(0, n));
}

captureBtn.addEventListener('click', async () => {
  setBusy(true);
  setStatus('Starting…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('No active tab found.');
    if (!/^https?:|^file:/.test(tab.url || '')) {
      throw new Error("This page can't be captured (unsupported URL).");
    }

    const delayMs = clampDelay(delayInput.value);
    const mode = currentMode();

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content-script.js'] });

    if (mode === 'visible') {
      setStatus('Capturing…');
      const res = await chrome.runtime.sendMessage({ type: 'PP_CAPTURE_VISIBLE', tabId: tab.id, delayMs });
      finish(res);
    } else if (mode === 'fullpage') {
      setStatus('Capturing full page…');
      const res = await chrome.runtime.sendMessage({
        type: 'PP_CAPTURE_FULLPAGE',
        tabId: tab.id,
        options: { delayMs, bottomToTop: bottomToTopCheckbox.checked },
      });
      finish(res);
    } else {
      await chrome.tabs.sendMessage(tab.id, { type: 'PP_START_SELECTION', delayMs });
      setStatus('Drag on the page to select an area…');
      window.close();
    }
  } catch (err) {
    console.error('[PagePixel]', err);
    setStatus(err.message || 'Something went wrong.', true);
    setBusy(false);
  }
});

function finish(res) {
  if (!res || res.ok === false) {
    throw new Error((res && res.error) || 'Capture failed.');
  }
  setStatus('Done — opening result…');
  window.close();
}
