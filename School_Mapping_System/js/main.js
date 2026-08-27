// =========================================
// LILONGWE SCHOOL MAPPING SYSTEM
// MAIN JAVASCRIPT (Map page)
// =========================================
let map;
let schoolMarkers = [];

// Nearby-search state
let geocoder;
let searchLocation = null;          // { lat, lng, label }
let searchLocationMarker = null;
let radiusCircle = null;

// Directions state
let directionsService;
let directionsRenderer;
let selectedSchool = null;

const MILES_TO_METERS = 1609.34;

// =========================================
// INITIALIZE GOOGLE MAP
// =========================================
window.initMap = async function () {
    const lilongwe = {
        lat: -13.9626,
        lng: 33.7741
    };

    map = new google.maps.Map(
        document.getElementById("map"),
        {
            center: lilongwe,
            zoom: 12,
            mapTypeControl: true,
            streetViewControl: false,
            fullscreenControl: true,
            zoomControl: true
        }
    );

    geocoder = new google.maps.Geocoder();

    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
        map: map,
        suppressMarkers: false,
        polylineOptions: {
            strokeColor: "#0d6efd",
            strokeWeight: 5
        }
    });

    console.log("Google Map loaded successfully.");

    await loadSchools();
    setupEventListeners();
    focusOnQueryParam();
};

// =========================================
// LOAD SCHOOL DATA
// =========================================
async function loadSchools() {
    try {
        const response = await fetch(
            "data/schools.json"
        );
        const schools = await response.json();
        console.log(
            "Schools loaded:",
            schools
        );
        // Update total schools
        document.getElementById(
            "totalSchools"
        ).textContent = schools.length;
        document.getElementById(
            "visibleSchools"
        ).textContent = schools.length;
        // Add markers
        schools.forEach(
            school => addSchoolMarker(school)
        );
    } catch (error) {
        console.error(
            "Error loading school data:",
            error
        );
    }
}

// =========================================
// IF THIS PAGE WAS OPENED FROM "VIEW ON MAP"
// (schools.html) WITH ?lat=&lng=&name=,
// CENTER ON AND OPEN THAT SCHOOL
// =========================================
function focusOnQueryParam() {
    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get("lat"));
    const lng = parseFloat(params.get("lng"));
    const name = params.get("name");

    if (!isNaN(lat) && !isNaN(lng)) {
        map.setCenter({ lat: lat, lng: lng });
        map.setZoom(17);

        if (name) {
            const found = schoolMarkers.find(item => item.school.name === name);
            if (found) {
                google.maps.event.trigger(found.marker, "click");
            }
        }
    }
}

// =========================================
// GET MARKER COLOR BASED ON
// OWNERSHIP + LEVEL
// =========================================
function getMarkerIcon(school) {
    const ownership = (school.ownership || "").trim().toLowerCase();
    const level = (school.level || "").trim().toLowerCase();

    const isPrivate = ownership === "private";
    const isPublic = ownership === "public";
    const isPrimary = level.includes("primary");
    const isSecondary = level.includes("secondary");

    let color = "gray"; // fallback for unmatched data

    if (isPrivate && isPrimary) {
        color = "blue";
    } else if (isPrivate && isSecondary) {
        color = "red";
    } else if (isPublic && isPrimary) {
        color = "orange";
    } else if (isPublic && isSecondary) {
        color = "yellow";
    }

    return `https://maps.google.com/mapfiles/ms/icons/${color}-dot.png`;
}

// =========================================
// ADD SCHOOL MARKER
// =========================================
function addSchoolMarker(school) {
    // Index this school will have in schoolMarkers, used to
    // wire up the "Directions" button inside its info window
    const idx = schoolMarkers.length;

    const position = {
        lat: Number(school.latitude),
        lng: Number(school.longitude)
    };

    const marker = new google.maps.Marker({
        position: position,
        map: map,
        title: school.name,
        icon: getMarkerIcon(school),
        animation: google.maps.Animation.DROP
    });

    const infoWindow =
        new google.maps.InfoWindow({
            content: buildInfoWindowContent(school, idx)
        });

    // Wire up the Directions button once the info window's
    // HTML has actually been inserted into the page
    google.maps.event.addListener(infoWindow, "domready", function () {
        const btn = document.getElementById(`directionsBtn-${idx}`);
        if (btn) {
            btn.addEventListener("click", function () {
                infoWindow.close();
                if (!searchLocation) {
                    alert("Please search a location first (or click \"My Location\"), then request directions.");
                    return;
                }
                selectSchoolForDirections(school, marker);
            });
        }
    });

    marker.addListener(
        "click",
        function () {
            infoWindow.open({
                map: map,
                anchor: marker
            });
        }
    );

    schoolMarkers.push({
        marker: marker,
        school: school,
        infoWindow: infoWindow
    });
}

// =========================================
// BUILD INFO WINDOW CONTENT
// =========================================
function buildInfoWindowContent(school, idx) {
    return `
        <div style="min-width:220px">
            <h6 class="fw-bold">
                ${school.name}
            </h6>
            <hr>
            <p class="mb-1">
                <strong>Level:</strong>
                ${school.level}
            </p>
            <p class="mb-1">
                <strong>Ownership:</strong>
                ${school.ownership}
            </p>
            <p class="mb-1">
                <strong>Type:</strong>
                ${school.type}
            </p>
            <p class="mb-2">
                <strong>Coordinates:</strong><br>
                ${school.latitude},
                ${school.longitude}
            </p>
            <button
                id="directionsBtn-${idx}"
                class="btn btn-sm btn-primary w-100">
                <i class="bi bi-signpost-2"></i>
                Directions
            </button>
        </div>
    `;
}

// =========================================
// EVENT LISTENERS
// =========================================
function setupEventListeners() {

    // Nearby-location search
    document.getElementById("locationSearchBtn")
        .addEventListener("click", handleLocationSearch);

    document.getElementById("locationSearchInput")
        .addEventListener("keypress", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                handleLocationSearch();
            }
        });

    document.getElementById("radiusSelect")
        .addEventListener("change", function () {
            if (searchLocation) {
                renderNearbySchools();
            }
        });

    document.getElementById("locationButton")
        .addEventListener("click", useCurrentLocation);

    document.getElementById("nearestButton")
        .addEventListener("click", findNearestSchool);

    document.getElementById("closeDirectionsBtn")
        .addEventListener("click", closeDirectionsPanel);

    // "Find a School" live filter (name + level + ownership)
    document.getElementById("schoolSearch")
        .addEventListener("input", applySchoolFilters);

    document.getElementById("schoolLevel")
        .addEventListener("change", applySchoolFilters);

    document.getElementById("ownership")
        .addEventListener("change", applySchoolFilters);
}

// =========================================
// "FIND A SCHOOL" FILTER
// Shows/hides markers on the map based on
// the name search box + the two dropdowns,
// and updates the "Visible" stat.
// =========================================
function applySchoolFilters() {
    const query = document.getElementById("schoolSearch").value.trim().toLowerCase();
    const levelFilter = document.getElementById("schoolLevel").value;
    const ownershipFilter = document.getElementById("ownership").value;

    let visibleCount = 0;
    const bounds = new google.maps.LatLngBounds();

    schoolMarkers.forEach(function (item) {
        const school = item.school;

        const nameMatches = !query || school.name.toLowerCase().includes(query);

        const levelValue = (school.level || "").toLowerCase();
        const levelMatches =
            levelFilter === "all" ||
            (levelFilter === "primary" && levelValue.includes("primary")) ||
            (levelFilter === "secondary" && levelValue.includes("secondary"));

        const ownershipValue = (school.ownership || "").toLowerCase();
        const ownershipMatches =
            ownershipFilter === "all" || ownershipValue === ownershipFilter;

        const isMatch = nameMatches && levelMatches && ownershipMatches;

        item.marker.setMap(isMatch ? map : null);

        if (isMatch) {
            visibleCount++;
            bounds.extend(item.marker.getPosition());
        }
    });

    document.getElementById("visibleSchools").textContent = visibleCount;

    // If the user is actively searching/filtering, zoom to the results
    const isFiltering = query || levelFilter !== "all" || ownershipFilter !== "all";
    if (isFiltering && visibleCount > 0) {
        map.fitBounds(bounds);
    } else if (!isFiltering) {
        // Filters cleared — show everything again
        map.setCenter({ lat: -13.9626, lng: 33.7741 });
        map.setZoom(12);
    }
}

// =========================================
// RESET THE "FIND A SCHOOL" FILTER
// (called before a nearby-location search so
// no markers are left hidden from an earlier
// name/level/ownership filter)
// =========================================
function resetSchoolFilters() {
    document.getElementById("schoolSearch").value = "";
    document.getElementById("schoolLevel").value = "all";
    document.getElementById("ownership").value = "all";

    schoolMarkers.forEach(item => item.marker.setMap(map));
    document.getElementById("visibleSchools").textContent = schoolMarkers.length;
}

// =========================================
// HAVERSINE DISTANCE (straight-line, in miles)
// Used for radius filtering/sorting — fast and
// doesn't use API quota.
// =========================================
function toRad(deg) {
    return deg * Math.PI / 180;
}

function haversineMiles(lat1, lng1, lat2, lng2) {
    const R = 3958.8; // Earth's radius in miles
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// =========================================
// HANDLE THE "NEARBY SCHOOLS" LOCATION SEARCH
//
// Fix for "could not find that location":
// 1. First try to match a school you already
//    loaded by name (instant, no API call,
//    works for informal school names).
// 2. Only if that fails, fall back to the
//    Geocoding API, restricted to Malawi so
//    partial/local addresses resolve better.
// =========================================
function handleLocationSearch() {
    const query = document.getElementById("locationSearchInput").value.trim();

    if (!query) {
        alert("Please enter a school name, place, or address to search.");
        return;
    }

    const queryLower = query.toLowerCase();
    const matchedSchool = schoolMarkers.find(
        item => item.school.name.toLowerCase().includes(queryLower)
    );

    if (matchedSchool) {
        const pos = matchedSchool.marker.getPosition();
        setSearchLocation(pos.lat(), pos.lng(), matchedSchool.school.name);
        return;
    }

    geocoder.geocode(
        {
            address: query,
            componentRestrictions: { country: "MW" },
            bounds: map.getBounds()
        },
        function (results, status) {
            if (status === "OK" && results[0]) {
                const loc = results[0].geometry.location;
                setSearchLocation(
                    loc.lat(),
                    loc.lng(),
                    results[0].formatted_address
                );
            } else {
                alert(
                    `Could not find "${query}". Try a school name from the list, ` +
                    `or a fuller address such as "Area 18, Lilongwe" or "City Centre, Lilongwe".`
                );
            }
        }
    );
}

// =========================================
// USE CURRENT (BROWSER/DEVICE) LOCATION
// =========================================
function useCurrentLocation() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function (position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            setSearchLocation(lat, lng, "My Current Location");
            document.getElementById("locationSearchInput").value = "My Current Location";
        },
        handleGeolocationError,
        {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 60000
        }
    );
}

// =========================================
// FRIENDLY GEOLOCATION ERROR MESSAGES
//
// Fix for the raw "location is turned off"
// browser prompt: this is your device's
// Location Services setting (outside the
// website's control), so we explain what to
// do instead of leaving it to the browser's
// generic dialog, and offer the manual
// address search as a fallback.
// =========================================
function handleGeolocationError(error) {
    let message = "Unable to retrieve your location.";

    if (error.code === error.PERMISSION_DENIED) {
        message =
            "Location access was denied for this site. Please allow location " +
            "permission in your browser's site settings, then try again — " +
            "or just type an address in the search box instead.";
    } else if (error.code === error.POSITION_UNAVAILABLE) {
        message =
            "Your device's Location Services appear to be turned off. Please " +
            "enable Location in your computer or phone's system settings, " +
            "then try again — or type an address in the search box instead.";
    } else if (error.code === error.TIMEOUT) {
        message =
            "Getting your location took too long. Please try again, or type " +
            "an address in the search box instead.";
    }

    alert(message);
}

// =========================================
// SET THE ACTIVE SEARCH LOCATION
// (places the search pin, redraws the radius
// circle, and refreshes the nearby list)
// =========================================
function setSearchLocation(lat, lng, label) {
    searchLocation = {
        lat: lat,
        lng: lng,
        label: label || "Search Location"
    };

    if (searchLocationMarker) {
        searchLocationMarker.setMap(null);
    }

    searchLocationMarker = new google.maps.Marker({
        position: { lat: lat, lng: lng },
        map: map,
        title: searchLocation.label,
        icon: {
            url: "https://maps.google.com/mapfiles/ms/icons/yellow-dot.png"
        },
        zIndex: 999
    });

    resetSchoolFilters();
    closeDirectionsPanel();
    renderNearbySchools();
}

// =========================================
// FILTER + SORT SCHOOLS WITHIN RADIUS
// =========================================
function renderNearbySchools() {
    if (!searchLocation) {
        return;
    }

    const radiusMiles = parseFloat(
        document.getElementById("radiusSelect").value
    );

    const withDistance = schoolMarkers.map(function (item) {
        const distance = haversineMiles(
            searchLocation.lat,
            searchLocation.lng,
            Number(item.school.latitude),
            Number(item.school.longitude)
        );
        return Object.assign({}, item, { distance: distance });
    });

    const nearby = withDistance
        .filter(item => item.distance <= radiusMiles)
        .sort((a, b) => a.distance - b.distance);

    document.getElementById("visibleSchools").textContent = nearby.length;

    renderResultsList(nearby, radiusMiles);
    fitMapToResults(nearby);
    drawRadiusCircle(radiusMiles);
}

// =========================================
// RENDER THE RESULTS LIST IN THE SIDEBAR
// =========================================
function renderResultsList(nearby, radiusMiles) {
    const container = document.getElementById("nearbySchoolsResults");
    const header = document.getElementById("nearbyResultsHeader");

    const radiusLabel = radiusMiles < 1
        ? `${radiusMiles} mile`
        : `${radiusMiles} mile${radiusMiles !== 1 ? "s" : ""}`;

    header.textContent = `${nearby.length} school${nearby.length !== 1 ? "s" : ""} within ${radiusLabel}`;

    if (nearby.length === 0) {
        container.innerHTML = `<p class="text-muted small">No schools found in this radius. Try a larger radius.</p>`;
        return;
    }

    container.innerHTML = nearby.map(function (item) {
        const idx = schoolMarkers.findIndex(m => m.marker === item.marker);

        return `
            <div class="nearby-school-item" data-idx="${idx}">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <div class="fw-bold">${item.school.name}</div>
                        <div class="small text-muted">
                            ${item.school.level} &middot; ${item.school.ownership}
                        </div>
                    </div>
                    <span class="badge bg-primary rounded-pill">
                        ${item.distance.toFixed(2)} mi
                    </span>
                </div>
            </div>
        `;
    }).join("");

    container.querySelectorAll(".nearby-school-item").forEach(function (el) {
        el.addEventListener("click", function () {
            const idx = parseInt(this.dataset.idx, 10);
            const item = schoolMarkers[idx];

            selectSchoolForDirections(item.school, item.marker);

            container.querySelectorAll(".nearby-school-item")
                .forEach(x => x.classList.remove("active"));
            this.classList.add("active");
        });
    });
}

// =========================================
// FIT THE MAP TO THE SEARCH PIN + RESULTS
// =========================================
function fitMapToResults(nearby) {
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(searchLocationMarker.getPosition());

    nearby.forEach(item => bounds.extend(item.marker.getPosition()));

    if (nearby.length > 0) {
        map.fitBounds(bounds);
    } else {
        map.setCenter(searchLocationMarker.getPosition());
        map.setZoom(14);
    }
}

// =========================================
// DRAW THE RADIUS CIRCLE ON THE MAP
// =========================================
function drawRadiusCircle(radiusMiles) {
    if (radiusCircle) {
        radiusCircle.setMap(null);
    }

    radiusCircle = new google.maps.Circle({
        map: map,
        center: searchLocationMarker.getPosition(),
        radius: radiusMiles * MILES_TO_METERS,
        strokeColor: "#0d6efd",
        strokeOpacity: 0.6,
        strokeWeight: 1,
        fillColor: "#0d6efd",
        fillOpacity: 0.08
    });
}

// =========================================
// FIND NEAREST SCHOOL BUTTON
// (uses current location, ignores the radius
// filter, and jumps straight to directions)
// =========================================
function findNearestSchool() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    if (schoolMarkers.length === 0) {
        alert("School data has not loaded yet.");
        return;
    }

    navigator.geolocation.getCurrentPosition(function (position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        setSearchLocation(lat, lng, "My Current Location");
        document.getElementById("locationSearchInput").value = "My Current Location";

        let nearest = null;
        let nearestDistance = Infinity;

        schoolMarkers.forEach(function (item) {
            const distance = haversineMiles(
                lat, lng,
                Number(item.school.latitude),
                Number(item.school.longitude)
            );
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = item;
            }
        });

        if (nearest) {
            // Widen the radius selector if needed so the
            // nearest school actually shows up in the list
            const radiusSelect = document.getElementById("radiusSelect");
            const currentRadius = parseFloat(radiusSelect.value);

            if (nearestDistance > currentRadius) {
                const options = Array.from(radiusSelect.options).map(o => parseFloat(o.value));
                const fitting = options.find(v => v >= nearestDistance);
                radiusSelect.value = fitting || options[options.length - 1];
            }

            renderNearbySchools();
            selectSchoolForDirections(nearest.school, nearest.marker);
        }
    }, handleGeolocationError, {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 60000
    });
}

// =========================================
// REQUEST + RENDER DIRECTIONS TO A SCHOOL
// =========================================
function selectSchoolForDirections(school, marker) {
    if (!searchLocation) {
        alert("Please search a location first.");
        return;
    }

    selectedSchool = school;

    const origin = { lat: searchLocation.lat, lng: searchLocation.lng };
    const destination = {
        lat: Number(school.latitude),
        lng: Number(school.longitude)
    };

    directionsService.route(
        {
            origin: origin,
            destination: destination,
            travelMode: google.maps.TravelMode.DRIVING,
            provideRouteAlternatives: true
        },
        function (result, status) {
            if (status === "OK") {
                directionsRenderer.setDirections(result);
                directionsRenderer.setRouteIndex(0);
                renderDirectionsPanel(school, result.routes, 0);
            } else {
                alert("Could not calculate directions to this school.");
                console.error("Directions request failed:", status);
            }
        }
    );
}

// =========================================
// RENDER THE DIRECTIONS PANEL
// (distance + duration + route alternatives,
// similar to the Google Maps "directions" list)
// =========================================
function renderDirectionsPanel(school, routes, activeIndex) {
    const panel = document.getElementById("directionsPanel");
    const title = document.getElementById("directionsTitle");
    const list = document.getElementById("routeOptionsList");

    title.innerHTML = `
        <div class="text-muted">${searchLocation.label}</div>
        <div class="text-center"><i class="bi bi-arrow-down"></i></div>
        <div class="fw-bold">${school.name}</div>
    `;

    list.innerHTML = routes.map(function (route, i) {
        const leg = route.legs[0];
        const active = i === activeIndex ? "active" : "";

        return `
            <div class="route-option ${active}" data-idx="${i}">
                <div class="d-flex justify-content-between">
                    <span class="fw-bold">${leg.duration.text}</span>
                    <span class="text-muted">${leg.distance.text}</span>
                </div>
                <div class="small text-muted">
                    via ${route.summary || ("route " + (i + 1))}
                </div>
                <button class="btn btn-link btn-sm p-0 details-toggle" data-idx="${i}">
                    Details
                </button>
                <ol class="route-steps small mt-2 d-none"></ol>
            </div>
        `;
    }).join("");

    // Clicking a route option makes it the active/drawn route
    list.querySelectorAll(".route-option").forEach(function (el) {
        el.addEventListener("click", function (e) {
            if (e.target.classList.contains("details-toggle")) {
                return;
            }
            const idx = parseInt(this.dataset.idx, 10);
            directionsRenderer.setRouteIndex(idx);

            list.querySelectorAll(".route-option")
                .forEach(x => x.classList.remove("active"));
            this.classList.add("active");
        });
    });

    // Expand/collapse turn-by-turn steps
    list.querySelectorAll(".details-toggle").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            const idx = parseInt(this.dataset.idx, 10);
            const stepsEl = this.parentElement.querySelector(".route-steps");

            if (stepsEl.classList.contains("d-none")) {
                const steps = routes[idx].legs[0].steps;
                stepsEl.innerHTML = steps.map(function (s) {
                    const instructions = s.instructions.replace(/<[^>]*>/g, "");
                    return `<li>${instructions} (${s.distance.text})</li>`;
                }).join("");
                stepsEl.classList.remove("d-none");
                this.textContent = "Hide details";
            } else {
                stepsEl.classList.add("d-none");
                this.textContent = "Details";
            }
        });
    });

    panel.classList.remove("d-none");
}

// =========================================
// CLOSE THE DIRECTIONS PANEL
// =========================================
function closeDirectionsPanel() {
    document.getElementById("directionsPanel").classList.add("d-none");
    directionsRenderer.setDirections({ routes: [] });
    selectedSchool = null;
}

// =========================================
// PAGE READY
// =========================================
document.addEventListener(
    "DOMContentLoaded",
    function () {
        console.log(
            "Lilongwe School GIS started."
        );
    }
);
