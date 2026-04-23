// Worker: receives OffscreenCanvas and drawing commands
let ctx = null;
let canvas = null;
let dpr = 1;

onmessage = async (e) => {
    const m = e.data;
    if (!m || !m.type) return;
    if (m.type === 'init') {
        canvas = m.canvas;
        dpr = m.dpr || 1;
        try {
            ctx = canvas.getContext('2d');
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
        } catch (err) {
            console.error('worker: failed to get 2d context', err);
            ctx = null;
        }
        return;
    }
    if (!ctx) return;
    if (m.type === 'drawLine') {
        const { x1,y1,x2,y2, style } = m;
        ctx.save();
        if (style && style.composite) ctx.globalCompositeOperation = style.composite;
        if (style && style.color) ctx.strokeStyle = style.color;
        if (style && style.width) ctx.lineWidth = style.width;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
    } else if (m.type === 'clear') {
        ctx.setTransform(1,0,0,1,0,0);
        ctx.clearRect(0,0,canvas.width,canvas.height);
    } else if (m.type === 'putImageBitmap') {
        // draw a bitmap into workspace (useful for merging)
        try { ctx.drawImage(m.bitmap, 0, 0); } catch (e) {}
    } else if (m.type === 'fill') {
        // simple flood-fill not implemented in worker prototype (postpone)
    }
};
