// Injected on demand (via chrome.scripting.executeScript, triggered by the
// activeTab permission on a user click) — never declared as a static
// content_scripts entry, so PagePixel needs no host_permissions.
(() => {
  if (window.__pagePixelContentScriptLoaded) return;
  window.__pagePixelContentScriptLoaded = true;

  let hiddenFixedEls = [];

  function measure() {
    return {
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      // captureVisibleTab includes the classic scrollbar; overlay scrollbars report 0 here.
      scrollbarWidth: Math.max(0, window.innerWidth - document.documentElement.clientWidth),
      devicePixelRatio: window.devicePixelRatio || 1,
      initialScrollY: window.scrollY,
    };
  }

  function waitForScrollSettle() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function prepareFullPage() {
    hiddenFixedEls = [];
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if ((style.position === 'fixed' || style.position === 'sticky') && style.visibility !== 'hidden') {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        hiddenFixedEls.push({ el, prevVisibility: el.style.visibility });
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    }
    return { hiddenCount: hiddenFixedEls.length };
  }

  async function scrollTo(y) {
    window.scrollTo(0, y);
    await waitForScrollSettle();
    return { scrollY: window.scrollY };
  }

  function restoreFullPage(scrollY) {
    for (const { el, prevVisibility } of hiddenFixedEls) {
      if (prevVisibility) el.style.visibility = prevVisibility;
      else el.style.removeProperty('visibility');
    }
    hiddenFixedEls = [];
    window.scrollTo(0, typeof scrollY === 'number' ? scrollY : 0);
    return { ok: true };
  }

  // ---- Selected-area drag overlay ----
  let activeSelection = null;

  function startSelection(delayMs) {
    if (activeSelection) return;

    const overlay = document.createElement('div');
    overlay.setAttribute('data-pagepixel', 'overlay');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      cursor: 'crosshair',
      background: 'rgba(11, 31, 51, 0.15)',
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'fixed',
      border: '2px solid #FF7A45',
      background: 'rgba(255, 122, 69, 0.18)',
      display: 'none',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });

    const hint = document.createElement('div');
    hint.textContent = 'Drag to select an area · Esc to cancel';
    Object.assign(hint.style, {
      position: 'fixed',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#0B1F33',
      color: '#fff',
      padding: '6px 14px',
      borderRadius: '999px',
      font: '13px/1.4 -apple-system, "Segoe UI", sans-serif',
      zIndex: '2147483647',
      pointerEvents: 'none',
      boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
    });

    document.documentElement.append(overlay, box, hint);

    let startX = 0;
    let startY = 0;
    let dragging = false;

    const onMouseDown = (e) => {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      Object.assign(box.style, { left: `${startX}px`, top: `${startY}px`, width: '0px', height: '0px', display: 'block' });
    };

    const onMouseMove = (e) => {
      if (!dragging) return;
      const x = Math.min(e.clientX, startX);
      const y = Math.min(e.clientY, startY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    };

    const onMouseUp = (e) => {
      if (!dragging) return;
      dragging = false;
      const rect = {
        x: Math.min(e.clientX, startX),
        y: Math.min(e.clientY, startY),
        width: Math.abs(e.clientX - startX),
        height: Math.abs(e.clientY - startY),
      };
      cleanup();
      if (rect.width < 4 || rect.height < 4) return;
      chrome.runtime.sendMessage({
        type: 'PP_SELECTION_MADE',
        rect,
        devicePixelRatio: window.devicePixelRatio || 1,
        delayMs,
      });
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') cleanup();
    };

    function cleanup() {
      overlay.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      box.remove();
      hint.remove();
      activeSelection = null;
    }

    overlay.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown, true);
    activeSelection = { cleanup };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'PP_MEASURE':
        sendResponse(measure());
        return false;
      case 'PP_PREPARE_FULLPAGE':
        sendResponse(prepareFullPage());
        return false;
      case 'PP_SCROLL_TO':
        scrollTo(message.y).then(sendResponse);
        return true;
      case 'PP_RESTORE_FULLPAGE':
        sendResponse(restoreFullPage(message.scrollY));
        return false;
      case 'PP_START_SELECTION':
        startSelection(message.delayMs);
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  });
})();
