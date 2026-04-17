import Input from './input.js';
import UI from './ui.js';
import Frame from './frame.js';
import VersionControl from './versionControl.js';
import { preload, setupIcons, setIconMaskColor, setAllMaskColors, refreshIcons } from './icons.js';
import FramesUI from './framesUI.js';


class Program {
    constructor() {
        this.canvas = document.getElementById('draw');
        this.displayCtx = this.canvas.getContext('2d');
        this.colorInput = document.getElementById('color');
        this.colorTrigger = document.getElementById('color-trigger');
        this.colorPreview = document.getElementById('color-preview');
        this.colorPickerEl = document.getElementById('color-picker');
        this.colorWheel = document.getElementById('color-wheel');
        this.colorValue = document.getElementById('color-value');
        this.colorAlpha = document.getElementById('color-alpha');
        this.colorOk = document.getElementById('color-ok');
        this.colorCancel = document.getElementById('color-cancel');
        this.overlay = document.getElementById('modal-overlay');

        this._suppressNextPointerDown = false;
        this._pickerHSV = { h: 0, s: 100, v: 100, a: 100 };
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

        // frames list (animation frames)
        this.frames = [];
        this.currentFrameIndex = 0;
        // include the initial frame
        this.frames.push(this.frame);

        this.drawing = false;
        this.lastPositions = []; // array of [x,y]
        this.tool = 'pencil';
        this._hasDrawnDuringStroke = false;

        // brush cursor overlay
        this._brushCursor = document.createElement('div');
        this._brushCursor.className = 'brush-cursor';
        document.body.appendChild(this._brushCursor);
        this._onCanvasPointerMoveForCursor = (ev) => {
            const rect = this.canvas.getBoundingClientRect();
            // position at pointer
            const x = ev.clientX;
            const y = ev.clientY;
            this._brushCursor.style.left = x + 'px';
            this._brushCursor.style.top = y + 'px';
            // size in CSS pixels (size input is CSS px)
            const sizeCss = Number(this.sizeInput?.value) || 4;
            this._brushCursor.style.width = sizeCss + 'px';
            this._brushCursor.style.height = sizeCss + 'px';
        };
        // show/hide on enter/leave
        this.canvas.addEventListener('pointerenter', ()=>{
            if(this.tool === 'pencil' || this.tool === 'erase') this._brushCursor.style.display = 'block';
        });
        this.canvas.addEventListener('pointerleave', ()=>{ this._brushCursor.style.display = 'none'; });
        this.canvas.addEventListener('pointermove', this._onCanvasPointerMoveForCursor);
        // update cursor size live when slider changes
        this.sizeInput?.addEventListener('input', ()=>{
            const sizeCss = Number(this.sizeInput.value) || 4;
            this._brushCursor.style.width = sizeCss + 'px';
            this._brushCursor.style.height = sizeCss + 'px';
        });

        // color trigger opens custom picker
        if (this.colorTrigger) {
            this.colorTrigger.addEventListener('click', (e)=>{
                e.stopPropagation();
                this.openColorPicker();
            });
        }

        // wire color input fallback to update icon masks
        this.colorInput?.addEventListener('input', ()=>{
            if(this.fillBtn) setIconMaskColor(this.fillBtn, this.colorInput.value);
            if(this.eyedropBtn) setIconMaskColor(this.eyedropBtn, this.colorInput.value);
            if(this.colorPreview) this.colorPreview.style.background = this.colorInput.value;
        });

        // ensure preview matches the actual input value on startup
        if(this.colorInput && this.colorPreview){
            try{ this.colorPreview.style.background = this.colorInput.value; }catch(e){}
        }

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

        // autosave setup: save project to localStorage every 5s and on unload
        this._autosaveKey = 'simpleDrawingApp.autosave.v1';
        this._autosaveInterval = 5000;
        this._autosaveTimer = setInterval(()=> this._autosave(), this._autosaveInterval);
        window.addEventListener('beforeunload', ()=> this._autosave());
        // attempt to load saved project (async) after initialization
        this._loadAutosave();

        // clear handled via CSS menu (clear-menu)
        if (this.undoBtn) this.undoBtn.addEventListener('click', this.undo.bind(this));
        if (this.redoBtn) this.redoBtn.addEventListener('click', this.redo.bind(this));

        // export / import controls (separate panel)
        this.exportBtn = document.getElementById('export');
        this.exportMenu = document.getElementById('export-menu');
        this.importBtn = document.getElementById('import');
        this.importMenu = document.getElementById('import-menu');
        this.importInput = document.getElementById('import-input');
        this.clearMenu = document.getElementById('clear-menu');
        this.clearYes = document.getElementById('clear-yes');
        this.clearCancel = document.getElementById('clear-cancel');
        if (this.exportBtn) this.exportBtn.addEventListener('click', (e)=>{ if(this.exportMenu) this.exportMenu.hidden = !this.exportMenu.hidden; });
        if (this.exportMenu) this.exportMenu.addEventListener('click', (e)=>{
            const t = e.target && e.target.dataset && e.target.dataset.type;
            if(!t) return;
            // show filename prompt then perform export using entered name
            this._pendingExportType = t;
            this._showFilenamePrompt((name)=>{
                if(!name) name = 'drawing';
                if (t === 'pdf') {
                    this._lastExportFilename = name.toLowerCase().endsWith('.pdf') ? name : (name + '.pdf');
                    this.exportPDF();
                } else {
                    // store base name (no extension) and let exportImage append ext
                    this._lastExportFilename = name.replace(/\.(png|jpe?g|pdf)$/i,'');
                    this.exportImage(t);
                }
            });
            this.exportMenu.hidden = true;
        });
        if (this.importBtn) this.importBtn.addEventListener('click', (e)=>{ if(this.importMenu) this.importMenu.hidden = !this.importMenu.hidden; });
        if (this.importMenu) this.importMenu.addEventListener('click', (e)=>{
            const t = e.target && e.target.dataset && e.target.dataset.type;
            if(!t) return;
            // set accept on file input and trigger
            if(this.importInput){
                if(t === 'pdf') this.importInput.accept = 'application/pdf';
                else this.importInput.accept = 'image/png,image/jpeg';
                this.importInput.value = null;
                this.importInput.click();
            }
            this.importMenu.hidden = true;
        });
        if (this.importInput) this.importInput.addEventListener('change', (e)=> this.handleImportFiles(e.target.files));
        if (this.clearBtn) this.clearBtn.addEventListener('click', (e)=>{ if(this.clearMenu) this.clearMenu.hidden = !this.clearMenu.hidden; });
        if (this.clearYes) this.clearYes.addEventListener('click', ()=>{ this.frame.clear(); this.commitSnapshot('clear'); if(this.clearMenu) this.clearMenu.hidden = true; });
        if (this.clearCancel) this.clearCancel.addEventListener('click', ()=>{ if(this.clearMenu) this.clearMenu.hidden = true; });
        // close menus on outside click
        document.addEventListener('click', (e)=>{
            const path = e.composedPath && e.composedPath();
            if(this.exportMenu && !this.exportMenu.hidden && !path.includes(this.exportBtn) && !path.includes(this.exportMenu)) this.exportMenu.hidden = true;
            if(this.importMenu && !this.importMenu.hidden && !path.includes(this.importBtn) && !path.includes(this.importMenu)) this.importMenu.hidden = true;
            if(this.clearMenu && !this.clearMenu.hidden && !path.includes(this.clearBtn) && !path.includes(this.clearMenu)) this.clearMenu.hidden = true;
        });

        window.addEventListener('resize', () => {
            syncDisplaySize(this.canvas);
            this.frame.resize(Math.round(window.innerWidth * DPR), Math.round(window.innerHeight * DPR));
            this.render();
        });
    }

    // render an on-screen commit history to help debug undo/redo ordering
    renderCommitHistory() {
        // Only show commit history when ?debug=true is present in the URL
        try {
            const params = new URLSearchParams(window.location.search);
            if (params.get('debug') !== 'true') {
                const existing = document.getElementById('vc-history');
                if (existing) existing.remove();
                return;
            }
        } catch (e) {}

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
        // also persist immediately after a commit
        try{ this._autosave(); }catch(e){}
    }
    handleDown({ event }) {
        // ignore the first pointerdown after closing modal controls
        if (this._suppressNextPointerDown) { this._suppressNextPointerDown = false; return; }
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
    }
    handleMove({ event }) {
        if (!this.drawing) return;
        const DPR = window.devicePixelRatio || 1;
        const positions = event.positions || [[event.clientX, event.clientY]];
        const color = this.colorInput.value || '#000';
        const widthCss = Number(this.sizeInput.value) || 4;
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
            const widthCss = Number(this.sizeInput.value) || 4;
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
    }
    clearAll() {
        // legacy API: directly clear and commit (confirmation handled by clear-menu)
        this.frame.clear();
        this.commitSnapshot('clear');
    }

    exportImage(kind='png'){
        const mime = kind === 'jpeg' ? 'image/jpeg' : 'image/png';
        const ext = kind === 'jpeg' ? 'jpg' : 'png';
        const filename = (this._lastExportFilename || 'drawing') + '.' + ext;
        const dataUrl = this.frame.canvas.toDataURL(mime, 0.92);
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    async exportPDF(){
        try{
            const J = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jspdf && window.jspdf.default && window.jspdf.default.jsPDF) ? window.jspdf.default.jsPDF : null;
            if (!J) throw new Error('jsPDF not available');
            if (!this.frames || !this.frames.length) this.frames = [this.frame];
            let pdf = null;
            for (let i = 0; i < this.frames.length; i++) {
                const f = this.frames[i];
                const DPR = f.dpr || window.devicePixelRatio || 1;
                const deviceW = f.canvas.width;
                const deviceH = f.canvas.height;
                const cssW = Math.round(deviceW / DPR);
                const cssH = Math.round(deviceH / DPR);
                const img = f.canvas.toDataURL('image/png');
                const orientation = cssW >= cssH ? 'landscape' : 'portrait';
                if (i === 0) {
                    pdf = new J({ unit: 'px', format: [cssW, cssH], orientation });
                    pdf.addImage(img, 'PNG', 0, 0, cssW, cssH);
                } else {
                    // add a new page sized to the same CSS pixels with explicit orientation
                    try {
                        pdf.addPage([cssW, cssH], orientation);
                    } catch (e) {
                        // fallback: try addPage with only format
                        pdf.addPage([cssW, cssH]);
                    }
                    pdf.addImage(img, 'PNG', 0, 0, cssW, cssH);
                }
            }
            if (pdf) pdf.save(this._lastExportFilename || 'drawing.pdf');
        } catch (err) {
            console.error('PDF export failed', err);
            alert('PDF export failed: ' + (err && err.message ? err.message : String(err)));
        }
    }

    // show the filename prompt and call `onConfirm(name)` with the entered filename
    _showFilenamePrompt(onConfirm){
        const el = document.getElementById('filename-prompt');
        const overlay = document.getElementById('modal-overlay');
        const input = document.getElementById('filename-input');
        const ok = document.getElementById('filename-ok');
        const cancel = document.getElementById('filename-cancel');
        if(!el || !input || !ok || !cancel) { onConfirm('drawing'); return; }
        if (overlay) overlay.hidden = false;
        el.hidden = false;
        input.value = 'drawing';
        input.focus();
        const onKey = function onKey(e){ if(e.key === 'Enter'){ ok.click(); } };
        const cleanup = () => { el.hidden = true; ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); input.removeEventListener('keydown', onKey); if (overlay) overlay.hidden = true; };
        const onOk = () => {
            let v = (input.value || '').trim();
            if(!v) v = 'drawing';
            cleanup();
            if (overlay) overlay.hidden = true;
            onConfirm(v);
        };
        const onCancel = () => { cleanup(); };
        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
        // enter key submits
        input.addEventListener('keydown', onKey);
    }

    // show import choice prompt; returns a Promise resolving to 'append'|'overwrite'|'cancel'
    _showImportChoice(){
        return new Promise((resolve)=>{
            const el = document.getElementById('import-choice');
            const overlay = document.getElementById('modal-overlay');
            const append = document.getElementById('import-append');
            const overwrite = document.getElementById('import-overwrite');
            const cancel = document.getElementById('import-cancel');
            if(!el || !append || !overwrite || !cancel) { resolve('append'); return; }
            if (overlay) overlay.hidden = false;
            el.hidden = false;
            const cleanup = ()=>{ el.hidden = true; if (overlay) overlay.hidden = true; append.removeEventListener('click', onAppend); overwrite.removeEventListener('click', onOverwrite); cancel.removeEventListener('click', onCancel); };
            const onAppend = ()=>{ cleanup(); resolve('append'); };
            const onOverwrite = ()=>{ cleanup(); resolve('overwrite'); };
            const onCancel = ()=>{ cleanup(); resolve('cancel'); };
            append.addEventListener('click', onAppend);
            overwrite.addEventListener('click', onOverwrite);
            cancel.addEventListener('click', onCancel);
        });
    }

    // Color picker open/close and preview handling
    openColorPicker(){
        if(!this.colorPickerEl) return;
        this.colorPickerEl.hidden = false;
        // attach outside-click listener to close picker
        this._pickerDocDown = (e)=>{
            const p = e.composedPath ? e.composedPath() : (e.path || []);
            if(!this.colorPickerEl.contains(e.target) && e.target !== this.colorTrigger && !p.includes(this.colorPickerEl)){
                this.closeColorPicker();
            }
        };
        // use capture so this runs before canvas handlers and we can suppress the upcoming pointerdown
        document.addEventListener('pointerdown', this._pickerDocDown, true);
        // draggable support when dragging on picker background (not on controls)
        this._pickerPointerDown = (e)=>{
            if(e.target.closest && (e.target.closest('.color-sliders') || e.target.closest('.color-wheel') || e.target.closest('input') || e.target.closest('button'))) return;
            const rect = this.colorPickerEl.getBoundingClientRect();
            // switch to pixel positioning and remove centering transform
            this.colorPickerEl.style.left = rect.left + 'px';
            this.colorPickerEl.style.top = rect.top + 'px';
            this.colorPickerEl.style.transform = 'none';
            this._pickerDragOffsetX = e.clientX - rect.left;
            this._pickerDragOffsetY = e.clientY - rect.top;
            this._pickerDragging = true;
            this.colorPickerEl.setPointerCapture && this.colorPickerEl.setPointerCapture(e.pointerId);
        };
        this._pickerPointerMove = (e)=>{
            if(!this._pickerDragging) return;
            let nx = e.clientX - this._pickerDragOffsetX;
            let ny = e.clientY - this._pickerDragOffsetY;
            // clamp inside viewport
            nx = Math.max(8, Math.min(window.innerWidth - this.colorPickerEl.offsetWidth - 8, nx));
            ny = Math.max(8, Math.min(window.innerHeight - this.colorPickerEl.offsetHeight - 8, ny));
            this.colorPickerEl.style.left = nx + 'px';
            this.colorPickerEl.style.top = ny + 'px';
        };
        this._pickerPointerUp = (e)=>{
            if(this._pickerDragging){
                this._pickerDragging = false;
                try{ this.colorPickerEl.releasePointerCapture && this.colorPickerEl.releasePointerCapture(e.pointerId); }catch(err){}
            }
        };
        this.colorPickerEl.addEventListener('pointerdown', this._pickerPointerDown);
        document.addEventListener('pointermove', this._pickerPointerMove);
        document.addEventListener('pointerup', this._pickerPointerUp);
        try{
            const rgba = hexToRgba(this.colorInput.value || '#000000', 255);
            const hsv = rgbToHsv(rgba[0], rgba[1], rgba[2]);
            this._pickerHSV.h = Math.round(hsv.h);
            this._pickerHSV.s = Math.round(hsv.s * 100);
            this._pickerHSV.v = Math.round(hsv.v * 100);
            this._pickerHSV.a = Math.round(((rgba[3] ?? 255) / 255) * 100);
        }catch(e){}
        if(this.colorValue) this.colorValue.value = this._pickerHSV.v;
        if(this.colorAlpha) this.colorAlpha.value = this._pickerHSV.a;
        this.updateColorPickerPreview();

        // bind wheel interactions once
        if(this.colorWheel && !this._colorWheelBound){
            let dragging = false;
            const onDown = (ev)=>{ ev.preventDefault(); dragging = true; this.colorWheel.setPointerCapture && this.colorWheel.setPointerCapture(ev.pointerId); handlePointer(ev); };
            const onMove = (ev)=>{ if(!dragging) return; handlePointer(ev); };
            const onUp = (ev)=>{ dragging = false; try{ this.colorWheel.releasePointerCapture && this.colorWheel.releasePointerCapture(ev.pointerId); }catch(e){} };
            const handlePointer = (ev)=>{
                const rect = this.colorWheel.getBoundingClientRect();
                const cx = rect.left + rect.width/2;
                const cy = rect.top + rect.height/2;
                const dx = ev.clientX - cx;
                const dy = ev.clientY - cy;
                const r = Math.sqrt(dx*dx + dy*dy);
                const radius = rect.width/2;
                const sat = Math.min(1, r / radius);
                let angle = Math.atan2(dy, dx) * 180 / Math.PI; // -180..180
                if(angle < 0) angle += 360;
                this._pickerHSV.h = Math.round(angle);
                this._pickerHSV.s = Math.round(sat * 100);
                this.updateColorPickerPreview();
            };
            this.colorWheel.addEventListener('pointerdown', onDown);
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            this._colorWheelBound = true;
        }

        if(this.colorValue && !this._colorValueBound){
            this.colorValue.addEventListener('input', ()=>{ this._pickerHSV.v = Number(this.colorValue.value); this.updateColorPickerPreview(); });
            this._colorValueBound = true;
        }
        if(this.colorAlpha && !this._colorAlphaBound){
            this.colorAlpha.addEventListener('input', ()=>{ this._pickerHSV.a = Number(this.colorAlpha.value); this.updateColorPickerPreview(); });
            this._colorAlphaBound = true;
        }

        if(this.colorOk && !this._colorOkBound){
            this.colorOk.addEventListener('click', ()=>{ this.applyPickerColor(); this.closeColorPicker(); });
            this._colorOkBound = true;
        }
        if(this.colorCancel && !this._colorCancelBound){
            this.colorCancel.addEventListener('click', ()=>{ this.closeColorPicker(); });
            this._colorCancelBound = true;
        }
        // do not use the dark modal overlay for the color picker; it is lightweight
    }

    updateColorPickerPreview(){
        const h = this._pickerHSV.h;
        const s = (this._pickerHSV.s ?? 100) / 100;
        const v = (this._pickerHSV.v ?? 100) / 100;
        const a = (this._pickerHSV.a ?? 100) / 100;
        const [r,g,b] = hsvToRgb(h, s, v);
        const hex = rgbaToHex([r,g,b,255]);
        if(this.colorPreview) this.colorPreview.style.background = `rgba(${r},${g},${b},${a})`;
        if(this.colorInput) this.colorInput.value = hex;
        if(this.fillBtn) setIconMaskColor(this.fillBtn, this.colorInput.value);
        if(this.eyedropBtn) setIconMaskColor(this.eyedropBtn, this.colorInput.value);

        // update wheel appearance based on value/alpha
        if(this.colorWheel){
            this.colorWheel.style.filter = `brightness(${Math.max(0.02, v)})`;
            this.colorWheel.style.opacity = String(a);
        }

        // position marker inside wheel according to hue and saturation
        const marker = document.getElementById('picker-marker');
        if(marker && this.colorWheel){
            const rect = this.colorWheel.getBoundingClientRect();
            const radius = rect.width/2;
            // angle in radians: hue corresponds to angle where 0 is top (we used conic from -90deg)
            const angleRad = h * Math.PI / 180; // marker angle aligns directly with hue
            const sat = s;
            const cx = rect.width/2;
            const cy = rect.height/2;
            const px = cx + Math.cos(angleRad) * sat * radius;
            const py = cy + Math.sin(angleRad) * sat * radius;
            marker.style.left = px + 'px';
            marker.style.top = py + 'px';
            // set marker inner color for visibility
            marker.style.background = `rgba(${r},${g},${b},${a})`;
        }

        // update slider gradients: value (black -> color at full value), alpha (transparent->color)
        const [rFull,gFull,bFull] = hsvToRgb(h, (this._pickerHSV.s ?? 100)/100, 1);
        if(this.colorValue){
            this.colorValue.style.background = `linear-gradient(to right, rgb(0,0,0), rgb(${rFull},${gFull},${bFull}))`;
        }
        if(this.colorAlpha){
            this.colorAlpha.style.background = `linear-gradient(to right, rgba(${rFull},${gFull},${bFull},0), rgba(${rFull},${gFull},${bFull},1))`;
        }
    }

    applyPickerColor(){
        // colorInput was already updated; further actions (if any) can be done here
    }

    closeColorPicker(){
        if(this.colorPickerEl) this.colorPickerEl.hidden = true;
        // remove document and picker listeners added when opening
        if(this._pickerDocDown){ document.removeEventListener('pointerdown', this._pickerDocDown, true); this._pickerDocDown = null; }
        if(this._pickerPointerDown){ this.colorPickerEl.removeEventListener('pointerdown', this._pickerPointerDown); this._pickerPointerDown = null; }
        if(this._pickerPointerMove){ document.removeEventListener('pointermove', this._pickerPointerMove); this._pickerPointerMove = null; }
        if(this._pickerPointerUp){ document.removeEventListener('pointerup', this._pickerPointerUp); this._pickerPointerUp = null; }
        this._pickerDragging = false;
        this._suppressNextPointerDown = true;
        setTimeout(()=>{ this._suppressNextPointerDown = false; }, 600);
    }

    // Autosave: store project frames in localStorage as data URLs
    _autosave(){
        try{
            if(!this.frames || !this.frames.length) return;
            const payload = { version: 1, currentFrameIndex: this.currentFrameIndex, frames: [] };
            for(const f of this.frames){
                try{
                    const url = f.canvas.toDataURL('image/png');
                    payload.frames.push(url);
                }catch(e){
                    payload.frames.push(null);
                }
            }
            localStorage.setItem(this._autosaveKey, JSON.stringify(payload));
        }catch(err){ console.warn('autosave failed', err); }
    }

    async _loadAutosave(){
        try{
            const raw = localStorage.getItem(this._autosaveKey);
            if(!raw) return;
            const obj = JSON.parse(raw);
            if(!obj || !Array.isArray(obj.frames) || obj.frames.length === 0) return;
            const DPR = this.frame.dpr || window.devicePixelRatio || 1;
            const deviceW = this.frame.canvas.width;
            const deviceH = this.frame.canvas.height;
            const loaded = [];
            for(const dataUrl of obj.frames){
                const f = new Frame(deviceW, deviceH, DPR);
                f.clear();
                if(dataUrl){
                    await new Promise((resolve)=>{
                        const img = new Image();
                        img.onload = ()=>{ try{ f.ctx.drawImage(img, 0, 0, f.canvas.width, f.canvas.height); }catch(e){}; resolve(); };
                        img.onerror = ()=> resolve();
                        img.src = dataUrl;
                    });
                }
                loaded.push(f);
            }
            if(loaded.length){
                this.frames = loaded;
                this.currentFrameIndex = Math.min(Math.max(0, Number(obj.currentFrameIndex || 0)), this.frames.length - 1);
                this.frame = this.frames[this.currentFrameIndex];
                this.selectFrame(this.currentFrameIndex);
                this.commitSnapshot('autosave-load');
            }
        }catch(err){ console.warn('load autosave failed', err); }
    }

    async handleImportFiles(files){
        if (!files || !files.length) return;
        const f = files[0];
        const type = f.type || '';
        if (type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')){
            let url = null;
            try{
                const pdfjs = window['pdfjsLib'] || window['pdfjs-dist/build/pdf'] || window['pdfjs-dist'] || window['pdfjs'];
                if (!pdfjs) { alert('PDF import requires PDF.js (missing)'); return; }
                // Some PDF.js bundles expose a read-only GlobalWorkerOptions; avoid writing to it.
                // Instead, disable workers when loading from a blob URL for compatibility.
                url = URL.createObjectURL(f);
                const loadingTask = pdfjs.getDocument({ url, disableWorker: true });
                const pdf = await loadingTask.promise;
                const numPages = pdf.numPages || 1;
                const DPR = this.frame.dpr || window.devicePixelRatio || 1;
                const deviceW = this.frame.canvas.width;
                const deviceH = this.frame.canvas.height;
                const inserted = [];
                for (let p = 1; p <= numPages; p++){
                    const page = await pdf.getPage(p);
                    const viewport = page.getViewport({ scale: 1 });
                    const scale = Math.min(deviceW / viewport.width, deviceH / viewport.height);
                    const vp = page.getViewport({ scale });
                    const tmp = document.createElement('canvas');
                    tmp.width = Math.round(vp.width);
                    tmp.height = Math.round(vp.height);
                    const ctx = tmp.getContext('2d');
                    const renderTask = page.render({ canvasContext: ctx, viewport: vp });
                    if (renderTask && renderTask.promise) await renderTask.promise; else await renderTask;
                    // create a new Frame sized to device pixels of the current frame and draw scaled
                    const f = new Frame(deviceW, deviceH, DPR);
                    f.clear();
                    f.ctx.drawImage(tmp, 0, 0, f.canvas.width, f.canvas.height);
                    inserted.push(f);
                }
                // If there's only one existing frame, replace it with imported pages
                if (this.frames.length === 1) {
                    this.frames = inserted;
                    this.currentFrameIndex = 0;
                    this.frame = this.frames[0];
                    this.selectFrame(0);
                    this.commitSnapshot('import-pdf');
                } else {
                    // If multiple frames exist, ask user whether to append or overwrite
                    const choice = await this._showImportChoice();
                    if (choice === 'append') {
                        // append imported frames to end of project
                        const oldLen = this.frames.length;
                        this.frames.push(...inserted);
                        // select first of the newly appended frames
                        this.selectFrame(oldLen);
                        this.commitSnapshot('import-pdf');
                    } else if (choice === 'overwrite') {
                        // replace entire project with imported frames
                        this.frames = inserted;
                        this.currentFrameIndex = 0;
                        this.frame = this.frames[0];
                        this.selectFrame(0);
                        this.commitSnapshot('import-pdf');
                    } else {
                        // cancelled; do nothing
                    }
                }
            }catch(err){
                console.error('PDF import failed', err);
                alert('PDF import failed: '+(err && err.message?err.message:String(err)));
            } finally {
                if (url) URL.revokeObjectURL(url);
            }
            return;
        }
        if (type.startsWith('image/') || f.name.match(/\.(png|jpe?g)$/i)){
            const url = URL.createObjectURL(f);
            const img = new Image();
            img.onload = ()=>{
                this.frame.clear();
                this.frame.ctx.drawImage(img, 0, 0, this.frame.canvas.width, this.frame.canvas.height);
                URL.revokeObjectURL(url);
                this.commitSnapshot('import-image');
            };
            img.onerror = (e)=>{ URL.revokeObjectURL(url); alert('Image load failed'); };
            img.src = url;
            return;
        }
        alert('Unsupported file type');
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
                    this._brushCursor.style.display = 'block';
                }
    }

    _updateToolUI() {
        const map = { pencil: this.pencilBtn, fill: this.fillBtn, eyedrop: this.eyedropBtn, erase: this.eraseBtn };
        Object.values(map).forEach(b => { if (b) b.classList.remove('active'); });
        const active = map[this.tool]; if (active) active.classList.add('active');
        // re-render icons to reflect active/grayscale state
        refreshIcons();
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
            container.appendChild(item);
        });
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
    }

    undo() {
        const idx = this.vc.undo();
        if (idx === -1) return;
        // restore full project snapshot
        try {
            this.vc.loadCommit(idx, this);
        } catch (e) {
            // fallback: if loading as project failed, do nothing
            return;
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
// attach modular frames UI
const framesUI = new FramesUI(program);
program.renderFramePreviews = framesUI.render.bind(framesUI);
// initialize icons and mask colors now that sprite tiles are cached
setupIcons();
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

// HSV <-> RGB helpers
function hsvToRgb(h, s, v){
    // h: 0-360, s: 0-1, v:0-1
    const c = v * s;
    const hh = (h / 60) % 6;
    const x = c * (1 - Math.abs(hh % 2 - 1));
    let r1=0,g1=0,b1=0;
    if(hh >= 0 && hh < 1){ r1=c; g1=x; b1=0; }
    else if(hh >=1 && hh < 2){ r1=x; g1=c; b1=0; }
    else if(hh >=2 && hh < 3){ r1=0; g1=c; b1=x; }
    else if(hh >=3 && hh < 4){ r1=0; g1=x; b1=c; }
    else if(hh >=4 && hh < 5){ r1=x; g1=0; b1=c; }
    else { r1=c; g1=0; b1=x; }
    const m = v - c;
    const r = Math.round((r1 + m) * 255);
    const g = Math.round((g1 + m) * 255);
    const b = Math.round((b1 + m) * 255);
    return [r,g,b];
}
function rgbToHsv(r,g,b){
    r/=255; g/=255; b/=255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    const d = max - min;
    let h = 0;
    if(d === 0) h = 0;
    else if(max === r) h = ((g - b) / d) % 6;
    else if(max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if(h < 0) h += 360;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return { h, s, v };
}



