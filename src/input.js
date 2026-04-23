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
        // internal queue to decouple event reception from interpretation
        this._queue = [];
        this._processingScheduled = false;
        // fast async scheduler using MessageChannel
        try {
            const mc = new MessageChannel();
            mc.port1.onmessage = () => this._processQueue();
            this._postMessagePort = mc.port2;
        } catch (e) {
            this._postMessagePort = null;
        }

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
        // queue a lightweight raw down event and schedule processing
        const ts = Date.now();
        this._queue.push({ type: 'down', id: e.pointerId, x: e.clientX, y: e.clientY, pressure: e.pressure || 0.5, t: ts, originalEvent: e });
        this._ensureProcessing();
    }
    _onPointerMove(e) {
        // capture coalesced points when available for higher-fidelity paths
        const ts = Date.now();
        if (typeof e.getCoalescedEvents === 'function') {
            const list = e.getCoalescedEvents();
            for (const c of list) this._queue.push({ type: 'move', id: e.pointerId, x: c.clientX, y: c.clientY, pressure: c.pressure || e.pressure || 0.5, t: ts, originalEvent: e });
        } else {
            this._queue.push({ type: 'move', id: e.pointerId, x: e.clientX, y: e.clientY, pressure: e.pressure || 0.5, t: ts, originalEvent: e });
        }
        this._ensureProcessing();
    }
    _onPointerUp(e) {
        const ts = Date.now();
        this._queue.push({ type: 'up', id: e.pointerId, x: e.clientX, y: e.clientY, pressure: e.pressure || 0.5, t: ts, originalEvent: e });
        this._ensureProcessing();
    }

    _onMouseDown(e) {
        this._queue.push({ type: 'down', id: 'mouse', x: e.clientX, y: e.clientY, pressure: 0.5, t: Date.now(), originalEvent: e });
        this._ensureProcessing();
    }
    _onMouseMove(e) {
        this._queue.push({ type: 'move', id: 'mouse', x: e.clientX, y: e.clientY, pressure: 0.5, t: Date.now(), originalEvent: e });
        this._ensureProcessing();
    }
    _onMouseUp(e) {
        this._queue.push({ type: 'up', id: 'mouse', x: e.clientX, y: e.clientY, pressure: 0.5, t: Date.now(), originalEvent: e });
        this._ensureProcessing();
    }

    _onTouchStart(e) {
        // prevent native gestures (scrolling / browser gestures) while interacting
        if (e.cancelable) e.preventDefault();
        const ts = Date.now();
        for (const t of Array.from(e.changedTouches)) {
            this._queue.push({ type: 'down', id: t.identifier, x: t.clientX, y: t.clientY, pressure: t.force || 0.5, t: ts, originalEvent: e });
        }
        this._ensureProcessing();
    }
    _onTouchMove(e) {
        if (e.cancelable) e.preventDefault();
        const ts = Date.now();
        for (const t of Array.from(e.changedTouches)) {
            this._queue.push({ type: 'move', id: t.identifier, x: t.clientX, y: t.clientY, pressure: t.force || 0.5, t: ts, originalEvent: e });
        }
        this._ensureProcessing();
    }
    _onTouchEnd(e) {
        if (e.cancelable) e.preventDefault();
        const ts = Date.now();
        for (const t of Array.from(e.changedTouches)) {
            this._queue.push({ type: 'up', id: t.identifier, x: t.clientX, y: t.clientY, pressure: t.force || 0.5, t: ts, originalEvent: e });
        }
        this._ensureProcessing();
    }

    _syncPositions() {
        this.positions = Array.from(this.pointsMap.values());
    }

    _buildEvent(originalEvent, id) {
        const positions = Array.from(this.pointsMap.values());
        const first = positions[0] || [0, 0];
        return { originalEvent, positions, clientX: first[0], clientY: first[1], pointerId: id };
    }

    // schedule processing of the queued raw events
    _ensureProcessing() {
        if (this._processingScheduled) return;
        this._processingScheduled = true;
        if (this._postMessagePort) {
            // use postMessage for lower latency than setTimeout
            try { this._postMessagePort.postMessage(null); return; } catch (e) {}
        }
        // fallback
        setTimeout(() => this._processQueue(), 0);
    }

    // drain the queue and call callbacks with interpreted positions
    _processQueue() {
        this._processingScheduled = false;
        if (!this._queue.length) return;
        // take a snapshot of queued events
        const q = this._queue.splice(0, this._queue.length);

        // maintain per-pointer arrays and preserve ordering
        const perId = new Map();
        for (const it of q) {
            const arr = perId.get(it.id) || [];
            arr.push(it);
            perId.set(it.id, arr);
        }

        // update internal pointsMap and call handlers in event order
        // We'll iterate the original queue order to preserve event sequencing
        for (const raw of q) {
            const id = raw.id;
            if (raw.type === 'down') {
                this.pointsMap.set(id, [raw.x, raw.y]);
                this._syncPositions();
                const ev = this._makeInterpretedEvent(raw.originalEvent, id, perId.get(id));
                if (this.onDown) try { this.onDown(ev); } catch(e) { console.error(e); }
            } else if (raw.type === 'move') {
                // update last known position for this id
                this.pointsMap.set(id, [raw.x, raw.y]);
                this._syncPositions();
                const ev = this._makeInterpretedEvent(raw.originalEvent, id, perId.get(id));
                if (this.onMove) try { this.onMove(ev); } catch(e) { console.error(e); }
            } else if (raw.type === 'up') {
                this.pointsMap.set(id, [raw.x, raw.y]);
                this._syncPositions();
                const ev = this._makeInterpretedEvent(raw.originalEvent, id, perId.get(id));
                if (this.onUp) try { this.onUp(ev); } catch(e) { console.error(e); }
                this.pointsMap.delete(id);
                this._syncPositions();
            }
        }
    }

    // Build an event object for consumers. "changes" is the per-id raw event list.
    _makeInterpretedEvent(originalEvent, id, changes) {
        const raw = (changes || []).map(c => ({ x: c.x, y: c.y, p: c.pressure || 0.5, t: c.t }));
        // If insufficient points, fall back to the last known single position
        if (raw.length === 0) {
            const fx = originalEvent && originalEvent.clientX || 0;
            const fy = originalEvent && originalEvent.clientY || 0;
            return { originalEvent, positions: [[fx, fy]], clientX: fx, clientY: fy, pointerId: id };
        }

        // Parameters: how many anchor points to splice into, and samples per segment
        const anchorsCount = Math.min(6, Math.max(2, Math.floor(raw.length / 1) ));
        const samplesPerSegment = 4;

        // Resample raw points into a fixed number of anchors spread by distance
        const anchors = this._resampleAnchors(raw, Math.min(anchorsCount, raw.length));

        // Convert anchors into smooth sampled points via Catmull-Rom -> Bezier sampling
        const sampled = this._catmullRomToBezierSamples(anchors, samplesPerSegment);

        // Provide both the instantaneous positions (current active pointers) and an interpreted path
        const curr = sampled.length ? sampled[sampled.length - 1] : [raw[raw.length - 1].x, raw[raw.length - 1].y];
        const positions = [ [ curr[0], curr[1] ] ];
        return { originalEvent, positions, clientX: curr[0], clientY: curr[1], pointerId: id, interpreted: { id, points: sampled } };
    }

    _resampleAnchors(rawPoints, k) {
        if (rawPoints.length <= k) return rawPoints.map(p => [p.x, p.y]);
        // compute cumulative distances
        const dists = [0];
        for (let i = 1; i < rawPoints.length; i++) {
            const dx = rawPoints[i].x - rawPoints[i-1].x;
            const dy = rawPoints[i].y - rawPoints[i-1].y;
            dists.push(dists[i-1] + Math.hypot(dx, dy));
        }
        const total = dists[dists.length - 1];
        const anchors = [];
        for (let a = 0; a < k; a++) {
            const target = (a / (k - 1)) * total;
            // find segment containing target
            let i = 0;
            while (i < dists.length - 1 && dists[i+1] < target) i++;
            const p0 = rawPoints[i];
            const p1 = rawPoints[Math.min(i+1, rawPoints.length -1)];
            const segLen = dists[i+1] - dists[i] || 1e-6;
            const t = (target - dists[i]) / segLen;
            const x = p0.x + (p1.x - p0.x) * t;
            const y = p0.y + (p1.y - p0.y) * t;
            anchors.push([x,y]);
        }
        return anchors;
    }

    _catmullRomToBezierSamples(points, samplesPerSegment) {
        if (!points || points.length === 0) return [];
        if (points.length === 1) return [points[0]];
        const out = [];
        const n = points.length;
        for (let i = 0; i < n - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(n - 1, i + 2)];
            // control points for cubic bezier approximating Catmull-Rom
            const cp1 = [ p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6 ];
            const cp2 = [ p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6 ];
            // sample this bezier segment
            for (let s = 0; s < samplesPerSegment; s++) {
                const t = s / samplesPerSegment;
                const x = this._cubicBezier(p1[0], cp1[0], cp2[0], p2[0], t);
                const y = this._cubicBezier(p1[1], cp1[1], cp2[1], p2[1], t);
                // avoid duplicating points across segment boundaries
                if (out.length === 0 || out[out.length-1][0] !== x || out[out.length-1][1] !== y) out.push([x,y]);
            }
        }
        // finally push last point
        const last = points[points.length - 1];
        out.push([last[0], last[1]]);
        return out;
    }

    _cubicBezier(a, b, c, d, t) {
        const it = 1 - t;
        return it*it*it*a + 3*it*it*t*b + 3*it*t*t*c + t*t*t*d;
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
