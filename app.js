const LAND_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson";
const LAKE_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const state = {
  mode: "circle",
  radiusKm: 5,
  center: null,
  polygonPoints: [],
  landFeatures: [],
  lakeFeatures: [],
  osmWaterFeatures: [],
  osmWaterKey: null,
  surfaceReady: false,
  surfacePromise: null,
  currentLayer: null,
  centerMarker: null,
  polygonMarkers: [],
  resultMarker: null,
  resultLatLng: null,
  baseLayer: null,
  spinLine: null,
  spinDot: null,
  spinFrame: null,
  isPicking: false,
  pickRunId: 0,
};

const tiles = {
  standard: L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 19,
    updateWhenIdle: false,
    keepBuffer: 4,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }),
  satellite: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      updateWhenIdle: false,
      keepBuffer: 4,
      attribution:
        "Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  ),
  topo: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      updateWhenIdle: false,
      keepBuffer: 4,
      attribution: "Tiles &copy; Esri, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors",
    },
  ),
  hillshade: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    {
      opacity: 0.2,
      maxZoom: 16,
      updateWhenIdle: false,
      keepBuffer: 4,
      attribution: "Hillshade &copy; Esri",
    },
  ),
};

const mapLayers = {
  standard: L.layerGroup([tiles.standard]),
  satellite: L.layerGroup([tiles.satellite]),
  topo: L.layerGroup([tiles.topo, tiles.hillshade]),
};

const tileFallback = {
  satellite: "standard",
  topo: "standard",
};

Object.entries(tiles).forEach(([key, layer]) => {
  layer.on("tileerror", () => {
    if (key === "standard") {
      setStatus("Noen kartfliser lastet ikke. Prøv å refreshe siden.");
      return;
    }

    const fallback = tileFallback[key] ?? "standard";
    document.querySelector("#mapStyle").value = fallback;
    setMapStyle(fallback);
    setStatus("Kartlaget svarte dårlig, så jeg byttet til standardkart.");
  });
});

const map = L.map("map", {
  attributionControl: false,
  zoomControl: false,
  worldCopyJump: true,
  preferCanvas: true,
}).setView([35, 10], 3);

L.control.zoom({ position: "topright" }).addTo(map);
state.baseLayer = mapLayers.standard.addTo(map);

const pickButton = document.querySelector("#pickButton");
const radiusInput = document.querySelector("#radius");
const radiusValue = document.querySelector("#radiusValue");
const statusEl = document.querySelector("#status");
const allowLandEl = document.querySelector("#allowLand");
const allowWaterEl = document.querySelector("#allowWater");
const coordFormatEl = document.querySelector("#coordFormat");
const coordinateOutputEl = document.querySelector("#coordinateOutput");

loadSurfaceData();

document.querySelectorAll(".mode-button").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    document
      .querySelectorAll(".mode-button")
      .forEach((item) => item.classList.toggle("is-active", item === button));
    clearSelection();
    setStatus(
      state.mode === "circle"
        ? "Trykk på kartet for å sette sentrum for sirkelen."
        : "Sett minst tre punkter på kartet for å tegne området.",
    );
  });
});

radiusInput.addEventListener("input", () => {
  state.radiusKm = Number(radiusInput.value);
  updateRadiusLabel();
  if (state.mode === "circle" && state.center) {
    drawCircle();
  }
});

document.querySelector("#clearButton").addEventListener("click", () => {
  clearSelection();
  setStatus(
    state.mode === "circle"
      ? "Området er nullstilt. Trykk på kartet for å sette sentrum."
      : "Området er nullstilt. Sett minst tre punkter på kartet.",
  );
});

document.querySelector("#mapStyle").addEventListener("change", (event) => {
  setMapStyle(event.target.value);
});

pickButton.addEventListener("click", pickPoint);
coordFormatEl.addEventListener("change", updateCoordinateOutput);

map.on("click", (event) => {
  if (state.isPicking) {
    return;
  }

  if (state.mode === "circle") {
    state.center = event.latlng;
    drawCircle();
    setStatus("Sirkel valgt. Juster radius eller trykk PickPoint.");
    return;
  }

  state.polygonPoints.push(event.latlng);
  drawPolygon();
  setStatus(
    state.polygonPoints.length < 3
      ? `Sett ${3 - state.polygonPoints.length} punkt til for å lukke området.`
      : "Polygon valgt. Legg til flere punkter eller trykk PickPoint.",
  );
});

window.addEventListener("resize", () => map.invalidateSize());
window.requestAnimationFrame(() => {
  map.invalidateSize(true);
  window.setTimeout(() => map.invalidateSize(true), 250);
});
updateRadiusLabel();

async function loadSurfaceData() {
  setStatus("Laster presist land/vann-filter ...");
  state.surfacePromise = loadSurfacePromise();
  await state.surfacePromise;
}

async function loadSurfacePromise() {
  try {
    const [landResponse, lakeResponse] = await Promise.all([
      fetch(LAND_GEOJSON_URL),
      fetch(LAKE_GEOJSON_URL),
    ]);

    if (!landResponse.ok || !lakeResponse.ok) {
      throw new Error(`HTTP ${landResponse.status}/${lakeResponse.status}`);
    }

    const [landData, lakeData] = await Promise.all([landResponse.json(), lakeResponse.json()]);
    state.landFeatures = createFeatureIndex(landData.features);
    state.lakeFeatures = createFeatureIndex(lakeData.features);
    state.surfaceReady = true;
    setStatus("Klar. Trykk på kartet for å velge et område.");
  } catch (error) {
    console.warn("Could not load surface data", error);
    setStatus("Kartet er klart, men land/vann-filteret kunne ikke lastes.");
  }
}

function createFeatureIndex(features) {
  return features.map((feature) => ({
    feature,
    bbox: turf.bbox(feature),
  }));
}

function drawCircle() {
  removeSelectionLayer();
  if (state.centerMarker) {
    map.removeLayer(state.centerMarker);
  }

  state.centerMarker = L.circleMarker(state.center, {
    radius: 8,
    color: "#17201b",
    fillColor: "#da2e28",
    fillOpacity: 1,
    weight: 2,
  }).addTo(map);

  state.currentLayer = L.circle(state.center, {
    radius: state.radiusKm * 1000,
    color: "#da2e28",
    fillColor: "#da2e28",
    fillOpacity: 0.16,
    weight: 3,
  }).addTo(map);

  state.currentLayer.bringToFront();
  state.centerMarker.bringToFront();
}

function setMapStyle(style) {
  if (state.baseLayer) {
    map.removeLayer(state.baseLayer);
  }

  state.baseLayer = mapLayers[style].addTo(map);
  map.invalidateSize(true);
  window.setTimeout(() => map.invalidateSize(true), 120);
}

function updateRadiusLabel() {
  radiusValue.textContent =
    state.radiusKm < 1 ? `${Math.round(state.radiusKm * 1000)} m` : `${formatKm(state.radiusKm)} km`;
}

function formatKm(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function drawPolygon() {
  removeSelectionLayer();
  clearPolygonMarkers();

  state.polygonPoints.forEach((point, index) => {
    const marker = L.circleMarker(point, {
      radius: 7,
      color: "#17201b",
      fillColor: "#da2e28",
      fillOpacity: 1,
      weight: 2,
    }).addTo(map);
    state.polygonMarkers.push(marker);
  });

  if (state.polygonPoints.length >= 2) {
    state.currentLayer = L.polygon(state.polygonPoints, {
      color: "#da2e28",
      fillColor: "#da2e28",
      fillOpacity: 0.12,
      weight: 3,
    }).addTo(map);
    state.currentLayer.bringToFront();
  }

  state.polygonMarkers.forEach((marker) => marker.bringToFront());
}

function clearSelection() {
  cancelPickAnimation();
  state.center = null;
  state.polygonPoints = [];
  state.resultLatLng = null;
  updateCoordinateOutput();
  removeSelectionLayer();
  clearPolygonMarkers();

  if (state.centerMarker) {
    map.removeLayer(state.centerMarker);
    state.centerMarker = null;
  }

  if (state.resultMarker) {
    map.removeLayer(state.resultMarker);
    state.resultMarker = null;
  }
}

function removeSelectionLayer() {
  if (state.currentLayer) {
    map.removeLayer(state.currentLayer);
    state.currentLayer = null;
  }
}

function clearPolygonMarkers() {
  state.polygonMarkers.forEach((marker) => map.removeLayer(marker));
  state.polygonMarkers = [];
}

async function pickPoint() {
  if (state.isPicking) {
    return;
  }

  if (!allowLandEl.checked && !allowWaterEl.checked) {
    setStatus("Velg minst land eller vann før du plukker et punkt.");
    return;
  }

  const area = getSelectedArea();
  if (!area) {
    return;
  }

  state.isPicking = true;
  const runId = state.pickRunId + 1;
  state.pickRunId = runId;
  pickButton.disabled = true;
  pickButton.textContent = "Spinner ...";

  try {
    const needsSurfaceFilter = allowLandEl.checked !== allowWaterEl.checked;
    if (needsSurfaceFilter && !state.surfaceReady) {
      setStatus("Venter på presist land/vann-filter ...");
      await state.surfacePromise;
      if (runId !== state.pickRunId) return;
    }
    if (needsSurfaceFilter) {
      await loadLocalWaterData(area);
      if (runId !== state.pickRunId) return;
    }

    const point = findRandomPoint(area);
    if (!point) {
      setStatus("Fant ikke et punkt som matcher filteret. Prøv større område eller flere valg.");
      return;
    }

    const [lng, lat] = point.geometry.coordinates;
    if (area.type === "circle") {
      await animateCirclePick(area, point);
      if (runId !== state.pickRunId) return;
    }
    showResult(lat, lng);
  } finally {
    if (runId === state.pickRunId) {
      state.isPicking = false;
      pickButton.disabled = false;
      pickButton.textContent = "PickPoint";
    }
  }
}

function getSelectedArea() {
  if (state.mode === "circle") {
    if (!state.center) {
      setStatus("Velg sentrum for sirkelen først.");
      return null;
    }
    return {
      type: "circle",
      center: turf.point([state.center.lng, state.center.lat]),
      polygon: turf.circle([state.center.lng, state.center.lat], state.radiusKm, {
        steps: 96,
        units: "kilometers",
      }),
    };
  }

  if (state.polygonPoints.length < 3) {
    setStatus("Punkttegning trenger minst tre punkter.");
    return null;
  }

  const ring = state.polygonPoints.map((point) => [point.lng, point.lat]);
  ring.push(ring[0]);
  return {
    type: "polygon",
    polygon: turf.polygon([ring]),
  };
}

function findRandomPoint(area) {
  const bbox = turf.bbox(area.polygon);
  const needsSurfaceFilter = allowLandEl.checked !== allowWaterEl.checked;
  const maxAttempts = needsSurfaceFilter ? 16000 : 1200;
  const needsOnlyWater = allowWaterEl.checked && !allowLandEl.checked;

  if (needsOnlyWater && state.osmWaterFeatures.length > 0) {
    const waterPoint = findRandomPointInWaterFeature(area);
    if (waterPoint) {
      return waterPoint;
    }
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const point = randomPointInBbox(bbox);
    if (areaContainsPoint(area, point) && matchesSurfaceFilter(point)) {
      return point;
    }
  }

  return null;
}

function findRandomPointInWaterFeature(area) {
  for (let attempt = 0; attempt < 6000; attempt += 1) {
    const indexedFeature =
      state.osmWaterFeatures[Math.floor(Math.random() * state.osmWaterFeatures.length)];
    const point = randomPointInBbox(indexedFeature.bbox);

    if (
      areaContainsPoint(area, point) &&
      turf.booleanPointInPolygon(point, indexedFeature.feature) &&
      matchesSurfaceFilter(point)
    ) {
      return point;
    }
  }

  return null;
}

function areaContainsPoint(area, point) {
  if (!turf.booleanPointInPolygon(point, area.polygon)) {
    return false;
  }

  if (area.type !== "circle") {
    return true;
  }

  const distance = turf.distance(area.center, point, { units: "kilometers" });
  return distance <= state.radiusKm;
}

function randomPointInBbox([minLng, minLat, maxLng, maxLat]) {
  const lng = minLng + Math.random() * (maxLng - minLng);
  const lat = minLat + Math.random() * (maxLat - minLat);
  return turf.point([lng, lat]);
}

function matchesSurfaceFilter(point) {
  if (allowLandEl.checked && allowWaterEl.checked) {
    return true;
  }

  if (!state.surfaceReady) {
    return true;
  }

  const isOsmWater = pointInIndexedFeatures(point, state.osmWaterFeatures);
  const isLake = pointInIndexedFeatures(point, state.lakeFeatures);
  const isLandPolygon = pointInIndexedFeatures(point, state.landFeatures);
  const isWater = isOsmWater || isLake || !isLandPolygon;
  const isLand = isLandPolygon && !isLake && !isOsmWater;
  return allowLandEl.checked ? isLand : isWater;
}

async function loadLocalWaterData(area) {
  const bbox = turf.bbox(area.polygon);
  const key = bbox.map((value) => value.toFixed(3)).join(",");
  if (state.osmWaterKey === key) {
    return;
  }

  state.osmWaterKey = key;
  state.osmWaterFeatures = [];
  setStatus("Henter lokale vannflater fra OpenStreetMap ...");

  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      body: new URLSearchParams({ data: buildOverpassQuery(bbox) }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const osmData = await response.json();
    const features = overpassToWaterFeatures(osmData);
    state.osmWaterFeatures = createFeatureIndex(features);
    setStatus("Lokale vannflater er lastet. Velger punkt ...");
  } catch (error) {
    console.warn("Could not load local OSM water data", error);
    setStatus("Kunne ikke hente lokale OSM-vannflater. Bruker globalt filter.");
  }
}

function buildOverpassQuery([minLng, minLat, maxLng, maxLat]) {
  const south = clamp(minLat, -85, 85).toFixed(6);
  const west = clamp(minLng, -180, 180).toFixed(6);
  const north = clamp(maxLat, -85, 85).toFixed(6);
  const east = clamp(maxLng, -180, 180).toFixed(6);
  const bbox = `${south},${west},${north},${east}`;

  return `[out:json][timeout:14];
(
  way["natural"="water"](${bbox});
  relation["natural"="water"](${bbox});
  way["water"~"."](${bbox});
  relation["water"~"."](${bbox});
  way["waterway"="riverbank"](${bbox});
  relation["waterway"="riverbank"](${bbox});
  way["landuse"="reservoir"](${bbox});
  relation["landuse"="reservoir"](${bbox});
  way["landuse"="basin"](${bbox});
  relation["landuse"="basin"](${bbox});
);
out geom;`;
}

function overpassToWaterFeatures(osmData) {
  let convertedFeatures = [];
  if (typeof osmtogeojson === "function") {
    try {
      convertedFeatures = osmtogeojson(osmData).features;
    } catch (error) {
      console.warn("Could not convert OSM relations", error);
    }
  }
  const polygonFeatures = convertedFeatures.filter((feature) =>
    ["Polygon", "MultiPolygon"].includes(feature.geometry?.type),
  );

  if (polygonFeatures.length > 0) {
    return polygonFeatures;
  }

  return osmData.elements
    .filter((element) => element.type === "way" && element.geometry?.length >= 4)
    .map((element) => {
      const coordinates = element.geometry.map((node) => [node.lon, node.lat]);
      const first = coordinates[0];
      const last = coordinates[coordinates.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coordinates.push(first);
      }
      return turf.polygon([coordinates]);
    });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pointInIndexedFeatures(point, indexedFeatures) {
  const [lng, lat] = point.geometry.coordinates;
  return indexedFeatures.some(({ feature, bbox }) => {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) {
      return false;
    }
    return turf.booleanPointInPolygon(point, feature);
  });
}

function showResult(lat, lng) {
  removePickAnimationLayers();
  if (state.resultMarker) {
    map.removeLayer(state.resultMarker);
  }

  state.resultLatLng = L.latLng(lat, lng);
  state.resultMarker = L.circleMarker([lat, lng], {
    radius: 8,
    color: "#ffffff",
    fillColor: "#da2e28",
    fillOpacity: 1,
    opacity: 1,
    weight: 2,
  }).addTo(map);

  state.resultMarker.bringToFront();
  updateCoordinateOutput();
  map.panTo([lat, lng], { animate: true });
  setStatus("Punkt valgt. Koordinatene står i sidebaren.");
}

async function animateCirclePick(area, finalPoint) {
  clearPickAnimationFrame();
  removePickAnimationLayers();
  if (state.resultMarker) {
    map.removeLayer(state.resultMarker);
    state.resultMarker = null;
  }

  const centerLatLng = L.latLng(state.center.lat, state.center.lng);
  const finalBearing = normalizeBearing(turf.bearing(area.center, finalPoint));
  const finalDistanceKm = turf.distance(area.center, finalPoint, { units: "kilometers" });
  const finalFraction = Math.min(1, Math.max(0, finalDistanceKm / state.radiusKm));

  setStatus("Spinner retningen ...");
  await animateSpinLine(centerLatLng, finalBearing);
  setStatus("Velger punkt på streken ...");
  await animateDotOnLine(centerLatLng, finalBearing, finalFraction);
}

function animateSpinLine(centerLatLng, finalBearing) {
  const duration = 4000;
  const totalRotation = 360 * 4 + finalBearing;

  state.spinLine = L.polyline([centerLatLng, pointOnCircleEdge(centerLatLng, 0)], {
    color: "#da2e28",
    weight: 3,
    opacity: 0.95,
    interactive: false,
    lineCap: "round",
  }).addTo(map);
  state.spinLine.bringToFront();

  return animateFor(duration, (progress) => {
    const eased = easeOutCubic(progress);
    const bearing = totalRotation * eased;
    state.spinLine.setLatLngs([centerLatLng, pointOnCircleEdge(centerLatLng, bearing)]);
  });
}

function animateDotOnLine(centerLatLng, bearing, finalFraction) {
  const duration = 4000;
  state.spinDot = L.circleMarker(centerLatLng, {
    radius: 7,
    color: "#ffffff",
    fillColor: "#da2e28",
    fillOpacity: 1,
    opacity: 1,
    weight: 2,
    interactive: false,
  }).addTo(map);
  state.spinDot.bringToFront();

  return animateFor(duration, (progress) => {
    const eased = easeInOutCubic(progress);
    const movingFraction = triangleWave(progress * 4.5);
    const radialFraction = clamp01(movingFraction * (1 - eased) + finalFraction * eased);
    state.spinDot.setLatLng(pointOnRadius(centerLatLng, bearing, radialFraction));
  });
}

function animateFor(duration, draw) {
  return new Promise((resolve) => {
    const start = performance.now();

    const frame = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      draw(progress);

      if (progress < 1 && state.isPicking) {
        state.spinFrame = requestAnimationFrame(frame);
        return;
      }

      state.spinFrame = null;
      if (state.isPicking) {
        draw(1);
      }
      resolve();
    };

    state.spinFrame = requestAnimationFrame(frame);
  });
}

function pointOnCircleEdge(centerLatLng, bearing) {
  return pointOnRadius(centerLatLng, bearing, 1);
}

function pointOnRadius(centerLatLng, bearing, fraction) {
  const point = turf.destination(
    [centerLatLng.lng, centerLatLng.lat],
    state.radiusKm * fraction,
    normalizeBearing(bearing),
    { units: "kilometers" },
  );
  const [lng, lat] = point.geometry.coordinates;
  return L.latLng(lat, lng);
}

function cancelPickAnimation() {
  state.pickRunId += 1;
  clearPickAnimationFrame();
  removePickAnimationLayers();
  state.isPicking = false;
  pickButton.disabled = false;
  pickButton.textContent = "PickPoint";
}

function clearPickAnimationFrame() {
  if (state.spinFrame) {
    cancelAnimationFrame(state.spinFrame);
    state.spinFrame = null;
  }
}

function removePickAnimationLayers() {
  if (state.spinLine) {
    map.removeLayer(state.spinLine);
    state.spinLine = null;
  }
  if (state.spinDot) {
    map.removeLayer(state.spinDot);
    state.spinDot = null;
  }
}

function normalizeBearing(bearing) {
  return ((bearing % 360) + 360) % 360;
}

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
}

function easeInOutCubic(value) {
  return value < 0.5 ? 4 * value ** 3 : 1 - ((-2 * value + 2) ** 3) / 2;
}

function triangleWave(value) {
  const phase = value % 1;
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function setStatus(message) {
  statusEl.textContent = message;
}

function updateCoordinateOutput() {
  if (!state.resultLatLng) {
    coordinateOutputEl.textContent = "Ingen punkt valgt";
    return;
  }

  const { lat, lng } = state.resultLatLng;
  coordinateOutputEl.textContent = formatCoordinate(lat, lng, coordFormatEl.value);
}

function formatCoordinate(lat, lng, format) {
  if (format === "dms") {
    return `${toDms(lat, "lat")}  ${toDms(lng, "lng")}`;
  }

  if (format === "utm") {
    const utm = latLonToUtm(lat, lng);
    return `${utm.zone}${utm.band}  ${Math.round(utm.easting)} E  ${Math.round(utm.northing)} N`;
  }

  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function toDms(value, axis) {
  const direction =
    axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutesFloat = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = (minutesFloat - minutes) * 60;
  return `${degrees}°${minutes}'${seconds.toFixed(2)}"${direction}`;
}

function latLonToUtm(lat, lng) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e = Math.sqrt(f * (2 - f));
  const ePrimeSq = e ** 2 / (1 - e ** 2);
  const zone = getUtmZone(lat, lng);
  const lonOrigin = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const latRad = lat * (Math.PI / 180);
  const lonRad = lng * (Math.PI / 180);
  const n = a / Math.sqrt(1 - e ** 2 * Math.sin(latRad) ** 2);
  const t = Math.tan(latRad) ** 2;
  const c = ePrimeSq * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lonRad - lonOrigin);
  const m =
    a *
    ((1 - e ** 2 / 4 - (3 * e ** 4) / 64 - (5 * e ** 6) / 256) * latRad -
      ((3 * e ** 2) / 8 + (3 * e ** 4) / 32 + (45 * e ** 6) / 1024) *
        Math.sin(2 * latRad) +
      ((15 * e ** 4) / 256 + (45 * e ** 6) / 1024) * Math.sin(4 * latRad) -
      ((35 * e ** 6) / 3072) * Math.sin(6 * latRad));
  const easting =
    k0 *
      n *
      (A +
        ((1 - t + c) * A ** 3) / 6 +
        ((5 - 18 * t + t ** 2 + 72 * c - 58 * ePrimeSq) * A ** 5) / 120) +
    500000;
  let northing =
    k0 *
    (m +
      n *
        Math.tan(latRad) *
        ((A ** 2) / 2 +
          ((5 - t + 9 * c + 4 * c ** 2) * A ** 4) / 24 +
          ((61 - 58 * t + t ** 2 + 600 * c - 330 * ePrimeSq) * A ** 6) / 720));

  if (lat < 0) {
    northing += 10000000;
  }

  return {
    zone,
    band: utmLatitudeBand(lat),
    easting,
    northing,
  };
}

function utmLatitudeBand(lat) {
  const bands = "CDEFGHJKLMNPQRSTUVWX";
  if (lat <= -80) return "C";
  if (lat >= 84) return "X";
  return bands[Math.floor((lat + 80) / 8)];
}

function getUtmZone(lat, lng) {
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) {
    return 32;
  }

  if (lat >= 72 && lat < 84) {
    if (lng >= 0 && lng < 9) return 31;
    if (lng >= 9 && lng < 21) return 33;
    if (lng >= 21 && lng < 33) return 35;
    if (lng >= 33 && lng < 42) return 37;
  }

  return Math.floor((lng + 180) / 6) + 1;
}
