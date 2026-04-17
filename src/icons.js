const COLS = 5;
const ROWS = 4;

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

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
    // make keyboard/space/enter activate like a button
    btn.tabIndex = 0;
    btn.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        btn.click();
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', ()=>{
  // run once and also after a short timeout to allow fonts/layout
  setupIcons();
  setTimeout(setupIcons, 250);
  // reposition on resize
  window.addEventListener('resize', setupIcons);
});

export { setupIcons };
