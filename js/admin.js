// =========================================
// ADMIN PAGE (Supabase login + add / update / delete schools)
// =========================================
(function () {
    const $ = id => document.getElementById(id);

    // Accepts the URL however it was pasted and reduces it to https://<project-ref>.supabase.co
    function normalizeSupabaseUrl(raw) {
        let text = String(raw || "").trim().replace(/^["']+|["']+$/g, "");
        if (!text) return "";
        if (!/^https?:\/\//i.test(text)) text = "https://" + text;
        try {
            const u = new URL(text);
            // Dashboard address pasted by mistake: https://supabase.com/dashboard/project/<ref>
            const m = u.pathname.match(/\/project\/([a-z0-9]+)/i);
            if (/(^|\.)supabase\.com$/i.test(u.hostname) && m) {
                return "https://" + m[1] + ".supabase.co";
            }
            return u.origin;   // drops any extra path such as /rest/v1/ or /auth/v1
        } catch (e) {
            return "";
        }
    }

    const url = normalizeSupabaseUrl(window.SUPABASE_URL);
    const key = String(window.SUPABASE_ANON_KEY || "").trim().replace(/^["']+|["']+$/g, "");

    function warn(html) {
        const box = $("setupWarning");
        box.innerHTML = html;
        box.classList.remove("d-none");
    }

    if (!url || !key) {
        warn(
            "<strong>js/config.js has no Supabase settings.</strong> " +
            "Paste your Project URL and anon public key between the quotes, save, and upload the file. " +
            "If you already did, your browser may be showing an old copy: press <b>Ctrl + Shift + R</b>, " +
            "and check that <code>config.js</code> is inside the <code>js</code> folder on GitHub."
        );
        return;
    }

    // The Supabase library normally loads from the page; if that failed, try a second source.
    if (window.supabase) {
        start();
    } else {
        const fallback = document.createElement("script");
        fallback.src = "https://unpkg.com/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
        fallback.onload = function () {
            if (window.supabase) start();
            else warn("<strong>Could not load the Supabase library.</strong> Check your internet connection and reload.");
        };
        fallback.onerror = function () {
            warn("<strong>Could not load the Supabase library.</strong> Check your internet connection (or disable ad blockers for this page) and reload.");
        };
        document.head.appendChild(fallback);
    }

    function start() {

    const sb = window.supabase.createClient(url, key);

    let schools = [];
    let editingId = null;
    let modal = null;
    let pickMap = null;
    let pickMarker = null;

    const NO_PERMISSION =
        "Your account is not an authorised administrator, so this change was not saved. " +
        "Ask the system owner to add your email to the admins list.";

    // ---------- helpers ----------
    function say(el, text, cls) {
        el.textContent = text || "";
        el.className = "small " + (cls || "");
    }

    function isPermissionError(error) {
        if (!error) return false;
        const m = (error.message || "").toLowerCase();
        return error.code === "42501" || m.includes("row-level security") || m.includes("permission");
    }

    // ---------- login / logout ----------
    function showLogin() {
        $("loginCard").classList.remove("d-none");
        $("adminPanel").classList.add("d-none");
        $("userEmail").classList.add("d-none");
        $("signOutBtn").classList.add("d-none");
    }

    async function showPanel(user) {
        $("loginCard").classList.add("d-none");
        $("adminPanel").classList.remove("d-none");
        $("userEmail").textContent = user.email || "";
        $("userEmail").classList.remove("d-none");
        $("signOutBtn").classList.remove("d-none");
        await loadSchools();
    }

    $("loginForm").addEventListener("submit", async function (e) {
        e.preventDefault();
        const email = $("loginEmail").value.trim();
        const password = $("loginPassword").value;

        if (!email || !password) {
            say($("loginMsg"), "Enter your email and password.", "text-danger");
            return;
        }

        $("loginBtn").disabled = true;
        say($("loginMsg"), "Signing in...", "text-muted");

        const { error } = await sb.auth.signInWithPassword({ email, password });

        $("loginBtn").disabled = false;
        if (error) {
            say($("loginMsg"), "Sign-in failed: " + error.message, "text-danger");
            return;
        }
        say($("loginMsg"), "");
        $("loginPassword").value = "";
    });

    $("signOutBtn").addEventListener("click", async function () {
        await sb.auth.signOut();
    });

    let panelUserId = null;

    sb.auth.onAuthStateChange(function (_event, session) {
        if (session && session.user) {
            if (panelUserId === session.user.id) return;   // e.g. token refresh: nothing to redo
            panelUserId = session.user.id;
            // run outside the callback (supabase-js must not be awaited inside it)
            setTimeout(() => showPanel(session.user), 0);
        } else {
            panelUserId = null;
            showLogin();
        }
    });

    sb.auth.getSession().then(function ({ data }) {
        if (!data.session) showLogin();
    });

    // ---------- load + render ----------
    async function loadSchools() {
        say($("panelMsg"), "Loading schools...", "text-muted");

        const all = [];
        let from = 0;
        const size = 1000;

        while (true) {
            const { data, error } = await sb
                .from("schools")
                .select("*")
                .order("name", { ascending: true })
                .range(from, from + size - 1);

            if (error) {
                say($("panelMsg"), "Could not load schools: " + error.message, "text-danger");
                return;
            }
            all.push(...data);
            if (data.length < size) break;
            from += size;
        }

        schools = all;
        say($("panelMsg"), "");
        renderRows();
    }

    function renderRows() {
        const text = $("filterText").value.trim().toLowerCase();
        const level = $("filterLevel").value;
        const owner = $("filterOwner").value;

        const shown = schools.filter(s =>
            (!text || s.name.toLowerCase().includes(text)) &&
            (!level || s.level === level) &&
            (!owner || s.ownership === owner)
        );

        $("countLabel").textContent = `${shown.length} of ${schools.length} schools`;

        const body = $("schoolRows");
        body.innerHTML = "";

        shown.forEach(function (s) {
            const tr = document.createElement("tr");

            [s.name, s.level, s.ownership, s.type || "", s.latitude, s.longitude].forEach(function (v) {
                const td = document.createElement("td");
                td.textContent = v;
                tr.appendChild(td);
            });

            const actions = document.createElement("td");
            actions.className = "text-end text-nowrap";

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "btn btn-outline-primary btn-sm me-1";
            edit.innerHTML = '<i class="bi bi-pencil"></i> Edit';
            edit.addEventListener("click", () => openForm(s));

            const del = document.createElement("button");
            del.type = "button";
            del.className = "btn btn-outline-danger btn-sm";
            del.innerHTML = '<i class="bi bi-trash"></i> Delete';
            del.addEventListener("click", () => deleteSchool(s));

            actions.append(edit, del);
            tr.appendChild(actions);
            body.appendChild(tr);
        });

        if (shown.length === 0) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = 7;
            td.className = "text-center text-muted py-4";
            td.textContent = schools.length === 0
                ? "No schools in the database yet. Run supabase/seed.sql or add a school."
                : "No schools match your filters.";
            tr.appendChild(td);
            body.appendChild(tr);
        }
    }

    ["filterText", "filterLevel", "filterOwner"].forEach(id =>
        $(id).addEventListener("input", renderRows));

    // ---------- add / edit form ----------
    modal = new bootstrap.Modal($("schoolModal"));

    function setPin(lat, lng, pan) {
        if (!pickMap) return;
        if (!pickMarker) {
            pickMarker = L.marker([lat, lng], { draggable: true }).addTo(pickMap);
            pickMarker.on("dragend", function () {
                const p = pickMarker.getLatLng();
                $("fLat").value = p.lat.toFixed(6);
                $("fLng").value = p.lng.toFixed(6);
            });
        } else {
            pickMarker.setLatLng([lat, lng]);
        }
        if (pan) pickMap.setView([lat, lng], Math.max(pickMap.getZoom(), 16));
    }

    $("schoolModal").addEventListener("shown.bs.modal", function () {
        if (!pickMap) {
            pickMap = L.map("pickMap").setView([-13.9626, 33.7741], 12);
            L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: 19,
                attribution: "&copy; OpenStreetMap contributors"
            }).addTo(pickMap);

            pickMap.on("click", function (e) {
                $("fLat").value = e.latlng.lat.toFixed(6);
                $("fLng").value = e.latlng.lng.toFixed(6);
                setPin(e.latlng.lat, e.latlng.lng, false);
            });
        }

        pickMap.invalidateSize();

        const lat = parseFloat($("fLat").value);
        const lng = parseFloat($("fLng").value);
        if (!isNaN(lat) && !isNaN(lng)) {
            setPin(lat, lng, true);
        } else if (pickMarker) {
            pickMap.removeLayer(pickMarker);
            pickMarker = null;
            pickMap.setView([-13.9626, 33.7741], 12);
        }
    });

    function onCoordInput() {
        const lat = parseFloat($("fLat").value);
        const lng = parseFloat($("fLng").value);
        if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            setPin(lat, lng, true);
        }
    }
    $("fLat").addEventListener("change", onCoordInput);
    $("fLng").addEventListener("change", onCoordInput);

    function openForm(school) {
        editingId = school ? school.id : null;
        $("modalTitle").textContent = school ? "Edit school" : "Add school";
        $("fName").value = school ? school.name : "";
        $("fLevel").value = school ? school.level : "Primary School";
        $("fOwner").value = school ? school.ownership : "Public";
        $("fType").value = school ? (school.type || "") : "Day School";
        $("fLat").value = school ? school.latitude : "";
        $("fLng").value = school ? school.longitude : "";
        $("fImage").value = school ? (school.image || "") : "";
        say($("formMsg"), "", "text-danger");
        modal.show();
    }

    $("addBtn").addEventListener("click", () => openForm(null));

    $("schoolForm").addEventListener("submit", async function (e) {
        e.preventDefault();

        const name = $("fName").value.trim();
        const lat = parseFloat($("fLat").value);
        const lng = parseFloat($("fLng").value);

        if (!name) return say($("formMsg"), "Enter the school name.", "text-danger");
        if (isNaN(lat) || lat < -90 || lat > 90) return say($("formMsg"), "Latitude must be a number between -90 and 90.", "text-danger");
        if (isNaN(lng) || lng < -180 || lng > 180) return say($("formMsg"), "Longitude must be a number between -180 and 180.", "text-danger");

        const duplicate = schools.some(s =>
            s.id !== editingId && s.name.trim().toLowerCase() === name.toLowerCase());
        if (duplicate && !confirm(`A school named "${name}" already exists. Save anyway?`)) return;

        const record = {
            name: name,
            level: $("fLevel").value,
            ownership: $("fOwner").value,
            type: $("fType").value.trim() || null,
            latitude: lat,
            longitude: lng,
            image: $("fImage").value.trim() || null
        };

        $("saveBtn").disabled = true;
        say($("formMsg"), "Saving...", "text-muted");

        const query = editingId
            ? sb.from("schools").update(record).eq("id", editingId).select()
            : sb.from("schools").insert(record).select();

        const { data, error } = await query;
        $("saveBtn").disabled = false;

        if (error) {
            say($("formMsg"), isPermissionError(error) ? NO_PERMISSION : "Could not save: " + error.message, "text-danger");
            return;
        }
        if (!data || data.length === 0) {
            say($("formMsg"), NO_PERMISSION, "text-danger");
            return;
        }

        modal.hide();
        await loadSchools();
        say($("panelMsg"), `Saved "${name}". The public map shows the change straight away.`, "text-success");
    });

    // ---------- delete ----------
    async function deleteSchool(school) {
        if (!confirm(`Delete "${school.name}"?\n\nThis removes it from the public map and cannot be undone.`)) return;

        const { data, error } = await sb.from("schools").delete().eq("id", school.id).select();

        if (error) {
            say($("panelMsg"), isPermissionError(error) ? NO_PERMISSION : "Could not delete: " + error.message, "text-danger");
            return;
        }
        if (!data || data.length === 0) {
            say($("panelMsg"), NO_PERMISSION, "text-danger");
            return;
        }

        await loadSchools();
        say($("panelMsg"), `Deleted "${school.name}".`, "text-success");
    }

    // ---------- backup ----------
    $("backupBtn").addEventListener("click", function () {
        const clean = schools.map(s => ({
            name: s.name, level: s.level, ownership: s.ownership, type: s.type,
            latitude: s.latitude, longitude: s.longitude, ...(s.image ? { image: s.image } : {})
        }));
        const blob = new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "schools-backup.json";
        a.click();
        URL.revokeObjectURL(a.href);
    });
    }
})();
