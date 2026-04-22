import Frame from './frame.js';

function _cloneImageToPlain(img) {
    // convert ImageData to plain serializable object
    if (!img) return null;
    return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

function _plainToImageData(obj) {
    if (!obj) return null;
    return new ImageData(new Uint8ClampedArray(obj.data), obj.width, obj.height);
}

export default class VersionControl {
    constructor() {
        this.commits = []; // list of commits (project-level snapshots)
        this.current = -1; // index of current commit, -1 = none
    }

    // commitProject(program, message, meta) - snapshot entire project state (delta-encoded)
    commitProject(program, message = '', meta = {}) {
        if (!program || !Array.isArray(program.frames)) throw new Error('commitProject requires a program with frames[]');
        // clone current frames into plain serializable objects
        const imgs = program.frames.map(f => (f instanceof Frame) ? _cloneImageToPlain(f.getImageData()) : null);

        // truncate future commits
        if (this.current < this.commits.length - 1) this.commits.splice(this.current + 1);

        let snapshot = null;
        if (this.current === -1) {
            // first commit - store full snapshot
            snapshot = { frames: imgs, deltas: null, baseIndex: null, currentFrameIndex: typeof program.currentFrameIndex === 'number' ? program.currentFrameIndex : 0 };
        } else {
            // build deltas against reconstructed previous commit state
            const prevFrames = this._reconstructFrames(this.current);
            const deltas = [];
            for (let i = 0; i < imgs.length; i++) {
                const a = imgs[i];
                const b = prevFrames[i];
                const same = a && b && a.width === b.width && a.height === b.height && a.data.length === b.data.length && this._imageDataEquals(a, b);
                if (!same) {
                    deltas.push({ index: i, image: a });
                }
            }
            // if no deltas, still create a no-op commit with empty deltas
            snapshot = { frames: null, deltas: deltas, baseIndex: this._findNearestFull(this.current), currentFrameIndex: typeof program.currentFrameIndex === 'number' ? program.currentFrameIndex : 0 };
        }

        const commit = { id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8), ts: Date.now(), message, snapshot, meta };
        this.commits.push(commit);
        this.current = this.commits.length - 1;
        return commit;
    }

    // move current pointer back by one and return new current index, or -1 if not possible
    undo() {
        if (this.current <= 0) return -1;
        this.current -= 1;
        return this.current;
    }

    // move current pointer forward by one and return new current index, or -1 if not possible
    redo() {
        if (this.current >= this.commits.length - 1) return -1;
        this.current += 1;
        return this.current;
    }

    // loadCommit(indexOrId, target) - load a commit into a Program (project-level)
    loadCommit(indexOrId, target) {
        const idx = this._resolveIndex(indexOrId);
        if (idx === -1) throw new Error('commit not found');
        const commit = this.commits[idx];
        if (!commit || !commit.snapshot) throw new Error('commit has no snapshot');
        if (!target || !Array.isArray(target.frames)) throw new Error('loadCommit requires a Program with frames[]');
        // reconstruct full frames for this commit (convert plain frames to ImageData)
        const plain = this._reconstructFrames(idx);
        const full = plain.map(p => _plainToImageData(p));
        // apply frames to program (create Frame instances as needed)
        for (let i = 0; i < full.length; i++) {
            const img = full[i];
            if (!img) continue;
            if (target.frames[i]) {
                target.frames[i].putImageData(img);
            } else {
                const f = new Frame(img.width, img.height, target.frame && target.frame.dpr ? target.frame.dpr : 1);
                f.putImageData(img);
                target.frames[i] = f;
            }
        }
        // trim extra frames
        if (target.frames.length > full.length) target.frames.length = full.length;
        // restore current index
        target.currentFrameIndex = Math.min(commit.snapshot.currentFrameIndex || 0, Math.max(0, target.frames.length - 1));
        target.frame = target.frames[target.currentFrameIndex] || target.frame;
        this.current = idx;
        return commit;
    }

    _resolveIndex(indexOrId) {
        if (typeof indexOrId === 'number') {
            if (indexOrId < 0 || indexOrId >= this.commits.length) return -1;
            return indexOrId;
        }
        // assume id
        return this.commits.findIndex(c => c.id === indexOrId);
    }

    // reconstruct full frames array for commit index by walking back to nearest full snapshot
    _reconstructFrames(index) {
        if (index < 0 || index >= this.commits.length) throw new Error('_reconstructFrames: index out of range');
        // find the nearest commit at or before index that has snapshot.frames (full)
        let base = index;
        while (base >= 0 && !(this.commits[base] && this.commits[base].snapshot && this.commits[base].snapshot.frames)) base--;
        if (base < 0) throw new Error('no base full snapshot found');
        // clone base frames (plain objects)
        const baseFrames = (this.commits[base].snapshot.frames || []).map(f => f ? { width: f.width, height: f.height, data: new Uint8ClampedArray(f.data) } : null);
        // apply deltas from base+1 .. index
        for (let i = base + 1; i <= index; i++) {
            const c = this.commits[i];
            if (!c || !c.snapshot) continue;
            const s = c.snapshot;
            if (s.frames) {
                // full snapshot - replace (plain objects)
                for (let j = 0; j < s.frames.length; j++) baseFrames[j] = s.frames[j] ? { width: s.frames[j].width, height: s.frames[j].height, data: new Uint8ClampedArray(s.frames[j].data) } : null;
            } else if (s.deltas && Array.isArray(s.deltas)) {
                for (const d of s.deltas) {
                    baseFrames[d.index] = d.image ? { width: d.image.width, height: d.image.height, data: new Uint8ClampedArray(d.image.data) } : null;
                }
            }
        }
        return baseFrames;
    }

    // Public helper: return plain frame object for given commit index and frame index
    getPlainFrameAtCommit(commitIndex, frameIndex) {
        try {
            const idx = this._resolveIndex(commitIndex);
            if (idx === -1) return null;
            const frames = this._reconstructFrames(idx);
            if (!frames || frameIndex < 0 || frameIndex >= frames.length) return null;
            return frames[frameIndex] || null;
        } catch (e) {
            return null;
        }
    }

    // IndexedDB persistence helpers
    _openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('simpleDrawingApp', 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                try { db.createObjectStore('app'); } catch (err) {}
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async _saveToIndexedDB() {
        try {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(['app'], 'readwrite');
                const store = tx.objectStore('app');
                const payload = { commits: this.commits, current: this.current };
                const r = store.put(payload, 'versionControl');
                r.onsuccess = () => { resolve(true); db.close(); };
                r.onerror = () => { reject(r.error); db.close(); };
            });
        } catch (e) {
            return false;
        }
    }

    async loadFromIndexedDB(targetProgram) {
        try {
            const db = await this._openDB();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(['app'], 'readonly');
                const store = tx.objectStore('app');
                const r = store.get('versionControl');
                r.onsuccess = async () => {
                    const payload = r.result;
                    db.close();
                    if (!payload || !Array.isArray(payload.commits) || payload.commits.length === 0) return resolve(false);
                    this.commits = payload.commits;
                    this.current = typeof payload.current === 'number' ? payload.current : this.commits.length - 1;
                    // apply the current commit to the provided program, if any
                    if (targetProgram) {
                        try { this.loadCommit(this.current, targetProgram); } catch (e) {}
                    }
                    resolve(true);
                };
                r.onerror = () => { db.close(); resolve(false); };
            });
        } catch (e) {
            return false;
        }
    }

    // Public API: trigger immediate save
    async saveNow() {
        try { await this._saveToIndexedDB(); } catch (e) {}
    }

    // Start periodic autosave (intervalMs defaults to 5000ms)
    startAutoSave(intervalMs = 5000) {
        this.stopAutoSave();
        try {
            this._autosaveIntervalId = setInterval(() => {
                try { this._saveToIndexedDB(); } catch (e) {}
            }, intervalMs);
        } catch (e) {}
    }

    stopAutoSave() {
        try { if (this._autosaveIntervalId) { clearInterval(this._autosaveIntervalId); this._autosaveIntervalId = null; } } catch (e) {}
    }

    _findNearestFull(index) {
        let i = index;
        while (i >= 0) {
            if (this.commits[i] && this.commits[i].snapshot && this.commits[i].snapshot.frames) return i;
            i--;
        }
        return -1;
    }

    _imageDataEquals(a, b) {
        if (!a || !b) return false;
        if (a.width !== b.width || a.height !== b.height) return false;
        const da = a.data, db = b.data;
        if (da.length !== db.length) return false;
        for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) return false;
        return true;
    }

    // get approximate byte size of a commit (sum of stored ImageData buffers)
    getCommitSize(index) {
        const idx = this._resolveIndex(index);
        if (idx === -1) return 0;
        const c = this.commits[idx];
        if (!c || !c.snapshot) return 0;
        let size = 0;
        const s = c.snapshot;
        if (s.frames) {
            for (const f of s.frames) if (f && f.data) size += f.data.length;
        }
        if (s.deltas) {
            for (const d of s.deltas) if (d && d.image && d.image.data) size += d.image.data.length;
        }
        return size;
    }

    getCommits() {
        return this.commits.map(({ id, ts, message, meta }, i) => ({ id, ts, message, index: i, meta }));
    }
}
