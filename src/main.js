import Input from './input.js';
import UI from './ui.js';
import Frame from './frame.js';
import VersionControl from './versionControl.js';
import { preload, setupIcons, setIconMaskColor, setAllMaskColors, refreshIcons } from './icons.js';
import { setupExportImport } from './exportImport.js';


class Program {
    constructor() {
        this.canvas = document.getElementById('draw');
        this.displayCtx = this.canvas.getContext('2d');
        this.colorInput = document.getElementById('color');
        this.sizeInput = document.getElementById('size');
        this.pencilBtn = document.getElementById('tool-pencil');
        this.fillBtn = document.getElementById('tool-fill');
        this.eyedropBtn = document.getElementById('tool-eyedrop');
        this.eraseBtn = document.getElementById('tool-erase');
        this.clearBtn = document.getElementById('clear');
        this.undoBtn = document.getElementById('undo');
        this.redoBtn = document.getElementById('redo');

        // single Frame for now (use device pixels for backing store)
        const DPR = window.devicePixelRatio || 1;
        this.frame = new Frame(Math.round(window.innerWidth * DPR), Math.round(window.innerHeight * DPR), DPR);
        this.vc = new VersionControl();

        this.input = new Input(this.canvas);
        this.ui = new UI(this.input);

        // commit history panel (on-screen diagnostics)
        this._vcHistory = null;
        // show commit history only when ?debug=true is present in the URL
        try {
            this._showCommitHistory = (new URLSearchParams(window.location.search).get('debug') === 'true');
        } catch (e) {
            this._showCommitHistory = false;
        }

        // frames list (animation frames)
        this.frames = [];
        this.currentFrameIndex = 0;
        // include the initial frame
        this.frames.push(this.frame);

        this.drawing = false;
        this.lastPositions = []; // array of [x,y]
        this.tool = 'pencil';
        this._hasDrawnDuringStroke = false;

        // hold-to-erase state
        this._holdEraseTimer = null;
        this._holdStartPos = null; // [x,y] in client coords
        this._holdEraseActive = false;
        this._holdPrevTool = null;
        this._holdMoveThreshold = 4; // pixels
        this._holdDelayMs = 500; // ms to trigger hold

        // brush cursor overlay
        this._brushCursor = document.createElement('div');
        this._brushCursor.className = 'brush-cursor';
        document.body.appendChild(this._brushCursor);
        // set initial outline and update when color changes
        try { this._updateBrushCursorOutline && this._updateBrushCursorOutline(); } catch (e) {}
        if (this.colorInput) this.colorInput.addEventListener('input', ()=> { try { this._updateBrushCursorOutline && this._updateBrushCursorOutline(); } catch(e){} });
        this._onCanvasPointerMoveForCursor = (ev) => {
            const rect = this.canvas.getBoundingClientRect();
            // position at pointer
            const x = ev.clientX;
            const y = ev.clientY;
            this._brushCursor.style.left = x + 'px';
            this._brushCursor.style.top = y + 'px';
            // size in CSS pixels (size input is CSS px)
            const sizeCss = this._computeBrushSize();
            this._brushCursor.style.width = sizeCss + 'px';
            this._brushCursor.style.height = sizeCss + 'px';
            // attempt to sample canvas pixel under pointer and invert it for outline
            try {
                const DPR = window.devicePixelRatio || 1;
                const relX = Math.round((x - rect.left) * DPR);
                const relY = Math.round((y - rect.top) * DPR);
                let px = [0,0,0,0];
                if (this.frame && typeof this.frame.samplePixel === 'function') {
                    px = this.frame.samplePixel(relX, relY) || [0,0,0,0];
                }
                let [r,g,b,a] = px;
                if (!a) {
                    // transparent: treat as white so inverted outline becomes black
                    r = 0; g = 0; b = 0; a = 255;
                } else {
                    r = 255 - r; g = 255 - g; b = 255 - b;
                }
                this._brushCursor.style.border = `1px solid rgba(${r},${g},${b},0.9)`;
            } catch (e) {}
        };
        // show/hide on enter/leave
        this.canvas.addEventListener('pointerenter', ()=>{
            this._brushCursor.style.display = 'block';
        });
        this.canvas.addEventListener('pointerleave', ()=>{ this._brushCursor.style.display = 'none'; });
        this.canvas.addEventListener('pointermove', this._onCanvasPointerMoveForCursor);
        // update cursor size live when slider changes
        this.sizeInput?.addEventListener('input', () =>{
            const sizeCss = this._computeBrushSize();
            this._brushCursor.style.width = sizeCss + 'px';
            this._brushCursor.style.height = sizeCss + 'px';
        });

        // wire actions via UI
        this.ui.addAction('draw', 'down', this.handleDown.bind(this));
        this.ui.addAction('draw', 'move', this.handleMove.bind(this));
        this.ui.addAction('draw', 'up', this.handleUp.bind(this));

        // tool buttons
        if (this.pencilBtn) this.pencilBtn.addEventListener('click', ()=> this.selectTool('pencil'));
        if (this.fillBtn) this.fillBtn.addEventListener('click', ()=> this.selectTool('fill'));
        if (this.eyedropBtn) this.eyedropBtn.addEventListener('click', ()=> this.selectTool('eyedrop'));
        if (this.eraseBtn) this.eraseBtn.addEventListener('click', ()=> this.selectTool('erase'));
        this._updateToolUI();

        // eyeddrop handler placeholder (preload happens before construction)
        this._eyedropPreviewHandler = null;

        // initial commit
        syncDisplaySize(this.canvas);
        this.commitSnapshot('initial');

        this.clearBtn.addEventListener('click', this.clearAll.bind(this));
        if (this.undoBtn) this.undoBtn.addEventListener('click', this.undo.bind(this));
        if (this.redoBtn) this.redoBtn.addEventListener('click', this.redo.bind(this));

        window.addEventListener('resize', () => {
            syncDisplaySize(this.canvas);
            this.frame.resize(Math.round(window.innerWidth * DPR), Math.round(window.innerHeight * DPR));
            this.render();
        });
    }

    // render an on-screen commit history to help debug undo/redo ordering
    renderCommitHistory() {
        if (!this._showCommitHistory) return;
        const existing = document.getElementById('vc-history');
        if (existing) existing.remove();
        const container = document.createElement('div');
        container.id = 'vc-history';
        container.className = 'vc-history';
        const header = document.createElement('div'); header.className = 'vc-history-header'; header.textContent = 'Commits';
        container.appendChild(header);
        const list = document.createElement('div'); list.className = 'vc-history-list';
        const commits = this.vc.getCommits();
        commits.forEach(c => {
          const el = document.createElement('div');
          el.className = 'vc-history-item' + (this.vc.current === c.index ? ' current' : '');
          const id = (c.meta && c.meta.frameId) ? String(c.meta.frameId).slice(0,8) : String(c.index);
          el.textContent = `#${c.index} ${c.message || ''} frameIndex:${(c.meta && typeof c.meta.frameIndex === 'number') ? c.meta.frameIndex : '-'} id:${id}`;
          list.appendChild(el);
        });
                container.appendChild(list);
                // also show current frames and their ids for verification
                const framesDiv = document.createElement('div');
                framesDiv.className = 'vc-frames-list';
                framesDiv.style.padding = '6px 8px';
                framesDiv.style.borderTop = '1px solid rgba(255,255,255,0.04)';
                const fheader = document.createElement('div'); fheader.style.fontWeight = '600'; fheader.textContent = 'Frames'; framesDiv.appendChild(fheader);
                this.frames.forEach((f, i) => {
                    const fe = document.createElement('div');
                    fe.textContent = `#${i} id:${f && f._id ? String(f._id).slice(0,12) : 'none'}`;
                    framesDiv.appendChild(fe);
                });
                container.appendChild(framesDiv);
        document.body.appendChild(container);
    }

    
    loop() {
        const dt = (Date.now() - this.lastFrameTime) / 1000;
        this.lastFrameTime = Date.now();

        this.update(dt);
        this.draw();
        requestAnimationFrame(() => this.loop());
    }
    update(dt){
    }
    draw(){
        this.displayCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.displayCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.displayCtx.drawImage(this.frame.canvas, 0, 0, this.canvas.width, this.canvas.height);
        this.displayCtx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // compatibility: render alias used in several places
    render(){ this.draw(); }

    commitSnapshot(message) {
        // snapshot entire project state (all frames)
        const meta = { frameIndex: this.currentFrameIndex };
        this.vc.commitProject(this, message || 'snapshot', meta);
        this._updateHistoryUI && this._updateHistoryUI();
        // refresh frame thumbnails so latest frame state appears in sidebar
        if(this.renderFramePreviews) requestAnimationFrame(()=> this.renderFramePreviews());
        // update commit history panel for debugging
        if (this.renderCommitHistory) this.renderCommitHistory();
    }

    _computeBrushSize() {
        // Map slider value to squared size for better large-range control
        const v = Number(this.sizeInput?.value) || 4;
        // ensure at least 1px
        const size = Math.max(1, Math.round(v ** 1.2));
        return size;
    }

    _updateBrushCursorOutline() {
        // compute inverted outline color from current color input
        try {
            const hex = (this.colorInput && this.colorInput.value) ? this.colorInput.value : '#000000';
            const h = hex.replace('#','');
            const r = parseInt(h.substring(0,2),16) || 0;
            const g = parseInt(h.substring(2,4),16) || 0;
            const b = parseInt(h.substring(4,6),16) || 0;
            const ir = 255 - r;
            const ig = 255 - g;
            const ib = 255 - b;
            if (this._brushCursor) this._brushCursor.style.border = `1px solid rgba(${ir},${ig},${ib},0.9)`;
        } catch (e) {}
    }
    handleDown({ event }) {
        // tool-specific down behavior
        if (this.tool === 'fill') {
            const p = (event.positions && event.positions[0]) || [event.clientX, event.clientY];
            const DPR = window.devicePixelRatio || 1;
            const x = Math.round(p[0] * DPR);
            const y = Math.round(p[1] * DPR);
            const c = hexToRgba(this.colorInput.value, 255);
            this.frame.fill(x, y, c);
            this.commitSnapshot('fill');
            return;
        }
        if (this.tool === 'eyedrop') {
            const p = (event.positions && event.positions[0]) || [event.clientX, event.clientY];
            const DPR = window.devicePixelRatio || 1;
            const x = Math.round(p[0] * DPR);
            const y = Math.round(p[1] * DPR);
            const px = this.frame.samplePixel(x, y);
            const hex = rgbaToHex(px);
            this.colorInput.value = hex;
            return;
        }
        // event.positions is array of [x,y]
        this.drawing = true;
        this.lastPositions = (event.positions || [[event.clientX, event.clientY]]).map(p => [p[0], p[1]]);
        this._hasDrawnDuringStroke = false;
        // commit will be done after stroke
        // start hold-to-erase detection (only for pencil tool)
        try {
            if (this.tool === 'pencil' && (!event.positions || event.positions.length === 1)) {
                const first = (event.positions && event.positions[0]) || [event.clientX, event.clientY];
                this._holdStartPos = [first[0], first[1]];
                this._holdEraseTimer = setTimeout(() => {
                    // if still drawing and movement small, switch to erase
                    if (!this.drawing) return;
                    const cur = (this.lastPositions && this.lastPositions[0]) || this._holdStartPos;
                    const dx = cur[0] - this._holdStartPos[0];
                    const dy = cur[1] - this._holdStartPos[1];
                    const distSq = dx*dx + dy*dy;
                    if (distSq <= (this._holdMoveThreshold * this._holdMoveThreshold)) {
                        this._holdPrevTool = this.tool;
                        this.tool = 'erase';
                        this._holdEraseActive = true;
                        this._updateToolUI();
                    }
                }, this._holdDelayMs);
            }
        } catch (e) { this._clearHoldEraseTimer(); }
    }
    handleMove({ event }) {
        if (!this.drawing) return;
        // if hold timer pending and movement exceeds threshold, cancel it
        try {
            if (this._holdEraseTimer && this._holdStartPos) {
                const first = (event.positions && event.positions[0]) || [event.clientX, event.clientY];
                const dx = first[0] - this._holdStartPos[0];
                const dy = first[1] - this._holdStartPos[1];
                if ((dx*dx + dy*dy) > (this._holdMoveThreshold * this._holdMoveThreshold)) {
                    this._clearHoldEraseTimer();
                }
            }
        } catch (e) { this._clearHoldEraseTimer(); }
        const DPR = window.devicePixelRatio || 1;
        const positions = event.positions || [[event.clientX, event.clientY]];
        const color = this.colorInput.value || '#000';
        const widthCss = this._computeBrushSize();
        const width = widthCss * DPR; // convert to device pixels
        const n = Math.min(this.lastPositions.length, positions.length);
                for (let i = 0; i < n; i++) {
            const a = this.lastPositions[i];
            const b = positions[i];
            // convert CSS positions to device pixels
            if (this.tool === 'erase') {
                this.frame.drawLine(Math.round(a[0] * DPR), Math.round(a[1] * DPR), Math.round(b[0] * DPR), Math.round(b[1] * DPR), { width, composite: 'destination-out' });
            } else {
                this.frame.drawLine(Math.round(a[0] * DPR), Math.round(a[1] * DPR), Math.round(b[0] * DPR), Math.round(b[1] * DPR), { color, width });
            }
            this._hasDrawnDuringStroke = true;
        }
        // if more new points than last, draw a point
        for (let i = n; i < positions.length; i++) {
            const p = positions[i];
            if (this.tool === 'erase') {
                this.frame.drawLine(Math.round(p[0] * DPR), Math.round(p[1] * DPR), Math.round(p[0] * DPR), Math.round(p[1] * DPR), { width, composite: 'destination-out' });
            } else {
                this.frame.drawLine(Math.round(p[0] * DPR), Math.round(p[1] * DPR), Math.round(p[0] * DPR), Math.round(p[1] * DPR), { color, width });
            }
            this._hasDrawnDuringStroke = true;
        }
        this.lastPositions = positions.map(p => [p[0], p[1]]);
    }
    handleUp({ event }) {
        if (!this.drawing) return;
                // if no move/draw occurred during this stroke, render a single point
                const DPR = window.devicePixelRatio || 1;
                if (!this._hasDrawnDuringStroke && this.lastPositions && this.lastPositions.length) {
                    const color = this.colorInput.value || '#000';
                    const widthCss = this._computeBrushSize();
                    const width = widthCss * DPR;
                    for (const p of this.lastPositions) {
                        const x = Math.round(p[0] * DPR);
                        const y = Math.round(p[1] * DPR);
                        if (this.tool === 'erase') {
                            this.frame.drawLine(x, y, x, y, { width, composite: 'destination-out' });
                        } else {
                            this.frame.drawLine(x, y, x, y, { color, width });
                        }
                    }
                }
                this.drawing = false;
                this._hasDrawnDuringStroke = false;
                // commit after stroke
                this.commitSnapshot('after-stroke');
                // clear any hold timer and restore tool if we switched to erase
                if (this._holdEraseActive) {
                    try {
                        if (this._holdPrevTool) this.selectTool(this._holdPrevTool);
                    } catch (e) {}
                    this._holdEraseActive = false;
                    this._holdPrevTool = null;
                }
                this._clearHoldEraseTimer();
    }
    clearAll() {
        const ok = window.confirm('Are you sure you want to clear the canvas? This cannot be undone.');
        if (!ok) return;
        this.frame.clear();
        this.commitSnapshot('clear');
    }

    selectTool(t) {
        this.tool = t;
        this._updateToolUI();
        // if eyedrop selected, preview sampled color on the eyedrop icon
        if(t === 'eyedrop'){
            if(this._eyedropPreviewHandler) this.canvas.removeEventListener('pointermove', this._eyedropPreviewHandler);
            this._eyedropPreviewHandler = (ev)=>{
                const rect = this.canvas.getBoundingClientRect();
                const DPR = window.devicePixelRatio || 1;
                const x = Math.round((ev.clientX - rect.left) * DPR);
                const y = Math.round((ev.clientY - rect.top) * DPR);
                const px = this.frame.samplePixel(x, y);
                const hex = rgbaToHex(px);
                if(this.eyedropBtn) setIconMaskColor(this.eyedropBtn, hex);
            };
            this.canvas.addEventListener('pointermove', this._eyedropPreviewHandler);
        } else {
            if(this._eyedropPreviewHandler){
                this.canvas.removeEventListener('pointermove', this._eyedropPreviewHandler);
                this._eyedropPreviewHandler = null;
                if(this.eyedropBtn) setIconMaskColor(this.eyedropBtn, this.colorInput.value);
            }
        }
                // show/hide brush cursor depending on tool
                if(this._brushCursor){
                    if(t === 'pencil' || t === 'erase'){
                        this._brushCursor.style.display = 'block';
                    } else {
                        this._brushCursor.style.display = 'none';
                    }
                }
    }

    _updateToolUI() {
        const map = { pencil: this.pencilBtn, fill: this.fillBtn, eyedrop: this.eyedropBtn, erase: this.eraseBtn };
        Object.values(map).forEach(b => { if (b) b.classList.remove('active'); });
        const active = map[this.tool]; if (active) active.classList.add('active');
        // re-render icons to reflect active/grayscale state
        refreshIcons();
    }

    _clearHoldEraseTimer() {
        try {
            if (this._holdEraseTimer) { clearTimeout(this._holdEraseTimer); this._holdEraseTimer = null; }
            this._holdStartPos = null;
        } catch (e) {}
    }

    _updateHistoryUI(){
        if(this.undoBtn){
            if(this.vc.current <= 0){
                this.undoBtn.dataset.col = '0';
                this.undoBtn.dataset.row = '3';
                this.undoBtn.classList.add('disabled');
                this.undoBtn.setAttribute('aria-disabled','true');
                this.undoBtn.tabIndex = -1;
            } else {
                this.undoBtn.dataset.col = '0';
                this.undoBtn.dataset.row = '2';
                this.undoBtn.classList.remove('disabled');
                this.undoBtn.removeAttribute('aria-disabled');
                this.undoBtn.tabIndex = 0;
            }
        }
        if(this.redoBtn){
            if(this.vc.current >= this.vc.commits.length - 1){
                this.redoBtn.dataset.col = '1';
                this.redoBtn.dataset.row = '3';
                this.redoBtn.classList.add('disabled');
                this.redoBtn.setAttribute('aria-disabled','true');
                this.redoBtn.tabIndex = -1;
            } else {
                this.redoBtn.dataset.col = '1';
                this.redoBtn.dataset.row = '2';
                this.redoBtn.classList.remove('disabled');
                this.redoBtn.removeAttribute('aria-disabled');
                this.redoBtn.tabIndex = 0;
            }
        }
        refreshIcons();
    }

    // render frame thumbnails into the sidebar
    renderFramePreviews(){
        const container = document.getElementById('frames-list');
        if(!container) return;
        container.innerHTML = '';
        const thumbW = 160, thumbH = 72;
        this.frames.forEach((f, idx)=>{
            const item = document.createElement('div');
            item.className = 'frame-thumb' + (idx === this.currentFrameIndex ? ' selected' : '');
            item.dataset.index = String(idx);
            const cvs = document.createElement('canvas');
            cvs.width = thumbW; cvs.height = thumbH;
            const ctx = cvs.getContext('2d');
            try{
                // clear and draw with smoothing for a better preview
                ctx.clearRect(0,0,thumbW,thumbH);
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.fillStyle = '#fff'; ctx.fillRect(0,0,thumbW,thumbH);
                ctx.drawImage(f.canvas, 0,0, f.canvas.width, f.canvas.height, 0,0, thumbW, thumbH);
            }catch(e){}
            item.appendChild(cvs);
            item.addEventListener('click', ()=> this.selectFrame(idx));
            // double-click to open frame actions menu
            item.addEventListener('dblclick', (ev)=>{
                const target = ev.currentTarget; 
                const rect = target.getBoundingClientRect(); 
                this.showFrameContextMenu(ev, idx, rect); 
                ev.stopPropagation(); 
            });
            container.appendChild(item);
        });
        // update frame counter display if present
        const counter = document.getElementById('frame-counter');
        if(counter) counter.textContent = `${this.currentFrameIndex+1}/${this.frames.length}`;
    }

    selectFrame(idx){
        if(idx < 0 || idx >= this.frames.length) return;
        this.currentFrameIndex = idx;
        this.frame = this.frames[idx];
        this._updateToolUI();
        this.render();
        this.renderFramePreviews();
    }

    addFrame(){
        const DPR = window.devicePixelRatio || 1;
        const w = this.frame.canvas.width;
        const h = this.frame.canvas.height;
        const f = new Frame(w, h, DPR);
        // clear new frame
        f.clear();
        this.frames.push(f);
        this.selectFrame(this.frames.length - 1);
        // commit snapshot for new frame
        this.commitSnapshot('add-frame');
        // ensure sidebar updates after frame creation/DOM paint
        if(this.renderFramePreviews) requestAnimationFrame(()=> this.renderFramePreviews());
        const counter = document.getElementById('frame-counter'); if(counter) counter.textContent = `${this.currentFrameIndex+1}/${this.frames.length}`;
    }

    // Frame operations: delete, duplicate, move
    deleteFrame(idx){
        if(idx < 0 || idx >= this.frames.length) return;
        if(this.frames.length === 1){
            // clear single frame instead of removing
            this.frames[0].clear();
            this.selectFrame(0);
            return;
        }
        this.frames.splice(idx,1);
        // adjust currentFrameIndex
        if(this.currentFrameIndex >= this.frames.length) this.currentFrameIndex = this.frames.length - 1;
        this.frame = this.frames[this.currentFrameIndex];
        if(this.renderFramePreviews) requestAnimationFrame(()=> this.renderFramePreviews());
    }

    duplicateFrame(idx){
        if(idx < 0 || idx >= this.frames.length) return;
        const src = this.frames[idx];
        const DPR = src.dpr || window.devicePixelRatio || 1;
        const f = new Frame(src.canvas.width, src.canvas.height, DPR);
        // copy pixels
        f.ctx.drawImage(src.canvas, 0,0);
        // insert after source
        this.frames.splice(idx+1, 0, f);
        this.selectFrame(idx+1);
        this.commitSnapshot('duplicate-frame');
    }

    moveFrame(idx, dir){
        // dir: -1 left/up, +1 right/down
        const to = idx + dir;
        if(idx < 0 || idx >= this.frames.length) return;
        if(to < 0 || to >= this.frames.length) return;
        const [item] = this.frames.splice(idx,1);
        this.frames.splice(to,0,item);
        // update current index
        if(this.currentFrameIndex === idx) this.currentFrameIndex = to;
        else if(this.currentFrameIndex === to) this.currentFrameIndex = idx;
        this.frame = this.frames[this.currentFrameIndex];
        this.commitSnapshot('move-frame');
        if(this.renderFramePreviews) requestAnimationFrame(()=> this.renderFramePreviews());
    }

    showFrameContextMenu(ev, idx, rectParam){
        
        
        this.closeFrameContextMenu();
        const menu = document.createElement('div');
        menu.className = 'frame-context-menu';
        const btnDelete = document.createElement('button'); btnDelete.textContent = 'Delete';
        const btnDuplicate = document.createElement('button'); btnDuplicate.textContent = 'Duplicate';
        const btnMoveLeft = document.createElement('button'); btnMoveLeft.textContent = 'Move Up';
        const btnMoveRight = document.createElement('button'); btnMoveRight.textContent = 'Move Down';
        menu.appendChild(btnDelete); menu.appendChild(btnDuplicate); menu.appendChild(btnMoveLeft); menu.appendChild(btnMoveRight);
        document.body.appendChild(menu);
        const targetEl = ev.currentTarget ?? ev.target;
        // Position after next frame so layout is measured correctly
        requestAnimationFrame(() => {
            // Use passed rect when valid; otherwise compute item's top from sidebar layout
            let rect = rectParam;
            const sidebar = document.querySelector('.frames-sidebar');
            const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : null;
            if ((!rect || !rect.top) && sidebarRect) {
                // CSS constants from styles: thumb height 72, gap 6, sidebar padding-top 8
                const thumbH = 72;
                const gap = 6;
                const paddingTop = 8;
                const scrollTop = sidebar.scrollTop || 0;
                const itemTopWithinSidebar = paddingTop + idx * (thumbH + gap) - scrollTop;
                rect = {
                    top: Math.round(sidebarRect.top + itemTopWithinSidebar),
                    right: Math.round(sidebarRect.right),
                    left: Math.round(sidebarRect.left),
                    width: Math.round(sidebarRect.width),
                    height: thumbH
                };
            }
            menu.style.left = '0px'; menu.style.top = '0px';
            const mw = menu.offsetWidth || 160;
            const mh = menu.offsetHeight || 120;
            let left;
            if (sidebarRect) {
                // prefer to place menu to the left of the sidebar
                left = Math.max(8, sidebarRect.left - mw - 8);
                // if not enough space, place to the right of sidebar
                if (left + mw + 8 > window.innerWidth) left = Math.min(window.innerWidth - mw - 8, sidebarRect.right + 8);
            } else {
                left = Math.max(8, rect.right + 8);
            }
            // align top of menu with the tapped thumbnail
            let top = Math.round(rect.top);
            // If aligning the top would cause the menu's bottom to overlap the toolbar area,
            // place the menu so its bottom sits at the toolbar's top (keep menu fully visible).
            const toolbarEl = document.querySelector('.toolbar');
            if (toolbarEl) {
                const tb = toolbarEl.getBoundingClientRect();
                if (top + mh > tb.top) {
                    top = Math.round(tb.top - mh);
                }
            }
            // clamp to viewport
            top = Math.max(8, Math.min(top, window.innerHeight - mh - 8));
            menu.style.left = left + 'px';
            // set CSS variable so CSS controls Y position
            try { document.documentElement.style.setProperty('--frame-context-top', top + 'px'); } catch (e) {}
            // remove inline top so the CSS variable takes effect
            try { menu.style.removeProperty('top'); } catch (e) {}

            // wire actions
            btnDelete.addEventListener('click', ()=>{ this.deleteFrame(idx); this.commitSnapshot('delete-frame'); this.closeFrameContextMenu(); });
            btnDuplicate.addEventListener('click', ()=>{ this.duplicateFrame(idx); this.closeFrameContextMenu(); });
            btnMoveLeft.addEventListener('click', ()=>{ this.moveFrame(idx, -1); this.closeFrameContextMenu(); });
            btnMoveRight.addEventListener('click', ()=>{ this.moveFrame(idx, +1); this.closeFrameContextMenu(); });
            // close on outside click or escape
            const onDoc = (e) => { if(!menu.contains(e.target)) this.closeFrameContextMenu(); };
            const onKey = (e) => { if(e.key === 'Escape') this.closeFrameContextMenu(); };
            setTimeout(()=>{ document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey); }, 0);
            this._frameMenu = { menu, onDoc, onKey };
        });
    }

    closeFrameContextMenu(){
        if(this._frameMenu){
            const { menu, onDoc, onKey } = this._frameMenu;
            try{ document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); } catch(e){}
            menu.remove();
            // clear the CSS variable when menu is closed
            try { document.documentElement.style.removeProperty('--frame-context-top'); } catch(e){}
            this._frameMenu = null;
        }
    }

    undo() {
        const prevCommitIndex = this.vc.current;
        const idx = this.vc.undo();
        if (idx === -1) return;
        // identify the commit we just undid (the one at prevCommitIndex)
        const undoneCommit = (prevCommitIndex >= 0 && this.vc.commits && this.vc.commits[prevCommitIndex]) ? this.vc.commits[prevCommitIndex] : null;
        const undoneFrameIndex = undoneCommit && undoneCommit.meta && (typeof undoneCommit.meta.frameIndex === 'number') ? undoneCommit.meta.frameIndex : null;
        // restore full project snapshot (state after undo)
        try {
            this.vc.loadCommit(idx, this);
        } catch (e) {
            // fallback: if loading as project failed, do nothing
            return;
        }
        // If the commit we just undid belonged to a different frame, switch to that frame now
        if (undoneFrameIndex !== null && undoneFrameIndex !== this.currentFrameIndex) {
            this.selectFrame(undoneFrameIndex);
        }
        this._updateHistoryUI && this._updateHistoryUI();
        if (this.renderFramePreviews) requestAnimationFrame(() => this.renderFramePreviews());
        if (this.renderCommitHistory) this.renderCommitHistory();
    }

    redo() {
        const idx = this.vc.redo();
        if (idx === -1) return;
        try {
            this.vc.loadCommit(idx, this);
        } catch (e) {
            return;
        }
        this._updateHistoryUI && this._updateHistoryUI();
        if (this.renderFramePreviews) requestAnimationFrame(() => this.renderFramePreviews());
        if (this.renderCommitHistory) this.renderCommitHistory();
    }

}




function syncDisplaySize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(window.innerWidth, 1);
  const cssH = Math.max(window.innerHeight, 1);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}

// preload sprite first, then construct program so constructor runs after resources ready
await preload('drawingIcons.png', 4, 4).catch(e=>console.warn('icon preload failed', e));
const program = new Program();
// attempt to restore persisted version control state (undo history + frames)
const restored = await program.vc.loadFromIndexedDB(program).catch(()=>false);
if (!restored) {
    // no persisted data: create initial commit
    program.commitSnapshot('initial');
} else {
    // after restore, ensure UI reflects restored state
    program._updateHistoryUI && program._updateHistoryUI();
}
// start periodic autosave every 5s instead of saving per commit
program.vc.startAutoSave(5000);
// ensure we flush immediately on page unload
window.addEventListener('beforeunload', ()=> { try { program.vc.saveNow(); } catch (e) {} });
// initialize icons and mask colors now that sprite tiles are cached
setupIcons();
// setup undo/redo hold preview UI
import { setupHistoryPreview } from './historyPreview.js';
setupHistoryPreview(program);
if(program.fillBtn) setIconMaskColor(program.fillBtn, program.colorInput.value);
if(program.eyedropBtn) setIconMaskColor(program.eyedropBtn, program.colorInput.value);
program.colorInput.addEventListener('input', ()=>{
    if(program.fillBtn) setIconMaskColor(program.fillBtn, program.colorInput.value);
});
// wire frames sidebar
const addFrameBtn = document.getElementById('add-frame');
if(addFrameBtn) addFrameBtn.addEventListener('click', ()=> program.addFrame());
program.renderFramePreviews();
// set initial undo/redo visual state
program._updateHistoryUI && program._updateHistoryUI();
program.loop();

// initialize export/import UI (bottom-right)
setupExportImport(program);

// helpers
function hexToRgba(hex, alpha=255) {
    const h = hex.replace('#','');
    const r = parseInt(h.substring(0,2),16);
    const g = parseInt(h.substring(2,4),16);
    const b = parseInt(h.substring(4,6),16);
    return [r,g,b,alpha];
}
function rgbaToHex(arr){
    const r = arr[0].toString(16).padStart(2,'0');
    const g = arr[1].toString(16).padStart(2,'0');
    const b = arr[2].toString(16).padStart(2,'0');
    return '#'+r+g+b;
}



