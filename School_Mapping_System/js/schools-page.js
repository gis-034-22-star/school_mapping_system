// =========================================
// SCHOOLS TABLE PAGE
// =========================================
let allSchools = [];
let currentSort = { key: "name", direction: "asc" };

document.addEventListener("DOMContentLoaded", function () {
    loadSchoolsTable();
    setupTableEvents();
});

// =========================================
// LOAD SCHOOL DATA
// =========================================
async function loadSchoolsTable() {
    try {
        const response = await fetch("../data/schools.json");
        allSchools = await response.json();
        renderTable();
    } catch (error) {
        console.error("Error loading school data:", error);
        document.getElementById("schoolsTableBody").innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-danger py-4">
                    Could not load school data. Please try again later.
                </td>
            </tr>
        `;
    }
}

// =========================================
// EVENT LISTENERS
// =========================================
function setupTableEvents() {
    document.getElementById("tableSearch")
        .addEventListener("input", renderTable);

    document.getElementById("tableLevel")
        .addEventListener("change", renderTable);

    document.getElementById("tableOwnership")
        .addEventListener("change", renderTable);

    document.querySelectorAll("th.sortable").forEach(function (th) {
        th.addEventListener("click", function () {
            const key = th.dataset.sort;

            if (currentSort.key === key) {
                currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
            } else {
                currentSort = { key: key, direction: "asc" };
            }

            renderTable();
        });
    });
}

// =========================================
// FILTER + SORT + RENDER
// =========================================
function renderTable() {
    const query = document.getElementById("tableSearch").value.trim().toLowerCase();
    const levelFilter = document.getElementById("tableLevel").value;
    const ownershipFilter = document.getElementById("tableOwnership").value;

    let filtered = allSchools.filter(function (school) {
        const nameMatches = !query || school.name.toLowerCase().includes(query);

        const levelValue = (school.level || "").toLowerCase();
        const levelMatches =
            levelFilter === "all" ||
            (levelFilter === "primary" && levelValue.includes("primary")) ||
            (levelFilter === "secondary" && levelValue.includes("secondary"));

        const ownershipValue = (school.ownership || "").toLowerCase();
        const ownershipMatches =
            ownershipFilter === "all" || ownershipValue === ownershipFilter;

        return nameMatches && levelMatches && ownershipMatches;
    });

    filtered.sort(function (a, b) {
        const valA = (a[currentSort.key] || "").toString().toLowerCase();
        const valB = (b[currentSort.key] || "").toString().toLowerCase();

        if (valA < valB) return currentSort.direction === "asc" ? -1 : 1;
        if (valA > valB) return currentSort.direction === "asc" ? 1 : -1;
        return 0;
    });

    document.getElementById("tableCount").textContent =
        `${filtered.length} of ${allSchools.length}`;

    const tbody = document.getElementById("schoolsTableBody");

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted py-4">
                    No schools match your filters.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(function (school) {
        const mapUrl =
            `../index.html?lat=${school.latitude}&lng=${school.longitude}` +
            `&name=${encodeURIComponent(school.name)}`;

        return `
            <tr>
                <td class="fw-bold">${school.name}</td>
                <td>${school.level}</td>
                <td>
                    <span class="badge ${school.ownership === "Private" ? "bg-info" : "bg-secondary"}">
                        ${school.ownership}
                    </span>
                </td>
                <td>${school.type || "-"}</td>
                <td class="small text-muted">
                    ${school.latitude}, ${school.longitude}
                </td>
                <td>
                    <a href="${mapUrl}" class="btn btn-sm btn-outline-primary">
                        <i class="bi bi-map"></i>
                        View on Map
                    </a>
                </td>
            </tr>
        `;
    }).join("");
}
