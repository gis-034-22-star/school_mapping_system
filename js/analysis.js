/* =========================================
   ANALYSIS TOOLS
   1. School comparison
   2. Area (concentration) analysis
   3. Coverage analysis (underserved areas)

   Uses the globals from main.js: map, schoolMarkers,
   haversineKm(), escapeHtml(), hideNearbyPanel(), LILONGWE.
   All distances are straight-line (haversine) distances in km.
========================================= */
(function () {
    "use strict";

    var NEIGH_KM = 2;                       /* "nearby" distance used in the comparison */
    var SLOT_COLORS = ["#0d6efd", "#dc3545", "#198754", "#fd7e14"];
    var MAX_COMPARE = 4;

    var overlay = null;                     /* Leaflet layer group for the current analysis */
    var mode = null;                        /* "compare" | "area" | "coverage" */
    var compareIdx = [];                    /* indexes into schoolMarkers */

    /* ------------------------------------------------------------
       Small helpers
    ------------------------------------------------------------ */
    function $(id) { return document.getElementById(id); }
    function esc(t) { return escapeHtml(t == null ? "" : String(t)); }
    function fmt(n, d) { return Number(n).toFixed(d == null ? 1 : d); }
    function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

    function allSchools() {
        return schoolMarkers.map(function (i) { return i.school; });
    }

    function dist(a, b) {
        return haversineKm(Number(a.latitude), Number(a.longitude),
                           Number(b.latitude), Number(b.longitude));
    }

    function ready() {
        if (typeof map === "undefined" || !map || schoolMarkers.length === 0) {
            alert("The schools are still loading. Please try again in a moment.");
            return false;
        }
        return true;
    }

    /* ------------------------------------------------------------
       Panel + overlay handling
    ------------------------------------------------------------ */
    function openPanel(title, wide) {
        if (typeof hideNearbyPanel === "function") hideNearbyPanel();
        $("analysisTitle").textContent = title;
        $("analysisPanel").classList.toggle("wide", !!wide);
        $("analysisPanel").classList.remove("d-none");
    }

    function clearOverlay() {
        if (overlay && map) map.removeLayer(overlay);
        overlay = null;
    }

    function newOverlay() {
        clearOverlay();
        overlay = L.layerGroup().addTo(map);
        return overlay;
    }

    function closePanel() {
        $("analysisPanel").classList.add("d-none");
        clearOverlay();
        mode = null;
    }

    function fitWithPanel(bounds) {
        var desktop = window.innerWidth >= 768;
        map.fitBounds(bounds, {
            paddingTopLeft: [40, 40],
            paddingBottomRight: [desktop ? 460 : 40, 40],
            maxZoom: 16
        });
    }

    /* ------------------------------------------------------------
       Category filter (level / ownership / type, built from the data)
    ------------------------------------------------------------ */
    function distinct(field) {
        var seen = {};
        allSchools().forEach(function (s) {
            var v = (s[field] || "").trim();
            if (v) seen[v] = true;
        });
        return Object.keys(seen).sort();
    }

    function categoryOptionsHtml() {
        var html = '<option value="all">All schools</option>';
        [["level", "Level"], ["ownership", "Ownership"], ["type", "Type"]].forEach(function (g) {
            distinct(g[0]).forEach(function (v) {
                html += '<option value="' + esc(g[0] + "|" + v) + '">' + g[1] + ": " + esc(v) + "</option>";
            });
        });
        return html;
    }

    function categoryFilter(value) {
        if (!value || value === "all") return function () { return true; };
        var p = value.split("|");
        return function (s) { return (s[p[0]] || "").trim() === p[1]; };
    }

    function categoryLabel(value) {
        if (!value || value === "all") return "school";
        var v = value.split("|")[1];
        return v.toLowerCase().replace(/ school$/, "") + " school";
    }

    /* ------------------------------------------------------------
       Geometry: convex hull (study area) + point-in-polygon
    ------------------------------------------------------------ */
    function convexHull(points) {                       /* points: [lng, lat] */
        var pts = points.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
        if (pts.length < 3) return pts;
        function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
        var lower = [], upper = [], i;
        for (i = 0; i < pts.length; i++) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
            lower.push(pts[i]);
        }
        for (i = pts.length - 1; i >= 0; i--) {
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
            upper.push(pts[i]);
        }
        lower.pop(); upper.pop();
        return lower.concat(upper);
    }

    function inPolygon(x, y, poly) {                    /* x = lng, y = lat */
        var inside = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }

    /* Grid over the extent of ALL schools; cells are about cellKm x cellKm */
    function makeGrid(schools, cellKm) {
        var lats = schools.map(function (s) { return Number(s.latitude); });
        var lngs = schools.map(function (s) { return Number(s.longitude); });
        var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
        var minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
        var midLat = (minLat + maxLat) / 2;
        var latStep = cellKm / 110.574;
        var lngStep = cellKm / (111.320 * Math.cos(midLat * Math.PI / 180));
        var rows = Math.floor((maxLat - minLat) / latStep) + 1;
        var cols = Math.floor((maxLng - minLng) / lngStep) + 1;
        var hull = convexHull(schools.map(function (s) { return [Number(s.longitude), Number(s.latitude)]; }));
        return {
            minLat: minLat, minLng: minLng, latStep: latStep, lngStep: lngStep,
            rows: rows, cols: cols, hull: hull, cellKm: cellKm,
            bounds: function (r, c) {
                var s = minLat + r * latStep, w = minLng + c * lngStep;
                return [[s, w], [s + latStep, w + lngStep]];
            },
            centre: function (r, c) {
                return { lat: minLat + (r + 0.5) * latStep, lng: minLng + (c + 0.5) * lngStep };
            },
            cellOf: function (s) {
                return {
                    r: Math.floor((Number(s.latitude) - minLat) / latStep),
                    c: Math.floor((Number(s.longitude) - minLng) / lngStep)
                };
            },
            inStudyArea: function (r, c) {
                var ct = this.centre(r, c);
                return inPolygon(ct.lng, ct.lat, hull);
            }
        };
    }

    function nearestSchool(lat, lng, list) {
        var best = null, bd = Infinity;
        for (var i = 0; i < list.length; i++) {
            var d = haversineKm(lat, lng, Number(list[i].latitude), Number(list[i].longitude));
            if (d < bd) { bd = d; best = list[i]; }
        }
        return { school: best, km: bd };
    }

    /* ============================================================
       1. SCHOOL COMPARISON
    ============================================================ */
    function metricsFor(s, all) {
        var m = { nearest: null, nd: Infinity, within: 0, sameLevel: 0, otherOwn: 0 };
        all.forEach(function (o) {
            if (o === s) return;
            var d = dist(s, o);
            if (d < m.nd) { m.nd = d; m.nearest = o; }
            if (d <= NEIGH_KM) {
                m.within++;
                if (o.level === s.level) m.sameLevel++;
                if (o.ownership !== s.ownership) m.otherOwn++;
            }
        });
        m.centre = haversineKm(Number(s.latitude), Number(s.longitude), LILONGWE[0], LILONGWE[1]);
        return m;
    }

    function compareRows(list, mets) {
        var first = list[0];
        return [
            { label: "Level", text: function (s) { return esc(s.level); }, key: function (s) { return s.level; } },
            { label: "Ownership", text: function (s) { return esc(s.ownership); }, key: function (s) { return s.ownership; } },
            { label: "School type", text: function (s) { return esc(s.type); }, key: function (s) { return s.type; } },
            { label: "Location", text: function (s) { return fmt(s.latitude, 4) + ", " + fmt(s.longitude, 4); }, nodiff: true },
            { label: "Distance to city centre", text: function (s, m) { return fmt(m.centre) + " km"; }, key: function (s, m) { return fmt(m.centre); } },
            { label: "Nearest other school", text: function (s, m) { return m.nearest ? esc(m.nearest.name) + " (" + fmt(m.nd, 2) + " km)" : "-"; }, key: function (s, m) { return fmt(m.nd, 1); } },
            { label: "Schools within " + NEIGH_KM + " km", text: function (s, m) { return m.within; }, key: function (s, m) { return m.within; } },
            { label: "Same-level schools within " + NEIGH_KM + " km", text: function (s, m) { return m.sameLevel; }, key: function (s, m) { return m.sameLevel; } },
            { label: "Other-ownership schools within " + NEIGH_KM + " km", text: function (s, m) { return m.otherOwn; }, key: function (s, m) { return m.otherOwn; } },
            { label: "Distance from School 1", text: function (s, m, i) { return i === 0 ? "-" : fmt(dist(first, s), 2) + " km"; }, nodiff: true }
        ];
    }

    function compareSummary(list, mets) {
        var lines = [];
        if (list.length < 2) return lines;
        var iC = 0, iN = 0, iF = 0;
        mets.forEach(function (m, i) {
            if (m.centre < mets[iC].centre) iC = i;
            if (m.within > mets[iN].within) iN = i;
            if (m.nd > mets[iF].nd) iF = i;
        });
        lines.push("<b>" + esc(list[iC].name) + "</b> is closest to the city centre (" + fmt(mets[iC].centre) + " km).");
        var tie = mets.filter(function (m) { return m.within === mets[iN].within; }).length > 1;
        if (!tie) lines.push("<b>" + esc(list[iN].name) + "</b> has the most schools within " + NEIGH_KM + " km (" + mets[iN].within + "), so parents there have more choice.");
        var isolatedTie = mets.filter(function (m) { return Math.abs(m.nd - mets[iF].nd) < 0.05; }).length > 1;
        if (!isolatedTie) lines.push("<b>" + esc(list[iF].name) + "</b> is the most isolated: its nearest other school is " + fmt(mets[iF].nd, 2) + " km away.");
        var levels = {}, owns = {};
        list.forEach(function (s) { levels[s.level] = 1; owns[s.ownership] = 1; });
        if (Object.keys(levels).length > 1 || Object.keys(owns).length > 1) {
            lines.push("These schools differ in " + [Object.keys(levels).length > 1 ? "level" : "", Object.keys(owns).length > 1 ? "ownership" : ""].filter(Boolean).join(" and ") + ".");
        }
        return lines;
    }

    function drawCompareOnMap(list) {
        var g = newOverlay();
        var pts = [];
        list.forEach(function (s, i) {
            var ll = [Number(s.latitude), Number(s.longitude)];
            pts.push(ll);
            L.circleMarker(ll, { radius: 18, color: SLOT_COLORS[i], weight: 4, fillOpacity: 0.12, fillColor: SLOT_COLORS[i] })
                .bindTooltip(String(i + 1), { permanent: true, direction: "center", className: "compare-num" })
                .addTo(g);
        });
        if (pts.length >= 2) fitWithPanel(L.latLngBounds(pts));
        else if (pts.length === 1) map.setView(pts[0], 15);
    }

    function renderCompareResult() {
        var all = allSchools();
        var list = compareIdx.map(function (i) { return schoolMarkers[i].school; });
        var box = $("cmpResult");

        if (list.length === 0) {
            clearOverlay();
            box.innerHTML = '<p class="small text-muted mb-0">Type a school name above and press <b>Add</b>, or click a school on the map and choose <b>Add to comparison</b>. You can compare up to ' + MAX_COMPARE + " schools.</p>";
            return;
        }

        var mets = list.map(function (s) { return metricsFor(s, all); });
        var head = '<th style="min-width:150px"></th>' + list.map(function (s, i) {
            return '<th style="min-width:130px"><span class="badge" style="background:' + SLOT_COLORS[i] + '">' + (i + 1) + "</span> " + esc(s.name) +
                ' <button type="button" class="btn btn-sm btn-link text-danger p-0 cmp-remove" data-pos="' + i + '" title="Remove">&times;</button></th>';
        }).join("");

        var body = compareRows(list, mets).map(function (row) {
            var diff = false;
            if (!row.nodiff && list.length > 1) {
                var keys = list.map(function (s, i) { return String(row.key(s, mets[i], i)); });
                diff = keys.some(function (k) { return k !== keys[0]; });
            }
            return '<tr class="' + (diff ? "diff-row" : "") + '"><th class="fw-semibold">' + row.label + (diff ? " *" : "") + "</th>" +
                list.map(function (s, i) { return "<td>" + row.text(s, mets[i], i) + "</td>"; }).join("") + "</tr>";
        }).join("");

        var summary = compareSummary(list, mets).map(function (l) { return "<li>" + l + "</li>"; }).join("");

        box.innerHTML =
            '<div class="table-responsive"><table class="table table-sm table-bordered align-middle mb-2"><thead class="table-light"><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>" +
            '<div class="small text-muted mb-2">* highlighted rows show where the schools differ. "Within ' + NEIGH_KM + ' km" uses straight-line distance.</div>' +
            (summary ? '<div class="fw-bold small mb-1">Summary</div><ul class="small mb-2 ps-3">' + summary + "</ul>" : "") +
            '<button type="button" id="cmpClearBtn" class="btn btn-outline-secondary btn-sm">Clear comparison</button>';

        box.querySelectorAll(".cmp-remove").forEach(function (b) {
            b.addEventListener("click", function () {
                compareIdx.splice(parseInt(this.dataset.pos, 10), 1);
                renderCompareResult();
            });
        });
        $("cmpClearBtn").addEventListener("click", function () { compareIdx = []; renderCompareResult(); });

        drawCompareOnMap(list);
    }

    function findIndexByName(name) {
        var q = (name || "").trim().toLowerCase();
        if (!q) return -1;
        var exact = -1, partial = -1;
        schoolMarkers.forEach(function (it, i) {
            var n = it.school.name.trim().toLowerCase();
            if (n === q && exact < 0) exact = i;
            else if (n.indexOf(q) !== -1 && partial < 0) partial = i;
        });
        return exact >= 0 ? exact : partial;
    }

    function addCompareByInput() {
        var input = $("cmpInput");
        var idx = findIndexByName(input.value);
        if (idx < 0) { alert('School "' + input.value + '" was not found. Pick a name from the list.'); return; }
        addIdx(idx);
        input.value = "";
    }

    function addIdx(idx) {
        if (compareIdx.indexOf(idx) !== -1) return;
        if (compareIdx.length >= MAX_COMPARE) { alert("You can compare up to " + MAX_COMPARE + " schools. Remove one first."); return; }
        compareIdx.push(idx);
        renderCompareResult();
    }

    function openCompare() {
        if (!ready()) return;
        mode = "compare";
        openPanel("Compare Schools", true);
        $("analysisBody").innerHTML =
            '<div class="input-group input-group-sm mb-2">' +
            '<input id="cmpInput" class="form-control" list="schoolNames" autocomplete="off" placeholder="Type a school name">' +
            '<button id="cmpAddBtn" type="button" class="btn btn-primary">Add</button></div>' +
            '<div id="cmpResult"></div>';
        $("cmpAddBtn").addEventListener("click", addCompareByInput);
        $("cmpInput").addEventListener("keydown", function (e) { if (e.key === "Enter") addCompareByInput(); });
        renderCompareResult();
    }

    /* used by the "Add to comparison" button in a school's pop-up */
    window.addToCompare = function (idx) {
        if (!ready()) return;
        map.closePopup();
        if (mode !== "compare") openCompare();
        addIdx(idx);
    };

    /* ============================================================
       2. AREA (CONCENTRATION) ANALYSIS
    ============================================================ */
    var AREA_COLORS = { none: "#9e9e9e", low: "#9ecae1", medium: "#4292c6", high: "#08306b" };

    /* Pure calculation (no map): returns the classified grid cells */
    function computeArea(schools, selected, cellKm) {
        var g = makeGrid(schools, cellKm);
        var cells = {}, key;
        selected.forEach(function (s) {
            var rc = g.cellOf(s);
            key = rc.r + "_" + rc.c;
            if (!cells[key]) cells[key] = { r: rc.r, c: rc.c, n: 0, names: [] };
            cells[key].n++;
            cells[key].names.push(s.name);
        });
        for (var r = 0; r < g.rows; r++) {
            for (var c = 0; c < g.cols; c++) {
                key = r + "_" + c;
                if (!cells[key] && g.inStudyArea(r, c)) cells[key] = { r: r, c: c, n: 0, names: [] };
            }
        }
        var list = Object.keys(cells).map(function (k) { return cells[k]; });
        var filled = list.filter(function (x) { return x.n > 0; });
        var mean = 0, sd = 0;
        if (filled.length) {
            mean = filled.reduce(function (a, x) { return a + x.n; }, 0) / filled.length;
            sd = Math.sqrt(filled.reduce(function (a, x) { return a + Math.pow(x.n - mean, 2); }, 0) / filled.length);
        }
        list.forEach(function (x) {
            if (x.n === 0) x.cls = "none";
            else if (sd > 0 && x.n >= mean + 0.5 * sd) x.cls = "high";
            else if (x.n === 1 || (sd > 0 && x.n <= mean - 0.5 * sd)) x.cls = "low";
            else x.cls = "medium";
        });
        return { grid: g, cells: list, mean: mean, sd: sd, filled: filled.length };
    }

    function legendHtml(items) {
        return '<div class="small mb-2">' + items.map(function (i) {
            return '<span class="me-3 d-inline-block"><span class="legend-swatch" style="background:' + i[0] + ';opacity:' + (i[2] || 1) + '"></span>' + i[1] + "</span>";
        }).join("") + "</div>";
    }

    function renderAreaResult() {
        var catVal = $("areaCat").value;
        var cellKm = parseFloat($("areaCell").value);
        var all = allSchools();
        var selected = all.filter(categoryFilter(catVal));
        var out = $("areaResult");

        if (selected.length === 0) { clearOverlay(); out.innerHTML = '<p class="small text-muted">No schools in this category.</p>'; return; }

        var res = computeArea(all, selected, cellKm);
        var label = categoryLabel(catVal);
        var g = newOverlay();
        var canvas = L.canvas({ padding: 0.5 });

        res.cells.forEach(function (x) {
            var tip = "<b>" + plural(x.n, label) + "</b> in this " + cellKm + " km cell<br>" +
                (x.n === 0 ? "No schools" : (x.cls === "high" ? "High" : x.cls === "low" ? "Low" : "Medium") + " concentration");
            if (x.n > 0 && x.n <= 6) tip += "<br>" + x.names.map(esc).join("<br>");
            L.rectangle(res.grid.bounds(x.r, x.c), {
                renderer: canvas, color: "#ffffff", weight: 1,
                fillColor: AREA_COLORS[x.cls], fillOpacity: x.cls === "none" ? 0.12 : 0.6
            }).bindTooltip(tip, { sticky: true }).addTo(g);
        });
        L.polygon(res.grid.hull.map(function (p) { return [p[1], p[0]]; }),
            { renderer: canvas, color: "#333", weight: 2, dashArray: "6 6", fill: false, interactive: false }).addTo(g);
        fitWithPanel(L.latLngBounds(res.grid.hull.map(function (p) { return [p[1], p[0]]; })));

        var counts = { high: 0, medium: 0, low: 0, none: 0 };
        res.cells.forEach(function (x) { counts[x.cls]++; });
        var top = res.cells.filter(function (x) { return x.n > 0; })
            .sort(function (a, b) { return b.n - a.n; }).slice(0, 5);

        var topHtml = top.map(function (x) {
            var ct = res.grid.centre(x.r, x.c);
            return '<div class="analysis-list-item small" data-lat="' + ct.lat + '" data-lng="' + ct.lng + '"><b>' + plural(x.n, label) + "</b> near " + esc(x.names[0]) + "</div>";
        }).join("");

        out.innerHTML =
            legendHtml([[AREA_COLORS.high, "High"], [AREA_COLORS.medium, "Medium"], [AREA_COLORS.low, "Low"], [AREA_COLORS.none, "No schools", 0.4]]) +
            '<div class="small mb-2">' +
            "<b>" + plural(selected.length, label) + "</b> in " + plural(res.filled, cellKm + " km cell") + " (average " + fmt(res.mean) + " per occupied cell).<br>" +
            "<b>" + counts.high + "</b> high, <b>" + counts.medium + "</b> medium, <b>" + counts.low + "</b> low concentration cells; <b>" + counts.none + "</b> cells inside the city area have none.</div>" +
            (topHtml ? '<div class="fw-bold small mb-1">Highest concentrations (click to zoom)</div>' + topHtml : "") +
            '<p class="small text-muted mt-2 mb-0">High = above average + 0.5 SD; Low = a single school or below average - 0.5 SD. The dashed line is the study area (outline of all schools).</p>';

        out.querySelectorAll(".analysis-list-item").forEach(function (el) {
            el.addEventListener("click", function () {
                map.flyTo([parseFloat(this.dataset.lat), parseFloat(this.dataset.lng)], 14);
            });
        });
    }

    function openArea() {
        if (!ready()) return;
        mode = "area";
        openPanel("Area Concentration Analysis", false);
        $("analysisBody").innerHTML =
            '<p class="small text-muted mb-2">Finds areas with high or low concentrations of a school category. The city is split into square cells and the schools in each cell are counted.</p>' +
            '<label class="form-label small fw-bold mb-1">School category</label>' +
            '<select id="areaCat" class="form-select form-select-sm mb-2">' + categoryOptionsHtml() + "</select>" +
            '<label class="form-label small fw-bold mb-1">Cell size</label>' +
            '<select id="areaCell" class="form-select form-select-sm mb-3"><option value="1">1 km</option><option value="2" selected>2 km</option><option value="3">3 km</option></select>' +
            '<div id="areaResult"></div>';
        $("areaCat").addEventListener("change", renderAreaResult);
        $("areaCell").addEventListener("change", renderAreaResult);
        renderAreaResult();
    }

    /* ============================================================
       3. COVERAGE ANALYSIS (underserved areas)
    ============================================================ */

    /* Pure calculation (no map) */
    function computeCoverage(schools, selected, cellKm, thresholdKm) {
        var g = makeGrid(schools, cellKm);
        var cells = [];
        var grid = {};
        for (var r = 0; r < g.rows; r++) {
            for (var c = 0; c < g.cols; c++) {
                if (!g.inStudyArea(r, c)) continue;
                var ct = g.centre(r, c);
                var near = nearestSchool(ct.lat, ct.lng, selected);
                var cell = { r: r, c: c, lat: ct.lat, lng: ct.lng, d: near.km, covered: near.km <= thresholdKm };
                cells.push(cell);
                grid[r + "_" + c] = cell;
            }
        }
        /* group neighbouring underserved cells into zones (flood fill) */
        var zones = [];
        cells.forEach(function (cell) {
            if (cell.covered || cell.zone) return;
            var zone = { cells: [] }, stack = [cell];
            cell.zone = zone;
            while (stack.length) {
                var cur = stack.pop();
                zone.cells.push(cur);
                [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (dd) {
                    var nb = grid[(cur.r + dd[0]) + "_" + (cur.c + dd[1])];
                    if (nb && !nb.covered && !nb.zone) { nb.zone = zone; stack.push(nb); }
                });
            }
            zones.push(zone);
        });
        var cellArea = cellKm * cellKm;
        zones.forEach(function (z) {
            var n = z.cells.length;
            z.areaKm2 = n * cellArea;
            z.lat = z.cells.reduce(function (a, x) { return a + x.lat; }, 0) / n;
            z.lng = z.cells.reduce(function (a, x) { return a + x.lng; }, 0) / n;
            z.maxD = Math.max.apply(null, z.cells.map(function (x) { return x.d; }));
            z.nearest = nearestSchool(z.lat, z.lng, selected);
        });
        zones.sort(function (a, b) { return b.areaKm2 - a.areaKm2; });
        var under = cells.filter(function (x) { return !x.covered; }).length;
        return { grid: g, cells: cells, zones: zones, total: cells.length, under: under, cellArea: cellArea };
    }

    function renderCoverageResult() {
        var catVal = $("covCat").value;
        var thr = parseFloat($("covDist").value);
        var cellKm = parseFloat($("covCell").value);
        var all = allSchools();
        var selected = all.filter(categoryFilter(catVal));
        var out = $("covResult");

        if (selected.length === 0) { clearOverlay(); out.innerHTML = '<p class="small text-muted">No schools in this category.</p>'; return; }

        var res = computeCoverage(all, selected, cellKm, thr);
        var g = newOverlay();
        var canvas = L.canvas({ padding: 0.5 });
        var label = categoryLabel(catVal);

        res.cells.forEach(function (x) {
            var b = res.grid.bounds(x.r, x.c);
            L.rectangle(b, {
                renderer: canvas, stroke: false,
                fillColor: x.covered ? "#2e9e5b" : "#d62728",
                fillOpacity: x.covered ? 0.22 : 0.55
            }).bindTooltip(fmt(x.d, 2) + " km to the nearest " + label + (x.covered ? " (served)" : " (underserved)"), { sticky: true }).addTo(g);
        });
        L.polygon(res.grid.hull.map(function (p) { return [p[1], p[0]]; }),
            { renderer: canvas, color: "#333", weight: 2, dashArray: "6 6", fill: false, interactive: false }).addTo(g);
        selected.forEach(function (s) {
            L.circleMarker([Number(s.latitude), Number(s.longitude)], { renderer: canvas, radius: 3, color: "#000", weight: 1, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(g);
        });
        fitWithPanel(L.latLngBounds(res.grid.hull.map(function (p) { return [p[1], p[0]]; })));

        var pctCov = res.total ? 100 * (res.total - res.under) / res.total : 0;
        var zonesHtml = res.zones.slice(0, 6).map(function (z) {
            return '<div class="analysis-list-item small" data-lat="' + z.lat + '" data-lng="' + z.lng + '"><b>' + fmt(z.areaKm2, 1) + " km&sup2;</b> underserved, near " +
                esc(z.nearest.school.name) + " (" + fmt(z.nearest.km, 1) + " km away); farthest point " + fmt(z.maxD, 1) + " km from a school</div>";
        }).join("");

        out.innerHTML =
            legendHtml([["#2e9e5b", "Served (within " + thr + " km)", 0.5], ["#d62728", "Underserved (beyond " + thr + " km)", 0.7]]) +
            '<div class="small mb-2"><b>' + fmt(pctCov, 0) + "%</b> of the city area is within " + thr + " km of a " + label + ".<br>" +
            "<b>" + fmt(res.under * res.cellArea, 1) + " km&sup2;</b> (" + plural(res.zones.length, "zone") + ") is underserved.</div>" +
            (zonesHtml ? '<div class="fw-bold small mb-1">Largest underserved zones (click to zoom)</div>' + zonesHtml
                       : '<p class="small text-success mb-0">No underserved areas at this distance.</p>') +
            '<p class="small text-muted mt-2 mb-0">Based on straight-line distance from the centre of each ' + cellKm + ' km cell to the nearest school. It does not use population data, so it shows where schools are far away, not how many children live there.</p>';

        out.querySelectorAll(".analysis-list-item").forEach(function (el) {
            el.addEventListener("click", function () {
                map.flyTo([parseFloat(this.dataset.lat), parseFloat(this.dataset.lng)], 13);
            });
        });
    }

    function openCoverage() {
        if (!ready()) return;
        mode = "coverage";
        openPanel("Coverage Analysis", false);
        $("analysisBody").innerHTML =
            '<p class="small text-muted mb-2">Finds areas that may be underserved: places farther than the chosen distance from the nearest school.</p>' +
            '<label class="form-label small fw-bold mb-1">School category</label>' +
            '<select id="covCat" class="form-select form-select-sm mb-2">' + categoryOptionsHtml() + "</select>" +
            '<label class="form-label small fw-bold mb-1">Acceptable distance to a school</label>' +
            '<select id="covDist" class="form-select form-select-sm mb-2"><option value="0.5">0.5 km</option><option value="1">1 km</option><option value="2" selected>2 km</option><option value="3">3 km</option><option value="5">5 km</option></select>' +
            '<label class="form-label small fw-bold mb-1">Detail (cell size)</label>' +
            '<select id="covCell" class="form-select form-select-sm mb-3"><option value="0.5" selected>0.5 km (detailed)</option><option value="1">1 km (faster)</option></select>' +
            '<div id="covResult"></div>';
        ["covCat", "covDist", "covCell"].forEach(function (id) { $(id).addEventListener("change", renderCoverageResult); });
        renderCoverageResult();
    }

    /* ------------------------------------------------------------
       Wire up buttons
    ------------------------------------------------------------ */
    function init() {
        if (!$("analysisPanel")) return;
        L.DomEvent.disableClickPropagation($("analysisPanel"));
        L.DomEvent.disableScrollPropagation($("analysisPanel"));
        $("openCompareBtn").addEventListener("click", openCompare);
        $("openAreaBtn").addEventListener("click", openArea);
        $("openCoverageBtn").addEventListener("click", openCoverage);
        $("closeAnalysisBtn").addEventListener("click", closePanel);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();

    /* exposed for testing only */
    window.SchoolAnalysis = { computeArea: computeArea, computeCoverage: computeCoverage, convexHull: convexHull, inPolygon: inPolygon, metricsFor: metricsFor, makeGrid: makeGrid };
})();
