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
		".area-lookup-popup { position: fixed; z-index: 99999; min-width: 230px; max-width: 320px;",
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
		x: [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]]
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

	function lookupPlaces(map, lng, lat) {
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
		console.log(TAG + " places near " + lat.toFixed(5) + ", " + lng.toFixed(5), result);
		return result;
	}

	// ---------- popup ----------
	function closePopup() {
		if (popup) { popup.remove(); popup = null; }
	}

	function openPopup(x, y) {
		closePopup();
		popup = el("div", "area-lookup-popup");
		popup.style.left = Math.min(x + 12, window.innerWidth - 340) + "px";
		popup.style.top = Math.min(y + 12, window.innerHeight - 300) + "px";
		// Keep clicks inside the popup from reaching the map/game.
		["mousedown", "mouseup", "click", "wheel"].forEach(function (t) {
			popup.addEventListener(t, function (e) { e.stopPropagation(); });
		});
		document.body.appendChild(popup);
		return popup;
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

		p.appendChild(el("div", "al-muted", lat.toFixed(5) + ", " + lng.toFixed(5) + " · nearest label points from the game map"));
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

	function setActive(on) {
		active = on;
		var map = attachedMap || api.utils.getMap();
		if (map) {
			attach(map);
			map.getContainer().classList.toggle("area-lookup-active", on);
		}
		if (!on) closePopup();
		console.log(TAG + " mode " + (on ? "ON" : "OFF"));
		notify(on ? "Click the map to see area names. Press Esc to stop." : "Area lookup off.", "info");
	}

	function onKey(e) {
		if (e.key !== "Escape") return;
		if (popup) closePopup();
		else if (active) setActive(false);
	}
	window.addEventListener("keydown", onKey);
	cleanups.push(function () { window.removeEventListener("keydown", onKey); closePopup(); });

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
