const COLS = 4;
const ROWS = 4;

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

const imageCache = new Map(); // url -> Promise<HTMLImageElement>

function loadImage(url){
  if(imageCache.has(url)) return imageCache.get(url);
  const p = new Promise((resolve, reject)=>{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = ()=> resolve(img);
    img.onerror = reject;
    img.src = url;
  });
  imageCache.set(url, p);
  return p;
}

function parseCssUrl(cssUrl){
  if(!cssUrl) return null;
  const m = cssUrl.match(/url\(["']?(.*?)["']?\)/);
  return m ? m[1] : null;
}

function makeMaskElement(btn){
  let mask = btn.querySelector('.icon__mask');
  if(!mask){
    mask = document.createElement('span');
    mask.className = 'icon__mask';
    btn.appendChild(mask);
  }
  // ensure mask sits under the base sprite (use z-index)
  btn.style.position = btn.style.position || 'relative';
  btn.style.zIndex = 1;
  mask.style.zIndex = 0;
  return mask;
}

async function recolorMask(btn, color){
  if(!btn) return;
  const maskCol = btn.dataset.maskCol !== undefined ? parseInt(btn.dataset.maskCol,10) : null;
  const maskRow = btn.dataset.maskRow !== undefined ? parseInt(btn.dataset.maskRow,10) : null;
  if(maskCol === null || maskRow === null) return; // nothing to do

  const rect = btn.getBoundingClientRect();
  const btnW = Math.round(rect.width);
  const btnH = Math.round(rect.height);
  const useMcol = clamp(maskCol, 0, COLS-1);
  const useMrow = clamp(maskRow, 0, ROWS-1);
  const bgW = COLS * btnW;
  const bgH = ROWS * btnH;

  const comp = getComputedStyle(btn);
  const cssUrl = comp.backgroundImage;
  const url = parseCssUrl(cssUrl) || parseCssUrl(getComputedStyle(document.documentElement).getPropertyValue('--icons-image')) || 'drawingIcons.png';
  let img;
  try{ img = await loadImage(url); } catch(e){ console.warn('failed to load sprite', url, e); return; }

  const scaleX = img.naturalWidth / bgW;
  const scaleY = img.naturalHeight / bgH;
  const sx = useMcol * btnW * scaleX;
  const sy = useMrow * btnH * scaleY;
  const sWidth = btnW * scaleX;
  const sHeight = btnH * scaleY;

  const c = document.createElement('canvas');
  c.width = btnW; c.height = btnH;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, btnW, btnH);

  try{
    const id = ctx.getImageData(0,0,btnW,btnH);
    const data = id.data;
    const hex = (''+color).replace('#','');
    const tr = parseInt(hex.substring(0,2),16);
    const tg = parseInt(hex.substring(2,4),16);
    const tb = parseInt(hex.substring(4,6),16);
    for(let i=0;i<data.length;i+=4){
      const r = data[i], g = data[i+1], b = data[i+2];
      if(r === 0 && g === 255 && b === 0){
        data[i] = tr; data[i+1] = tg; data[i+2] = tb;
      }
    }
    ctx.putImageData(id,0,0);
  }catch(e){ console.warn('recolor failed', e); }

  const mask = makeMaskElement(btn);
  mask.style.backgroundImage = `url(${c.toDataURL()})`;
  mask.style.backgroundSize = `${btnW}px ${btnH}px`;
  mask.style.backgroundPosition = `0 0`;
}

function setupIcons(){
  const icons = document.querySelectorAll('.icon');
  if(!icons.length) return;
  icons.forEach(btn => {
    const col = parseInt(btn.dataset.col,10) || 0;
    const row = parseInt(btn.dataset.row,10) || 0;
    const rect = btn.getBoundingClientRect();
    const btnW = Math.round(rect.width);
    const btnH = Math.round(rect.height);
    const useCol = clamp(col, 0, COLS-1);
    const useRow = clamp(row, 0, ROWS-1);
    if(useCol !== col || useRow !== row){
      console.warn('icon coord out-of-range, clamped', btn, {col,row,used:[useCol,useRow]});
    }
    const bgW = COLS * btnW;
    const bgH = ROWS * btnH;
    btn.style.backgroundSize = `${bgW}px ${bgH}px`;
    btn.style.backgroundPosition = `-${useCol * btnW}px -${useRow * btnH}px`;

    if(btn.dataset.maskCol !== undefined && btn.dataset.maskRow !== undefined){
      makeMaskElement(btn);
      btn.classList.add('icon--masked');
    } else {
      const existing = btn.querySelector('.icon__mask');
      if(existing) existing.remove();
      btn.classList.remove('icon--masked');
    }

    btn.tabIndex = 0;
    btn.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        btn.click();
      }
    });
  });
}

async function setIconMaskColor(btn, color){ await recolorMask(btn,color); }
async function setAllMaskColors(color){
  const icons = document.querySelectorAll('.icon.icon--masked');
  await Promise.all(Array.from(icons).map(b=>recolorMask(b,color)));
}

export { setupIcons, setIconMaskColor, setAllMaskColors };
