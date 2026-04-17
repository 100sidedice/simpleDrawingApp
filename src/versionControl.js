import Frame from './frame.js';

function cloneImageData(img) {
    return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

export default class VersionControl {
    constructor() {
        this.commits = []; // { id, ts, message, image }
        this.current = -1; // index of current commit, -1 = none
    }

    // commit(frame, message, meta) - stores a snapshot and truncates future commits
    // meta can include arbitrary data, e.g. { frameIndex }
    commit(frame, message = '', meta = {}) {
        if (!(frame instanceof Frame)) throw new Error('commit requires a Frame');
        const img = frame.getImageData();
        const copy = cloneImageData(img);
        // truncate future commits
        if (this.current < this.commits.length - 1) this.commits.splice(this.current + 1);
        const commit = { id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8), ts: Date.now(), message, image: copy, meta };
        this.commits.push(commit);
        this.current = this.commits.length - 1;
        return commit;
    }

    // loadCommit(indexOrId, frame) - load snapshot into frame WITHOUT deleting future commits
    loadCommit(indexOrId, frame) {
        if (!(frame instanceof Frame)) throw new Error('loadCommit requires a Frame');
        const idx = this._resolveIndex(indexOrId);
        if (idx === -1) throw new Error('commit not found');
        const commit = this.commits[idx];
        // apply a clone to avoid shared buffers
        const imgCopy = cloneImageData(commit.image);
        frame.putImageData(imgCopy);
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

    getCommits() {
        return this.commits.map(({ id, ts, message, meta }, i) => ({ id, ts, message, index: i, meta }));
    }
}
