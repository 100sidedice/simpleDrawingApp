import Input from './input.js';
import UI from './ui.js';
import Frame from './frame.js';
import VersionControl from './versionControl.js';


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

        this.drawing = false;
        this.lastPositions = []; // array of [x,y]
        this.tool = 'pencil';
        this._hasDrawnDuringStroke = false;

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

    commitSnapshot(message) {
        this.vc.commit(this.frame, message || 'snapshot');
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
        this.frame.clear();
        this.commitSnapshot('clear');
    }

    selectTool(t) {
        this.tool = t;
        this._updateToolUI();
    }

    _updateToolUI() {
        const map = { pencil: this.pencilBtn, fill: this.fillBtn, eyedrop: this.eyedropBtn, erase: this.eraseBtn };
        Object.values(map).forEach(b => { if (b) b.classList.remove('active'); });
        const active = map[this.tool]; if (active) active.classList.add('active');
    }

    undo() {
        if (this.vc.current <= 0) return;
        const idx = this.vc.current - 1;
        this.vc.loadCommit(idx, this.frame);
    }

    redo() {
        if (this.vc.current >= this.vc.commits.length - 1) return;
        const idx = this.vc.current + 1;
        this.vc.loadCommit(idx, this.frame);
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

const program = new Program();
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



