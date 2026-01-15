const DEFAULT_CONFIG = {
  baseUrl: "https://api.t-vos.com/v1.23",
  token: "",
  endpoint: "/Voyage",
};

const STORAGE_KEY = "theyr-voyage-config";

const elements = {
  baseUrl: document.getElementById("baseUrl"),
  token: document.getElementById("token"),
  voyageEndpoint: document.getElementById("voyageEndpoint"),
  voyagePayload: document.getElementById("voyagePayload"),
  saveConfig: document.getElementById("saveConfig"),
  loadVoyages: document.getElementById("loadVoyages"),
  voyageList: document.getElementById("voyageList"),
  statusPill: document.getElementById("statusPill"),
};

let config = loadConfig();
let map;
let routeLayer;
let voyages = [];

init();

function init() {
  hydrateInputs();
  initMap();
  bindEvents();
  updateStatus(!!config.token);
}

function bindEvents() {
  elements.saveConfig.addEventListener("click", () => {
    config = readConfigFromInputs();
    saveConfig(config);
    updateStatus(!!config.token);
  });

  elements.loadVoyages.addEventListener("click", loadVoyages);
}

function initMap() {
  map = L.map("map").setView([20, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
}

function loadConfig() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch (error) {
    console.warn("Failed to parse config", error);
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(nextConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConfig));
}

function hydrateInputs() {
  elements.baseUrl.value = config.baseUrl;
  elements.token.value = config.token;
  elements.voyageEndpoint.value = config.endpoint;
}

function readConfigFromInputs() {
  return {
    baseUrl: elements.baseUrl.value.trim(),
    token: elements.token.value.trim(),
    endpoint: elements.voyageEndpoint.value.trim(),
  };
}

function updateStatus(isConnected) {
  elements.statusPill.textContent = isConnected ? "Token set" : "Token missing";
  elements.statusPill.classList.toggle("connected", isConnected);
}

function buildUrl(path) {
  return `${config.baseUrl.replace(/\/$/, "")}${path}`;
}

async function fetchJson(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: { ...headers, ...options.headers },
    body: options.body ?? null,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${message}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function loadVoyages() {
  setLoading(elements.loadVoyages, true);
  try {
    config = readConfigFromInputs();
    saveConfig(config);
    const url = buildUrl(config.endpoint);
    const payload = parseJsonPayload(elements.voyagePayload.value);
    const data = await fetchJson(url, {
      method: "POST",
      body: payload ? JSON.stringify(payload) : null,
    });
    voyages = normalizeArray(data, ["voyages", "items", "data", "results"]) || [];
    updateVoyageList(voyages);
    updateStatus(!!config.token);
    if (voyages.length > 0) {
      selectVoyage(voyages[0], 0);
    }
  } catch (error) {
    console.error(error);
    alert(`Failed to load voyages: ${error.message}`);
  } finally {
    setLoading(elements.loadVoyages, false);
  }
}

function parseJsonPayload(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return JSON.parse(trimmed);
}

function normalizeArray(data, keys) {
  if (Array.isArray(data)) {
    return data;
  }
  for (const key of keys) {
    if (data && Array.isArray(data[key])) {
      return data[key];
    }
  }
  return null;
}

function updateVoyageList(items) {
  elements.voyageList.innerHTML = "";
  if (!items.length) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = "No voyages returned.";
    elements.voyageList.appendChild(emptyItem);
    return;
  }
  items.forEach((voyage, index) => {
    const button = document.createElement("button");
    const name = voyage.name || voyage.title || voyage.id || `Voyage ${index + 1}`;
    const status = voyage.status || voyage.state || "Unknown status";
    button.textContent = `${name} · ${status}`;
    button.addEventListener("click", () => selectVoyage(voyage, index));
    elements.voyageList.appendChild(button);
  });
}

function selectVoyage(voyage, index) {
  const buttons = elements.voyageList.querySelectorAll("button");
  buttons.forEach((button, idx) => {
    button.classList.toggle("active", idx === index);
  });
  renderRoute(voyage);
}

function renderRoute(voyage) {
  routeLayer.clearLayers();
  const coordinates = extractCoordinates(voyage);
  if (!coordinates.length) {
    return;
  }
  const polyline = L.polyline(coordinates, { color: "#1f6feb", weight: 4 }).addTo(routeLayer);
  map.fitBounds(polyline.getBounds(), { padding: [30, 30] });
}

function extractCoordinates(voyage) {
  if (!voyage) {
    return [];
  }
  if (voyage.geometry && Array.isArray(voyage.geometry.coordinates)) {
    return voyage.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  }
  if (Array.isArray(voyage.coordinates)) {
    return voyage.coordinates.map((point) => normalizePoint(point)).filter(Boolean);
  }
  if (Array.isArray(voyage.path)) {
    return voyage.path.map((point) => normalizePoint(point)).filter(Boolean);
  }
  if (Array.isArray(voyage.waypoints)) {
    return voyage.waypoints.map((point) => normalizePoint(point)).filter(Boolean);
  }
  return [];
}

function normalizePoint(point) {
  if (!point) {
    return null;
  }
  if (Array.isArray(point) && point.length >= 2) {
    return [point[1], point[0]];
  }
  const lat = point.lat ?? point.latitude;
  const lng = point.lng ?? point.lon ?? point.longitude;
  if (lat !== undefined && lng !== undefined) {
    return [lat, lng];
  }
  return null;
}

function setLoading(button, isLoading) {
  if (!button) {
    return;
  }
  if (!button.dataset.label) {
    button.dataset.label = button.textContent;
  }
  button.disabled = isLoading;
  button.textContent = isLoading ? "Loading..." : button.dataset.label || button.textContent;
}
