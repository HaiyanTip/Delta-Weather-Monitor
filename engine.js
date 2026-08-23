/* ============================================================
   1. UI & UTILITY FUNCTIONS
   ============================================================ */

function toggleDarkMode() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    if (currentTheme === 'dark') { body.removeAttribute('data-theme'); }
    else { body.setAttribute('data-theme', 'dark'); }
    if (masterChartInstance) {
        const isDark = body.getAttribute('data-theme') === 'dark';
        masterChartInstance.options.scales.x.ticks.color = isDark ? '#e0e0e0' : '#666';
        masterChartInstance.options.scales.y.ticks.color = isDark ? '#e0e0e0' : '#666';
        masterChartInstance.options.scales.y.grid.color = isDark ? '#333' : '#e5e5e5';
        masterChartInstance.update();
    }
}

window.switchPopupTab = function(el, paneId) {
    const container = el.closest('.matrix-popup');
    container.querySelectorAll('.popup-tab').forEach(t => t.classList.remove('active'));
    container.querySelectorAll('.popup-pane').forEach(p => p.style.display = 'none');
    el.classList.add('active');
    container.querySelector('#' + paneId).style.display = 'block';
};

function showNotice(message) {
    document.getElementById('noticeModalMessage').innerText = message;
    document.getElementById('noticeModal').style.display = 'flex';
}

function closeNoticeModal() { 
    document.getElementById('noticeModal').style.display = 'none'; 
}

/* ============================================================
   2. FILTERING & MULTI-SELECT
   ============================================================ */

function quickSelectDistricts(mode, checkboxClass) {
    const checkboxes = document.querySelectorAll(`.${checkboxClass}`);
    const cdzCore = ['thanjavur', 'tiruvarur', 'thiruvarur', 'nagapattinam', 'mayiladuthurai'];
    const cdzExt = [...cdzCore, 'thiruchirappalli', 'tiruchirappalli', 'trichy', 'karur', 'ariyalur', 'cuddalore', 'pudukkottai', 'pudukottai'];

    checkboxes.forEach(cb => {
        const val = cb.value.toLowerCase();
        if (mode === 'ALL') { cb.checked = true; }
        else if (mode === 'CLEAR') { cb.checked = false; }
        else if (mode === 'CDZ_CORE') { cb.checked = cdzCore.some(d => val.includes(d)); }
        else if (mode === 'CDZ_EXT') { cb.checked = cdzExt.some(d => val.includes(d)); }
    });
}

function toggleMultiSelect(e) {
    e.stopPropagation();
    document.getElementById('stnDistFilterMenu').classList.toggle('show');
}

function checkAllStnFilters(checked) {
    document.querySelectorAll('.stn-dist-chk').forEach(cb => cb.checked = checked);
}

function applyStnFilter() {
    document.getElementById('stnDistFilterMenu').classList.remove('show');
    const checkedBoxes = Array.from(document.querySelectorAll('.stn-dist-chk:checked')).map(cb => cb.value);
    activeStationDistricts = checkedBoxes;
    const btn = document.getElementById('stnDistFilterBtn');
    const totalBoxes = document.querySelectorAll('.stn-dist-chk').length;
    
    if (checkedBoxes.length === totalBoxes || checkedBoxes.length === 0) {
        btn.innerText = "ALL ▼";
        activeStationDistricts = [];
    } else if (checkedBoxes.length === 1) {
        btn.innerText = "1 SEL ▼";
    } else {
        btn.innerText = checkedBoxes.length + " SEL ▼";
    }
    renderTables();
}

window.onclick = function(event) {
    if (!event.target.matches('.multi-select-btn') && !event.target.closest('.multi-select-menu')) {
        const menus = document.getElementsByClassName("multi-select-menu");
        for (let i = 0; i < menus.length; i++) {
            if (menus[i].classList.contains('show')) { menus[i].classList.remove('show'); }
        }
    }
}

/* ============================================================
   3. CORE MAP & DATA INITIALIZATION
   ============================================================ */

const map = L.map('map', {
    center: [10.80, 79.35],
    zoom: 8.5,
    zoomControl: false
});
L.control.zoom({ position: 'topleft' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CARTO', subdomains: 'abcd', maxZoom: 20
}).addTo(map);
setTimeout(() => { map.invalidateSize(); }, 500);

const layers = {
    station: L.layerGroup().addTo(map),
    heatmap: L.layerGroup() 
};

let globalRainData = [];
let globalStations = {};
let fallbackStations = {};
let tnGeoJSONData = null;

let activeView = 'station';
let activePopupMode = 'stats';
let masterChartInstance = null;
let currentSliderDateStr = "";
let datasetActiveYear = 2026;
let finalImageBase64 = null;
let finalImageFileName = "Report.png";
let activeModalSource = "";
let chartInstances = {};         
let exportIdwMapInstance = null; 

let customDates = [];
let currentDistrictData = [];
let currentStationData = [];
let rawStationMap = {};
let rawDistrictMap = {};
let activeStationDistricts = [];

let sortConfig = {
    district: { key: 'name', dir: 'asc' },
    station: { key: 'district', dir: 'asc' }
};

const RAINFALL_DATA = 'thanjavur_stations_rainfall_2026.csv';
const STATIONS_DATA = 'Stations.csv';
const GEOJSON_DATA = 'tn_districts.geojson';

fetch(GEOJSON_DATA)
    .then(res => res.json())
    .then(gData => { tnGeoJSONData = gData; })
    .catch(err => console.warn("GeoJSON loading failed or file missing:", err));

Papa.parse(RAINFALL_DATA, {
    download: true, header: true, skipEmptyLines: true,
    complete: function(rainResults) {
        if (!rainResults.data || rainResults.data.length === 0) return;
        globalRainData = rainResults.data;

        Papa.parse(STATIONS_DATA, {
            download: true, header: true, skipEmptyLines: true,
            complete: function(stationResults) {
                buildStationLookup(stationResults.data);
                initializeDashboard();
            },
            error: function() {
                buildStationLookup([]);
                initializeDashboard();
            }
        });
    }
});

/* ============================================================
   4. DATA PARSING & COLOR ENGINES
   ============================================================ */

function cleanName(str) { return str ? str.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() : ""; }

const districtAliases = {
    "sivagangai": "sivaganga", "sivaganga": "sivagangai",
    "tuticorin": "thoothukudi", "thoothukudi": "tuticorin",
    "tiruchirappalli": "thiruchirappalli", "thiruchirappalli": "tiruchirappalli", "trichy": "tiruchirappalli",
    "thiruvallur": "tiruvallur", "tiruvallur": "thiruvallur",
    "kanchipuram": "kancheepuram", "kancheepuram": "kanchipuram",
    "kanyakumari": "kanniyakumari", "kanniyakumari": "kanyakumari"
};

function getMatchedDistrict(cName) {
    if (rawDistrictMap[cName]) return rawDistrictMap[cName];
    if (districtAliases[cName] && rawDistrictMap[districtAliases[cName]]) return rawDistrictMap[districtAliases[cName]];
    for (let key in rawDistrictMap) {
        if (key.includes(cName) || cName.includes(key)) return rawDistrictMap[key];
    }
    return null;
}

// ----------------------------------------------------------------
// 1. STATION SPECIFIC ENGINE (Annual Only, 1 Red, Neon Pink End)
// ----------------------------------------------------------------
const stationPalette = [
    "#ea1916", "#FEA53A", "#E2DC38", "#98f132", "#32f252", 
    "#0ef6e6", "#28BBEC", "#466BE3", "#2802c0", "#9d46ff", "#4B0082" 
];

const stationConfig = {
    'annual': [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000]
};

function getStationColor(value) {
    if (value <= 0) return stationPalette[0];
    const bounds = stationConfig['annual'];
    const maxBound = bounds[bounds.length - 1];
    if (value > maxBound) return '#ff00ff';
    let binIdx = 0;
    for (let i = 0; i < bounds.length - 1; i++) {
        if (value > bounds[i] && value <= bounds[i+1]) { binIdx = i; break; }
    }
    let numBins = bounds.length - 1;
    let colorIdx = Math.floor((binIdx / Math.max(1, numBins - 1)) * (stationPalette.length - 1));
    return stationPalette[colorIdx];
}

// ----------------------------------------------------------------
// 2. DISTRICT SPECIFIC ENGINE (Seasonal Scales, Original Base Palette)
// ----------------------------------------------------------------
const districtPalette = [
    "#ea1916", "#C92A2C", "#F15B2E", "#FEA53A", "#E2DC38", 
    "#98f132", "#32F298", "#28BBEC", "#466BE3", "#2802c0", "#4B0082"
];

const districtSeasonConfig = {
    'annual': [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000],
    'nem': [0, 150, 300, 450, 600, 750, 900, 1050, 1200, 1350, 1500],
    'swm': [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600],
    'summer': [0, 40, 80, 120, 160, 200, 240, 280, 320, 360, 400],
    'winter': [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200],
    'monthly': [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500],
    'custom': [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500]
};

function getDistrictColor(value, metric = 'annual') {
    if (value <= 0) return districtPalette[0];
    const bounds = districtSeasonConfig[metric] || districtSeasonConfig['annual'];
    const maxBound = bounds[bounds.length - 1];
    if (value > maxBound) return '#ff00ff'; 
    let binIdx = 0;
    for (let i = 0; i < bounds.length - 1; i++) {
        if (value > bounds[i] && value <= bounds[i+1]) { binIdx = i; break; }
    }
    let numBins = bounds.length - 1;
    let colorIdx = Math.floor((binIdx / Math.max(1, numBins - 1)) * (districtPalette.length - 1));
    return districtPalette[colorIdx];
}

// ----------------------------------------------------------------
// 3. UTILITY - IMD & Legend Generators
// ----------------------------------------------------------------
function getIMDColor(mm) {
    if (mm === 0) return '#ffffff';
    if (mm <= 2.4) return '#e0e0e0';
    if (mm <= 15.5) return '#98fb98';
    if (mm <= 64.4) return '#2ecc71';
    if (mm <= 115.5) return '#f1c40f';
    if (mm <= 204.4) return '#e67e22';
    return '#e74c3c';
}

function generateDiscreteGradient(palette) {
    let step = 100 / palette.length;
    let gradParts = [];
    palette.forEach((color, i) => {
        gradParts.push(`${color} ${i * step}%`, `${color} ${(i + 1) * step}%`);
    });
    return 'linear-gradient(to right, ' + gradParts.join(', ') + ')';
}

function parseDateString(dateStr) {
    const parts = dateStr.split('-');
    if(parts.length !== 3) return null;
    return { day: parseInt(parts[0]), month: parseInt(parts[1]), year: parseInt(parts[2]) };
}

function getDayOfYear(day, month, year) {
    const date = new Date(year, month - 1, day);
    const start = new Date(year, 0, 0);
    return Math.floor((date - start) / (1000 * 60 * 60 * 24));
}

function getFormattedDateFromDOY(doy, year) {
    const date = new Date(year, 0, doy);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
}

function buildStationLookup(stationsData) {
    stationsData.forEach(st => {
        const rawName = st['Name of the station'] || st.Station_Name || "";
        const dist = st.District || "Unknown";
        const cleanedName = cleanName(rawName);
        const cleanedDist = cleanName(dist);
        const lat = parseFloat(st.Latitude) || 0;
        const lon = parseFloat(st.Longitude) || 0;

        if (cleanedName) {
            const compositeKey = cleanedDist + "_" + cleanedName;
            const stObj = { district: dist.trim(), lat: lat, lon: lon };
            globalStations[compositeKey] = stObj;
            if (cleanedName.includes("papanasam")) {
                if (lat > 10.0 || cleanedDist.includes("thanjavur")) {
                    globalStations["thanjavur_papanasam"] = { district: "Thanjavur", lat: 10.92, lon: 79.27 };
                }
            } else {
                if(!fallbackStations[cleanedName]) { fallbackStations[cleanedName] = stObj; }
            }
        }
    });
}

function resolveStationMeta(rawName, rawDist, rLat, rLon) {
    const cName = cleanName(rawName);
    const cDist = cleanName(rawDist);
    if (cName.includes("papanasam")) {
        const lat = rLat || 0; const lon = rLon || 0;
        if (lat > 10.0 || lon > 78.5 || cDist.includes("thanjavur") || cDist.includes("tanjore")) {
            return { uniqueKey: "thanjavur_papanasam", district: "Thanjavur", name: "Papanasam", lat: lat > 0 ? lat : 10.92, lon: lon > 0 ? lon : 79.27 };
        }
        if (lat > 0 && lat < 9.5) {
            return { uniqueKey: "tirunelveli_papanasam", district: "Tirunelveli", name: "Papanasam (TNV)", lat: lat, lon: lon };
        }
    }
    const meta = globalStations[cDist + "_" + cName] || fallbackStations[cName] || {};
    const district = rawDist ? rawDist.trim() : (meta.district && meta.district !== "Unknown" ? meta.district : "Unknown");
    const lat = !isNaN(meta.lat) && meta.lat !== 0 ? meta.lat : rLat;
    const lon = !isNaN(meta.lon) && meta.lon !== 0 ? meta.lon : rLon;
    return { uniqueKey: cleanName(district) + "_" + cName, district: district, name: rawName ? rawName.trim() : "Unknown", lat: lat, lon: lon };
}

/* ============================================================
   5. DASHBOARD ENGINE & STATE MANAGEMENT
   ============================================================ */

function initializeDashboard() {
    const yearSet = new Set(); let maxDOY = 1;
    globalRainData.forEach(row => {
        const d = parseDateString(row.Date);
        if(d) { yearSet.add(d.year); const doy = getDayOfYear(d.day, d.month, d.year); if(doy > maxDOY) maxDOY = doy; }
    });

    const yearSelect = document.getElementById('yearSelect');
    const years = Array.from(yearSet).sort((a,b) => b - a);
    years.forEach(y => { const opt = document.createElement('option'); opt.value = y; opt.innerText = y; yearSelect.appendChild(opt); });
    datasetActiveYear = years.length > 0 ? years[0] : new Date().getFullYear();

    yearSelect.addEventListener('change', (e) => { datasetActiveYear = parseInt(e.target.value); updateEngine(); });

    const slider = document.getElementById('timeSlider');
    slider.max = maxDOY; slider.value = maxDOY;
    
    let renderTimeout;
    slider.addEventListener('input', (e) => { 
        document.getElementById('sliderDateDisplay').innerText = getFormattedDateFromDOY(parseInt(e.target.value), datasetActiveYear); 
    });
    slider.addEventListener('change', () => {
        clearTimeout(renderTimeout);
        renderTimeout = setTimeout(updateEngine, 100);
    });

    document.querySelectorAll('input[name="viewMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            activeView = e.target.value;
            map.removeLayer(layers.station);
            if(map.hasLayer(layers.heatmap)) map.removeLayer(layers.heatmap);

            if (activeView === 'heatmap') {
                map.addLayer(layers.heatmap);
                document.getElementById('heatmapMetric').style.display = 'block';
            } else {
                map.addLayer(layers[activeView]);
                document.getElementById('heatmapMetric').style.display = 'none';
            }
            updateEngine();
        });
    });

    document.querySelectorAll('input[name="popupMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => { activePopupMode = e.target.value; map.closePopup(); updateEngine(); });
    });

    document.getElementById('heatmapMetric').addEventListener('change', updateEngine);

    setupSortingListeners();
    setupChartDropdownListeners();

    // Ensure metric dropdown is hidden on initial load since default view is 'Station'
    document.getElementById('heatmapMetric').style.display = 'none';

    initEmptyDailyChart(); 
    updateEngine();
}

function initEmptyDailyChart() {
    if (masterChartInstance) return;
    const ctx = document.getElementById('masterDailyChart').getContext('2d');
    masterChartInstance = new Chart(ctx, {
        type: 'bar', data: { labels: [], datasets: [] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Rainfall (mm)' }, grid: {color: '#e5e5e5'} }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } }
    });
}

function setupChartDropdownListeners() {
    const distSelect = document.getElementById('chartDistSelect'); const stnSelect = document.getElementById('chartStnSelect');
    
    distSelect.addEventListener('change', (e) => {
        const districtName = e.target.value; stnSelect.innerHTML = '<option value="">Select Station...</option>';
        if (!districtName) { stnSelect.disabled = true; return; }
        stnSelect.disabled = false;
        stnSelect.innerHTML += `<option value="DISTRICT_AVG">⭐ ${districtName} (District Average)</option>`;
        currentStationData.filter(s => s.district === districtName).sort((a,b) => a.name.localeCompare(b.name)).forEach(st => { const opt = document.createElement('option'); opt.value = st.id; opt.innerText = st.name; stnSelect.appendChild(opt); });
        stnSelect.value = "DISTRICT_AVG"; stnSelect.dispatchEvent(new Event('change'));
    });
    
    stnSelect.addEventListener('change', (e) => {
        const val = e.target.value; const dist = distSelect.value;
        const daysInYear = ((datasetActiveYear % 4 === 0 && datasetActiveYear % 100 !== 0) || (datasetActiveYear % 400 === 0)) ? 366 : 365;
        if (!val) return;
        if (val === "DISTRICT_AVG") { const dData = rawDistrictMap[cleanName(dist)]; if (dData) triggerDailyChartSync(dData, true, datasetActiveYear, daysInYear, dData.count || 1); }
        else { const sData = currentStationData.find(s => s.id === val); if (sData) triggerDailyChartSync(sData, false, datasetActiveYear, daysInYear, 1); }
    });
}

function populateChartDropdowns() {
    const distSelect = document.getElementById('chartDistSelect'); const currentDist = distSelect.value;
    const uniqueDistricts = new Set(); currentStationData.forEach(st => { if (st.district !== "Unknown" && st.district !== "Unassigned") uniqueDistricts.add(st.district); });
    distSelect.innerHTML = '<option value="">Select District...</option>';
    Array.from(uniqueDistricts).sort().forEach(d => { const opt = document.createElement('option'); opt.value = d; opt.innerText = d; distSelect.appendChild(opt); });
    if (currentStationData.some(st => st.district === "Unassigned")) distSelect.innerHTML += '<option value="Unassigned">Unassigned</option>';
    if (Array.from(uniqueDistricts).includes(currentDist) || currentDist === "Unassigned") distSelect.value = currentDist;
}

function updateDistrictFilterMenus() {
    const menu = document.getElementById('stnDistChecklist');
    const uniqueDistricts = new Set();
    currentStationData.forEach(st => { if (st.district !== "Unknown" && st.district !== "Unassigned") uniqueDistricts.add(st.district); });

    let html = '';
    Array.from(uniqueDistricts).sort().forEach(d => {
        const checked = (activeStationDistricts.length === 0 || activeStationDistricts.includes(d)) ? 'checked' : '';
        html += `<label class="multi-select-item"><input type="checkbox" value="${d}" class="stn-dist-chk" ${checked}> ${d}</label>`;
    });
    if (currentStationData.some(st => st.district === "Unassigned")) {
        const checked = (activeStationDistricts.length === 0 || activeStationDistricts.includes('Unassigned')) ? 'checked' : '';
        html += `<label class="multi-select-item"><input type="checkbox" value="Unassigned" class="stn-dist-chk" ${checked}> Unassigned</label>`;
    }
    menu.innerHTML = html;
}

function triggerDailyChartSync(item, isAverage, year, daysInYear, div) {
    document.getElementById('masterChartTitle').innerHTML = `<span style="color:#2980b9;">${item.name} ${isAverage ? 'District' : '('+item.district+')'}</span> Daily Trends`;
    const labels = []; const data = [];
    for(let i=0; i<daysInYear; i++) { labels.push(new Date(year, 0, i + 1).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })); data.push(item.dailyArray[i] / div); }
    masterChartInstance.data.labels = labels;
    masterChartInstance.data.datasets = [{ label: 'Rain (mm)', data: data, backgroundColor: '#3498db', hoverBackgroundColor: '#e74c3c', barPercentage: 1.0, categoryPercentage: 1.0 }];
    masterChartInstance.options.plugins.tooltip = { intersect: false, callbacks: { title: (ctx) => ctx[0].label + ' ' + year, label: (ctx) => ctx.parsed.y.toFixed(1) + ' mm' } };
    masterChartInstance.update();
}

/* ============================================================
   6. MASTER ENGINE UPDATE FUNCTION
   ============================================================ */

function updateEngine() {
    const sliderValue = parseInt(document.getElementById('timeSlider').value);
    const daysInYear = ((datasetActiveYear % 4 === 0 && datasetActiveYear % 100 !== 0) || (datasetActiveYear % 400 === 0)) ? 366 : 365;

    currentSliderDateStr = getFormattedDateFromDOY(sliderValue, datasetActiveYear);
    document.getElementById('sliderDateDisplay').innerText = currentSliderDateStr;
    layers.station.clearLayers(); layers.heatmap.clearLayers();
    
    const stationMap = {}; const districtMap = {};

    globalRainData.forEach(row => {
        const d = parseDateString(row.Date);
        if (!d || d.year !== datasetActiveYear) return;
        const doy = getDayOfYear(d.day, d.month, d.year); if (doy > sliderValue) return;

        const resolved = resolveStationMeta(row.Station_Name || row['Name of the station'], row.District || "", parseFloat(row.Latitude) || 0, parseFloat(row.Longitude) || 0);
        let mm = parseFloat(row.Rainfall_mm); if (isNaN(mm)) mm = 0.0;

        if (!stationMap[resolved.uniqueKey]) {
            stationMap[resolved.uniqueKey] = {
                id: resolved.uniqueKey, name: resolved.name, lat: resolved.lat, lon: resolved.lon, district: resolved.district,
                total: 0, today: 0, winter: 0, summer: 0, swm: 0, nem: 0, vl: 0, light: 0, mod: 0, heavy: 0, vheavy: 0, extreme: 0,
                maxRain: 0, maxDate: "-", monthly: [0,0,0,0,0,0,0,0,0,0,0,0], dailyArray: new Array(daysInYear).fill(0)
            };
        }
        const st = stationMap[resolved.uniqueKey];
        st.total += mm; st.monthly[d.month - 1] += mm; st.dailyArray[doy - 1] += mm;
        if (doy === sliderValue) st.today += mm;

        if (d.month <= 2) st.winter += mm; else if (d.month <= 5) st.summer += mm; else if (d.month <= 9) st.swm += mm; else st.nem += mm;

        if (mm > 0) {
            if (mm <= 2.4) st.vl++; else if (mm <= 15.5) st.light++; else if (mm <= 64.4) st.mod++;
            else if (mm <= 115.5) st.heavy++; else if (mm <= 204.4) st.vheavy++; else st.extreme++;
            if (mm > st.maxRain) { st.maxRain = mm; st.maxDate = row.Date; }
        }
    });

    Object.values(stationMap).forEach(st => {
        const safeDistrict = st.district === "Unknown" ? "Unassigned" : st.district;
        const distKey = cleanName(safeDistrict);
        if (!districtMap[distKey]) {
            districtMap[distKey] = {
                id: distKey, name: safeDistrict, count: 0, latSum: 0, lonSum: 0, total: 0, todaySum: 0, winter: 0, summer: 0, swm: 0, nem: 0,
                vl: 0, light: 0, mod: 0, heavy: 0, vheavy: 0, extreme: 0, maxRain: 0, maxDate: "Varies", monthly: [0,0,0,0,0,0,0,0,0,0,0,0], dailyArray: new Array(daysInYear).fill(0)
            };
        }
        let d = districtMap[distKey];
        d.count++; d.latSum += st.lat; d.lonSum += st.lon; d.total += st.total; d.todaySum += st.today;
        d.winter += st.winter; d.summer += st.summer; d.swm += st.swm; d.nem += st.nem;
        d.vl += st.vl; d.light += st.light; d.mod += st.mod; d.heavy += st.heavy; d.vheavy += st.vheavy; d.extreme += st.extreme;
        if (st.maxRain > d.maxRain) { d.maxRain = st.maxRain; }
        for(let i=0; i<12; i++) d.monthly[i] += st.monthly[i];
        for(let i=0; i<daysInYear; i++) d.dailyArray[i] += st.dailyArray[i];
    });

    rawStationMap = stationMap; rawDistrictMap = districtMap;
    currentDistrictData = Object.values(districtMap); currentStationData = Object.values(stationMap);

    if (activeView === 'station') {
        for (let key in stationMap) {
            const item = stationMap[key];
            if (item.lat === 0 || item.lon === 0 || isNaN(item.lat) || isNaN(item.lon)) continue;
            
            // Uses the distinct Station Engine Color Generator
            const marker = L.circleMarker([item.lat, item.lon], { 
                radius: 7, fillColor: getStationColor(item.total), 
                color: "white", weight: 1.5, opacity: 1, fillOpacity: 0.85 
            }).addTo(layers.station);

            const canvasId = `chart-${item.id}`;
            let modeSpecificHTML = '';
            if (activePopupMode === 'stats') {
                modeSpecificHTML = `<div class="popup-tabs"><div class="popup-tab active" onclick="switchPopupTab(this, 'pane-overview-${item.id}')">Overview</div><div class="popup-tab" onclick="switchPopupTab(this, 'pane-imd-${item.id}')">IMD Days</div></div>
                    <div class="popup-pane" id="pane-overview-${item.id}"><table class="stats-table-exact"><tr><td>🌧️ Today (${currentSliderDateStr})</td><td>${item.today.toFixed(1)} mm</td></tr><tr class="row-highlight"><td>Annual Total</td><td>${item.total.toFixed(1)} mm</td></tr><tr><td>❄️ Winter</td><td>${item.winter.toFixed(1)} mm</td></tr><tr><td>☀️ Summer</td><td>${item.summer.toFixed(1)} mm</td></tr><tr><td>☁️ SWM (so far)</td><td>${item.swm.toFixed(1)} mm</td></tr><tr><td>☔ NEM</td><td>${item.nem.toFixed(1)} mm</td></tr></table><div class="sec-title">🏆 ANNUAL EXTREME</div><table class="stats-table-exact"><tr><td>Highest Single Day</td><td class="text-red">${item.maxRain.toFixed(1)} mm</td></tr><tr><td>Date of Extreme</td><td>${item.maxDate}</td></tr></table></div>
                    <div class="popup-pane" id="pane-imd-${item.id}" style="display:none;"><table class="stats-table-exact"><tr><td>V. Light (&lt; 2.5)</td><td>${item.vl} days</td></tr><tr><td>Light (2.5 - 15.5)</td><td>${item.light} days</td></tr><tr><td>Moderate (15.6 - 64.4)</td><td>${item.mod} days</td></tr><tr><td>Heavy (64.5 - 115.5)</td><td>${item.heavy} days</td></tr><tr><td>V. Heavy (115.6 - 204.4)</td><td>${item.vheavy} days</td></tr><tr><td>Ext. Heavy (&gt; 204.4)</td><td>${item.extreme} days</td></tr></table></div>`;
            } else {
                modeSpecificHTML = `<div class="metrics-grid">
                    <div class="metric-box"><div class="metric-val">${item.total.toFixed(1)}</div><div class="metric-lbl">Annual</div></div>
                    <div class="metric-box"><div class="metric-val">${item.winter.toFixed(1)}</div><div class="metric-lbl">Winter</div></div>
                    <div class="metric-box"><div class="metric-val">${item.summer.toFixed(1)}</div><div class="metric-lbl">Summer</div></div>
                    <div class="metric-box"><div class="metric-val">${item.swm.toFixed(1)}</div><div class="metric-lbl">SWM</div></div>
                    <div class="metric-box"><div class="metric-val">${item.nem.toFixed(1)}</div><div class="metric-lbl">NEM</div></div>
                </div><div style="height:120px; width:100%;"><canvas id="${canvasId}"></canvas></div>`;
            }

            marker.bindPopup(`<div class="matrix-popup"><div class="popup-header">${item.name}</div><div class="popup-sub">${item.district}</div>${modeSpecificHTML}</div>`, { maxWidth: 320 });
            marker.bindTooltip(`<b>${item.name}</b> (${item.district})<br>${item.total.toFixed(1)} mm`, { sticky: true });
            marker.on('click', function() {
                const distSelect = document.getElementById('chartDistSelect'); const stnSelect = document.getElementById('chartStnSelect');
                distSelect.value = item.district; distSelect.dispatchEvent(new Event('change'));
                setTimeout(() => { stnSelect.value = item.id; stnSelect.dispatchEvent(new Event('change')); }, 50);
            });
            marker.on('popupopen', function() {
                if (activePopupMode === 'chart') {
                    const ctx = document.getElementById(canvasId); if (!ctx) return;
                    if(chartInstances[canvasId]) chartInstances[canvasId].destroy();
                    chartInstances[canvasId] = new Chart(ctx, { type: 'bar', data: { labels: ['J','F','M','A','M','J','J','A','S','O','N','D'], datasets: [{ data: item.monthly, backgroundColor: '#3498db', borderRadius: 3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { font: {size: 9} } } } } });
                }
            });
        }
    }

    const hMetric = document.getElementById('heatmapMetric').value;
    const isDailyHeatmap = (activeView === 'heatmap' && hMetric === 'daily');

    document.getElementById('continuousLegend').style.display = isDailyHeatmap ? 'none' : 'block';
    document.getElementById('imdLegendContainer').style.display = isDailyHeatmap ? 'block' : 'none';

    if (!isDailyHeatmap) {
        let bounds, activePalette;
        
        if (activeView === 'heatmap') {
            const activeLegendMetric = hMetric;
            bounds = districtSeasonConfig[activeLegendMetric] || districtSeasonConfig['annual'];
            activePalette = districtPalette;
        } else {
            bounds = stationConfig['annual'];
            activePalette = stationPalette;
        }
        
        const maxR = bounds[bounds.length - 1];
        const lbls = document.getElementById('webContinuousLabels');
        let mStr = maxR >= 1000 ? (maxR/1000 + 'k') : maxR;
        lbls.innerHTML = `<span>0</span><span>${bounds[Math.floor(bounds.length/4)]}</span><span>${bounds[Math.floor(bounds.length/2)]}</span><span>${bounds[Math.floor((bounds.length*3)/4)]}</span><span>${maxR}</span><span style="color:#ff00ff;">>${mStr}</span>`;
        
        // Dynamically paint the CSS color bar with hard, discrete bands instead of a smooth blend
        document.getElementById('webContinuousBar').style.background = generateDiscreteGradient(activePalette);
    }

    if (activeView === 'heatmap' && tnGeoJSONData) {
        const geoJsonLayer = L.geoJSON(tnGeoJSONData, {
            style: function(feature) {
                const rawName = feature.properties.dist || feature.properties.dtname || "";
                const cName = cleanName(rawName);
                const matchedDist = getMatchedDistrict(cName);

                let val = 0;
                if (matchedDist && matchedDist.count > 0) {
                    const div = matchedDist.count;
                    if (hMetric === 'daily') val = matchedDist.todaySum / div;
                    else if (hMetric === 'annual') val = matchedDist.total / div;
                    else val = (matchedDist[hMetric] || 0) / div;
                }

                // Uses the distinct District Engine Color Generator
                const fillColor = (hMetric === 'daily') ? getIMDColor(val) : getDistrictColor(val, hMetric);

                return { fillColor: fillColor, fillOpacity: 0.82, weight: 1.5, color: '#ffffff' };
            },
            onEachFeature: function(feature, layer) {
                const rawName = feature.properties.dist || feature.properties.dtname || "District";
                const cName = cleanName(rawName);
                const matchedDist = getMatchedDistrict(cName);

                let val = 0;
                let displayName = rawName;
                if (matchedDist && matchedDist.count > 0) {
                    displayName = matchedDist.name;
                    const div = matchedDist.count;
                    if (hMetric === 'daily') val = matchedDist.todaySum / div;
                    else if (hMetric === 'annual') val = matchedDist.total / div;
                    else val = (matchedDist[hMetric] || 0) / div;
                }

                layer.bindTooltip(`<b>${displayName} District</b><br>Rainfall Avg: <b>${val.toFixed(1)} mm</b>`, { sticky: true });

                if (matchedDist && matchedDist.count > 0) {
                    const div = matchedDist.count;
                    const total = matchedDist.total / div;
                    const canvasId = `chart-dist-${matchedDist.id}`;
                    let modeSpecificHTML = '';

                    if (activePopupMode === 'stats') {
                        modeSpecificHTML = `<div class="popup-tabs"><div class="popup-tab active" onclick="switchPopupTab(this, 'pane-overview-${matchedDist.id}')">Overview</div><div class="popup-tab" onclick="switchPopupTab(this, 'pane-imd-${matchedDist.id}')">IMD Days</div></div>
                            <div class="popup-pane" id="pane-overview-${matchedDist.id}"><table class="stats-table-exact"><tr><td>🌧️ Today (${currentSliderDateStr})</td><td>${(matchedDist.todaySum/div).toFixed(1)} mm</td></tr><tr class="row-highlight"><td>Annual Total</td><td>${total.toFixed(1)} mm</td></tr><tr><td>❄️ Winter</td><td>${(matchedDist.winter/div).toFixed(1)} mm</td></tr><tr><td>☀️ Summer</td><td>${(matchedDist.summer/div).toFixed(1)} mm</td></tr><tr><td>☁️ SWM (so far)</td><td>${(matchedDist.swm/div).toFixed(1)} mm</td></tr><tr><td>☔ NEM</td><td>${(matchedDist.nem/div).toFixed(1)} mm</td></tr></table><div class="sec-title">🏆 ANNUAL EXTREME</div><table class="stats-table-exact"><tr><td>Highest Single Day</td><td class="text-red">${matchedDist.maxRain.toFixed(1)} mm</td></tr><tr><td>Date of Extreme</td><td>District Max</td></tr></table></div>
                            <div class="popup-pane" id="pane-imd-${matchedDist.id}" style="display:none;"><table class="stats-table-exact"><tr><td>V. Light (&lt; 2.5)</td><td>${(matchedDist.vl / div).toFixed(1)} days</td></tr><tr><td>Light (2.5 - 15.5)</td><td>${(matchedDist.light / div).toFixed(1)} days</td></tr><tr><td>Moderate (15.6 - 64.4)</td><td>${(matchedDist.mod / div).toFixed(1)} days</td></tr><tr><td>Heavy (64.5 - 115.5)</td><td>${(matchedDist.heavy / div).toFixed(1)} days</td></tr><tr><td>V. Heavy (115.6 - 204.4)</td><td>${(matchedDist.vheavy / div).toFixed(1)} days</td></tr><tr><td>Ext. Heavy (&gt; 204.4)</td><td>${(matchedDist.extreme / div).toFixed(1)} days</td></tr></table></div>`;
                    } else {
                        modeSpecificHTML = `<div class="metrics-grid">
                            <div class="metric-box"><div class="metric-val">${total.toFixed(1)}</div><div class="metric-lbl">Annual</div></div>
                            <div class="metric-box"><div class="metric-val">${(matchedDist.winter/div).toFixed(1)}</div><div class="metric-lbl">Winter</div></div>
                            <div class="metric-box"><div class="metric-val">${(matchedDist.summer/div).toFixed(1)}</div><div class="metric-lbl">Summer</div></div>
                            <div class="metric-box"><div class="metric-val">${(matchedDist.swm/div).toFixed(1)}</div><div class="metric-lbl">SWM</div></div>
                            <div class="metric-box"><div class="metric-val">${(matchedDist.nem/div).toFixed(1)}</div><div class="metric-lbl">NEM</div></div>
                        </div><div style="height:120px; width:100%;"><canvas id="${canvasId}"></canvas></div>`;
                    }

                    layer.bindPopup(`<div class="matrix-popup"><div class="popup-header">${displayName}</div><div class="popup-sub">Average across ${matchedDist.count} stations</div>${modeSpecificHTML}</div>`, { maxWidth: 320 });

                    layer.on('click', function() {
                        const distSelect = document.getElementById('chartDistSelect');
                        const stnSelect = document.getElementById('chartStnSelect');
                        distSelect.value = matchedDist.name;
                        distSelect.dispatchEvent(new Event('change'));
                        setTimeout(() => { stnSelect.value = "DISTRICT_AVG"; stnSelect.dispatchEvent(new Event('change')); }, 50);
                    });

                    layer.on('popupopen', function() {
                        if (activePopupMode === 'chart') {
                            const ctx = document.getElementById(canvasId); if (!ctx) return;
                            if(chartInstances[canvasId]) chartInstances[canvasId].destroy();
                            chartInstances[canvasId] = new Chart(ctx, { type: 'bar', data: { labels: ['J','F','M','A','M','J','J','A','S','O','N','D'], datasets: [{ data: matchedDist.monthly.map(val => val / div), backgroundColor: '#3498db', borderRadius: 3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { font: {size: 9} } } } } });
                        }
                    });
                }
            }
        });
        layers.heatmap.addLayer(geoJsonLayer);
    }

    populateChartDropdowns();
    updateDistrictFilterMenus();
    renderTables();

    const metaEl = document.getElementById('headerMeta');
    if (metaEl) {
        metaEl.textContent = `${datasetActiveYear} · ${currentStationData.length} stations · data through ${currentSliderDateStr}`;
    }
}

/* ============================================================
   7. TABLE SORTING & RENDERING
   ============================================================ */

function setupSortingListeners() {
    let sortedElems = document.querySelectorAll('th[data-sort]');
    sortedElems.forEach(th => {
        let newTh = th.cloneNode(true);
        th.parentNode.replaceChild(newTh, th);
        newTh.addEventListener('click', function(e) {
            if(e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.closest('.multi-select-menu')) return;
            const type = this.closest('table').id === 'districtTable' ? 'district' : 'station';
            const key = this.getAttribute('data-sort');
            if (sortConfig[type].key === key) sortConfig[type].dir = sortConfig[type].dir === 'asc' ? 'desc' : 'asc';
            else { sortConfig[type].key = key; sortConfig[type].dir = (key === 'name' || key === 'district') ? 'asc' : 'desc'; }
            renderTables();
        });
    });
}

function sortDataArray(dataArray, config, isAverageTable) {
    return [...dataArray].sort((a, b) => {
        let valA, valB; const divA = isAverageTable ? (a.count || 1) : 1; const divB = isAverageTable ? (b.count || 1) : 1;
        if (config.key.startsWith('m')) { const idx = parseInt(config.key.substring(1)); valA = a.monthly[idx] / divA; valB = b.monthly[idx] / divB; }
        else if (['annual', 'winter', 'summer', 'swm', 'nem', 'max'].includes(config.key)) { const mapKey = config.key === 'annual' ? 'total' : (config.key === 'max' ? 'maxRain' : config.key); valA = a[mapKey] / (config.key === 'max' ? 1 : divA); valB = b[mapKey] / (config.key === 'max' ? 1 : divB); }
        else { valA = a[config.key] || ""; valB = b[config.key] || ""; }

        if (['annual', 'winter', 'summer', 'swm', 'nem', 'max'].includes(config.key) || config.key.startsWith('m')) {
            valA = parseFloat(valA) || 0;
            valB = parseFloat(valB) || 0;
            return config.dir === 'asc' ? (valA - valB) : (valB - valA);
        }

        if (typeof valA === 'string') return config.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        return config.dir === 'asc' ? valA - valB : valB - valA;
    });
}

function renderTables() {
    document.querySelectorAll('.sort-icon').forEach(icon => icon.innerHTML = '');
    const distHeader = document.querySelector(`#districtTable th[data-sort="${sortConfig.district.key}"] .sort-icon`);
    if(distHeader) distHeader.innerHTML = sortConfig.district.dir === 'asc' ? '↑' : '↓';
    const statHeader = document.querySelector(`#stationTable th[data-sort="${sortConfig.station.key}"] .sort-icon`);
    if(statHeader) statHeader.innerHTML = sortConfig.station.dir === 'asc' ? '↑' : '↓';

    let distHTML = ''; let dSno = 1;
    sortDataArray(currentDistrictData, sortConfig.district, true).forEach(d => {
        const div = d.count > 0 ? d.count : 1;
        distHTML += `<tr class="row-hover"><td style="text-align:center; color:var(--text-muted);">${dSno++}</td><td style="font-weight:bold;">${d.name.toUpperCase()}</td><td style="color:#d35400; font-size:11px;">AVG (${d.count} Stn)</td><td>${(d.monthly[0]/div).toFixed(1)}</td><td>${(d.monthly[1]/div).toFixed(1)}</td><td>${(d.monthly[2]/div).toFixed(1)}</td><td>${(d.monthly[3]/div).toFixed(1)}</td><td>${(d.monthly[4]/div).toFixed(1)}</td><td>${(d.monthly[5]/div).toFixed(1)}</td><td>${(d.monthly[6]/div).toFixed(1)}</td><td>${(d.monthly[7]/div).toFixed(1)}</td><td>${(d.monthly[8]/div).toFixed(1)}</td><td>${(d.monthly[9]/div).toFixed(1)}</td><td>${(d.monthly[10]/div).toFixed(1)}</td><td>${(d.monthly[11]/div).toFixed(1)}</td><td style="font-weight:bold; color:#2980b9;">${(d.total/div).toFixed(1)}</td><td>${(d.winter/div).toFixed(1)}</td><td>${(d.summer/div).toFixed(1)}</td><td>${(d.swm/div).toFixed(1)}</td><td>${(d.nem/div).toFixed(1)}</td><td style="font-weight:bold; color:#e74c3c;">${d.maxRain.toFixed(1)}</td><td>Dist. Max</td></tr>`;
    });
    document.getElementById('districtTableBody').innerHTML = distHTML;

    let statHTML = ''; let sSno = 1;
    sortDataArray(currentStationData, sortConfig.station, false).forEach(st => {
        if (activeStationDistricts.length > 0 && !activeStationDistricts.includes(st.district)) return;
        statHTML += `<tr class="row-hover"><td style="text-align:center;">${sSno++}</td><td style="${st.district === 'Unassigned' ? 'color:#e74c3c; font-weight:bold;' : ''}">${st.district}</td><td style="font-weight:bold;">${st.name}</td><td>${st.monthly[0].toFixed(1)}</td><td>${st.monthly[1].toFixed(1)}</td><td>${st.monthly[2].toFixed(1)}</td><td>${st.monthly[3].toFixed(1)}</td><td>${st.monthly[4].toFixed(1)}</td><td>${st.monthly[5].toFixed(1)}</td><td>${st.monthly[6].toFixed(1)}</td><td>${st.monthly[7].toFixed(1)}</td><td>${st.monthly[8].toFixed(1)}</td><td>${st.monthly[9].toFixed(1)}</td><td>${st.monthly[10].toFixed(1)}</td><td>${st.monthly[11].toFixed(1)}</td><td style="font-weight:bold; color:#2980b9;">${st.total.toFixed(1)}</td><td>${st.winter.toFixed(1)}</td><td>${st.summer.toFixed(1)}</td><td>${st.swm.toFixed(1)}</td><td>${st.nem.toFixed(1)}</td><td style="font-weight:bold; color:#e74c3c;">${st.maxRain.toFixed(1)}</td><td>${st.maxDate}</td></tr>`;
    });
    document.getElementById('stationTableBody').innerHTML = statHTML;
}

/* ============================================================
   8. UI MODALS & EXPORT LOGIC
   ============================================================ */

function populateModalDistrictChecklist(containerId, checkboxClass) {
    const chkContainer = document.getElementById(containerId);
    chkContainer.innerHTML = '';
    const uniqueDistricts = new Set();
    currentStationData.forEach(st => { if (st.district !== "Unknown" && st.district !== "Unassigned") uniqueDistricts.add(st.district); });
    Array.from(uniqueDistricts).sort().forEach(dist => {
        chkContainer.innerHTML += `<label class="checklist-item"><input type="checkbox" value="${dist}" class="${checkboxClass}"> ${dist}</label>`;
    });
}

function getLatestDatasetDate() {
    let maxDOY = 1;
    globalRainData.forEach(row => {
        const d = parseDateString(row.Date);
        if(d && d.year === datasetActiveYear) {
            const doy = getDayOfYear(d.day, d.month, d.year);
            if(doy > maxDOY) maxDOY = doy;
        }
    });
    return {
        doy: maxDOY,
        dateString: `${datasetActiveYear}-${String(new Date(datasetActiveYear, 0, maxDOY).getMonth() + 1).padStart(2, '0')}-${String(new Date(datasetActiveYear, 0, maxDOY).getDate()).padStart(2, '0')}`
    };
}

function openReportModal() {
    populateModalDistrictChecklist('reportDistrictChecklist', 'dist-chk-daily');
    document.getElementById('reportDateInput').value = getLatestDatasetDate().dateString;
    document.getElementById('reportModal').style.display = 'flex';
}

function openAnnualReportModal() {
    populateModalDistrictChecklist('annualReportDistrictChecklist', 'dist-chk-annual');
    document.getElementById('annualModalYearLabel').innerText = datasetActiveYear;
    document.getElementById('annualReportModal').style.display = 'flex';
}

function toggleIdwDateInput() {
    const val = document.getElementById('idwMetricFilter').value;
    document.getElementById('idwDateGroup').style.display = (val === 'daily') ? 'block' : 'none';
    document.getElementById('idwMonthGroup').style.display = (val === 'monthly') ? 'block' : 'none';
    document.getElementById('idwCustomGroup').style.display = (val === 'custom') ? 'block' : 'none';
    if (val === 'custom') renderIdwCustomDateTags();
}

function addIdwCustomDate() {
    const input = document.getElementById('idwCustomDateInput');
    const value = input.value;
    if (!value) { showNotice("Please select a date."); return; }

    const y = Number(value.slice(0,4));
    if (y !== datasetActiveYear) { showNotice(`Please select dates within ${datasetActiveYear}.`); return; }
    if (idwCustomDates.includes(value)) { showNotice("That date is already selected."); return; }

    idwCustomDates.push(value);
    idwCustomDates.sort();
    renderIdwCustomDateTags();
    input.value = '';
}

function removeIdwCustomDate(value) {
    idwCustomDates = idwCustomDates.filter(d => d !== value);
    renderIdwCustomDateTags();
}

function renderIdwCustomDateTags() {
    const box = document.getElementById('idwCustomDateTags');
    if (!box) return;
    if (!idwCustomDates.length) {
        box.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">No dates selected.</span>';
        return;
    }
    box.innerHTML = idwCustomDates.map(value => {
        const d = new Date(value + 'T00:00:00');
        const label = d.toLocaleDateString('en-US', {day:'2-digit', month:'short', year:'numeric'});
        return `<span class="idw-date-tag">${label}<button type="button" class="idw-date-remove" onclick="removeIdwCustomDate('${value}')">×</button></span>`;
    }).join('');
}

function openIdwModal() {
    const latest = getLatestDatasetDate();
    document.getElementById('idwDateInput').value = latest.dateString;
    document.getElementById('idwMonthInput').value = String(new Date(datasetActiveYear, 0, latest.doy).getMonth());
    idwCustomDates = [];
    document.getElementById('idwCustomDateInput').value = '';
    renderIdwCustomDateTags();
    document.getElementById('idwModal').style.display = 'flex';
    toggleIdwDateInput();
}

function closeReportModal(modalId) { document.getElementById(modalId).style.display = 'none'; }

function closePreviewModal() {
    document.getElementById('previewModal').style.display = 'none';
    if(activeModalSource) document.getElementById(activeModalSource).style.display = 'flex';
}

function generateDailyReportPreview() {
    const dateVal = document.getElementById('reportDateInput').value;
    if (!dateVal) { showNotice("Please select a date."); return; }

    const selectedDistricts = Array.from(document.querySelectorAll('.dist-chk-daily:checked')).map(cb => cb.value);
    if (selectedDistricts.length === 0) { showNotice("Please select at least one district."); return; }

    const targetDate = new Date(dateVal);
    if (targetDate.getFullYear() !== datasetActiveYear) { showNotice(`Please select a date within ${datasetActiveYear}.`); return; }

    const intensityThreshold = parseFloat(document.getElementById('intensityFilter').value);
    const doy = getDayOfYear(targetDate.getDate(), targetDate.getMonth() + 1, targetDate.getFullYear());

    finalImageFileName = `Rainfall_Daily_${dateVal}.png`;
    activeModalSource = 'reportModal';

    const targetDiv = document.getElementById('exportDailyWrapper');
    if (selectedDistricts.length >= 5) {
        targetDiv.classList.remove('layout-vertical'); targetDiv.classList.add('layout-landscape');
    } else {
        targetDiv.classList.remove('layout-landscape'); targetDiv.classList.add('layout-vertical');
    }

    const results = {};
    selectedDistricts.forEach(d => results[d] = []);
    currentStationData.forEach(st => {
        if (selectedDistricts.includes(st.district)) {
            const rainOnDay = st.dailyArray[doy - 1] || 0;
            if (rainOnDay >= intensityThreshold && rainOnDay > 0) results[st.district].push({ name: st.name, rain: rainOnDay });
        }
    });

    document.getElementById('exportDailyDateLabel').innerText = targetDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    let htmlStr = ""; let hasAnyData = false;

    selectedDistricts.sort().forEach(dist => {
        const stations = results[dist];
        if (stations.length > 0) {
            hasAnyData = true;
            stations.sort((a, b) => b.rain - a.rain);
            let rowsHtml = "";
            stations.forEach(s => {
                const dynamicColor = getIMDColor(s.rain);
                rowsHtml += `<div class="export-row"><span class="export-stn">${s.name}</span><span class="export-val" style="color:${dynamicColor};">${s.rain.toFixed(1)} mm</span></div>`;
            });
            htmlStr += `<div class="export-district-block"><h3 class="export-district-name">${dist.toUpperCase()}</h3>${rowsHtml}</div>`;
        }
    });

    if (!hasAnyData) {
        htmlStr = `<div style="text-align:center; width: 100%; font-size:36px; color:var(--exp-text-dim); margin-top:50px; grid-column: 1 / -1;">No rainfall met the selected criteria.</div>`;
    }

    document.getElementById('exportDailyBodyContent').innerHTML = htmlStr;
    targetDiv.dataset.exportTheme = document.getElementById('dailyExportTheme').value;
    triggerExportRender(targetDiv, 'reportModal');
}

function generateAnnualReportPreview() {
    const selectedDistricts = Array.from(document.querySelectorAll('.dist-chk-annual:checked')).map(cb => cb.value);
    if (selectedDistricts.length === 0) { showNotice("Please select at least one district."); return; }

    const sortSelection = document.getElementById('annualSortFilter').value;
    const sortLabelText = document.getElementById('annualSortFilter').options[document.getElementById('annualSortFilter').selectedIndex].text;

    finalImageFileName = `Rainfall_Annual_${datasetActiveYear}.png`;
    activeModalSource = 'annualReportModal';

    document.getElementById('exportAnnualTitleLabel').innerText = `${datasetActiveYear} Annual Rainfall Summary`;
    document.getElementById('exportAnnualSubtitleLabel').innerText = `Ranked by ${sortLabelText}`;

    document.querySelectorAll('.export-annual-table th').forEach(th => th.classList.remove('col-highlight'));
    const highlightHeaderMap = { 'annual': 'head-annual', 'winter': 'head-winter', 'summer': 'head-summer', 'swm': 'head-swm', 'nem': 'head-nem', 'max': 'head-max' };
    const activeHeaderClass = highlightHeaderMap[sortSelection];
    if(activeHeaderClass) document.querySelector(`.export-annual-table .${activeHeaderClass}`).classList.add('col-highlight');

    let exportData = currentStationData.filter(st => selectedDistricts.includes(st.district));

    exportData.sort((a, b) => {
        let valA = 0, valB = 0;
        if (sortSelection === 'annual') { valA = a.total; valB = b.total; }
        else if (sortSelection === 'max') { valA = a.maxRain; valB = b.maxRain; }
        else { valA = a[sortSelection]; valB = b[sortSelection]; }
        return valB - valA;
    });

    let htmlStr = ""; let sNo = 1;
    exportData.forEach(st => {
        const hc = (col) => col === sortSelection ? 'col-highlight' : '';
        htmlStr += `
            <tr>
                <td style="text-align: center; color: var(--exp-text-dim2);">${sNo++}</td>
                <td style="font-weight: bold;">${st.district}</td>
                <td style="font-weight: bold; color: var(--exp-text);">${st.name}</td>
                <td>${st.monthly[0].toFixed(1)}</td><td>${st.monthly[1].toFixed(1)}</td><td>${st.monthly[2].toFixed(1)}</td>
                <td>${st.monthly[3].toFixed(1)}</td><td>${st.monthly[4].toFixed(1)}</td><td>${st.monthly[5].toFixed(1)}</td>
                <td>${st.monthly[6].toFixed(1)}</td><td>${st.monthly[7].toFixed(1)}</td><td>${st.monthly[8].toFixed(1)}</td>
                <td>${st.monthly[9].toFixed(1)}</td><td>${st.monthly[10].toFixed(1)}</td><td>${st.monthly[11].toFixed(1)}</td>
                <td class="${hc('annual')}">${st.total.toFixed(1)}</td><td class="${hc('winter')}">${st.winter.toFixed(1)}</td>
                <td class="${hc('summer')}">${st.summer.toFixed(1)}</td><td class="${hc('swm')}">${st.swm.toFixed(1)}</td>
                <td class="${hc('nem')}">${st.nem.toFixed(1)}</td><td class="${hc('max')}">${st.maxRain.toFixed(1)}</td>
                <td style="font-size: 16px; color: var(--exp-text-dim);">${st.maxDate}</td>
            </tr>
        `;
    });

    document.getElementById('exportAnnualTableBody').innerHTML = htmlStr;
    const targetDiv = document.getElementById('exportAnnualWrapper');
    targetDiv.dataset.exportTheme = document.getElementById('annualExportTheme').value;
    triggerExportRender(targetDiv, 'annualReportModal');
}

/* ============================================================
   9. SPATIAL IDW MAPPING & EXPORT
   ============================================================ */

function generateInvertedMask(geoJsonFeatureCollection) {
    let maskCoords = [[ [90, -180], [90, 180], [-90, 180], [-90, -180] ]];
    geoJsonFeatureCollection.features.forEach(f => {
        if (f.geometry.type === 'Polygon') {
            maskCoords.push(f.geometry.coordinates[0].map(pt => [pt[1], pt[0]]));
        } else if (f.geometry.type === 'MultiPolygon') {
            f.geometry.coordinates.forEach(poly => maskCoords.push(poly[0].map(pt => [pt[1], pt[0]])));
        }
    });
    return maskCoords;
}

function generateIdwPreview() {
    if(!tnGeoJSONData) { showNotice("Boundary data not loaded yet. Please wait."); return; }

    const metric = document.getElementById('idwMetricFilter').value;
    const dateVal = document.getElementById('idwDateInput').value;
    const isDaily = metric === 'daily';
    const isMonthly = metric === 'monthly';
    const isCustom = metric === 'custom';

    if (isDaily && !dateVal) { showNotice("Please select a date."); return; }
    if (isCustom && idwCustomDates.length === 0) { showNotice("Please add at least one date."); return; }

    let targetDate, doy, prettyDate, monthIndex = null, mappedCustomDates = [];

    if (isDaily) {
        targetDate = new Date(dateVal);
        if (targetDate.getFullYear() !== datasetActiveYear) { showNotice(`Please select a date within ${datasetActiveYear}.`); return; }
        prettyDate = targetDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        doy = getDayOfYear(targetDate.getDate(), targetDate.getMonth() + 1, targetDate.getFullYear());
    } else if (isMonthly) {
        monthIndex = Number(document.getElementById('idwMonthInput').value);
        const monthName = document.getElementById('idwMonthInput').options[monthIndex].text;
        prettyDate = `${monthName} ${datasetActiveYear} Total`;
    } else if (isCustom) {
        mappedCustomDates = [...idwCustomDates];
        const labels = mappedCustomDates.map(v => new Date(v + 'T00:00:00').toLocaleDateString('en-US', {day:'numeric', month:'short'}));
        prettyDate = `${labels.join(', ')} — Cumulative`;
    } else {
        prettyDate = `${datasetActiveYear} - ${metric.toUpperCase()} Total`;
    }

    document.getElementById('idwModal').style.display = 'none';
    document.getElementById('loadingModal').style.display = 'flex';

    setTimeout(() => {
        try {
            runIdwGeneration(metric, isDaily, doy, prettyDate, dateVal, monthIndex, mappedCustomDates);
        } catch(e) {
            console.error("IDW Generation Failed:", e);
            showNotice("Error generating spatial map: " + e.message);
            document.getElementById('loadingModal').style.display = 'none';
        }
    }, 100);
}

function runIdwGeneration(metric, isDaily, doy, prettyDate, dateVal, monthIndex = null, customDates = []) {
    let maxRain = 0;
    const pts = [];
    currentStationData.forEach(st => {
        if (!st.lat || !st.lon || isNaN(st.lat) || isNaN(st.lon) || st.lat === 0 || st.lon === 0) return;

        let val = 0;
        if (isDaily) val = st.dailyArray[doy - 1] || 0;
        else if (metric === 'monthly') val = (st.monthly && st.monthly[monthIndex] != null) ? st.monthly[monthIndex] : 0;
        else if (metric === 'custom') {
            val = customDates.reduce((sum, dateStr) => {
                const d = new Date(dateStr + 'T00:00:00');
                const cdoy = getDayOfYear(d.getDate(), d.getMonth() + 1, d.getFullYear());
                return sum + (st.dailyArray[cdoy - 1] || 0);
            }, 0);
        }
        else if (metric === 'annual') val = st.total;
        else val = st[metric];

        if (val > maxRain) maxRain = val;
        let lat = st.lat + (Math.random() - 0.5) * 0.00001;
        let lon = st.lon + (Math.random() - 0.5) * 0.00001;
        pts.push(turf.point([lon, lat], { rain: val }));
    });

    if (maxRain === 0) {
        showNotice("No rainfall recorded for the selected timeframe. Map cannot be generated.");
        document.getElementById('loadingModal').style.display = 'none';
        return;
    }

    const customScale300 = { thresholds: [0, 25, 50, 75, 100, 150, 200, 250, 300], colors: ["#ffffff", "#ffd1b3", "#ff9f43", "#ffe66d", "#9be564", "#2e8b57", "#21d4d8", "#7ec8ff", "#246bce"], overflow: "#ff00ff" };
    const customScale500 = { thresholds: [0, 25, 50, 75, 100, 150, 200, 250, 300, 350, 400, 500], colors: ["#ffffff", "#ffd1b3", "#ff9f43", "#ffe66d", "#9be564", "#2e8b57", "#21d4d8", "#7ec8ff", "#246bce", "#4b3f9f", "#7a2fa3", "#9b59b6"], overflow: "#ff00ff" };

    const monthlyMax = (metric === 'monthly' && monthIndex === 10) ? 1000 : 500;
    const monthlyStep = 50;

    let customScale = customScale500;
    if (metric === 'custom') {
        const includesOctOnward = customDates.some(dateStr => new Date(dateStr + 'T00:00:00').getMonth() >= 9);
        customScale = includesOctOnward ? customScale500 : customScale300;
    }

    let maxRainNormal = 2000, step = 200;
    if (metric === 'annual') { maxRainNormal = 2000; step = 200; }
    else if (metric === 'nem') { maxRainNormal = 1200; step = 100; }
    else if (metric === 'swm') { maxRainNormal = 1000; step = 100; }
    else if (metric === 'summer') { maxRainNormal = 500; step = 50; }
    else if (metric === 'winter') { maxRainNormal = 200; step = 20; }
    else if (metric === 'monthly') { maxRainNormal = monthlyMax; step = monthlyStep; }

    let numBins = Math.round(maxRainNormal / step);

    const idwMasterPalette = [
        "#d32f2f", "#f57c00", "#ffb300", "#ffeb3b",
        "#8bdc39", "#1a570b", "#00c191", "#32f3ed",
        "#087db8", "#2842e6", "#311b92", "#5e35b1"
    ];

    const pointsCollection = turf.featureCollection(pts);
    const tnBounds = L.geoJSON(tnGeoJSONData).getBounds();
    const boundingBox = [tnBounds.getWest() - 0.1, tnBounds.getSouth() - 0.1, tnBounds.getEast() + 0.1, tnBounds.getNorth() + 0.1];
    
    const grid = turf.interpolate(pointsCollection, 2.5, { gridType: 'hex', property: 'rain', units: 'kilometers', weight: 3, bbox: boundingBox });

    const filteredFeatures = [];
    turf.featureEach(grid, function (cell) { if (cell.properties.rain >= (isDaily ? 0.1 : 1)) filteredFeatures.push(cell); });
    const finalGrid = turf.featureCollection(filteredFeatures);

    if(!exportIdwMapInstance) {
        exportIdwMapInstance = L.map('idwMapExportDiv', { zoomControl: false, attributionControl: false, preferCanvas: true });
        ['gridPane', 'maskPane', 'boundsPane', 'pointsPane'].forEach((p, i) => {
            exportIdwMapInstance.createPane(p);
            exportIdwMapInstance.getPane(p).style.zIndex = 400 + (i * 10);
        });
    }

    exportIdwMapInstance.eachLayer(l => exportIdwMapInstance.removeLayer(l));

    L.geoJSON(finalGrid, {
        pane: 'gridPane',
        style: function(feature) {
            const val = feature.properties.rain; let color;
            if (isDaily) color = getIMDColor(val);
            else if (metric === 'custom') {
                if (val > customScale.thresholds[customScale.thresholds.length - 1]) color = customScale.overflow;
                else {
                    let binIdx = 0;
                    for (let i = 0; i < customScale.thresholds.length - 1; i++) { if (val > customScale.thresholds[i]) binIdx = i + 1; }
                    color = customScale.colors[Math.min(binIdx, customScale.colors.length - 1)];
                }
            } else {
                if (val > maxRainNormal) color = '#ff00ff';
                else {
                    let binIdx = Math.max(0, Math.min(numBins - 1, Math.floor((val - 0.0001) / step)));
                    let colorIdx = Math.floor((binIdx / Math.max(1, numBins - 1)) * (idwMasterPalette.length - 1));
                    color = idwMasterPalette[colorIdx];
                }
            }
            return { fillColor: color, fillOpacity: 0.95, weight: 2, color: color, stroke: true };
        }
    }).addTo(exportIdwMapInstance);

    L.polygon(generateInvertedMask(tnGeoJSONData), { pane: 'maskPane', fillColor: 'var(--exp-bg-annual)', fillOpacity: 1, stroke: false }).addTo(exportIdwMapInstance);
    L.geoJSON(tnGeoJSONData, { pane: 'boundsPane', style: { fillColor: 'transparent', color: 'var(--exp-text-dim)', weight: 1.5, opacity: 0.9 } }).addTo(exportIdwMapInstance);

    if (document.getElementById('idwShowStations').checked) {
        L.geoJSON(pointsCollection, { pane: 'pointsPane', pointToLayer: function (feature, latlng) { return L.circleMarker(latlng, { radius: 0.8, fillColor: "var(--exp-text)", color: "transparent", fillOpacity: 0.7 }); } }).addTo(exportIdwMapInstance);
    }

    document.getElementById('idwExportTitle').innerText = isDaily ? "24-Hour Spatial Distribution" : (metric === 'custom' ? "Custom Multi-Date Spatial Distribution" : "Spatial Rainfall Distribution");
    document.getElementById('idwExportSubtitle').innerText = prettyDate;

    if (isDaily) {
        document.getElementById('idwLegendImd').style.display = 'flex';
        document.getElementById('idwLegendSeasonal').style.display = 'none';
    } else {
        document.getElementById('idwLegendImd').style.display = 'none';
        document.getElementById('idwLegendSeasonal').style.display = 'flex';

        let seasonalLegendHTML = "";
        if (metric === 'custom') {
            for (let i = 0; i < customScale.thresholds.length - 1; i++) {
                const lower = customScale.thresholds[i], upper = customScale.thresholds[i + 1], color = customScale.colors[i];
                seasonalLegendHTML += `<span style="color:${color === '#FFFFFF' ? 'var(--exp-text-dim)' : color}; white-space:nowrap; font-size:13px; font-weight:700;"><span class="legend-dot" style="background:${color}; border:1px solid rgba(255,255,255,0.2);"></span> ${lower === 0 ? `1-${upper}` : `${lower}-${upper}`}</span>`;
            }
            seasonalLegendHTML += `<span style="color:${customScale.overflow}; white-space:nowrap; font-size:13px; font-weight:700;"><span class="legend-dot" style="background:${customScale.overflow}; border:1px solid rgba(255,255,255,0.2);"></span> &gt; ${customScale.thresholds[customScale.thresholds.length - 1]}</span>`;
        } else {
            for (let i = 0; i < numBins; i++) {
                let color = idwMasterPalette[Math.floor((i / Math.max(1, numBins - 1)) * (idwMasterPalette.length - 1))];
                let label = i === 0 ? `1-${(i + 1) * step}` : `${(i * step) + 1}-${(i + 1) * step}`;
                seasonalLegendHTML += `<span style="color:${color}; white-space:nowrap; font-size:13px; font-weight:700;"><span class="legend-dot" style="background:${color}; border:1px solid rgba(255,255,255,0.2);"></span> ${label}</span>`;
            }
            seasonalLegendHTML += `<span style="color:#ff00ff; white-space:nowrap; font-size:13px; font-weight:700;"><span class="legend-dot" style="background:#ff00ff; border:1px solid rgba(255,255,255,0.2);"></span> &gt; ${maxRainNormal}</span>`;
        }
        document.getElementById('seasonalLegendBlocks').innerHTML = seasonalLegendHTML;
    }

    finalImageFileName = `IDW_Map_${isDaily ? dateVal : (metric === 'custom' ? 'custom_multidate' : metric+'_'+datasetActiveYear)}.png`;
    activeModalSource = '';

    const targetDiv = document.getElementById('exportIdwWrapper');
    targetDiv.dataset.exportTheme = document.getElementById('idwExportTheme').value;
    targetDiv.style.display = 'flex';
    exportIdwMapInstance.invalidateSize(true);
    exportIdwMapInstance.fitBounds(tnBounds);

    setTimeout(() => {
        document.getElementById('loadingModal').style.display = 'none';
        document.getElementById('previewContainer').innerHTML = '<span style="color: #fff; line-height: 100px;">Capturing High-Res Map...</span>';
        document.getElementById('previewModal').style.display = 'flex';

        html2canvas(targetDiv, { scale: 2, useCORS: true, backgroundColor: getComputedStyle(targetDiv).backgroundColor }).then(canvas => {
            targetDiv.style.display = 'none';
            finalImageBase64 = canvas.toDataURL('image/png');
            document.getElementById('previewContainer').innerHTML = `<img id="previewImage" src="${finalImageBase64}" />`;
        });
    }, 1000);
}

function triggerExportRender(targetDiv, modalIdToClose) {
    document.getElementById(modalIdToClose).style.display = 'none';
    document.getElementById('previewContainer').innerHTML = '<span style="color: #fff; line-height: 100px;">Generating High-Res Image...</span>';
    document.getElementById('previewModal').style.display = 'flex';
    targetDiv.style.display = 'flex';
    setTimeout(() => {
        html2canvas(targetDiv, { scale: 2, backgroundColor: getComputedStyle(targetDiv).backgroundColor }).then(canvas => {
            targetDiv.style.display = 'none';
            finalImageBase64 = canvas.toDataURL('image/png');
            document.getElementById('previewContainer').innerHTML = `<img id="previewImage" src="${finalImageBase64}" />`;
        });
    }, 100);
}

function downloadPreviewImage() {
    if (!finalImageBase64) return;
    const link = document.createElement('a');
    link.download = finalImageFileName; link.href = finalImageBase64; link.click();
    document.getElementById('previewModal').style.display = 'none';
}

/* ============================================================
   10. FORECAST IFRAME CONTROLLER
   ============================================================ */

(function(){
    const forecastBtn = document.getElementById('openForecastBtn');
    const closeBtn = document.getElementById('closeForecastBtn');
    const panel = document.getElementById('forecastAppPanel');
    const dashboard = document.getElementById('tnSmartDashboard');

    function openForecast() {
        if(!panel) return;
        panel.classList.add('open');
        panel.setAttribute('aria-hidden','false');
        if(dashboard) dashboard.style.visibility='hidden';
        document.body.style.overflow='hidden';

        setTimeout(() => {
            const frame = document.getElementById('forecastFrame');
            if(frame && frame.contentWindow){
                try { frame.contentWindow.dispatchEvent(new Event('resize')); } catch(e){}
            }
        }, 150);
    }

    function closeForecast() {
        if(!panel) return;
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden','true');
        if(dashboard) dashboard.style.visibility='';
        document.body.style.overflow='';
    }

    if(forecastBtn) forecastBtn.addEventListener('click', openForecast);
    if(closeBtn) closeBtn.addEventListener('click', closeForecast);

    window.addEventListener('keydown', e => {
        if(e.key === 'Escape' && panel && panel.classList.contains('open')) closeForecast();
    });
})();