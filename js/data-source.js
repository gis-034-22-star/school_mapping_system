// =========================================
// SHARED SCHOOL DATA LOADER
// Reads schools from Supabase when js/config.js is filled in,
// otherwise (or if Supabase cannot be reached) from data/schools.json.
// =========================================
async function loadSchoolsData(fallbackJsonUrl) {
    const url = (window.SUPABASE_URL || "").replace(/\/+$/, "");
    const key = window.SUPABASE_ANON_KEY || "";

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
