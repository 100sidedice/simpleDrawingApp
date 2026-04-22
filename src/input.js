// Input class: normalizes pointer / mouse / touch and stores mouse position as an array
export default class Input {
    constructor(elem) {
        this.elem = elem;
        // positions: array of [x,y] for all active pointers (mouse or touches)
        this.positions = [];
        // internal map of active pointers: id -> [x,y]
        this.pointsMap = new Map();
        this.onDown = null;
        this.onMove = null;
        this.onUp = null;
        this._bind();
        this._preventBrowserGestures();
    }

    _bind() {
        // Prefer touch events on touch-capable devices so we get multi-touch.
        const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
        if (hasTouch) {
            // touch + mouse fallback (no PointerEvent to avoid single-pointer override)
            this.elem.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
            this.elem.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
            this.elem.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
            this.elem.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });
            this.elem.addEventListener('mousedown', (e) => this._onMouseDown(e));
            window.addEventListener('mousemove', (e) => this._onMouseMove(e));
            window.addEventListener('mouseup', (e) => this._onMouseUp(e));
        } else if (window.PointerEvent) {
            this.elem.addEventListener('pointerdown', (e) => this._onPointerDown(e));
            this.elem.addEventListener('pointermove', (e) => this._onPointerMove(e));
            this.elem.addEventListener('pointerup', (e) => this._onPointerUp(e));
            this.elem.addEventListener('pointercancel', (e) => this._onPointerUp(e));
        } else {
            // mouse-only fallback
            this.elem.addEventListener('mousedown', (e) => this._onMouseDown(e));
            window.addEventListener('mousemove', (e) => this._onMouseMove(e));
            window.addEventListener('mouseup', (e) => this._onMouseUp(e));
        }
    }

    _onPointerDown(e) {
        this.pointsMap.set(e.pointerId, [e.clientX, e.clientY]);
        this._syncPositions();
        const ev = this._buildEvent(e, e.pointerId);
        if (this.onDown) this.onDown(ev);
    }
    _onPointerMove(e) {
        if (this.pointsMap.has(e.pointerId)) this.pointsMap.set(e.pointerId, [e.clientX, e.clientY]);
        this._syncPositions();
        const ev = this._buildEvent(e, e.pointerId);
        if (this.onMove) this.onMove(ev);
    }
    _onPointerUp(e) {
        // include final position then remove
        if (this.pointsMap.has(e.pointerId)) this.pointsMap.set(e.pointerId, [e.clientX, e.clientY]);
        this._syncPositions();
        const ev = this._buildEvent(e, e.pointerId);
        if (this.onUp) this.onUp(ev);
        this.pointsMap.delete(e.pointerId);
        this._syncPositions();
    }

    _onMouseDown(e) {
        this.pointsMap.set('mouse', [e.clientX, e.clientY]);
        this._syncPositions();
        const ev = this._buildEvent(e, 'mouse');
        if (this.onDown) this.onDown(ev);
    }
    _onMouseMove(e) {
        if (this.pointsMap.has('mouse')) this.pointsMap.set('mouse', [e.clientX, e.clientY]);
        this._syncPositions();
        const ev = this._buildEvent(e, 'mouse');
        if (this.onMove) this.onMove(ev);
    }
    _onMouseUp(e) {
        if (this.pointsMap.has('mouse')) this.pointsMap.set('mouse', [e.clientX, e.clientY]);
        this._syncPositions();
        const ev = this._buildEvent(e, 'mouse');
        if (this.onUp) this.onUp(ev);
        this.pointsMap.delete('mouse');
        this._syncPositions();
    }

    _onTouchStart(e) {
        // prevent native gestures (scrolling / browser gestures) while interacting
        if (e.cancelable) e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
            this.pointsMap.set(t.identifier, [t.clientX, t.clientY]);
        }
        this._syncPositions();
        // pass event with aggregated positions; include primary
        const firstId = e.changedTouches[0] && e.changedTouches[0].identifier;
        const ev = this._buildEvent(e, firstId);
        if (this.onDown) this.onDown(ev);
    }
    _onTouchMove(e) {
        if (e.cancelable) e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
            this.pointsMap.set(t.identifier, [t.clientX, t.clientY]);
        }
        this._syncPositions();
        const firstId = e.changedTouches[0] && e.changedTouches[0].identifier;
        const ev = this._buildEvent(e, firstId);
        if (this.onMove) this.onMove(ev);
    }
    _onTouchEnd(e) {
        if (e.cancelable) e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
            // update final position then delete
            this.pointsMap.set(t.identifier, [t.clientX, t.clientY]);
        }
        this._syncPositions();
        const firstId = e.changedTouches[0] && e.changedTouches[0].identifier;
        const ev = this._buildEvent(e, firstId);
        if (this.onUp) this.onUp(ev);
        for (const t of Array.from(e.changedTouches)) this.pointsMap.delete(t.identifier);
        this._syncPositions();
    }

    _syncPositions() {
        this.positions = Array.from(this.pointsMap.values());
    }

    _buildEvent(originalEvent, id) {
        const positions = Array.from(this.pointsMap.values());
        const first = positions[0] || [0, 0];
        return { originalEvent, positions, clientX: first[0], clientY: first[1], pointerId: id };
    }

    _preventBrowserGestures() {
        // Prevent two-finger context menu on trackpads within the element
        document.addEventListener('contextmenu', (e) => {
            if (this.elem.contains(e.target)) e.preventDefault();
        });

        // Prevent horizontal wheel swipes (commonly generated by trackpad three-finger swipes)
        const wheelHandler = (e) => {
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 10) e.preventDefault();
        };
        window.addEventListener('wheel', wheelHandler, { passive: false });

        // Prevent 3+ finger touch gestures from triggering navigation/other defaults
        const touchStart = (e) => { if (e.touches && e.touches.length >= 3 && e.cancelable) e.preventDefault(); };
        const touchMove = (e) => { if (e.touches && e.touches.length >= 3 && e.cancelable) e.preventDefault(); };
        this.elem.addEventListener('touchstart', touchStart, { passive: false });
        this.elem.addEventListener('touchmove', touchMove, { passive: false });

        // Safari gesture events (best-effort): try to prevent them inside the element
        try {
            window.addEventListener('gesturestart', (e) => { if (this.elem.contains(e.target) && e.cancelable) e.preventDefault(); }, { passive: false });
        } catch (err) {}
    }
}
