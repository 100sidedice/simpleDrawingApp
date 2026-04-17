# Simple Full-Screen Canvas App

This is a minimal boilerplate for a full-screen 2D canvas web app.

Quick start

Open `index.html` in a browser, or serve the folder with a simple HTTP server:

```bash
cd /path/to/simpleDrawingApp
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

Controls

- Color picker: choose stroke color
- Size slider: choose stroke width
- Clear button: clears the canvas (or press `C`)
 - Undo / Redo: use the `Undo` and `Redo` buttons in the toolbar to undo or redo the most recent stroke. This uses Yjs' `UndoManager` and stores strokes (color/width/points) as operations under the hood.

Notes

- Canvas is DPI-aware and resizes to fill the viewport.
- Drawing uses pointer events (works with mouse, pen, and touch devices).
