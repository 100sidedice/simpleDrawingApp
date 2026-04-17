import Input from './input.js';
import UI from './ui.js';
import Frame from './frame.js';
import VersionControl from './versionControl.js';
import { preload, setupIcons, setIconMaskColor, setAllMaskColors, refreshIcons } from './icons.js';


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



