// =========================================
// DASHBOARD PAGE
// =========================================
document.addEventListener("DOMContentLoaded", loadDashboard);

async function loadDashboard() {
    try {
        const response = await fetch("../data/schools.json");
        const schools = await response.json();

        renderStatCards(schools);
        renderLevelChart(schools);
        renderOwnershipChart(schools);
        renderBreakdownChart(schools);
    } catch (error) {
        console.error("Error loading school data:", error);
    }
}

// =========================================
// STAT CARDS
// =========================================
function renderStatCards(schools) {
    const primary = schools.filter(s => (s.level || "").toLowerCase().includes("primary"));
    const secondary = schools.filter(s => (s.level || "").toLowerCase().includes("secondary"));
    const publicSchools = schools.filter(s => (s.ownership || "").toLowerCase() === "public");
    const privateSchools = schools.filter(s => (s.ownership || "").toLowerCase() === "private");

    document.getElementById("statTotal").textContent = schools.length;
    document.getElementById("statPrimary").textContent = primary.length;
    document.getElementById("statSecondary").textContent = secondary.length;
    document.getElementById("statPublicPrivate").textContent =
        `${publicSchools.length} / ${privateSchools.length}`;
}

// =========================================
// SCHOOLS BY LEVEL (doughnut)
// =========================================
function renderLevelChart(schools) {
    const primaryCount = schools.filter(s => (s.level || "").toLowerCase().includes("primary")).length;
    const secondaryCount = schools.filter(s => (s.level || "").toLowerCase().includes("secondary")).length;

    new Chart(document.getElementById("levelChart"), {
        type: "doughnut",
        data: {
            labels: ["Primary", "Secondary"],
            datasets: [{
                data: [primaryCount, secondaryCount],
                backgroundColor: ["#0d6efd", "#fd7e14"]
            }]
        },
        options: {
            plugins: { legend: { position: "bottom" } }
        }
    });
}

// =========================================
// SCHOOLS BY OWNERSHIP (doughnut)
// =========================================
function renderOwnershipChart(schools) {
    const publicCount = schools.filter(s => (s.ownership || "").toLowerCase() === "public").length;
    const privateCount = schools.filter(s => (s.ownership || "").toLowerCase() === "private").length;

    new Chart(document.getElementById("ownershipChart"), {
        type: "doughnut",
        data: {
            labels: ["Public", "Private"],
            datasets: [{
                data: [publicCount, privateCount],
                backgroundColor: ["#198754", "#6f42c1"]
            }]
        },
        options: {
            plugins: { legend: { position: "bottom" } }
        }
    });
}

// =========================================
// LEVEL x OWNERSHIP (grouped bar)
// =========================================
function renderBreakdownChart(schools) {
    const counts = {
        "Public Primary": 0,
        "Private Primary": 0,
        "Public Secondary": 0,
        "Private Secondary": 0
    };

    schools.forEach(function (s) {
        const level = (s.level || "").toLowerCase().includes("primary") ? "Primary" : "Secondary";
        const ownership = (s.ownership || "").toLowerCase() === "private" ? "Private" : "Public";
        counts[`${ownership} ${level}`]++;
    });

    new Chart(document.getElementById("breakdownChart"), {
        type: "bar",
        data: {
            labels: Object.keys(counts),
            datasets: [{
                label: "Number of Schools",
                data: Object.values(counts),
                backgroundColor: ["#0d6efd", "#6f42c1", "#fd7e14", "#20c997"]
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}
