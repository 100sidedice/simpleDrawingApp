// UI class: maps normalized input signals and keyboard events to named actions
export default class UI {
  constructor(input, opts = {}) {
    this.input = input;
    this.actions = new Map(); // key -> type -> [fn]
    this.opts = opts;

    // wire input events
    this.input.onDown = (e) => this._handle('down', e);
    this.input.onMove = (e) => this._handle('move', e);
    this.input.onUp = (e) => this._handle('up', e);

    // keyboard
    this._onKey = (ev) => this._handle('key', ev);
    window.addEventListener('keydown', this._onKey);
  }

  // addAction(key, type, fn)
  // key: string identifier (e.g. 'draw', 'erase', 'clear')
  // type: 'down' | 'move' | 'up' | 'key' | '*' (wildcard)
  // fn: callback(event)
  addAction(key, type, fn) {
    if (!this.actions.has(key)) this.actions.set(key, new Map());
    const byType = this.actions.get(key);
    const t = type || '*';
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(fn);
    return () => this.removeAction(key, type, fn);
  }

  removeAction(key, type, fn) {
    const byType = this.actions.get(key);
    if (!byType) return false;
    const arr = byType.get(type || '*');
    if (!arr) return false;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
    return true;
  }

  // internal: call matching actions for event type
  _handle(type, event) {
    // call all actions where type matches (exact or '*')
    for (const [key, byType] of this.actions) {
      const exact = byType.get(type);
      const any = byType.get('*');
      if (exact) for (const fn of exact) try { fn({ key, type, event }); } catch (e) { console.error(e); }
      if (any) for (const fn of any) try { fn({ key, type, event }); } catch (e) { console.error(e); }
    }
  }

  // helper: trigger programmatically
  trigger(key, type, event) {
    const byType = this.actions.get(key);
    if (!byType) return;
    const exact = byType.get(type);
    const any = byType.get('*');
    if (exact) for (const fn of exact) fn(event);
    if (any) for (const fn of any) fn(event);
  }

  destroy() {
    window.removeEventListener('keydown', this._onKey);
    // unbind input handlers
    this.input.onDown = null;
    this.input.onMove = null;
    this.input.onUp = null;
    this.actions.clear();
  }
}
