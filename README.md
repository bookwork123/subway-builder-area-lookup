# Area Lookup — a Subway Builder mod

Click anywhere on the map to see the neighborhood, district and city names
near that spot, so you can name stations after them. Names come from the
game's own basemap label layers (including labels the game hides at the
current zoom), so it works offline.

> Why not an online geocoder? The game's Content-Security-Policy only allows
> network requests to its own servers and `localhost`, so mods can't call
> services like Nominatim directly.

**Status:** feasibility spike (v0.1.0).

## Install (dev)

The game loads mods from `%APPDATA%\metro-maker4\mods\`. This repo is linked
there with a directory junction, so edits here are live:

```powershell
New-Item -ItemType Junction -Path "$env:APPDATA\metro-maker4\mods\area-lookup" -Target "C:\Users\oscar\repositories\subway-builder-mod"
```

Then restart the game and enable **Area Lookup** under Settings → Mods.

## Use

1. Click the map-pin button in the toolbar (or run `AreaLookup.toggle()` in the console).
2. Click the map. A panel shows the area names, with Copy buttons and an
   "Open in Google Maps" button.
3. Press Esc to close the panel; press Esc again to turn the mode off.

## Spike checklist

Open DevTools (Ctrl+Shift+I) and filter the console by `[AreaLookup]`.

- [ ] Toolbar button appears and toggles (crosshair cursor on the map)
- [ ] Clicking the map shows the panel and does **not** trigger game actions
- [ ] Dragging still pans the map
- [ ] Panel shows neighborhood / district / city names (check `places near`)
- [ ] "Open in Google Maps" opens the system browser (check `openExternalUrl returned`)
- [ ] Copy buttons put text on the clipboard

Console helpers: `AreaLookup.layers()`, `AreaLookup.here()` (names at map center), `AreaLookup.openTest()`.
