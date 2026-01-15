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
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  pageNumber: document.getElementById("pageNumber"),
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
  elements.prevPage.addEventListener("click", () => changePage(-1));
  elements.nextPage.addEventListener("click", () => changePage(1));
  elements.pageNumber.addEventListener("change", () => {
    const page = Number(elements.pageNumber.value) || 1;
    setPage(page);
  });
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
  if (!elements.voyagePayload.value.trim()) {
    elements.voyagePayload.value = JSON.stringify({ split: 10, page: 1 }, null, 2);
  }
  elements.pageNumber.value = getCurrentPage();
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

function getCurrentPage() {
  const payload = safeParseJson(elements.voyagePayload.value);
  return Number(payload?.page) || 1;
}

function setPage(page) {
  const safePage = Math.max(1, Number(page) || 1);
  const payload = safeParseJson(elements.voyagePayload.value) ?? {};
  payload.page = safePage;
  elements.voyagePayload.value = JSON.stringify(payload, null, 2);
  elements.pageNumber.value = safePage;
  loadVoyages();
}

function changePage(delta) {
  const current = getCurrentPage();
  setPage(current + delta);
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
    const payload = parseJsonPayload(elements.voyagePayload.value);
    const url = buildUrlWithQuery(config.endpoint, payload);
    const data = await fetchJson(url, {
      method: "GET",
    });
    voyages = normalizeArray(data, ["voyages", "items", "data", "results"]) || [];
    updateVoyageList(voyages);
    updateStatus(!!config.token);
    elements.pageNumber.value = getCurrentPage();
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

function safeParseJson(value) {
  try {
    return parseJsonPayload(value);
  } catch (error) {
    return null;
  }
}

function buildUrlWithQuery(path, payload) {
  const base = buildUrl(path);
  if (!payload || typeof payload !== "object") {
    return base;
  }
  const params = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, String(item)));
      return;
    }
    params.append(key, String(value));
  });
  const query = params.toString();
  return query ? `${base}?${query}` : base;
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
    const description =
      voyage.description ||
      voyage.summary ||
      voyage.routeDescription ||
      voyage.route?.description ||
      "No description provided.";
    button.innerHTML = `${name} · ${status}<span class="description">${description}</span>`;
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
