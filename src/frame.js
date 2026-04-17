// Frame: represents a single drawing frame (offscreen, DPI-aware canvas)
export default class Frame {
    // Frame now stores pixels in device (backing) pixels directly.
    // widthPx/heightPx are device-pixel dimensions.
    constructor(
        widthPx = 800,
        heightPx = 600,
        dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    ) {
        this.dpr = dpr;
        this.canvas = document.createElement("canvas");
        this.ctx = this.canvas.getContext("2d");
        // stable id to identify this frame across commits
        this._id =
            String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
        this.resize(widthPx, heightPx);
    }

    // widthPx/heightPx in device pixels
    resize(widthPx, heightPx) {
        this.canvas.width = Math.max(1, Math.round(widthPx));
        this.canvas.height = Math.max(1, Math.round(heightPx));
        // ensure style size reflects CSS pixels when possible
        try {
            this.canvas.style.width = this.canvas.width / this.dpr + "px";
            this.canvas.style.height = this.canvas.height / this.dpr + "px";
        } catch (e) {}
        // keep default transform (1:1 in device pixels)
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
    }

    // draw a line where coordinates are in device pixels
    drawLine(x1, y1, x2, y2, style = {}) {
        this.ctx.save();
        if (style.composite) this.ctx.globalCompositeOperation = style.composite;
        if (style.color) this.ctx.strokeStyle = style.color;
        if (style.width) this.ctx.lineWidth = style.width;
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.stroke();
        this.ctx.restore();
    }

    clear() {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // full-frame ImageData (device-pixel sized)
    getImageData() {
        return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

    putImageData(img) {
        if (!img) return;
        // if sizes differ, resize frame to match image (img is device-pixel sized)
        if (img.width !== this.canvas.width || img.height !== this.canvas.height) {
            this.resize(img.width, img.height);
        }
        this.ctx.putImageData(img, 0, 0);
    }

    // device-pixel tile helpers (tx,ty are tile coords; tileSize in device pixels)
    getTile(tx, ty, tileSize) {
        const sx = Math.round(tx * tileSize);
        const sy = Math.round(ty * tileSize);
        const sw = Math.min(Math.round(tileSize), this.canvas.width - sx);
        const sh = Math.min(Math.round(tileSize), this.canvas.height - sy);
        if (sw <= 0 || sh <= 0) return null;
        return this.ctx.getImageData(sx, sy, sw, sh);
    }

    putTile(tx, ty, tileSize, img) {
        if (!img) return;
        const sx = Math.round(tx * tileSize);
        const sy = Math.round(ty * tileSize);
        this.ctx.putImageData(img, sx, sy);
    }

    // sample pixel at device-pixel coords, returns [r,g,b,a]
    samplePixel(x, y) {
        const sx = Math.round(x);
        const sy = Math.round(y);
        if (sx < 0 || sy < 0 || sx >= this.canvas.width || sy >= this.canvas.height)
            return [0, 0, 0, 0];
        const d = this.ctx.getImageData(sx, sy, 1, 1).data;
        return [d[0], d[1], d[2], d[3]];
    }

    // simple flood fill at device-pixel coords with rgba color tuple [r,g,b,a]
    fill(x, y, colorRGBA) {
        const sx = Math.round(x);
        const sy = Math.round(y);
        if (sx < 0 || sy < 0 || sx >= this.canvas.width || sy >= this.canvas.height)
            return;
        const img = this.ctx.getImageData(
            0,
            0,
            this.canvas.width,
            this.canvas.height,
        );
        const data = img.data;
        const w = img.width;
        const h = img.height;
        const idx = (px, py) => (py * w + px) * 4;
        const targetIdx = idx(sx, sy);
        const tr = data[targetIdx],
            tg = data[targetIdx + 1],
            tb = data[targetIdx + 2],
            ta = data[targetIdx + 3];
        // target equals replacement? then no-op
        if (
            tr === colorRGBA[0] &&
            tg === colorRGBA[1] &&
            tb === colorRGBA[2] &&
            ta === colorRGBA[3]
        )
            return;
        const stack = [[sx, sy]];
        const within = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
        while (stack.length) {
            const [cx, cy] = stack.pop();
            const i = idx(cx, cy);
            if (
                data[i] === tr &&
                data[i + 1] === tg &&
                data[i + 2] === tb &&
                data[i + 3] === ta
            ) {
                data[i] = colorRGBA[0];
                data[i + 1] = colorRGBA[1];
                data[i + 2] = colorRGBA[2];
                data[i + 3] = colorRGBA[3];
                stack.push([cx + 1, cy]);
                stack.push([cx - 1, cy]);
                stack.push([cx, cy + 1]);
                stack.push([cx, cy - 1]);
            }
        }
        // perform a single-pixel dilation of the filled region to avoid 1px anti-aliased gaps
        const replR = colorRGBA[0],
            replG = colorRGBA[1],
            replB = colorRGBA[2],
            replA = colorRGBA[3];
        const mask = new Uint8Array(w * h);
        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                const i = (py * w + px) * 4;
                if (
                    data[i] === replR &&
                    data[i + 1] === replG &&
                    data[i + 2] === replB &&
                    data[i + 3] === replA
                ) {
                    mask[py * w + px] = 1;
                }
            }
        }
        // expand by 1px (8-neighborhood) using original mask
        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                const m = mask[py * w + px];
                if (m) continue; // already filled
                // check neighbors
                let found = false;
                for (let oy = -1; oy <= 1 && !found; oy++) {
                    for (let ox = -1; ox <= 1 && !found; ox++) {
                        if (ox === 0 && oy === 0) continue;
                        const nx = px + ox,
                            ny = py + oy;
                        if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
                            if (mask[ny * w + nx]) found = true;
                        }
                    }
                }
                if (found) {
                    const i = (py * w + px) * 4;
                    data[i] = replR;
                    data[i + 1] = replG;
                    data[i + 2] = replB;
                    data[i + 3] = replA;
                }
            }
        }
        this.ctx.putImageData(img, 0, 0);
    }

    toDataURL(type = "image/png", quality) {
        return this.canvas.toDataURL(type, quality);
    }
}
