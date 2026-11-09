// =========================================
// SHARED SCHOOL DATA LOADER
// Reads schools from Supabase when js/config.js is filled in,
// otherwise (or if Supabase cannot be reached) from data/schools.json.
// =========================================
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

async function loadSchoolsData(fallbackJsonUrl) {
    const url = normalizeSupabaseUrl(window.SUPABASE_URL);
    const key = String(window.SUPABASE_ANON_KEY || "").trim().replace(/^["']+|["']+$/g, "");

    if (url && key) {
        try {
            const rows = [];
            const pageSize = 1000;
            let from = 0;

            while (true) {
                const response = await fetch(
                    `${url}/rest/v1/schools?select=id,name,level,ownership,type,latitude,longitude,image&order=name.asc`,
                    {
                        headers: {
                            apikey: key,
                            Authorization: `Bearer ${key}`,
                            "Range-Unit": "items",
                            Range: `${from}-${from + pageSize - 1}`
                        }
                    }
                );
                if (!response.ok) throw new Error("Supabase responded with HTTP " + response.status);

                const part = await response.json();
                rows.push(...part);
                if (part.length < pageSize) break;
                from += pageSize;
            }

            if (rows.length > 0) {
                return rows.map(r => ({
                    id: r.id,
                    name: r.name,
                    level: r.level,
                    ownership: r.ownership,
                    type: r.type || "Not specified",
                    latitude: Number(r.latitude),
                    longitude: Number(r.longitude),
                    image: r.image || ""
                }));
            }
            console.warn("The Supabase schools table is empty. Using schools.json instead.");
        } catch (error) {
            console.warn("Supabase unavailable. Using schools.json instead.", error);
        }
    }

    const response = await fetch(fallbackJsonUrl);
    return response.json();
}
