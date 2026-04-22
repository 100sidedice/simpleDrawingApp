export function setupHistoryPreview(program) {
  if (!program || !program.vc) return;
  const undoBtn = program.undoBtn;
  const redoBtn = program.redoBtn;
  const canvas = program.canvas;
  const vc = program.vc;

  let overlay = null;
  function createOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('canvas');
    overlay.className = 'history-preview-overlay';
    overlay.style.position = 'fixed';
    overlay.style.left = canvas.style.left || canvas.getBoundingClientRect().left + 'px';
    overlay.style.top = canvas.style.top || canvas.getBoundingClientRect().top + 'px';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = 99999;
    document.body.appendChild(overlay);
    return overlay;
  }

  function removeOverlay() {
    if (!overlay) return;
    try { overlay.remove(); } catch (e) {}
    overlay = null;
  }

  function drawDiff(plainA, plainB) {
    if (!plainA || !plainB) return false;
    if (plainA.width !== plainB.width || plainA.height !== plainB.height) return false;
    const w = plainA.width, h = plainA.height;
    const out = createOverlay();
    // size overlay in device pixels and CSS pixels to match main canvas
    out.width = w;
    out.height = h;
    try {
      out.style.width = (w / (window.devicePixelRatio || 1)) + 'px';
      out.style.height = (h / (window.devicePixelRatio || 1)) + 'px';
      const rect = canvas.getBoundingClientRect();
      out.style.left = rect.left + 'px';
      out.style.top = rect.top + 'px';
    } catch (e) {}
    const ctx = out.getContext('2d');
    const da = plainA.data;
    const db = plainB.data;
    const img = ctx.createImageData(w, h);
    const id = img.data;
    let changed = false;
    // highlight differences: green for additions, red for removals
    for (let i = 0; i < da.length; i += 4) {
      const a0 = da[i], a1 = da[i+1], a2 = da[i+2], a3 = da[i+3];
      const b0 = db[i], b1 = db[i+1], b2 = db[i+2], b3 = db[i+3];
      const same = a0 === b0 && a1 === b1 && a2 === b2 && a3 === b3;
      if (same) {
        id[i] = 0; id[i+1] = 0; id[i+2] = 0; id[i+3] = 0;
        continue;
      }
      changed = true;
      // classify: if target (b) has more alpha than current (a) => addition (green)
      if (b3 > a3) {
        id[i] = 0; id[i+1] = 255; id[i+2] = 0; id[i+3] = 150;
      } else if (b3 < a3) {
        // removal (red)
        id[i] = 255; id[i+1] = 0; id[i+2] = 0; id[i+3] = 150;
      } else {
        // same alpha but different color: show as green (treat as replacement/add)
        id[i] = 0; id[i+1] = 255; id[i+2] = 0; id[i+3] = 150;
      }
    }
    if (!changed) {
      // nothing to show
      removeOverlay();
      return false;
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }

  function previewFor(commitIndex) {
    if (commitIndex < 0 || commitIndex >= vc.commits.length) return;
    const current = vc.current;
    // only preview if the affected frame is the current frame
    const targetCommit = vc.commits[commitIndex];
    if (!targetCommit || !targetCommit.meta) return;
    const frameIdx = typeof targetCommit.meta.frameIndex === 'number' ? targetCommit.meta.frameIndex : null;
    if (frameIdx === null || frameIdx !== program.currentFrameIndex) {
      // do not preview if it affects a different frame
      removeOverlay();
      return;
    }
    // get plain frames for this commit and the current commit
    const plainA = vc.getPlainFrameAtCommit(current, frameIdx);
    const plainB = vc.getPlainFrameAtCommit(commitIndex, frameIdx);
    if (!plainA || !plainB) { removeOverlay(); return; }
    drawDiff(plainA, plainB);
  }

  function onHold(buttonType) {
    if (!vc || typeof vc.current !== 'number') return;
    if (buttonType === 'undo') {
      const target = vc.current - 1;
      previewFor(target);
    } else {
      const target = vc.current + 1;
      previewFor(target);
    }
  }

  function attachHold(button, type) {
    if (!button) return;
    let holdTimer = null;
    let spamInterval = null;
    let lastTapTime = 0;
    let lastTapX = 0, lastTapY = 0;
    const DOUBLE_TAP_MS = 200;
    const DOUBLE_TAP_DIST = 10; // px

    const doAction = () => {
      try {
        if (type === 'undo') program.undo(); else program.redo();
      } catch (e) {}
    };

    let isDown = false;
    const start = (e) => {
      // ignore if a pointer is already down to prevent duplicate events
      if (isDown) return;
      isDown = true;
      const now = Date.now();
      const x = (e.clientX !== undefined) ? e.clientX : (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
      const y = (e.clientY !== undefined) ? e.clientY : (e.touches && e.touches[0] && e.touches[0].clientY) || 0;
      const dx = x - lastTapX, dy = y - lastTapY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const isDouble = (now - lastTapTime) <= DOUBLE_TAP_MS && dist <= DOUBLE_TAP_DIST;
      lastTapTime = now; lastTapX = x; lastTapY = y;

      // If double-tap detected, start continuous spam on hold (immediate first action)
      if (isDouble) {
        // cancel any preview timer
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        // perform one action immediately, then start interval
        doAction();
        spamInterval = setInterval(() => { doAction(); }, 120);
      } else {
        // single tap: schedule preview after short delay
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(()=> onHold(type), 200);
      }
    };

    const cancel = (e) => {
      isDown = false;
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      if (spamInterval) { clearInterval(spamInterval); spamInterval = null; }
      removeOverlay();
    };

    // Use pointer events only to avoid duplicate mouse/touch events
    button.addEventListener('pointerdown', start);
    button.addEventListener('pointerup', cancel);
    button.addEventListener('pointercancel', cancel);
    button.addEventListener('pointerleave', cancel);
  }

  attachHold(undoBtn, 'undo');
  attachHold(redoBtn, 'redo');
}
