# HTML Studio

[English](README.md) | [中文](README.zh-CN.md)

A lightweight browser-based HTML editor with source editing, visual editing, and live preview.

## Features

- Source mode with HTML syntax highlighting, line numbers, tag matching, snippets, formatting, and code folding.
- Visual mode for Word-like editing without exposing HTML tags.
- Live iframe preview with desktop, tablet, and mobile view presets.
- Draggable splitter between editor and preview panes.
- New, open, save, export, and autosave support.
- Light and dark themes.
- Focus mode for distraction-free editing.
- Undo support with `Ctrl+Z`.

## Usage

Open `index.html` directly in a browser.

No build step or development server is required.

## Keyboard Shortcuts

- `Ctrl+S`: Save
- `Ctrl+O`: Open
- `Ctrl+N`: New document
- `Ctrl+Z`: Undo
- `Ctrl+Shift+F`: Format HTML
- `F11`: Toggle focus mode
- `Esc`: Exit focus mode

## Files

- `index.html`: Application shell
- `styles.css`: Layout, themes, editor, and preview styling
- `app.js`: Editor behavior, preview rendering, file operations, history, and mode switching

## Notes

The editor runs fully in the browser. Autosaved content is stored in `localStorage`; saved and exported files are downloaded or written through the browser file picker when supported.
