const COLS_DEFAULT = 4;
const ROWS_DEFAULT = 4;

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

const imageCache = new Map(); // url -> Promise<HTMLImageElement>
const tileCache = new Map(); // "x,y" -> canvas (native tile size)
let SPRITE = null;
let COLS = COLS_DEFAULT, ROWS = ROWS_DEFAULT, TILE_W = 0, TILE_H = 0;

function loadImage(url){
  if(imageCache.has(url)) return imageCache.get(url);
  const p = new Promise((resolve, reject)=>{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const onload = ()=>{
      img.removeEventListener('load', onload);
      img.removeEventListener('error', onerror);
      resolve(img);
    };
    const onerror = (e)=>{
      img.removeEventListener('load', onload);
      img.removeEventListener('error', onerror);
      reject(e);
    };
    img.addEventListener('load', onload);
    img.addEventListener('error', onerror);
    img.src = url;
  });
  imageCache.set(url, p);
  return p;
}

function makeTileKey(x,y){ return `${x},${y}`; }

async function preload(url, cols=COLS_DEFAULT, rows=ROWS_DEFAULT){
  const img = await loadImage(url);
  SPRITE = img;
  COLS = cols; ROWS = rows;
  TILE_W = Math.round(img.naturalWidth / COLS);
  TILE_H = Math.round(img.naturalHeight / ROWS);
  tileCache.clear();
  for(let y=0;y<ROWS;y++){
    for(let x=0;x<COLS;x++){
      const c = document.createElement('canvas');
      c.width = TILE_W; c.height = TILE_H;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, x*TILE_W, y*TILE_H, TILE_W, TILE_H, 0, 0, TILE_W, TILE_H);
      tileCache.set(makeTileKey(x,y), c);
      // don't precompute grayscale here (can be expensive); generate on-demand
    }
  }
}

function getTileCanvas(x,y){ return tileCache.get(makeTileKey(x,y)) || null; }

function getIcon(col,row,w,h, opts={}){
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  const srcTile = getTileCanvas(col,row);
  if(srcTile){
    if(opts.grayscale){
      ctx.save();
      ctx.filter = 'grayscale(100%)';
      ctx.drawImage(srcTile, 0,0, srcTile.width, srcTile.height, 0,0, w,h);
      ctx.restore();
    } else {
      ctx.drawImage(srcTile, 0,0, srcTile.width, srcTile.height, 0,0, w,h);
    }
  }
  if(opts.mask){
    const m = opts.mask;
    const msrc = getTileCanvas(m.col, m.row);
    if(msrc){
      const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
      const tctx = tmp.getContext('2d');
      tctx.drawImage(msrc,0,0,msrc.width,msrc.height,0,0,w,h);
      try{
        const id = tctx.getImageData(0,0,w,h);
        const d = id.data;
        const hex = (''+m.color).replace('#','');
        const tr = parseInt(hex.substring(0,2),16);
        const tg = parseInt(hex.substring(2,4),16);
        const tb = parseInt(hex.substring(4,6),16);
        for(let i=0;i<d.length;i+=4){
          if(d[i]===0 && d[i+1]===255 && d[i+2]===0){
            d[i]=tr; d[i+1]=tg; d[i+2]=tb;
          }
        }
        tctx.putImageData(id,0,0);
        ctx.drawImage(tmp,0,0);
      }catch(e){ console.warn('mask recolor failed', e); }
    }
  }
  return out;
}

function drawIconToButton(btn, color){
  const col = parseInt(btn.dataset.col,10) || 0;
  const row = parseInt(btn.dataset.row,10) || 0;
  const rect = btn.getBoundingClientRect();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  const masked = (btn.dataset.maskCol !== undefined && btn.dataset.maskRow !== undefined);
  const mask = masked ? { col: parseInt(btn.dataset.maskCol,10), row: parseInt(btn.dataset.maskRow,10), color: color || '#000000' } : null;
  const cvs = getIcon(col,row,w,h, { grayscale: !btn.classList.contains('active'), mask });
  // clear previous content and append canvas
  btn.innerHTML = '';
  cvs.className = 'icon__canvas';
  btn.appendChild(cvs);
}

function setupIcons(){
  const icons = document.querySelectorAll('.icon');
  if(!icons.length) return;
  icons.forEach(btn=>{
    btn.tabIndex = 0;
    btn.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); btn.click(); } });
    // initial draw; use current color picker if available
    const colorInput = document.getElementById('color');
    const color = colorInput ? colorInput.value : '#000000';
    drawIconToButton(btn, color);
  });
}

async function setIconMaskColor(btn, color){
  drawIconToButton(btn, color);
}

async function setAllMaskColors(color){
  const icons = document.querySelectorAll('.icon');
  icons.forEach(btn=> drawIconToButton(btn, color));
}

function refreshIcons(){
  const colorInput = document.getElementById('color');
  const color = colorInput ? colorInput.value : '#000000';
  const icons = document.querySelectorAll('.icon');
  icons.forEach(btn=> drawIconToButton(btn, color));
}

export { preload, setupIcons, setIconMaskColor, setAllMaskColors, getIcon, refreshIcons };
