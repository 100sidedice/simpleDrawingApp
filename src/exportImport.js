// exportImport.js - modular export/import helpers
export function setupExportImport(program) {
    // create container
    const container = document.createElement('div');
    container.className = 'export-controls';

    const btnSavePng = document.createElement('button');
    btnSavePng.id = 'export-png';
    btnSavePng.className = 'export-btn';
    btnSavePng.textContent = 'Save PNG';

    const btnSavePdf = document.createElement('button');
    btnSavePdf.id = 'export-pdf';
    btnSavePdf.className = 'export-btn';
    btnSavePdf.textContent = 'Save PDF';

    const btnImport = document.createElement('button');
    btnImport.id = 'import-image';
    btnImport.className = 'export-btn';
    btnImport.textContent = 'Import';

    container.appendChild(btnSavePng);
    container.appendChild(btnSavePdf);
    container.appendChild(btnImport);
    document.body.appendChild(container);

    // hidden file input for import
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,application/pdf';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    btnSavePng.addEventListener('click', async () => {
        const defaultName = 'drawing';
        const name = window.prompt('Filename (without extension):', defaultName);
        if (!name) return;
        await saveAsImage(program.frame.canvas, name + '.png');
    });

    btnSavePdf.addEventListener('click', async () => {
        const defaultName = 'drawing';
        const name = window.prompt('Filename (without extension):', defaultName);
        if (!name) return;
        // Export all frames as a downloaded multi-page PDF (uses jsPDF)
        await saveAllFramesAsPdfDirect(program.frames, name + '.pdf');
    });

    btnImport.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
    });

    fileInput.addEventListener('change', async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            await importPdfFile(file, program);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                // draw into current frame, fitting image to canvas
                const f = program.frame;
                const ctx = f.ctx || f.canvas.getContext('2d');
                // clear frame then draw image scaled to fit while preserving aspect
                ctx.clearRect(0,0,f.canvas.width,f.canvas.height);
                const sw = img.width, sh = img.height;
                const dw = f.canvas.width, dh = f.canvas.height;
                const sRatio = sw / sh;
                const dRatio = dw / dh;
                let drawW, drawH, offsetX, offsetY;
                if (sRatio > dRatio) {
                    drawW = dw; drawH = Math.round(dw / sRatio);
                    offsetX = 0; offsetY = Math.round((dh - drawH) / 2);
                } else {
                    drawH = dh; drawW = Math.round(dh * sRatio);
                    offsetY = 0; offsetX = Math.round((dw - drawW) / 2);
                }
                ctx.drawImage(img, 0,0,sw,sh, offsetX, offsetY, drawW, drawH);
                program.commitSnapshot('import-image');
            };
            img.src = String(reader.result);
        };
        reader.readAsDataURL(file);
    });
}

export async function saveAsImage(canvas, filename) {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            if (!blob) return resolve();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            resolve();
        }, 'image/png');
    });
}

// Basic PDF export: opens a print window with the canvas image so user can "Save as PDF".
export async function saveAsPdf(canvas, filename) {
    // convert canvas to data URL
    const dataUrl = canvas.toDataURL('image/png');
    const w = window.open('', '_blank');
    if (!w) return;
    const html = `<!doctype html><html><head><title>${filename}</title><style>html,body{height:100%;margin:0}img{width:100%;height:auto;display:block}</style></head><body><img src="${dataUrl}" alt="drawing"/></body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
    // give the window a moment to render then call print — user can choose "Save as PDF"
    setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 300);
}

// Multi-page PDF export: opens a print window with each frame as its own page.
export async function saveAllFramesAsPdf(frames, filename) {
    if (!frames || !frames.length) return;
    const dataUrls = frames.map(f => f && f.canvas ? f.canvas.toDataURL('image/png') : null).filter(Boolean);
    const w = window.open('', '_blank');
    if (!w) return;
    const htmlStart = `<!doctype html><html><head><title>${filename}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        html,body{height:100%;margin:0;padding:0}
        .page{width:100%;height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden}
        .page img{max-width:100%;max-height:100%;display:block}
        @media print{ .page{page-break-after:always; width:100%;height:auto} }
        </style></head><body>`;
    const htmlEnd = '</body></html>';
    const pages = dataUrls.map(src => `<div class="page"><img src="${src}" alt="frame"/></div>`).join('\n');
    const html = htmlStart + pages + htmlEnd;
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 400);
}

// Load jsPDF from CDN (UMD build) and return the jsPDF constructor
function loadJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    return new Promise((resolve, reject) => {
        const src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => {
            if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf.jsPDF);
            return reject(new Error('jsPDF failed to load'));
        };
        s.onerror = (err) => reject(err);
        document.head.appendChild(s);
    });
}

// Create and download a multi-page PDF containing each frame as a full-page image.
export async function saveAllFramesAsPdfDirect(frames, filename) {
    if (!frames || !frames.length) return;
    let jsPDF;
    try {
        jsPDF = await loadJsPdf();
    } catch (e) {
        // fallback to print-based method if jsPDF can't be loaded
        return saveAllFramesAsPdf(frames, filename);
    }

    // Use pixel units and set page size to each canvas's pixel dimensions.
    // Ensure orientation is specified so landscape pages don't get rotated/cropped.
    const firstCanvas = frames[0].canvas;
    const firstW = firstCanvas.width;
    const firstH = firstCanvas.height;
    const firstOrientation = firstW >= firstH ? 'landscape' : 'portrait';
    let doc = new jsPDF({ unit: 'px', format: [firstW, firstH], orientation: firstOrientation });

    for (let i = 0; i < frames.length; i++) {
        const c = frames[i].canvas;
        const pageW = c.width;
        const pageH = c.height;
        const orientation = pageW >= pageH ? 'landscape' : 'portrait';
        const dataUrl = c.toDataURL('image/png');
        if (i === 0) {
            // If first page dimensions differ from initial doc, recreate doc to match exactly
            if (pageW !== firstW || pageH !== firstH) {
                doc = new jsPDF({ unit: 'px', format: [pageW, pageH], orientation });
            }
            doc.addImage(dataUrl, 'PNG', 0, 0, pageW, pageH);
        } else {
            // create a new page with explicit size and orientation
            doc.addPage([pageW, pageH], orientation);
            doc.setPage(i + 1);
            doc.addImage(dataUrl, 'PNG', 0, 0, pageW, pageH);
        }
    }
    doc.save(filename);
}

// Load pdf.js (pdfjsLib) from CDN and return the global
function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((resolve, reject) => {
        const src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => {
            if (window.pdfjsLib) {
                // set workerSrc to CDN worker
                try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js'; } catch (e) {}
                resolve(window.pdfjsLib);
            } else reject(new Error('pdfjs failed to load'));
        };
        s.onerror = (err) => reject(err);
        document.head.appendChild(s);
    });
}

// Import a PDF file and create frames for each page, scaling pages to window bounds.
async function importPdfFile(file, program) {
    let pdfjsLib;
    try {
        pdfjsLib = await loadPdfJs();
    } catch (e) {
        alert('Failed to load PDF importer.');
        return;
    }
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const DPR = window.devicePixelRatio || 1;
    const targetW = Math.round(window.innerWidth * DPR);
    const targetH = Math.round(window.innerHeight * DPR);
    const newFrames = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        // compute scale so rendered page width equals targetW
        const scale = targetW / viewport.width || 1;
        const renderViewport = page.getViewport({ scale });
        const tmp = document.createElement('canvas');
        tmp.width = Math.round(renderViewport.width);
        tmp.height = Math.round(renderViewport.height);
        const ctx = tmp.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
        // create frame sized to window bounds (device pixels)
        const Frame = (await import('./frame.js')).default;
        const f = new Frame(targetW, targetH, DPR);
        // draw white background then draw scaled page preserving aspect ratio
        f.ctx.fillStyle = '#ffffff';
        f.ctx.fillRect(0,0,f.canvas.width,f.canvas.height);
        const sw = tmp.width, sh = tmp.height;
        const sRatio = sw / sh;
        const dRatio = f.canvas.width / f.canvas.height;
        let drawW, drawH, offsetX, offsetY;
        if (sRatio > dRatio) {
            drawW = f.canvas.width; drawH = Math.round(f.canvas.width / sRatio);
            offsetX = 0; offsetY = Math.round((f.canvas.height - drawH) / 2);
        } else {
            drawH = f.canvas.height; drawW = Math.round(f.canvas.height * sRatio);
            offsetY = 0; offsetX = Math.round((f.canvas.width - drawW) / 2);
        }
        f.ctx.drawImage(tmp, 0,0, sw, sh, offsetX, offsetY, drawW, drawH);
        newFrames.push(f);
    }
    // replace program frames with imported pages
    program.frames = newFrames;
    program.selectFrame(0);
    program.commitSnapshot('import-pdf');
    if (program.renderFramePreviews) requestAnimationFrame(()=> program.renderFramePreviews());
}

export default { setupExportImport, saveAsImage, saveAsPdf };
