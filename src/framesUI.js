export default class FramesUI {
  constructor(program){
    this.program = program;
    this.container = document.getElementById('frames-list');
    this.addBtn = document.getElementById('add-frame');
    this.dupBtn = document.getElementById('dup-frame');
    this.delBtn = document.getElementById('del-frame');

    this.thumbW = 160; this.thumbH = 72;
    this.selected = new Set();

    this._longPressTimeout = 500; // ms
    this._recentLongPressIndex = null;
    // track active pointers globally to support two-finger gestures on touch
    this._activePointers = new Map(); // pointerId -> {idx,x,y,type}
    this._twoFingerTimers = new Map(); // idx -> timerId
    this._bindControls();
    this.render();
    // pointerdown outside clears selection mode
    this._onDocPointer = (e)=>{
      if(!this.container) return;
      const p = e.composedPath ? e.composedPath() : (e.path || []);
      const outside = !p.includes(this.container) && !(this.addBtn && this.addBtn.contains && this.addBtn.contains(e.target)) && !(this.dupBtn && this.dupBtn.contains && this.dupBtn.contains(e.target)) && !(this.delBtn && this.delBtn.contains && this.delBtn.contains(e.target));
      // Only clear multi-selection if we're currently in selection mode
      // or there is an active multi-selection. Do not touch selection when
      // the user is not using multi-select — this preserves the basic
      // single-frame (blue) selection and avoids suppressing normal input.
      if(outside && (this._selectionMode || this.selected.size > 0)){
        this._selectionMode = false;
        this.container.classList.remove('selection-active');
        // clear selection
        if(this.selected.size) { this.selected.clear(); this.render(); }
        // prevent the closing click from drawing on the canvas only when
        // we actually cleared a selection (so normal clicks are not suppressed)
        try{ this.program._suppressNextPointerDown = true; }catch(e){}
        setTimeout(()=>{ try{ this.program._suppressNextPointerDown = false; }catch(e){} }, 300);
      }
    };
    // capture phase so suppression runs before canvas handlers
    document.addEventListener('pointerdown', this._onDocPointer, true);
  }

  _bindControls(){
    if(this.addBtn) this.addBtn.addEventListener('click', ()=>{ this.program.addFrame(); this.render(); });
    if(this.dupBtn) this.dupBtn.addEventListener('click', ()=> this.duplicateSelection());
    if(this.delBtn) this.delBtn.addEventListener('click', ()=> this.deleteSelection());
  }

  render(){
    if(!this.container) return;
    this.container.innerHTML = '';
    this.program.frames.forEach((f, idx)=>{
      const item = document.createElement('div');
      // show program's current frame as selected (blue) OR the multi-select state
      const isCurrent = this.program.currentFrameIndex === idx;
      const isMultiSelected = this.selected.has(idx);
      item.className = 'frame-thumb' + ((isCurrent || isMultiSelected) ? ' selected' : '');
      item.dataset.index = String(idx);

      const cvs = document.createElement('canvas');
      cvs.width = this.thumbW; cvs.height = this.thumbH;
      const ctx = cvs.getContext('2d');
      try{
        ctx.clearRect(0,0,this.thumbW,this.thumbH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#fff'; ctx.fillRect(0,0,this.thumbW,this.thumbH);
        ctx.drawImage(f.canvas, 0,0, f.canvas.width, f.canvas.height, 0,0, this.thumbW, this.thumbH);
      }catch(e){}
      item.appendChild(cvs);

      // pointer handling for two-step input: 0.25s -> drag start, 0.5s -> select
      let dragTimer = null;
      let selectTimer = null;
      let startPos = null;
      let dragged = false;
      let isScrolling = false;

      const clearTimers = ()=>{
        if(dragTimer){ clearTimeout(dragTimer); dragTimer = null; }
        if(selectTimer){ clearTimeout(selectTimer); selectTimer = null; }
      };

      const beginDragFromTimer = (ev)=>{
        // clear selection timer if pending
        if(selectTimer){ clearTimeout(selectTimer); selectTimer = null; }
        // mark dragged and start drag flow
        dragged = true;
        this._recentLongPressIndex = null;
        // prevent default now to stop page scrolling when an actual drag begins
        try{ ev.preventDefault(); }catch(e){}
        item.setPointerCapture && item.setPointerCapture(ev.pointerId);
        this._startDrag(idx, ev);
      };

      const onPointerDown = (ev)=>{
        // capture pointer immediately and prevent default behavior to stop
        // the browser from focusing UI or scrolling. We'll implement manual
        // scrolling if the user moves before a drag starts.
        try{ item.setPointerCapture && item.setPointerCapture(ev.pointerId); }catch(e){}
        try{ ev.preventDefault(); }catch(e){}
        startPos = {x: ev.clientX, y: ev.clientY};
        dragged = false; isScrolling = false;
        // register active pointer for multi-touch detection
        try{
          this._activePointers.set(ev.pointerId, {idx, x: ev.clientX, y: ev.clientY, type: ev.pointerType});
        }catch(e){}
        // count how many active touch pointers are on this thumbnail
        const sameCnt = Array.from(this._activePointers.values()).filter(p=>p.idx===idx && p.type==='touch').length;
        if(ev.pointerType === 'touch' && sameCnt >= 2){
          // start a short two-finger hold timer to enter multi-select
          if(!this._twoFingerTimers.has(idx)){
            const t = setTimeout(()=>{
              this._twoFingerTimers.delete(idx);
              this._recentLongPressIndex = idx;
              this._selectionMode = true;
              this.container.classList.add('selection-active');
              this.toggleSelect(idx);
            }, 250);
            this._twoFingerTimers.set(idx, t);
          }
        }
        // 250ms: start a drag if the user holds without moving
        dragTimer = setTimeout(()=> beginDragFromTimer(ev), 250);
        // 500ms: long-press selection
        selectTimer = setTimeout(()=>{
          this._recentLongPressIndex = idx;
          this._selectionMode = true;
          this.container.classList.add('selection-active');
          this.toggleSelect(idx);
          selectTimer = null;
          // clear pending drag timer so we don't immediately begin dragging after select
          if(dragTimer){ clearTimeout(dragTimer); dragTimer = null; }
        }, 500);
      };
      const onPointerMove = (ev)=>{
        if(!startPos) return;
        // update active pointer position for multi-touch detection
        try{ if(this._activePointers.has(ev.pointerId)) this._activePointers.set(ev.pointerId, {idx, x: ev.clientX, y: ev.clientY, type: ev.pointerType}); }catch(e){}
        const dx = ev.clientX - startPos.x, dy = ev.clientY - startPos.y;
        if(!dragged && (Math.abs(dx) > 6 || Math.abs(dy) > 6)){
          // movement before a drag has been intentionally started -> treat as scroll
          if(dragTimer){
            // user moved before drag-timer fired: perform manual scroll
            isScrolling = true;
            if(selectTimer){ clearTimeout(selectTimer); selectTimer = null; }
            if(dragTimer){ clearTimeout(dragTimer); dragTimer = null; }
            // scroll the list by the delta
            if(this.container) this.container.scrollTop += (startPos.y - ev.clientY);
            // reset startPos for further scroll deltas
            startPos = {x: ev.clientX, y: ev.clientY};
          } else {
            // dragTimer already fired or drag was initiated: start actual drag
            dragged = true;
            if(selectTimer){ clearTimeout(selectTimer); selectTimer = null; }
            try{ ev.preventDefault(); }catch(e){}
            item.setPointerCapture && item.setPointerCapture(ev.pointerId);
            this._startDrag(idx, ev);
          }
        }
        if(dragged){
          this._onDragMove(ev);
        }
      };
      const onPointerUp = (ev)=>{
        clearTimers();
        if(dragged){
          this._endDrag(ev);
        } else if(isScrolling){
          // finished manual scroll; do nothing further
          isScrolling = false;
        } else {
          // If a long-press just occurred for this index, suppress any
          // further toggle on pointerup. This persists across re-renders
          // because _recentLongPressIndex is stored on the FramesUI instance.
          if(this._recentLongPressIndex === idx){
            this._recentLongPressIndex = null;
          } else if(this._selectionMode){
            this.toggleSelect(idx);
          } else {
            // click behavior: ctrl/meta toggles additional selection, otherwise select single
            if(ev.ctrlKey || ev.metaKey){
              this.toggleSelect(idx);
            } else {
              this.selectSingle(idx);
            }
          }
        }
        startPos = null;
        dragged = false;
        // remove from active pointers and clear any pending two-finger timers
        try{
          this._activePointers.delete(ev.pointerId);
          const sameCntAfter = Array.from(this._activePointers.values()).filter(p=>p.idx===idx && p.type==='touch').length;
          if(this._twoFingerTimers.has(idx) && sameCntAfter < 2){
            clearTimeout(this._twoFingerTimers.get(idx));
            this._twoFingerTimers.delete(idx);
          }
        }catch(e){}
        try{ item.releasePointerCapture && item.releasePointerCapture(ev.pointerId); }catch(e){}
      };

      item.addEventListener('pointerdown', onPointerDown);
      item.addEventListener('pointermove', onPointerMove);
      item.addEventListener('pointerup', onPointerUp);
      item.addEventListener('pointercancel', onPointerUp);

      this.container.appendChild(item);
    });
  }

  toggleSelect(idx){
    if(this.selected.has(idx)) this.selected.delete(idx);
    else this.selected.add(idx);
    this.render();
  }
  selectSingle(idx){
    // Clear any multi-selection but do NOT add the index to the multi-select set.
    // A single click should change the program's current frame (blue highlight)
    // without turning it into a multi-selected (green) state.
    this.selected.clear();
    this.program.selectFrame(idx);
    this.render();
  }

  duplicateSelection(){
    // If no multi-selection, operate on the current frame
    const indices = this.selected.size === 0 ? [this.program.currentFrameIndex] : Array.from(this.selected).sort((a,b)=>a-b);
    const insertAt = indices[indices.length-1] + 1;
    const clones = [];
    for(const i of indices){
      const f = this.program.frames[i];
      const DPR = f.dpr || window.devicePixelRatio || 1;
      const clone = new (this.program.frame.constructor)(f.canvas.width, f.canvas.height, DPR);
      clone.ctx.drawImage(f.canvas,0,0,clone.canvas.width, clone.canvas.height);
      clones.push(clone);
    }
    this.program.frames.splice(insertAt, 0, ...clones);
    // select the newly inserted clones (multi-select) if we had a selection,
    // otherwise just select the inserted frame as the current frame.
    this.selected.clear();
    if(indices.length > 1){
      for(let i=0;i<clones.length;i++) this.selected.add(insertAt + i);
      this.program.selectFrame(insertAt);
    } else {
      this.program.selectFrame(insertAt);
    }
    this.program.commitSnapshot('duplicate-frames');
    this.render();
  }

  deleteSelection(){
    // If no multi-selection, delete the current frame (if possible)
    const indices = this.selected.size === 0 ? [this.program.currentFrameIndex] : Array.from(this.selected).sort((a,b)=>a-b);
    for(let i = indices.length-1; i >= 0; i--){
      const idx = indices[i];
      if(this.program.frames.length > 1) this.program.frames.splice(idx,1);
    }
    // clamp currentFrameIndex
    this.program.currentFrameIndex = Math.min(this.program.currentFrameIndex, this.program.frames.length - 1);
    this.program.frame = this.program.frames[this.program.currentFrameIndex];
    this.selected.clear();
    this.program.selectFrame(this.program.currentFrameIndex);
    this.program.commitSnapshot('delete-frames');
    this.render();
  }

  // Drag helpers
  _startDrag(startIdx, ev){
    // if startIdx not selected, consider it the selected single
    if(!this.selected.has(startIdx)){
      this.selected.clear(); this.selected.add(startIdx);
    }
    this._dragging = true;
    this._dragStartIdx = startIdx;
    // create drag ghost
    this._dragGhost = document.createElement('div');
    this._dragGhost.style.position = 'fixed';
    this._dragGhost.style.pointerEvents = 'none';
    this._dragGhost.style.opacity = '0.9';
    this._dragGhost.style.zIndex = '9999';
    const canvas = document.createElement('canvas');
    canvas.width = this.thumbW; canvas.height = this.thumbH;
    const ctx = canvas.getContext('2d');
    // render combined preview: show first selected as ghost
    const firstIdx = Array.from(this.selected)[0];
    try{ ctx.drawImage(this.program.frames[firstIdx].canvas, 0,0, this.program.frames[firstIdx].canvas.width, this.program.frames[firstIdx].canvas.height, 0,0, this.thumbW, this.thumbH); }catch(e){}
    this._dragGhost.appendChild(canvas);
    document.body.appendChild(this._dragGhost);
    this._onDragMove(ev);
  }
  _onDragMove(ev){
    if(!this._dragging) return;
    // center ghost under pointer
    const gw = this._dragGhost.offsetWidth || this.thumbW;
    const gh = this._dragGhost.offsetHeight || this.thumbH;
    this._dragGhost.style.left = (ev.clientX - (gw/2)) + 'px';
    this._dragGhost.style.top = (ev.clientY - (gh/2)) + 'px';
    // highlight potential drop index
    const items = Array.from(this.container.children);
    let dropIdx = items.length;
    for(let i=0;i<items.length;i++){
      const r = items[i].getBoundingClientRect();
      if(ev.clientY < r.top + r.height/2){ dropIdx = i; break; }
    }
    // store for end
    this._lastDropIndex = dropIdx;
    // visual indicator
    items.forEach(it=> it.classList.remove('drop-after'));
    if(dropIdx > 0 && dropIdx <= items.length){
      const ref = items[Math.max(0, dropIdx-1)];
      if(ref) ref.classList.add('drop-after');
    }
  }
  _endDrag(ev){
    if(!this._dragging) return;
    this._dragging = false;
    // remove ghost
    if(this._dragGhost){ this._dragGhost.remove(); this._dragGhost = null; }
    // perform reorder: move selected frames to _lastDropIndex position
    const indices = Array.from(this.selected).sort((a,b)=>a-b);
    const framesToMove = indices.map(i=> this.program.frames[i]);
    // remove highest-first
    for(let i=indices.length-1;i>=0;i--) this.program.frames.splice(indices[i],1);
    // adjust drop index after removals
    let target = this._lastDropIndex;
    // clamp
    target = Math.max(0, Math.min(this.program.frames.length, target));
    this.program.frames.splice(target,0,...framesToMove);
    // select moved frames
    this.selected.clear();
    for(let i=0;i<framesToMove.length;i++) this.selected.add(target + i);
    this.program.selectFrame(target);
    // cleanup visuals
    Array.from(this.container.children).forEach(c=> c.classList.remove('drop-after'));
    this.program.commitSnapshot('reorder-frames');
    this.render();
  }
}
