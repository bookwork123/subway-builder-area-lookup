// Area Lookup — spike / feasibility test.
// Toggle the toolbar button, click the map, and a small panel shows the
// neighborhood / district / city names near that spot.
//
// Names come from the game's own basemap vector tiles (the same label layers
// the game draws, including ones it hides at the current zoom). The game's
// Content-Security-Policy blocks outside APIs such as Nominatim, so this works
// fully offline. Every step logs to the console with the [AreaLookup] prefix.
(function () {
	var TAG = "[AreaLookup]";
	var api = window.SubwayBuilderAPI;
	if (!api) {
		console.error(TAG + " SubwayBuilderAPI not found!");
		return;
	}

	// Hot reload: tear down the previous copy of this mod before starting.
	var w = window;
	if (typeof w.__areaLookupCleanup === "function") {
		try { w.__areaLookupCleanup(); } catch (e) {}
	}
	var cleanups = [];
	w.__areaLookupCleanup = function () {
		cleanups.splice(0).forEach(function (fn) { try { fn(); } catch (e) {} });
	};

	console.log(TAG + " loaded | API v" + api.version);

	var BUTTON_ID = "area-lookup-toggle";
	var MAX_DISTANCE_KM = { neighbourhood: 3, suburb: 8, city: 40 };
	var COPIED_MS = 750; // how long the checkmark shows after copying
	var NEARBY_STATION_KM = 1;
	var MAX_NEARBY_STATIONS = 5;
	var UNDO_MS = 5000; // how long Undo stays available after a rename

	var active = false;
	var attachedMap = null;
	var popup = null;
	var loggedSample = false;

	// ---------- styles ----------
	// Colors and rounding come from the game's own theme variables (shadcn-style
	// HSL triplets on :root / .dark), so the panel follows its light/dark theme.
	// Fallbacks are the game's dark-theme values.
	var style = document.createElement("style");
	style.textContent = [
		".area-lookup-active canvas { cursor: crosshair !important; }",
		".area-lookup-popup { position: fixed; z-index: 99999; min-width: 230px; max-width: 360px;",
		"  max-height: calc(100vh - 24px); overflow-y: auto;",
		"  background: hsl(var(--popover, 0 0% 3.9%)); color: hsl(var(--popover-foreground, 0 0% 98%));",
		"  border: 1px solid hsl(var(--border, 0 0% 14.9%)); border-radius: var(--radius, 0.5rem);",
		"  box-shadow: 0 10px 15px -3px rgba(0,0,0,0.25), 0 4px 6px -4px rgba(0,0,0,0.25);",
		"  font-size: 13px; line-height: 1.4; padding: 10px 12px; }",
		".area-lookup-popup svg { display: block; flex-shrink: 0; }",
		".area-lookup-popup h4 { margin: 0 0 6px; font-size: 15px; font-weight: 600; display: flex;",
		"  justify-content: space-between; align-items: center; gap: 8px; }",
		".area-lookup-popup .al-title { display: flex; align-items: center; gap: 6px; min-width: 0; }",
		".area-lookup-popup .al-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 2px 0; }",
		".area-lookup-popup .al-label { color: hsl(var(--muted-foreground, 0 0% 63.9%)); font-size: 11px; text-transform: uppercase; }",
		".area-lookup-popup .al-dist { color: hsl(var(--muted-foreground, 0 0% 63.9%)); font-size: 11px; }",
		".area-lookup-popup button.al-btn { background: transparent; color: inherit;",
		"  border: 1px solid hsl(var(--border, 0 0% 14.9%)); border-radius: calc(var(--radius, 0.5rem) - 2px);",
		"  padding: 3px 8px; cursor: pointer; font-size: 12px; white-space: nowrap; }",
		".area-lookup-popup button.al-icon-btn { background: transparent; color: hsl(var(--muted-foreground, 0 0% 63.9%));",
		"  border: 0; border-radius: calc(var(--radius, 0.5rem) - 2px); padding: 5px; cursor: pointer; }",
		".area-lookup-popup button.al-btn:hover, .area-lookup-popup button.al-icon-btn:hover {",
		"  background: hsl(var(--accent, 0 0% 14.9%)); color: hsl(var(--accent-foreground, 0 0% 98%)); }",
		".area-lookup-popup .al-icon-swap { position: relative; display: block; width: 14px; height: 14px; }",
		".area-lookup-popup .al-icon-swap svg { position: absolute; inset: 0; transition: opacity 200ms ease; }",
		".area-lookup-popup .al-icon-swap .al-check { opacity: 0; }",
		".area-lookup-popup .al-copied .al-copy { opacity: 0; }",
		".area-lookup-popup .al-copied .al-check { opacity: 1; }",
		".area-lookup-popup .al-section { margin: 10px 0 4px; padding-top: 8px; font-size: 11px; font-weight: 600; text-transform: uppercase;",
		"  color: hsl(var(--muted-foreground, 0 0% 63.9%)); border-top: 1px solid hsl(var(--border, 0 0% 14.9%)); }",
		".area-lookup-popup .al-station-info { min-width: 0; flex: 1; }",
		".area-lookup-popup .al-warn { color: #f59e0b; font-size: 11px; }",
		".area-lookup-popup .al-rename-slot { width: 170px; flex-shrink: 0; }",
		".area-lookup-popup .al-split { display: flex; }",
		".area-lookup-popup .al-split[hidden], .area-lookup-popup .al-caret[hidden] { display: none; }",
		".area-lookup-popup button.al-rename { flex: 1; min-height: 42px; white-space: normal; text-align: center; }",
		".area-lookup-popup .al-split button.al-rename:not(:last-child) { border-top-right-radius: 0; border-bottom-right-radius: 0; }",
		".area-lookup-popup button.al-caret { width: 26px; padding: 0; display: flex; align-items: center; justify-content: center;",
		"  border-left: 0; border-top-left-radius: 0; border-bottom-left-radius: 0; }",
		".area-lookup-popup .al-edit { display: flex; align-items: center; gap: 4px; min-height: 42px; }",
		".area-lookup-popup .al-edit-input { flex: 1; min-width: 0; font: inherit; font-size: 12px; color: inherit;",
		"  background: hsl(var(--background, 0 0% 3.9%)); border: 1px solid hsl(var(--border, 0 0% 14.9%));",
		"  border-radius: calc(var(--radius, 0.5rem) - 2px); padding: 5px 6px; outline: none; }",
		".area-lookup-popup .al-edit-input:focus { border-color: hsl(var(--ring, 0 0% 83.1%)); }",
		".area-lookup-popup .al-menu { position: fixed; z-index: 100000; min-width: 200px; max-width: 280px; padding: 4px;",
		"  background: hsl(var(--popover, 0 0% 3.9%)); color: hsl(var(--popover-foreground, 0 0% 98%));",
		"  border: 1px solid hsl(var(--border, 0 0% 14.9%)); border-radius: calc(var(--radius, 0.5rem) - 2px);",
		"  box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3), 0 4px 6px -4px rgba(0,0,0,0.3); }",
		".area-lookup-popup button.al-menu-item { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px;",
		"  padding: 6px 8px; background: transparent; border: 0; color: inherit; font: inherit; font-size: 13px; text-align: left;",
		"  border-radius: calc(var(--radius, 0.5rem) - 4px); cursor: pointer; }",
		".area-lookup-popup button.al-menu-item:hover { background: hsl(var(--accent, 0 0% 14.9%)); color: hsl(var(--accent-foreground, 0 0% 98%)); }",
		".area-lookup-popup .al-menu-name { display: flex; align-items: center; gap: 6px; min-width: 0; }",
		".area-lookup-popup .al-menu-mark { width: 14px; height: 14px; flex-shrink: 0; }",
		".area-lookup-popup .al-menu-tag { color: hsl(var(--muted-foreground, 0 0% 63.9%)); font-size: 11px; white-space: nowrap; }",
		".area-lookup-popup .al-menu-sep { height: 1px; margin: 4px 0; background: hsl(var(--border, 0 0% 14.9%)); }",
		".area-lookup-popup button.al-btn:disabled { opacity: 0.5; cursor: default; background: transparent; color: inherit; }",
		".area-lookup-popup .al-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }",
		".area-lookup-popup .al-muted { color: hsl(var(--muted-foreground, 0 0% 63.9%)); font-size: 11px; margin-top: 6px; }"
	].join("\n");
	document.head.appendChild(style);
	cleanups.push(function () { style.remove(); });

	// ---------- helpers ----------
	function el(tag, cls, text) {
		var e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text; // textContent: never inject HTML from map data
		return e;
	}

	// Lucide icon shapes, copied from the game's bundled Lucide icons so they
	// match its toolbar and panels exactly.
	var ICONS = {
		mapPin: [
			["path", { d: "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" }],
			["circle", { cx: "12", cy: "10", r: "3" }]
		],
		copy: [
			["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }],
			["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }]
		],
		check: [["path", { d: "M20 6 9 17l-5-5" }]],
		x: [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]],
		chevronDown: [["path", { d: "m6 9 6 6 6-6" }]],
		pencil: [
			["path", { d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }],
			["path", { d: "m15 5 4 4" }]
		]
	};
	var SVG_NS = "http://www.w3.org/2000/svg";
	function icon(name, size) {
		var svg = document.createElementNS(SVG_NS, "svg");
		var attrs = {
			width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
			"stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true"
		};
		Object.keys(attrs).forEach(function (k) { svg.setAttribute(k, attrs[k]); });
		ICONS[name].forEach(function (node) {
			var child = document.createElementNS(SVG_NS, node[0]);
			Object.keys(node[1]).forEach(function (k) { child.setAttribute(k, node[1][k]); });
			svg.appendChild(child);
		});
		return svg;
	}
	function setIcon(button, name, size) {
		button.textContent = "";
		button.appendChild(icon(name, size));
	}

	function copyText(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text).then(function () { return true; }, function (err) {
				console.warn(TAG + " clipboard API failed, trying fallback", err);
				return legacyCopy(text);
			});
		}
		return Promise.resolve(legacyCopy(text));
	}
	function legacyCopy(text) {
		var ta = document.createElement("textarea");
		ta.value = text;
		document.body.appendChild(ta);
		ta.select();
		var ok = false;
		try { ok = document.execCommand("copy"); } catch (e) {}
		ta.remove();
		return ok;
	}

	function notify(msg, type) {
		try { api.ui.showNotification(msg, type || "info", "Area Lookup"); }
		catch (e) { console.log(TAG + " " + msg); }
	}

	function distanceKm(aLng, aLat, bLng, bLat) {
		var rad = Math.PI / 180;
		var x = (bLng - aLng) * rad * Math.cos(((aLat + bLat) / 2) * rad);
		var y = (bLat - aLat) * rad;
		return Math.sqrt(x * x + y * y) * 6371;
	}

	function formatDistance(km) {
		return km < 1 ? Math.round(km * 1000) + " m away" : km.toFixed(1) + " km away";
	}

	// ---------- basemap place labels ----------
	// Source layers that carry place names, per basemap schema. A fixed tier
	// means every feature in that layer is that tier; null means read the
	// feature's kind/class property.
	var PLACE_LAYERS = {
		neighborhood_labels: "neighbourhood",
		suburb_labels: "suburb",
		city_labels: "city",
		places: null,      // protomaps
		place: null,       // openmaptiles
		place_label: null  // mapbox
	};
	var KIND_TO_TIER = {
		neighbourhood: "neighbourhood", neighborhood: "neighbourhood", quarter: "neighbourhood",
		suburb: "suburb", borough: "suburb", district: "suburb",
		city: "city", town: "city", village: "city", locality: "city"
	};
	var TIERS = [
		["neighbourhood", "Neighborhood"],
		["suburb", "District / Borough"],
		["city", "City / Town"]
	];

	// Find which vector source(s) and source-layers in the current style hold place labels.
	function findPlaceLayers(map) {
		var style = map.getStyle() || {};
		var found = [];
		var seen = {};
		(style.layers || []).forEach(function (l) {
			var sl = l["source-layer"];
			if (!l.source || !sl || !(sl in PLACE_LAYERS)) return;
			var key = l.source + "|" + sl;
			if (seen[key]) return;
			seen[key] = true;
			found.push({ source: l.source, sourceLayer: sl, tier: PLACE_LAYERS[sl] });
		});
		return found;
	}

	function featureName(props) {
		return props["name:en"] || props.name_en || props.name || props["pmap:name"] || props.label || null;
	}

	function featurePoint(f) {
		var g = f.geometry;
		if (!g) return null;
		if (g.type === "Point") return g.coordinates;
		if (g.type === "MultiPoint") return g.coordinates[0];
		return null;
	}

	function lookupPlaces(map, lng, lat, quiet) {
		var layers = findPlaceLayers(map);
		if (!layers.length) console.warn(TAG + " no place-label layers found in map style");
		var best = { neighbourhood: {}, suburb: {}, city: {} }; // tier -> name -> distance

		layers.forEach(function (pl) {
			var feats;
			try {
				feats = map.querySourceFeatures(pl.source, { sourceLayer: pl.sourceLayer });
			} catch (e) {
				console.warn(TAG + " querySourceFeatures failed for " + pl.sourceLayer, e);
				return;
			}
			if (!loggedSample && feats.length) {
				loggedSample = true;
				console.log(TAG + " sample feature from " + pl.sourceLayer, feats[0].properties, feats[0].geometry && feats[0].geometry.type);
			}
			feats.forEach(function (f) {
				var props = f.properties || {};
				var tier = pl.tier || KIND_TO_TIER[String(props.kind || props["class"] || props.type || "").toLowerCase()];
				var name = featureName(props);
				var pt = featurePoint(f);
				if (!tier || !name || !pt) return;
				var d = distanceKm(lng, lat, pt[0], pt[1]);
				if (d > MAX_DISTANCE_KM[tier]) return;
				if (best[tier][name] == null || d < best[tier][name]) best[tier][name] = d;
			});
		});

		var result = {};
		TIERS.forEach(function (t) {
			var map = best[t[0]];
			result[t[0]] = Object.keys(map)
				.map(function (n) { return { name: n, km: map[n] }; })
				.sort(function (a, b) { return a.km - b.km; })
				.slice(0, 3);
		});
		if (!quiet) console.log(TAG + " places near " + lat.toFixed(5) + ", " + lng.toFixed(5), result);
		return result;
	}

	function closestName(places) {
		var p = places.neighbourhood[0] || places.suburb[0] || places.city[0];
		return p ? p.name : null;
	}

	// ---------- stations ----------
	// A "stop" is what the player sees as one station on the map: either a
	// lone station, or a station group of 2+ stations,
	// which is renamed as a whole.
	function getStops() {
		var gs = api.gameState || {};
		var stations = (gs.getStations && gs.getStations()) || [];
		var groups = (gs.getStationGroups && gs.getStationGroups()) || [];
		var groupOf = {};
		groups.forEach(function (g) {
			if (g.stationIds && g.stationIds.length >= 2) {
				g.stationIds.forEach(function (id) { groupOf[id] = g; });
			}
		});
		var stops = [];
		var seenGroup = {};
		stations.forEach(function (s) {
			var g = groupOf[s.id];
			if (g) {
				if (seenGroup[g.id]) return;
				seenGroup[g.id] = true;
				var c = g.center || g.manualCenter || s.coords;
				if (c) stops.push({ kind: "group", id: g.id, name: g.customName || g.name || s.name, customName: g.customName == null ? null : g.customName, coords: c, count: g.stationIds.length });
			} else if (s.coords) {
				stops.push({ kind: "station", id: s.id, name: s.name, coords: s.coords });
			}
		});
		return stops;
	}

	function nearbyStops(lng, lat) {
		var all = getStops();
		var near = all
			.map(function (s) { return { stop: s, km: distanceKm(lng, lat, s.coords[0], s.coords[1]) }; })
			.filter(function (x) { return x.km <= NEARBY_STATION_KM; })
			.sort(function (a, b) { return a.km - b.km; })
			.slice(0, MAX_NEARBY_STATIONS);
		console.log(TAG + " " + near.length + " stops within " + NEARBY_STATION_KM + " km (of " + all.length + ")");
		return { near: near, all: all };
	}

	// Returns true only when the game confirms the rename. In some game modes
	// the API's actions are replaced with no-ops that return undefined.
	function renameStop(stop, newName) {
		var actions = api.actions || {};
		var fn = stop.kind === "group" ? actions.renameStationGroup : actions.renameStation;
		if (typeof fn !== "function") {
			console.warn(TAG + " rename action not available for " + stop.kind);
			return false;
		}
		var result;
		try { result = fn(stop.id, newName); } catch (e) { console.error(TAG + " rename threw", e); }
		console.log(TAG + " rename " + stop.kind + " " + stop.id + " -> " + JSON.stringify(newName) + " returned", result);
		return result === true;
	}

	// Undo restores exactly what was there: a group's custom name (null clears
	// it back to the game's default), or a station's previous name.
	function undoRename(stop) {
		return renameStop(stop, stop.kind === "group" ? stop.customName : stop.name);
	}

	// ---------- popup ----------
	function closePopup() {
		closeMenu();
		if (popup) { popup.remove(); popup = null; }
	}

	function openPopup(x, y) {
		closePopup();
		popup = el("div", "area-lookup-popup");
		popup._anchor = { x: x, y: y };
		// Keep clicks inside the popup from reaching the map/game.
		["mousedown", "mouseup", "click", "wheel"].forEach(function (t) {
			popup.addEventListener(t, function (e) { e.stopPropagation(); });
		});
		popup.addEventListener("scroll", closeMenu);
		document.body.appendChild(popup);
		return popup;
	}

	// Place the panel just below-right of the click, nudged so it stays fully
	// on screen now that its height depends on how many stations are listed.
	function placePopup(p) {
		var a = p._anchor, margin = 12;
		var left = a.x + margin, top = a.y + margin;
		if (left + p.offsetWidth > window.innerWidth - margin) left = Math.max(margin, a.x - margin - p.offsetWidth);
		if (top + p.offsetHeight > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - margin - p.offsetHeight);
		p.style.left = left + "px";
		p.style.top = top + "px";
	}

	function nameRow(label, place) {
		var row = el("div", "al-row");
		var txt = el("div");
		txt.appendChild(el("div", "al-label", label));
		var line = el("div", null, place.name + " ");
		line.appendChild(el("span", "al-dist", "· " + formatDistance(place.km)));
		txt.appendChild(line);
		row.appendChild(txt);
		var b = el("button", "al-icon-btn");
		b.title = "Copy";
		b.setAttribute("aria-label", "Copy " + place.name);
		// Both icons sit stacked in one box; the al-copied class cross-fades them.
		var swap = el("span", "al-icon-swap");
		var copyIcon = icon("copy", 14);
		var checkIcon = icon("check", 14);
		copyIcon.setAttribute("class", "al-copy");
		checkIcon.setAttribute("class", "al-check");
		swap.appendChild(copyIcon);
		swap.appendChild(checkIcon);
		b.appendChild(swap);
		var resetTimer = null;
		b.onclick = function () {
			copyText(place.name).then(function (ok) {
				if (!ok) { b.title = "Copy failed"; return; }
				b.classList.add("al-copied");
				b.title = "Copied";
				clearTimeout(resetTimer);
				resetTimer = setTimeout(function () { b.classList.remove("al-copied"); b.title = "Copy"; }, COPIED_MS);
			});
		};
		row.appendChild(b);
		return row;
	}

	function render(p, lat, lng, zoom, places) {
		p.textContent = "";
		var nearest = places.neighbourhood[0] || places.suburb[0] || places.city[0];
		var head = el("h4");
		var title = el("span", "al-title");
		title.appendChild(icon("mapPin", 16));
		title.appendChild(el("span", null, nearest ? nearest.name : "No names found"));
		head.appendChild(title);
		var x = el("button", "al-icon-btn");
		x.title = "Close";
		x.setAttribute("aria-label", "Close");
		setIcon(x, "x", 14);
		x.onclick = closePopup;
		head.appendChild(x);
		p.appendChild(head);

		TIERS.forEach(function (t) {
			var list = places[t[0]];
			if (list[0]) p.appendChild(nameRow(t[1], list[0]));
		});
		var others = places.neighbourhood.slice(1);
		if (others.length) {
			others.forEach(function (o) { p.appendChild(nameRow("Also nearby", o)); });
		}
		if (!places.neighbourhood.length) {
			p.appendChild(el("div", "al-muted", "No neighborhood labels loaded here. Try zooming in a bit and clicking again."));
		}

		var actions = el("div", "al-actions");
		var gmaps = "https://www.google.com/maps/@?api=1&map_action=map&center=" +
			lat.toFixed(6) + "," + lng.toFixed(6) + "&zoom=" + Math.max(3, Math.min(21, Math.round(zoom)));
		var open = el("button", "al-btn", "Open in Google Maps");
		open.onclick = function () { openExternal(gmaps); };
		actions.appendChild(open);
		var copyLink = el("button", "al-btn", "Copy link");
		copyLink.onclick = function () {
			copyText(gmaps).then(function (ok) { copyLink.textContent = ok ? "Link copied" : "Failed"; });
		};
		actions.appendChild(copyLink);
		p.appendChild(actions);

		p.appendChild(el("div", "al-muted", lat.toFixed(5) + ", " + lng.toFixed(5)));

		var map = attachedMap || api.utils.getMap();
		var stops = nearbyStops(lng, lat);
		if (map && stops.near.length) {
			p.appendChild(el("div", "al-section", "Nearby stations"));
			stops.near.forEach(function (item) { p.appendChild(stationRow(map, item, stops.all)); });
		}
		placePopup(p);
	}

	function sameName(a, b) {
		return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
	}

	// Names offered for one station, from its own location: its closest few
	// neighborhoods, then its district and city. The first is the default.
	function candidateNames(places) {
		var out = [];
		function add(list, label) {
			list.forEach(function (p) {
				if (!out.some(function (c) { return sameName(c.name, p.name); })) out.push({ name: p.name, label: label });
			});
		}
		add(places.neighbourhood, "Neighborhood");
		add(places.suburb.slice(0, 1), "District");
		add(places.city.slice(0, 1), "City");
		return out;
	}

	// ---------- rename menu ----------
	var openMenu = null;
	function closeMenu() {
		if (!openMenu) return;
		openMenu.el.remove();
		document.removeEventListener("mousedown", openMenu.onOutside, true);
		openMenu = null;
	}

	// items: [{ name, label, current }] plus a trailing "Edit name…" entry.
	function showMenu(anchor, items, onPick, onEdit) {
		closeMenu();
		var menu = el("div", "al-menu");
		menu.setAttribute("role", "menu");
		items.forEach(function (it) {
			var b = el("button", "al-menu-item");
			b.setAttribute("role", "menuitem");
			var left = el("span", "al-menu-name");
			var mark = el("span", "al-menu-mark");
			if (it.current) mark.appendChild(icon("check", 14));
			left.appendChild(mark);
			left.appendChild(el("span", null, it.name));
			b.appendChild(left);
			b.appendChild(el("span", "al-menu-tag", it.label));
			b.onclick = function () { closeMenu(); onPick(it.name); };
			menu.appendChild(b);
		});
		menu.appendChild(el("div", "al-menu-sep"));
		var edit = el("button", "al-menu-item");
		edit.setAttribute("role", "menuitem");
		var editLeft = el("span", "al-menu-name");
		var editMark = el("span", "al-menu-mark");
		editMark.appendChild(icon("pencil", 14));
		editLeft.appendChild(editMark);
		editLeft.appendChild(el("span", null, "Edit name…"));
		edit.appendChild(editLeft);
		edit.onclick = function () { closeMenu(); onEdit(); };
		menu.appendChild(edit);

		popup.appendChild(menu);
		// Fixed positioning so the popup's scroll area can't clip the menu.
		var r = anchor.getBoundingClientRect(), margin = 8;
		var left = Math.max(margin, r.right - menu.offsetWidth);
		var top = r.bottom + 4;
		if (top + menu.offsetHeight > window.innerHeight - margin) top = Math.max(margin, r.top - 4 - menu.offsetHeight);
		menu.style.left = left + "px";
		menu.style.top = top + "px";

		var onOutside = function (e) {
			if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu();
		};
		document.addEventListener("mousedown", onOutside, true);
		openMenu = { el: menu, anchor: anchor, onOutside: onOutside };
	}

	// One nearby station: its name, distance, and a split button. The main
	// part renames to the chosen name (by default the place closest to the
	// station itself, not to the click); the arrow opens a menu of other
	// nearby names plus "Edit name…" for typing a custom one.
	function stationRow(map, item, allStops) {
		var stop = item.stop;
		var originalName = stop.name || "Unnamed station";
		var candidates = candidateNames(lookupPlaces(map, stop.coords[0], stop.coords[1], true));
		var choice = candidates.length ? candidates[0].name : null;

		var row = el("div", "al-row");
		var info = el("div", "al-station-info");
		var nameEl = el("div", null, originalName);
		info.appendChild(nameEl);
		info.appendChild(el("div", "al-dist", formatDistance(item.km) +
			(stop.kind === "group" ? " · " + stop.count + " stations" : "")));
		var warnEl = el("div", "al-warn");
		info.appendChild(warnEl);
		row.appendChild(info);

		var slot = el("div", "al-rename-slot");
		var split = el("div", "al-split");
		var btn = el("button", "al-btn al-rename");
		var caret = el("button", "al-btn al-caret");
		caret.title = "Choose a different name";
		caret.setAttribute("aria-label", "Choose a different name for " + originalName);
		caret.setAttribute("aria-haspopup", "menu");
		caret.appendChild(icon("chevronDown", 14));
		split.appendChild(btn);
		split.appendChild(caret);
		slot.appendChild(split);
		row.appendChild(slot);

		var undoTimer = null;
		function updateWarn() {
			var taken = choice && !sameName(nameEl.textContent, choice) &&
				allStops.some(function (s) { return s !== stop && sameName(s.name, choice); });
			warnEl.textContent = taken ? "Another station is already named " + choice : "";
		}
		function show(state) {
			btn.onclick = null;
			btn.disabled = false;
			caret.hidden = state === "undo";
			if (state === "undo") {
				btn.textContent = "Undo";
				btn.onclick = onUndo;
			} else if (!choice) {
				btn.disabled = true;
				btn.textContent = "No name found";
			} else if (sameName(nameEl.textContent, choice)) {
				btn.disabled = true;
				btn.textContent = "Named " + choice;
			} else {
				btn.textContent = "Rename to " + choice;
				btn.onclick = function () { doRename(choice); };
			}
			updateWarn();
		}
		function doRename(newName) {
			if (!renameStop(stop, newName)) return renameFailed();
			choice = newName;
			nameEl.textContent = newName;
			show("undo");
			clearTimeout(undoTimer);
			undoTimer = setTimeout(function () { show("normal"); }, UNDO_MS);
		}
		function onUndo() {
			clearTimeout(undoTimer);
			if (!undoRename(stop)) return renameFailed();
			nameEl.textContent = originalName;
			show("normal");
		}
		function renameFailed() {
			notify("The game didn't allow that rename. Renaming may be turned off in this game mode.", "error");
		}

		caret.onclick = function () {
			if (openMenu && openMenu.anchor === caret) return closeMenu();
			showMenu(caret, candidates.map(function (c) {
				return { name: c.name, label: c.label, current: sameName(c.name, nameEl.textContent) };
			}), doRename, startEdit);
		};

		// Inline editor: replaces the split button with a text box prefilled
		// with the current choice. Enter renames, Esc or clicking away cancels.
		function startEdit() {
			split.hidden = true;
			var form = el("div", "al-edit");
			var input = el("input", "al-edit-input");
			input.type = "text";
			input.value = choice || nameEl.textContent;
			input.setAttribute("aria-label", "New name for " + originalName);
			var ok = el("button", "al-icon-btn");
			ok.title = "Rename";
			ok.setAttribute("aria-label", "Rename");
			ok.appendChild(icon("check", 14));
			form.appendChild(input);
			form.appendChild(ok);
			slot.appendChild(form);

			var done = false;
			function finish(commit) {
				if (done) return;
				done = true;
				var value = input.value.trim();
				form.remove();
				split.hidden = false;
				if (commit && value && !sameName(value, nameEl.textContent)) doRename(value);
				else show("normal");
			}
			// Keep keystrokes away from the game's shortcuts while typing.
			["keydown", "keyup", "keypress"].forEach(function (t) {
				input.addEventListener(t, function (e) { e.stopPropagation(); });
			});
			input.addEventListener("keydown", function (e) {
				if (e.key === "Enter") { e.preventDefault(); finish(true); }
				else if (e.key === "Escape") { e.preventDefault(); finish(false); }
			});
			input.addEventListener("blur", function () { finish(false); });
			ok.addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep focus so blur doesn't cancel
			ok.onclick = function () { finish(true); };
			input.focus();
			input.select();
		}

		show("normal");
		return row;
	}

	// The game exposes its own "open in system browser" bridge (used for its
	// Discord/docs links). window.open only spawns a blank in-game window.
	function openExternal(url) {
		var bridge = window.electron && window.electron.openExternalUrl;
		if (typeof bridge !== "function") {
			console.warn(TAG + " window.electron.openExternalUrl not available");
			fallbackCopy(url);
			return;
		}
		Promise.resolve()
			.then(function () { return bridge(url); })
			.then(function (result) {
				console.log(TAG + " openExternalUrl returned", result);
				if (result === false || (result && result.success === false)) fallbackCopy(url);
			}, function (err) {
				console.warn(TAG + " openExternalUrl failed", err);
				fallbackCopy(url);
			});
	}
	function fallbackCopy(url) {
		copyText(url).then(function (ok) {
			notify(ok ? "Couldn't open a browser, so the link was copied instead." : "Couldn't open a browser or copy the link.", "warning");
		});
	}

	// ---------- map interaction ----------
	function handleMapClick(map, e) {
		var rect = map.getCanvas().getBoundingClientRect();
		var lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
		var lat = lngLat.lat, lng = lngLat.lng, zoom = map.getZoom();
		console.log(TAG + " click at " + lat.toFixed(5) + ", " + lng.toFixed(5) + " (zoom " + zoom.toFixed(1) + ")");
		var places;
		try {
			places = lookupPlaces(map, lng, lat);
		} catch (err) {
			console.error(TAG + " lookup failed", err);
			places = { neighbourhood: [], suburb: [], city: [] };
		}
		render(openPopup(e.clientX, e.clientY), lat, lng, zoom, places);
	}

	function attach(map) {
		if (!map || map === attachedMap) return;
		attachedMap = map;
		var container = map.getContainer();
		var downAt = null;

		// Capture phase on the map container runs before MapLibre's own
		// listeners, so while active we can swallow the click and keep the
		// game from treating it as a build/select click. Dragging still pans.
		function onDown(e) { downAt = active ? { x: e.clientX, y: e.clientY } : null; }
		function onClick(e) {
			if (!active || !downAt) return;
			var moved = Math.abs(e.clientX - downAt.x) + Math.abs(e.clientY - downAt.y);
			downAt = null;
			if (moved > 5) return; // that was a pan, not a click
			e.stopPropagation();
			e.preventDefault();
			handleMapClick(map, e);
		}
		container.addEventListener("mousedown", onDown, true);
		container.addEventListener("click", onClick, true);
		cleanups.push(function () {
			container.removeEventListener("mousedown", onDown, true);
			container.removeEventListener("click", onClick, true);
			container.classList.remove("area-lookup-active");
		});
		console.log(TAG + " attached to map");
	}

	function setActive(on, quiet) {
		active = on;
		var map = attachedMap || api.utils.getMap();
		if (map) {
			attach(map);
			map.getContainer().classList.toggle("area-lookup-active", on);
		}
		if (!on) closePopup();
		console.log(TAG + " mode " + (on ? "ON" : "OFF"));
		if (!quiet) notify(on ? "Click the map to see area names. Press Esc to stop." : "Area lookup off.", "info");
	}

	// Leaving the game (e.g. Exit to main menu) doesn't remove our panel,
	// since it lives on document.body, so tear everything down ourselves.
	// The game routes with the URL hash (#/game?city=... while playing).
	function shutDown(reason) {
		if (!active && !popup) return;
		console.log(TAG + " closing: " + reason);
		setActive(false, true);
	}
	function onRouteChange() {
		if (!/^#\/game(?:[/?]|$)/.test(location.hash)) shutDown("left game (" + location.hash + ")");
	}
	window.addEventListener("hashchange", onRouteChange);
	window.addEventListener("popstate", onRouteChange);
	cleanups.push(function () {
		window.removeEventListener("hashchange", onRouteChange);
		window.removeEventListener("popstate", onRouteChange);
	});

	// Capture phase on window runs before the game's own Esc handling (which
	// opens the options menu). When Esc closes something of ours, we swallow
	// it so the game never sees it; otherwise it passes through untouched.
	function onKey(e) {
		if (e.key !== "Escape") return;
		// The inline name editor handles its own Esc (cancel edit).
		if (popup && popup.contains(e.target) && e.target.tagName === "INPUT") return;
		if (openMenu) closeMenu();
		else if (popup) closePopup();
		else if (active) setActive(false);
		else return;
		e.preventDefault();
		e.stopImmediatePropagation();
	}
	window.addEventListener("keydown", onKey, true);
	cleanups.push(function () { window.removeEventListener("keydown", onKey, true); closePopup(); });

	// ---------- UI ----------
	function ensureUI() {
		try { api.ui.unregisterComponent("top-bar", BUTTON_ID); } catch (e) {}
		try {
			api.ui.addToolbarButton({
				id: BUTTON_ID,
				icon: "MapPinned",
				tooltip: "Area Lookup",
				onClick: function () { setActive(!active); },
				isActive: function () { return active; }
			});
		} catch (err) {
			console.error(TAG + " addToolbarButton failed", err);
		}
		var map = api.utils.getMap();
		if (map) attach(map);
	}

	// Hot reload doesn't clear onMapReady callbacks, so stale copies of this
	// mod must ignore them.
	var myGen = w.__areaLookupGen = (w.__areaLookupGen || 0) + 1;
	function isCurrent() { return w.__areaLookupGen === myGen; }
	api.hooks.onMapReady(function (map) { if (isCurrent()) { attach(map); ensureUI(); } });
	api.hooks.onGameLoaded(function () { if (isCurrent()) ensureUI(); });
	api.hooks.onGameEnd(function () { if (isCurrent()) shutDown("game ended"); });
	ensureUI();

	// Console helpers for testing.
	w.AreaLookup = {
		toggle: function () { setActive(!active); },
		layers: function () { var m = api.utils.getMap(); return m ? findPlaceLayers(m) : null; },
		here: function () {
			var m = api.utils.getMap();
			if (!m) return null;
			var c = m.getCenter();
			return lookupPlaces(m, c.lng, c.lat);
		},
		openTest: function () { openExternal("https://www.openstreetmap.org/"); }
	};
})();
