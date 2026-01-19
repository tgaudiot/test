const DEFAULT_CONFIG = {
  baseUrl: "https://api.t-vos.com/v1.23",
  token: "",
  endpoint: "/Voyage",
  computationsEndpoint: "/Voyage/{id}/computations",
  routeEndpoint:
    "/VoyageRoute/{voyageId}",
  paretoEndpoint: "/VoyageRoute/{voyageId}/solution",
  paretoDistanceUnit: "nm",
  weatherBaseUrl: "https://rdas.theyr.com/v2.3",
  weatherEndpoint: "/RouteData",
  weatherToken: "",
  weatherUnits: "{\"direction\":\"degree\",\"height\":\"meter\",\"speed\":\"mps\"}",
  weatherFilters:
    "[\"tide\",\"airTemperature\",\"seaFloorDepth\",\"sst\",\"sss\",\"iceFraction\",\"stdmet\"]",
  weatherDataFeedId: "8d7c5712-bea2-4148-93eb-b00000",
  weatherIncludeOptions: false,
  routeQueryParams:
    "{\"speed\":true,\"direction\":true,\"operational\":true,\"directionUnit\":\"degree\",\"speedUnit\":\"kn\",\"distanceUnit\":\"nm\",\"illustrative\":true}",
  computationsQuery: "{\"metadata\":true}",
};

const WEATHER_CHUNK_SIZE = 100;
const MIN_MAP_ZOOM = 2;

const STORAGE_KEY = "theyr-voyage-config";

const elements = {
  baseUrl: document.getElementById("baseUrl"),
  token: document.getElementById("token"),
  voyageEndpoint: document.getElementById("voyageEndpoint"),
  computationsEndpoint: document.getElementById("computationsEndpoint"),
  computationsQuery: document.getElementById("computationsQuery"),
  routeEndpoint: document.getElementById("routeEndpoint"),
  paretoEndpoint: document.getElementById("paretoEndpoint"),
  paretoDistanceUnit: document.getElementById("paretoDistanceUnit"),
  routeQueryParams: document.getElementById("routeQueryParams"),
  descriptionSearch: document.getElementById("descriptionSearch"),
  searchVoyages: document.getElementById("searchVoyages"),
  searchStatus: document.getElementById("searchStatus"),
  weatherBaseUrl: document.getElementById("weatherBaseUrl"),
  weatherEndpoint: document.getElementById("weatherEndpoint"),
  weatherToken: document.getElementById("weatherToken"),
  weatherUnits: document.getElementById("weatherUnits"),
  weatherFilters: document.getElementById("weatherFilters"),
  weatherDataFeedId: document.getElementById("weatherDataFeedId"),
  weatherIncludeOptions: document.getElementById("weatherIncludeOptions"),
  voyagePayload: document.getElementById("voyagePayload"),
  saveConfig: document.getElementById("saveConfig"),
  loadVoyages: document.getElementById("loadVoyages"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  pageNumber: document.getElementById("pageNumber"),
  voyageList: document.getElementById("voyageList"),
  computationList: document.getElementById("computationList"),
  computationDetails: document.getElementById("computationDetails"),
  voyageDetails: document.getElementById("voyageDetails"),
  selectedVoyageId: document.getElementById("selectedVoyageId"),
  selectedComputationId: document.getElementById("selectedComputationId"),
  statusPill: document.getElementById("statusPill"),
  timeseriesContainer: document.getElementById("timeseriesContainer"),
  paretoContainer: document.getElementById("paretoContainer"),
  paretoStatus: document.getElementById("paretoStatus"),
  weatherStatus: document.getElementById("weatherStatus"),
  weatherTimeseriesContainer: document.getElementById("weatherTimeseriesContainer"),
  weatherProgressBar: document.getElementById("weatherProgressBar"),
  weatherFetch: document.getElementById("weatherFetch"),
  routeFilters: document.getElementById("routeFilters"),
};

let config = loadConfig();
let map;
let routeLayer;
let solutionRouteLayer;
let voyages = [];
let computations = [];
let selectedVoyageId = null;
let selectedComputationId = null;
let lastRouteTags = new Set();
let lastRouteFeaturePoints = [];
let baseRouteData = null;
let solutionRouteData = null;
let baseRouteBounds = null;
let solutionRouteBounds = null;
let currentParetoComputationId = null;
let paretoRequestId = 0;
let computationRequestId = 0;
let weatherRequestId = 0;
const chartInstances = new Map();
let resizeHandlerBound = false;
let paretoChartInstance = null;
let paretoChartNode = null;
const EXCLUDED_ROUTE_TAGS = new Set(["best_tce", "min_fuel"]);
const PREFERRED_ROUTE_TAGS = new Set(["foa", "best_time", "jita"]);
const TIMESERIES_ROUTE_TAGS = new Set(["foa", "min_time", "best_dte"]);
let selectedVoyageIds = new Set();
let multiVoyageRequestId = 0;
const routeTagVisibility = new Map();

init();

function init() {
  hydrateInputs();
  initMap();
  bindEvents();
  updateStatus(!!config.token);
  bindParetoEvents();
  bindChartTabs();
  bindPageTabs();
}

function bindEvents() {
  elements.saveConfig.addEventListener("click", () => {
    config = readConfigFromInputs();
    saveConfig(config);
    updateStatus(!!config.token);
  });

  if (elements.searchVoyages) {
    elements.searchVoyages.addEventListener("click", searchVoyagesByDescription);
  }

  if (elements.weatherFetch) {
    elements.weatherFetch.addEventListener("click", () => {
      const merged = mergeRouteData(baseRouteData, solutionRouteData);
      if (!merged) {
        setWeatherStatus("Select a computation before fetching weather.");
        setWeatherProgress(0);
        return;
      }
      void fetchWeatherForRoutes(merged, "manual fetch");
    });
  }

  elements.loadVoyages.addEventListener("click", loadVoyages);
  elements.prevPage.addEventListener("click", () => changePage(-1));
  elements.nextPage.addEventListener("click", () => changePage(1));
  elements.pageNumber.addEventListener("change", () => {
    const page = Number(elements.pageNumber.value) || 1;
    setPage(page);
  });
}

function initMap() {
  map = L.map("map", {
    worldCopyJump: true,
    minZoom: MIN_MAP_ZOOM,
  }).setView([20, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    minZoom: MIN_MAP_ZOOM,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  solutionRouteLayer = L.layerGroup().addTo(map);
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
  elements.computationsEndpoint.value = config.computationsEndpoint;
  elements.computationsQuery.value = config.computationsQuery;
  elements.routeEndpoint.value = config.routeEndpoint;
  elements.paretoEndpoint.value = config.paretoEndpoint;
  elements.paretoDistanceUnit.value = config.paretoDistanceUnit;
  elements.routeQueryParams.value = config.routeQueryParams;
  elements.weatherBaseUrl.value = config.weatherBaseUrl;
  elements.weatherEndpoint.value = config.weatherEndpoint;
  elements.weatherToken.value = config.weatherToken;
  elements.weatherUnits.value = config.weatherUnits;
  elements.weatherFilters.value = config.weatherFilters;
  elements.weatherDataFeedId.value = config.weatherDataFeedId;
  if (elements.weatherIncludeOptions) {
    elements.weatherIncludeOptions.checked = !!config.weatherIncludeOptions;
  }
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
    computationsEndpoint: elements.computationsEndpoint.value.trim(),
    computationsQuery: elements.computationsQuery.value.trim(),
    routeEndpoint: elements.routeEndpoint.value.trim(),
    paretoEndpoint: elements.paretoEndpoint.value.trim(),
    paretoDistanceUnit: elements.paretoDistanceUnit.value.trim(),
    routeQueryParams: elements.routeQueryParams.value.trim(),
    weatherBaseUrl: elements.weatherBaseUrl.value.trim(),
    weatherEndpoint: elements.weatherEndpoint.value.trim(),
    weatherToken: elements.weatherToken.value.trim(),
    weatherUnits: elements.weatherUnits.value.trim(),
    weatherFilters: elements.weatherFilters.value.trim(),
    weatherDataFeedId: elements.weatherDataFeedId.value.trim(),
    weatherIncludeOptions: !!elements.weatherIncludeOptions?.checked,
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
    voyages = voyages.filter(isProductionVoyage);
    updateVoyageList(voyages);
    updateComputationList([]);
    updateComputationDetails(null);
    updateVoyageDetails(null);
    updateSelectedIds(null, null);
    updateStatus(!!config.token);
    elements.pageNumber.value = getCurrentPage();
    if (voyages.length > 0) {
      selectedVoyageIds = new Set();
      const firstId = findIdValue(voyages[0], ["id", "voyageId", "voyageID"]);
      if (firstId) {
        selectedVoyageIds.add(String(firstId));
      }
      refreshSelectedVoyages();
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

function bindParetoEvents() {
  if (!elements.paretoContainer) {
    return;
  }
  elements.paretoContainer.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const solutionId = target.getAttribute("data-solution-id");
    if (!solutionId) {
      return;
    }
    if (!selectedVoyageId) {
      alert("No voyage ID selected for this solution.");
      return;
    }
    const paretoComputationId = target.getAttribute("data-computation-id");
    if (paretoComputationId && String(paretoComputationId) !== String(selectedComputationId)) {
      alert("This solution belongs to a different computation. Please reload pareto.");
      return;
    }
    if (!currentParetoComputationId || currentParetoComputationId !== selectedComputationId) {
      alert("Please wait for the current computation pareto to load before selecting a point.");
      return;
    }
    loadSolutionRoute(selectedVoyageId, solutionId);
  });
}

function buildUrlWithQueryFromUrl(baseUrl, payload) {
  if (!payload || typeof payload !== "object") {
    return baseUrl;
  }
  const url = new URL(baseUrl);
  Object.entries(payload).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url.toString();
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
function isProductionVoyage(voyage) {
  const description = voyage?.description || voyage?.summary || "";
  const tokens = extractBracketTokens(description);
  const isProd = tokens.length >= 2 &&
    tokens[0].toLowerCase() === "server" &&
    tokens[1].toLowerCase() === "production";
  const hasCompleted = description.toLowerCase().includes("state.task.completed");
  return isProd && hasCompleted;
}

function getVoyageLabel(voyage) {
  const description = voyage?.description || voyage?.summary || "";
  const tokens = extractBracketTokens(description);
  if (tokens.length >= 3) {
    return tokens[2];
  }
  return voyage.name || voyage.title || findIdValue(voyage, ["id", "voyageId", "voyageID"]) || "Voyage";
}

function matchesDescription(voyage, query) {
  if (!query) {
    return true;
  }
  const description = voyage?.description || voyage?.summary || "";
  return description.toLowerCase().includes(query.toLowerCase());
}
function isCompletedVoyage(voyage) {
  return String(voyage?.status || "") === "state.task.completed";
}

function extractBracketTokens(text) {
  if (!text) {
    return [];
  }
  const tokens = [];
  const regex = /\[([^\]]+)\]/g;
  let match = regex.exec(text);
  while (match) {
    tokens.push(match[1]);
    match = regex.exec(text);
  }
  return tokens;
}

function updateVoyageList(items) {
  elements.voyageList.innerHTML = "";
  if (!items.length) {
    const emptyItem = document.createElement("div");
    emptyItem.className = "empty-state";
    emptyItem.textContent = "No voyages returned.";
    elements.voyageList.appendChild(emptyItem);
    return;
  }
  const grouped = groupVoyagesByDescription(items);
  grouped.forEach((group) => {
    if (group.items.length === 1) {
      const row = buildVoyageRow(group.items[0], group.description, "scenario-row");
      elements.voyageList.appendChild(row);
      return;
    }
    const container = document.createElement("div");
    container.className = "scenario-group";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "scenario-row scenario-group-row";
    header.setAttribute("aria-expanded", "false");
    header.appendChild(buildGroupDescriptionCell(group.description, group.items.length, false));
    header.appendChild(buildScenarioCell(`${group.items.length} runs`, "scenario-meta"));
    header.appendChild(buildScenarioCell(formatDateTime(group.latest.startTime)));
    header.appendChild(buildScenarioCell(group.latest.vessel));
    header.appendChild(buildScenarioCell(group.waveRange, "optional"));
    header.appendChild(buildScenarioCell(formatDateTime(group.latest.lastUsed) || "--", "optional"));

    const children = document.createElement("div");
    children.className = "scenario-children hidden";
    group.items.forEach((voyage) => {
      const row = buildVoyageRow(voyage, group.description, "scenario-row scenario-child");
      children.appendChild(row);
    });

    header.addEventListener("click", () => {
      const expanded = header.getAttribute("aria-expanded") === "true";
      header.setAttribute("aria-expanded", String(!expanded));
      children.classList.toggle("hidden", expanded);
      const toggle = header.querySelector(".group-toggle");
      if (toggle) {
        toggle.textContent = expanded ? "▸" : "▾";
      }
    });

    container.appendChild(header);
    container.appendChild(children);
    elements.voyageList.appendChild(container);
  });
}

function buildScenarioCell(value, className) {
  const cell = document.createElement("span");
  if (className) {
    cell.className = className;
  }
  cell.textContent = String(value ?? "");
  return cell;
}

function buildGroupDescriptionCell(description, count, expanded) {
  const cell = document.createElement("span");
  cell.className = "scenario-desc";
  const wrapper = document.createElement("span");
  wrapper.className = "group-label";
  const toggle = document.createElement("span");
  toggle.className = "group-toggle";
  toggle.textContent = expanded ? "▾" : "▸";
  const text = document.createElement("span");
  text.textContent = `${description} (${count})`;
  wrapper.appendChild(toggle);
  wrapper.appendChild(text);
  cell.appendChild(wrapper);
  return cell;
}

function buildVoyageRow(voyage, descriptionOverride, className) {
  const button = document.createElement("button");
  const voyageId = findIdValue(voyage, ["id", "voyageId", "voyageID"]);
  const status = voyage.status || voyage.state || "Unknown status";
  const description =
    descriptionOverride ||
    voyage.description ||
    voyage.summary ||
    voyage.routeDescription ||
    voyage.route?.description ||
    "No description provided.";
  const startTime = pickDateValue(voyage, [
    "startTime",
    "startDate",
    "start",
    "createdDate",
    "creationDate",
  ]);
  const lastUsed = pickDateValue(voyage, ["lastUsed", "lastUsedDate", "updatedAt", "updatedDate"]);
  const vessel = getVoyageLabel(voyage);
  const maxWaveCruiseHeight = pickNestedValue(voyage, [
    "options",
    "constraints",
    "maxWaveCruiseHeight",
  ]);
  const waveValue = Number.isFinite(maxWaveCruiseHeight)
    ? formatNumber(maxWaveCruiseHeight)
    : maxWaveCruiseHeight;
  button.type = "button";
  button.className = className;
  button.appendChild(buildScenarioCell(description, "scenario-desc"));
  button.appendChild(buildStatusPill(status));
  button.appendChild(buildScenarioCell(formatDateTime(startTime)));
  button.appendChild(buildScenarioCell(vessel));
  button.appendChild(buildScenarioCell(waveValue ?? "--", "optional"));
  button.appendChild(buildScenarioCell(formatDateTime(lastUsed) || "--", "optional"));
  if (voyageId) {
    button.dataset.voyageId = String(voyageId);
    if (selectedVoyageIds.has(String(voyageId))) {
      button.classList.add("active");
    }
  }
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleVoyageSelection(voyage);
  });
  return button;
}

function buildStatusPill(status) {
  const pill = document.createElement("span");
  pill.className = "status-pill";
  const normalized = String(status || "Unknown").toLowerCase();
  if (normalized.includes("completed")) {
    pill.classList.add("status-complete");
  } else if (normalized.includes("running")) {
    pill.classList.add("status-running");
  } else if (normalized.includes("failed")) {
    pill.classList.add("status-failed");
  }
  pill.textContent = status || "Unknown";
  return pill;
}

function pickDateValue(payload, keys) {
  if (!payload || !Array.isArray(keys)) {
    return null;
  }
  for (const key of keys) {
    const value = payload[key];
    if (value) {
      return value;
    }
  }
  return null;
}

function pickStringValue(payload, keys) {
  if (!payload || !Array.isArray(keys)) {
    return null;
  }
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function pickNestedValue(payload, path) {
  if (!payload || !Array.isArray(path)) {
    return null;
  }
  let current = payload;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = current[key];
  }
  return current ?? null;
}

function groupVoyagesByDescription(items) {
  const groups = new Map();
  items.forEach((voyage) => {
    const raw =
      voyage.description ||
      voyage.summary ||
      voyage.routeDescription ||
      voyage.route?.description ||
      "No description provided.";
    const key = normalizeDescription(raw);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(voyage);
  });
  const result = [];
  groups.forEach((groupItems, description) => {
    const sorted = [...groupItems].sort((a, b) => getLastUsedTime(b) - getLastUsedTime(a));
    const latest = sorted[0];
    const maxWaveValues = sorted
      .map((item) =>
        pickNestedValue(item, ["options", "constraints", "maxWaveCruiseHeight"])
      )
      .filter((value) => Number.isFinite(value));
    const waveRange = formatWaveRange(maxWaveValues);
    result.push({
      description,
      items: sorted,
      latest: {
        startTime: pickDateValue(latest, [
          "startTime",
          "startDate",
          "start",
          "createdDate",
          "creationDate",
        ]),
        lastUsed: pickDateValue(latest, ["lastUsed", "lastUsedDate", "updatedAt", "updatedDate"]),
        vessel: getVoyageLabel(latest),
      },
      waveRange,
    });
  });
  return result.sort((a, b) => getLastUsedTime(a.items[0]) - getLastUsedTime(b.items[0])).reverse();
}

function normalizeDescription(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "No description provided.";
  }
  const uuidPattern =
    /\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b/gi;
  const cleaned = text.replace(uuidPattern, "").replace(/\\s+/g, " ").trim();
  return cleaned || text;
}

function getLastUsedTime(voyage) {
  const value = pickDateValue(voyage, ["lastUsedDate", "lastUsed", "updatedAt", "updatedDate"]);
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}

function formatWaveRange(values) {
  if (!values.length) {
    return "--";
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return formatNumber(min);
  }
  return `${formatNumber(min)}–${formatNumber(max)}`;
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month} ${day}, ${year} ${hours}:${minutes}`;
}

function toggleVoyageSelection(voyage) {
  const voyageId = findIdValue(voyage, ["id", "voyageId", "voyageID"]);
  if (!voyageId) {
    console.warn("No voyage ID found for selected voyage.");
    return;
  }
  const id = String(voyageId);
  if (selectedVoyageIds.has(id)) {
    selectedVoyageIds.delete(id);
  } else {
    selectedVoyageIds.add(id);
  }
  refreshSelectedVoyages();
}

function refreshSelectedVoyages() {
  const selected = voyages.filter((voyage) => {
    const voyageId = findIdValue(voyage, ["id", "voyageId", "voyageID"]);
    return voyageId && selectedVoyageIds.has(String(voyageId));
  });
  const buttons = elements.voyageList.querySelectorAll("button");
  buttons.forEach((button) => {
    const id = button.dataset.voyageId;
    button.classList.toggle("active", id && selectedVoyageIds.has(id));
  });

  if (!selected.length) {
    selectedVoyageId = null;
    selectedComputationId = null;
    currentParetoComputationId = null;
    updateComputationList([]);
    updateComputationDetails(null);
    updateVoyageDetails(null);
    updateSelectedIds(null, null);
    baseRouteData = null;
    solutionRouteData = null;
    renderBaseRoute(null);
    renderSolutionRoute(null);
    renderTimeseries(null);
  updateRouteFilters(baseRouteData);
    renderWeatherTimeseries(null);
    renderPareto(null);
    return;
  }

  if (selected.length === 1) {
    selectSingleVoyage(selected[0]);
    return;
  }

  selectedVoyageId = null;
  selectedComputationId = null;
  currentParetoComputationId = null;
  updateSelectedIds(
    selected.map((voyage) => findIdValue(voyage, ["id", "voyageId", "voyageID"])),
    null
  );
  updateVoyageDetails(selected);
  updateComputationDetails(null);
  updateComputationListAuto([]);
  renderPareto(null);
  loadLatestComputationsForVoyages(selected);
}

function selectSingleVoyage(voyage) {
  selectedVoyageId = findIdValue(voyage, ["id", "voyageId", "voyageID"]);
  selectedComputationId = null;
  currentParetoComputationId = null;
  updateComputationList([]);
  updateComputationDetails(null);
  updateVoyageDetails(voyage);
  updateSelectedIds(selectedVoyageId, null);
  baseRouteData = voyage;
  solutionRouteData = null;
  baseRouteBounds = null;
  solutionRouteBounds = null;
  renderBaseRoute(voyage);
  renderSolutionRoute(null);
  renderTimeseries(null);
  renderWeatherTimeseries(null);
  renderPareto(null);
  if (selectedVoyageId) {
    loadComputations(selectedVoyageId).then(() => {
      if (Array.isArray(computations) && computations.length) {
        const latest = pickLatestComputation(computations);
        if (latest) {
          selectComputation(latest);
        }
      }
    });
  } else {
    console.warn("No voyage ID found for selected voyage.");
  }
}

async function loadComputations(voyageId) {
  try {
    const queryPayload = safeParseJson(config.computationsQuery) ?? {};
    const url = buildUrlWithQuery(
      config.computationsEndpoint.replace("{id}", encodeURIComponent(voyageId)),
      queryPayload
    );
    const data = await fetchJson(url, { method: "GET" });
    computations = normalizeArray(data, ["computations", "items", "data", "results"]) || [];
    updateComputationList(computations);
  } catch (error) {
    console.error(error);
    alert(`Failed to load computations: ${error.message}`);
  }
}

function updateComputationList(items) {
  elements.computationList.innerHTML = "";
  if (!items.length) {
    const emptyItem = document.createElement("div");
    emptyItem.className = "empty-state";
    emptyItem.textContent = "No computations returned.";
    elements.computationList.appendChild(emptyItem);
    updateComputationDetails(null);
    return;
  }
  items.forEach((computation) => {
    const button = document.createElement("button");
    const computationId = findIdValue(computation, [
      "id",
      "computationId",
      "computationID",
      "computation",
    ]);
    const name = computation.name || computation.title || computationId || `Computation ${index + 1}`;
    const status = computation.status || computation.state || "Unknown status";
    button.type = "button";
    button.className = "computation-row";
    if (computationId !== null && computationId !== undefined) {
      button.dataset.computationId = String(computationId);
    }
    const title = document.createElement("span");
    title.className = "computation-title";
    title.textContent = String(name);
    button.appendChild(title);
    button.appendChild(buildStatusPill(status));
    button.addEventListener("click", () => selectComputation(computation));
    elements.computationList.appendChild(button);
  });
}

async function selectComputation(computation) {
  const buttons = elements.computationList.querySelectorAll("button");
  updateComputationDetails(computation);
  selectedComputationId = findIdValue(computation, [
    "id",
    "computationId",
    "computationID",
    "computation",
  ]);
  buttons.forEach((button) => {
    const id = button.dataset.computationId;
    button.classList.toggle("active", id && id === String(selectedComputationId));
  });
  updateSelectedIds(selectedVoyageId, selectedComputationId);
  currentParetoComputationId = null;
  renderPareto(null);
  setParetoStatus("Loading pareto...");
  if (!selectedVoyageId || !selectedComputationId) {
    if (!selectedVoyageId) {
      alert("No voyage ID was found for this selection.");
    } else {
      alert("No computation ID was found for this computation.");
    }
    return;
  }
  await loadVoyageRoute(selectedVoyageId, selectedComputationId, computation);
}

async function loadVoyageRoute(voyageId, computationId, fallbackData) {
  try {
    computationRequestId += 1;
    const requestId = computationRequestId;
    const url = buildVoyageRouteUrl(voyageId, computationId);
    const data = await fetchJson(url, { method: "GET" });
    if (requestId !== computationRequestId) {
      return;
    }
    const hasPayload = !isEmptyObject(data);
    if (hasPayload || !fallbackData) {
      updateComputationDetails(data);
    } else {
      updateComputationDetails(fallbackData);
    }
    const routeData = resolveRouteData(hasPayload ? data : null) ?? resolveRouteData(fallbackData);
    baseRouteData = routeData;
    solutionRouteData = null;
    baseRouteBounds = null;
    solutionRouteBounds = null;
    renderBaseRoute(routeData);
    renderSolutionRoute(null);
    renderTimeseries(routeData);
    updateRouteFilters(mergeRouteData(baseRouteData, solutionRouteData));
    lastRouteTags = new Set(extractRouteTags(routeData));
    lastRouteFeaturePoints = extractRouteFeaturePoints(routeData);
    await loadParetoFront(voyageId, computationId);
  } catch (error) {
    console.error(error);
    alert(`Failed to load route: ${error.message}`);
  }
}

function resolveRouteData(data) {
  if (!data) {
    return null;
  }
  if (
    data.geometry ||
    data.coordinates ||
    data.path ||
    data.waypoints ||
    data.points ||
    data.routePoints
  ) {
    return data;
  }
  if (data.route) {
    return data.route;
  }
  if (data.data) {
    return data.data;
  }
  if (Array.isArray(data.routes) && data.routes.length > 0) {
    return data;
  }
  return data;
}

function buildVoyageRouteUrl(voyageId, computationId) {
  let routeTemplate = config.routeEndpoint || "";
  const hasBracedPlaceholders = /{[^}]+}/.test(routeTemplate);
  if (hasBracedPlaceholders) {
    routeTemplate = routeTemplate
      .replaceAll("{id}", encodeURIComponent(voyageId))
      .replaceAll("{voyageId}", encodeURIComponent(voyageId))
      .replaceAll("{voyageID}", encodeURIComponent(voyageId))
      .replaceAll("{computationId}", encodeURIComponent(computationId))
      .replaceAll("{computationID}", encodeURIComponent(computationId));
  } else {
    routeTemplate = routeTemplate
      .replace("voyageID", encodeURIComponent(voyageId))
      .replace("computationID", encodeURIComponent(computationId));
  }
  const baseUrl = buildUrl(routeTemplate);
  const queryPayload = safeParseJson(config.routeQueryParams) ?? {};
  if (computationId) {
    queryPayload.computation = computationId;
  }
  return buildUrlWithQueryFromUrl(baseUrl, queryPayload);
}

function renderBaseRoute(voyage) {
  baseRouteBounds = renderRouteToLayer(routeLayer, voyage);
  fitMapToRoutes();
}

function renderSolutionRoute(voyage) {
  solutionRouteBounds = renderRouteToLayer(solutionRouteLayer, voyage);
  fitMapToRoutes();
}

function renderRouteToLayer(layer, voyage) {
  layer.clearLayers();
  const segments = extractRouteSegments(voyage);
  if (!segments.length) {
    return null;
  }
  const bounds = L.latLngBounds([]);
  const wrapShifts = [0, -360, 360];
  segments.forEach((segment) => {
    if (!isRouteTagVisible(segment.tag)) {
      return;
    }
    wrapShifts.forEach((shift) => {
      const coordinates =
        shift === 0 ? segment.coordinates : shiftCoordinates(segment.coordinates, shift);
      if (!coordinates.length) {
        return;
      }
      const polyline = L.polyline(coordinates, {
        color: segment.color,
        weight: 4,
        interactive: shift === 0,
      }).addTo(layer);
      if (shift === 0) {
        bounds.extend(polyline.getBounds());
      }
    });
    if (segment.includeMarkers !== false) {
      addRoutePointMarkers(layer, segment, wrapShifts);
    }
  });
  return bounds.isValid() ? bounds : null;
}

function fitMapToRoutes() {
  if (!map) {
    return;
  }
  const bounds = L.latLngBounds([]);
  if (baseRouteBounds) {
    bounds.extend(baseRouteBounds);
  }
  if (solutionRouteBounds) {
    bounds.extend(solutionRouteBounds);
  }
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [30, 30] });
    map.setView(bounds.getCenter(), map.getMinZoom());
  }
}

async function searchVoyagesByDescription() {
  const query = elements.descriptionSearch?.value.trim();
  if (!query) {
    alert("Enter a description to search.");
    return;
  }
  if (!elements.searchVoyages) {
    return;
  }
  setLoading(elements.searchVoyages, true);
  try {
    config = readConfigFromInputs();
    saveConfig(config);
    const url = buildUrlWithQuery("/Voyage/description", { description: query });
    if (elements.searchStatus) {
      elements.searchStatus.textContent = `GET ${url}`;
    }
    const data = await fetchJson(url, { method: "GET" });
    voyages = normalizeArray(data, ["voyages", "items", "data", "results"]) || [];
    voyages = voyages.filter(isCompletedVoyage);
    updateVoyageList(voyages);
    updateComputationList([]);
    updateComputationDetails(null);
    updateVoyageDetails(null);
    updateSelectedIds(null, null);
    updateStatus(!!config.token);
    if (voyages.length > 0) {
      selectedVoyageIds = new Set();
      const firstId = findIdValue(voyages[0], ["id", "voyageId", "voyageID"]);
      if (firstId) {
        selectedVoyageIds.add(String(firstId));
      }
      refreshSelectedVoyages();
    }
  } catch (error) {
    console.error(error);
    alert(`Failed to search voyages: ${error.message}`);
  } finally {
    setLoading(elements.searchVoyages, false);
  }
}

function extractRouteTags(voyage) {
  if (!voyage) {
    return [];
  }
  const routes =
    voyage.routes ||
    voyage.data?.routes ||
    voyage.route?.routes ||
    voyage.routeData?.routes ||
    null;
  if (!Array.isArray(routes)) {
    return [];
  }
  const tags = routes
    .map((route, index) => {
      const points = route?.data || route?.points || [];
      return route?.tag || points.find((point) => point?.tag)?.tag || `route-${index + 1}`;
    })
    .filter((tag) => !isRouteExcluded(tag))
    .filter(Boolean)
    .map((tag) => String(tag));
  return tags;
}

function extractRouteFeaturePoints(voyage) {
  if (!voyage) {
    return [];
  }
  const routes =
    voyage.routes ||
    voyage.data?.routes ||
    voyage.route?.routes ||
    voyage.routeData?.routes ||
    null;
  if (!Array.isArray(routes)) {
    return [];
  }
  return routes
    .map((route, index) => {
      const tag = route?.tag || `route-${index + 1}`;
      if (isRouteExcluded(tag) || !isTimeseriesRouteTag(tag)) {
        return null;
      }
      const features = route?.features || {};
      const fuelOil = toNumber(features.fuelOil ?? features.consumption?.fuelOil);
      const fuelLowSulfur = toNumber(features.fuelLowSulfur ?? features.consumption?.fuelLowSulfur);
      const fuel =
        Number.isFinite(fuelOil) || Number.isFinite(fuelLowSulfur)
          ? (fuelOil ?? 0) + (fuelLowSulfur ?? 0)
          : null;
      const duration = toNumber(features.time ?? features.consumption?.time);
      const distance = toNumber(features.distance);
      return {
        tag: String(tag),
        fuel,
        duration,
        distance,
      };
    })
    .filter(Boolean)
    .filter((point) => Number.isFinite(point.fuel) && Number.isFinite(point.duration));
}

function updateComputationDetails(computation) {
  if (!elements.computationDetails) {
    return;
  }
  elements.computationDetails.textContent = computation
    ? JSON.stringify(computation, null, 2)
    : "{}";
}

function updateVoyageDetails(voyage) {
  if (!elements.voyageDetails) {
    return;
  }
  elements.voyageDetails.textContent = voyage ? JSON.stringify(voyage, null, 2) : "{}";
}

function updateSelectedIds(voyageId, computationId) {
  if (elements.selectedVoyageId) {
    if (Array.isArray(voyageId)) {
      const filtered = voyageId.filter(Boolean).map((id) => String(id));
      elements.selectedVoyageId.textContent = `Selected voyages: ${filtered.length || 0} ${
        filtered.length ? `(${filtered.join(", ")})` : ""
      }`;
    } else {
      elements.selectedVoyageId.textContent = `Selected voyage ID: ${voyageId ?? "--"}`;
    }
  }
  if (elements.selectedComputationId) {
    elements.selectedComputationId.textContent = `Selected computation ID: ${computationId ?? "--"}`;
  }
}

function extractCoordinates(voyage) {
  if (!voyage) {
    return [];
  }
  if (Array.isArray(voyage.data)) {
    return voyage.data.map((point) => normalizePoint(point)).filter(Boolean);
  }
  if (Array.isArray(voyage.routes)) {
    const routePoints = voyage.routes.flatMap((route) => route?.data || route?.points || []);
    const coords = routePoints.map((point) => normalizePoint(point)).filter(Boolean);
    if (coords.length) {
      return coords;
    }
  }
  if (voyage.geometry && Array.isArray(voyage.geometry.coordinates)) {
    return voyage.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  }
  if (Array.isArray(voyage.points)) {
    return voyage.points.map((point) => normalizePoint(point)).filter(Boolean);
  }
  if (Array.isArray(voyage.routePoints)) {
    return voyage.routePoints.map((point) => normalizePoint(point)).filter(Boolean);
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

function extractRouteSegments(voyage) {
  if (!voyage) {
    return [];
  }
  if (Array.isArray(voyage.data)) {
    const coordinates = voyage.data.map((point) => normalizePoint(point)).filter(Boolean);
    if (!coordinates.length) {
      return [];
    }
    const tag = voyage.tag || "solution";
    if (isRouteExcluded(tag)) {
      return [];
    }
    const splitCoords = splitAntimeridianCoordinates(coordinates);
    return splitCoords.map((segmentCoords, index) => ({
      coordinates: segmentCoords,
      color: colorFromTag(String(tag)),
      tag: String(tag),
      points: voyage.data,
      weatherLookup: buildWeatherLookup(voyage),
      includeMarkers: index === 0,
    }));
  }
  const routes =
    voyage.routes ||
    voyage.data?.routes ||
    voyage.route?.routes ||
    voyage.routeData?.routes ||
    null;
  if (Array.isArray(routes) && routes.length) {
    return routes
      .map((route, index) => {
        const points = route?.data || route?.points || [];
        const coordinates = points.map((point) => normalizePoint(point)).filter(Boolean);
        const tag = route?.tag || points.find((point) => point?.tag)?.tag || `route-${index + 1}`;
        if (isRouteExcluded(tag)) {
          return null;
        }
        const splitCoords = splitAntimeridianCoordinates(coordinates);
        return splitCoords.map((segmentCoords, segmentIndex) => ({
          coordinates: segmentCoords,
          color: colorFromTag(String(tag)),
          tag: String(tag),
          points,
          weatherLookup: buildWeatherLookup(route),
          includeMarkers: segmentIndex === 0,
        }));
      })
      .filter(Boolean)
      .flat()
      .filter((segment) => segment.coordinates.length);
  }
  const coordinates = extractCoordinates(voyage);
  if (!coordinates.length) {
    return [];
  }
  const splitCoords = splitAntimeridianCoordinates(coordinates);
  return splitCoords.map((segmentCoords, index) => ({
    coordinates: segmentCoords,
    color: "#1f6feb",
    tag: "route",
    points: [],
    weatherLookup: null,
    includeMarkers: index === 0,
  }));
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
    const latNum = typeof lat === "string" ? Number(lat) : lat;
    const lngNum = typeof lng === "string" ? Number(lng) : lng;
    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      return [latNum, lngNum];
    }
  }
  return null;
}

function normalizeLng(lng) {
  if (!Number.isFinite(lng)) {
    return lng;
  }
  let normalized = lng;
  while (normalized > 180) {
    normalized -= 360;
  }
  while (normalized < -180) {
    normalized += 360;
  }
  return normalized;
}

function splitAntimeridianCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length <= 1) {
    return coordinates.length ? [coordinates] : [];
  }
  const normalized = coordinates.map(([lat, lng]) => [lat, normalizeLng(lng)]);
  const segments = [];
  let current = [normalized[0]];
  for (let i = 1; i < normalized.length; i += 1) {
    const prev = normalized[i - 1];
    const curr = normalized[i];
    let prevLng = prev[1];
    const currLng = curr[1];
    let adjustedLng = currLng;
    if (Math.abs(currLng - prevLng) > 180) {
      if (prevLng > 0 && currLng < 0) {
        adjustedLng = currLng + 360;
      } else if (prevLng < 0 && currLng > 0) {
        adjustedLng = currLng - 360;
      }
      const delta = adjustedLng - prevLng;
      const boundaryLng = prevLng > 0 ? 180 : -180;
      const ratio = delta === 0 ? 0 : (boundaryLng - prevLng) / delta;
      const latAtBoundary = prev[0] + (curr[0] - prev[0]) * ratio;
      current.push([latAtBoundary, boundaryLng]);
      segments.push(current);
      const wrapLng = boundaryLng === 180 ? -180 : 180;
      current = [[latAtBoundary, wrapLng], [curr[0], currLng]];
    } else {
      current.push(curr);
    }
  }
  if (current.length) {
    segments.push(current);
  }
  return segments;
}

function wrapCoordinatesForWorld(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return [];
  }
  const normalized = coordinates.map(([lat, lng]) => [lat, normalizeLng(lng)]);
  const wrapped = [normalized[0]];
  let offset = 0;
  let prevLng = normalized[0][1];
  for (let i = 1; i < normalized.length; i += 1) {
    const [lat, lng] = normalized[i];
    const delta = lng - prevLng;
    if (delta > 180) {
      offset -= 360;
    } else if (delta < -180) {
      offset += 360;
    }
    const adjustedLng = lng + offset;
    wrapped.push([lat, adjustedLng]);
    prevLng = adjustedLng;
  }
  return wrapped;
}

function shiftCoordinates(coordinates, shift) {
  if (!Array.isArray(coordinates) || !coordinates.length) {
    return [];
  }
  return coordinates.map(([lat, lng]) => [lat, lng + shift]);
}

function colorFromTag(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) {
    hash = (hash << 5) - hash + tag.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

async function loadParetoFront(voyageId, computationId) {
  if (!elements.paretoContainer) {
    return;
  }
  try {
    currentParetoComputationId = computationId;
    setParetoStatus(`Loading pareto for computation ${computationId}...`);
    paretoRequestId += 1;
    const requestId = paretoRequestId;
    const url = buildParetoUrl(voyageId, computationId);
    const data = await fetchJson(url, { method: "GET" });
    if (requestId !== paretoRequestId) {
      return;
    }
    renderPareto(data, computationId);
  } catch (error) {
    console.error(error);
    setParetoStatus(`Failed to load pareto: ${error.message}`);
    renderPareto({ error: error.message });
  }
}

function buildParetoUrl(voyageId, computationId) {
  let template = config.paretoEndpoint || "/VoyageRoute/{voyageId}/solution";
  template = template
    .replaceAll("{id}", encodeURIComponent(voyageId))
    .replaceAll("{voyageId}", encodeURIComponent(voyageId))
    .replaceAll("{voyageID}", encodeURIComponent(voyageId));
  const baseUrl = buildUrl(template);
  const params = {
    computation: computationId,
    distanceUnit: config.paretoDistanceUnit || "nm",
  };
  return buildUrlWithQueryFromUrl(baseUrl, params);
}

function renderPareto(payload, computationId) {
  if (!elements.paretoContainer) {
    return;
  }
  if (!payload || payload.error) {
    const message = payload?.error ? `Failed to load pareto: ${payload.error}` : "No pareto data.";
    setParetoStatus(message);
    elements.paretoContainer.innerHTML = `<p>${message}</p>`;
    destroyParetoChart();
    return;
  }
  const candidates = extractParetoCandidates(payload);
  const points = extractParetoPoints(payload);
  if (!points.length) {
    setParetoStatus("No pareto points found.");
    const sample = candidates[0] ? JSON.stringify(candidates[0], null, 2) : "{}";
    const keys = candidates[0] ? Object.keys(candidates[0]) : [];
    elements.paretoContainer.innerHTML = `
      <p>No pareto points found.</p>
      <p>Sample item keys: ${keys.join(", ") || "none"}</p>
      <pre class="json-output">${escapeHtml(sample)}</pre>
    `;
    destroyParetoChart();
    return;
  }
  setParetoStatus("");
  const payloadData = buildParetoPayload(
    points,
    lastRouteFeaturePoints,
    computationId ?? currentParetoComputationId
  );
  elements.paretoContainer.innerHTML = `<div class="pareto-echart" data-pareto="${encodeURIComponent(
    JSON.stringify(payloadData)
  )}"></div>`;
  initParetoChart();
}

function extractParetoPoints(payload) {
  const candidates = extractParetoCandidates(payload);
  if (!Array.isArray(candidates)) {
    return [];
  }
  return candidates
    .map((item, index) => {
      const features = item.features || {};
      const fuelOil = toNumber(features.fuelOil ?? features.consumption?.fuelOil);
      const fuelLowSulfur = toNumber(
        features.fuelLowSulfur ?? features.consumption?.fuelLowSulfur
      );
      const fuelSum =
        Number.isFinite(fuelOil) || Number.isFinite(fuelLowSulfur)
          ? (fuelOil ?? 0) + (fuelLowSulfur ?? 0)
          : null;
      const fuel = toNumber(
        fuelSum ??
          item.totalFuelConsumption ??
          item.fuelConsumption ??
          item.fuel ??
          item.totalFuel ??
          item.objectiveFuel
      );
      const duration = toNumber(
        features.time ??
          features.consumption?.time ??
          item.duration ??
          item.totalDuration ??
          item.time ??
          item.sailingTime ??
          item.objectiveDuration
      );
      return {
        fuel,
        duration,
        label: item.tag || item.name || item.id || `solution-${index + 1}`,
        id: item.id ?? item.solutionId ?? item.solutionID ?? null,
      };
    })
    .filter((point) => Number.isFinite(point.fuel) && Number.isFinite(point.duration));
}

function extractParetoCandidates(payload) {
  return normalizeArray(payload, ["solutions", "items", "data", "results", "routes"]) || [];
}

function buildParetoPayload(points, highlightPoints, computationId) {
  return {
    computationId: computationId ?? null,
    points: points.map((point) => ({
      name: point.label,
      value: [point.fuel, point.duration],
      solutionId: point.id ?? null,
    })),
    highlightPoints: (highlightPoints || []).map((point) => ({
      name: point.tag,
      value: [point.fuel, point.duration],
      color: colorFromTag(point.tag),
    })),
  };
}

async function loadSolutionRoute(voyageId, solutionId) {
  try {
    const url = buildSolutionRouteUrl(voyageId, solutionId);
    setParetoStatus(`Loading solution ${solutionId}...`);
    const data = await fetchJson(url, { method: "GET" });
    updateComputationDetails(data);
    const routeData = resolveRouteData(data);
    solutionRouteData = routeData;
    renderSolutionRoute(routeData);
    renderTimeseries(mergeRouteData(baseRouteData, solutionRouteData));
    setParetoStatus(`Loaded solution ${solutionId}.`);
  } catch (error) {
    console.error(error);
    const url = buildSolutionRouteUrl(voyageId, solutionId);
    const message = `Failed to load solution route: ${error.message}`;
    setParetoStatus(`${message} (${url})`);
    alert(message);
  }
}

function buildSolutionRouteUrl(voyageId, solutionId) {
  const template = "/VoyageRoute/{voyageId}/solution/{solutionId}";
  const path = template
    .replaceAll("{voyageId}", encodeURIComponent(voyageId))
    .replaceAll("{voyageID}", encodeURIComponent(voyageId))
    .replaceAll("{solutionId}", encodeURIComponent(solutionId))
    .replaceAll("{solutionID}", encodeURIComponent(solutionId));
  return buildUrl(path);
}

function setParetoStatus(message) {
  if (!elements.paretoStatus) {
    return;
  }
  elements.paretoStatus.textContent = message;
}

function setWeatherStatus(message) {
  if (!elements.weatherStatus) {
    return;
  }
  elements.weatherStatus.textContent = message;
}

function setWeatherProgress(value) {
  if (!elements.weatherProgressBar) {
    return;
  }
  const clamped = Math.max(0, Math.min(100, value));
  elements.weatherProgressBar.style.width = `${clamped}%`;
}

async function fetchWeatherForRoutes(routeData, label) {
  if (!routeData) {
    return;
  }
  const weatherBaseUrl = config.weatherBaseUrl?.trim();
  const weatherEndpoint = config.weatherEndpoint?.trim();
  if (!weatherBaseUrl || !weatherEndpoint) {
    setWeatherStatus("Weather endpoint not configured.");
    return;
  }
  const weatherToken = config.weatherToken?.trim() || config.token;
  if (!weatherToken) {
    setWeatherStatus("Weather token missing.");
    return;
  }

  weatherRequestId += 1;
  const requestId = weatherRequestId;
  const routes = getRoutesArray(routeData);
  if (!routes.length) {
    setWeatherStatus("No routes available for weather fetch.");
    setWeatherProgress(0);
    return;
  }
  setWeatherStatus(`Loading weather for ${label}...`);
  setWeatherProgress(0);

  try {
    let totalPoints = 0;
    let totalChunks = 0;
    routes.forEach((route) => {
      const points = buildWeatherPoints(route);
      if (points.length) {
        totalChunks += Math.ceil(points.length / WEATHER_CHUNK_SIZE);
      }
    });
    let completedChunks = 0;
    for (const route of routes) {
      const points = buildWeatherPoints(route);
      if (!points.length) {
        continue;
      }
      route.weatherBatches = [];
      for (let i = 0; i < points.length; i += WEATHER_CHUNK_SIZE) {
        if (requestId !== weatherRequestId) {
          return;
        }
        const chunk = points.slice(i, i + WEATHER_CHUNK_SIZE);
        const payload = buildWeatherPayload(chunk);
        const url = buildWeatherUrl(weatherBaseUrl, weatherEndpoint);
        const data = await fetchJson(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${weatherToken}`,
          },
          body: JSON.stringify(payload),
        });
        route.weatherBatches.push(data);
        if (Array.isArray(data?.dataPoints)) {
          totalPoints += data.dataPoints.length;
        }
        completedChunks += 1;
        if (totalChunks > 0) {
          setWeatherProgress((completedChunks / totalChunks) * 100);
        }
      }
    }
    if (requestId === weatherRequestId) {
      setWeatherStatus(`Weather loaded for ${label}. Points: ${totalPoints}`);
      renderWeatherTimeseries(mergeRouteData(baseRouteData, solutionRouteData));
      setWeatherProgress(100);
    }
  } catch (error) {
    console.error(error);
    setWeatherStatus(`Weather load failed: ${error.message}`);
    setWeatherProgress(0);
  }
}

function buildWeatherUrl(baseUrl, endpoint) {
  return `${baseUrl.replace(/\/$/, "")}${endpoint}`;
}

function buildWeatherPayload(points) {
  if (!config.weatherIncludeOptions) {
    return { points };
  }
  const units = safeParseJson(config.weatherUnits) ?? {
    direction: "degree",
    height: "meter",
    speed: "mps",
  };
  const filter =
    safeParseJson(config.weatherFilters) ?? [
      "tide",
      "airTemperature",
      "seaFloorDepth",
      "sst",
      "sss",
      "iceFraction",
      "stdmet",
    ];
  const dataFeedId = normalizeDataFeedId(config.weatherDataFeedId);
  return {
    points,
    options: {
      units,
      filter,
      dataFeed: dataFeedId
        ? {
            id: dataFeedId,
            options: null,
          }
        : null,
    },
  };
}

function buildWeatherPoints(route) {
  const rawPoints = route?.data || route?.points || [];
  return rawPoints
    .map((point) => {
      const lat = toNumber(point.latitude ?? point.lat);
      const lon = toNumber(point.longitude ?? point.lon);
      const time = normalizeWeatherTime(point.timestamp ?? point.arrival ?? point.etd);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !time) {
        return null;
      }
      return { lat, lon, t: time };
    })
    .filter(Boolean);
}

function normalizeWeatherTime(value) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function normalizeDataFeedId(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (!isGuid(trimmed)) {
    setWeatherStatus("Weather data feed ID is invalid; ignoring dataFeed.");
    return null;
  }
  return trimmed;
}

function isGuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function mergeRouteData(primary, secondary) {
  if (!primary && !secondary) {
    return null;
  }
  if (!secondary) {
    return primary;
  }
  if (!primary) {
    return secondary;
  }
  const primaryRoutes = getRoutesArray(primary);
  const secondaryRoutes = getRoutesArray(secondary);
  if (!primaryRoutes.length && !secondaryRoutes.length) {
    return primary;
  }
  return { routes: [...primaryRoutes, ...secondaryRoutes] };
}

function getRoutesArray(payload) {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload.data)) {
    return [payload];
  }
  if (payload.route && Array.isArray(payload.route.data)) {
    return [payload.route];
  }
  const routes =
    payload.routes ||
    payload.data?.routes ||
    payload.route?.routes ||
    payload.routeData?.routes ||
    null;
  return Array.isArray(routes) ? routes : [];
}

function renderTimeseries(voyage) {
  if (!elements.timeseriesContainer) {
    return;
  }
  const routes = extractRouteSeries(voyage);
  if (!routes.length) {
    elements.timeseriesContainer.innerHTML = "<p>No timeseries data available.</p>";
    destroyChartsIn(elements.timeseriesContainer);
    return;
  }
  const metrics = [
    { key: "speed", label: "Speed (kn)" },
    { key: "rpm", label: "RPM" },
    { key: "power", label: "Power" },
    { key: "fuel", label: "Fuel / day" },
  ];
  const cards = metrics
    .map((metric) => {
      const seriesByTag = routes
        .map((route) => {
          const series = route.points
            .map((point) => ({ t: point.t, value: point[metric.key] }))
            .filter((point) => Number.isFinite(point.value));
          return {
            tag: route.tag,
            color: route.color,
            series,
          };
        })
        .filter((route) => route.series.length);
      const chart = buildSeriesChart(seriesByTag, metric.label);
      const flatValues = seriesByTag.flatMap((route) => route.series.map((point) => point.value));
      const range = flatValues.length ? summarizeRange(flatValues) : null;
      return `
        <div class="series-card" data-metric="${metric.key}">
          <div class="series-header">
            <span class="series-title">${metric.label}</span>
            <span class="series-meta">${range ?? "No data"}</span>
          </div>
          ${chart}
        </div>
      `;
    })
    .join("");
  destroyChartsIn(elements.timeseriesContainer);
  elements.timeseriesContainer.innerHTML = `<div class="timeseries-grid">${cards}</div>`;
  initChartsIn(elements.timeseriesContainer);
}

function renderWeatherTimeseries(voyage) {
  if (!elements.weatherTimeseriesContainer) {
    return;
  }
  const routes = extractWeatherSeries(voyage);
  if (!routes.length) {
    elements.weatherTimeseriesContainer.innerHTML = "<p>No weather timeseries available.</p>";
    destroyChartsIn(elements.weatherTimeseriesContainer);
    return;
  }
  const metrics = [
    { key: "windSpeed", label: "Wind speed (m/s)" },
    { key: "waveHs", label: "Wave Hs (m)" },
    { key: "sst", label: "Sea surface temp (C)" },
    { key: "airTemp", label: "Air temp (C)" },
    { key: "currentSpeed", label: "Current speed (m/s)" },
    { key: "tideHeight", label: "Tide height (m)" },
  ];
  const cards = metrics
    .map((metric) => {
      const seriesByTag = routes
        .map((route) => {
          const series = route.points
            .map((point) => ({ t: point.t, value: point[metric.key] }))
            .filter((point) => Number.isFinite(point.value));
          return {
            tag: route.tag,
            color: route.color,
            series,
          };
        })
        .filter((route) => route.series.length);
      if (!seriesByTag.length) {
        return "";
      }
      const chart = buildSeriesChart(seriesByTag, metric.label);
      const flatValues = seriesByTag.flatMap((route) => route.series.map((point) => point.value));
      const range = flatValues.length ? summarizeRange(flatValues) : null;
      return `
        <div class="series-card" data-metric="${metric.key}">
          <div class="series-header">
            <span class="series-title">${metric.label}</span>
            <span class="series-meta">${range ?? "No data"}</span>
          </div>
          ${chart}
        </div>
      `;
    })
    .filter(Boolean)
    .join("");
  destroyChartsIn(elements.weatherTimeseriesContainer);
  elements.weatherTimeseriesContainer.innerHTML = cards
    ? `<div class="timeseries-grid">${cards}</div>`
    : "<p>No weather timeseries available.</p>";
  initChartsIn(elements.weatherTimeseriesContainer);
}

function extractWeatherSeries(voyage) {
  if (!voyage) {
    return [];
  }
  const routes = getRoutesArray(voyage);
  if (!routes.length) {
    return [];
  }
  return routes
    .map((route, routeIndex) => {
      const tag = route?.tag || `route-${routeIndex + 1}`;
      if (isRouteExcluded(tag)) {
        return null;
      }
      const batches = Array.isArray(route.weatherBatches) ? route.weatherBatches : [];
      const points = batches
        .flatMap((batch) => batch?.dataPoints || [])
        .map((point) => mapWeatherPoint(point))
        .filter((point) => point && point.t !== null)
        .sort((a, b) => a.t - b.t);
      return {
        tag: String(tag),
        color: colorFromTag(String(tag)),
        points,
      };
    })
    .filter(Boolean)
    .filter((route) => route.points.length);
}

function mapWeatherPoint(point) {
  if (!point) {
    return null;
  }
  const timestamp = Date.parse(point.t);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  const data = point.data || {};
  const windSpeed = toNumber(data.wind?.values?.[0]?.speed);
  const waveHs = toNumber(data.wave?.totalSea?.hs);
  const sst = toNumber(data.sst?.value);
  const airTemp = toNumber(data.airTemperature?.values?.[0]?.value);
  const currentSpeed = toNumber(data.oceanCurrent?.values?.[0]?.speed);
  const tideHeight = toNumber(data.tide?.height);
  return {
    t: timestamp,
    windSpeed,
    waveHs,
    sst,
    airTemp,
    currentSpeed,
    tideHeight,
  };
}

function extractRouteSeries(voyage) {
  if (!voyage) {
    return [];
  }
  const routes =
    voyage.routes ||
    voyage.data?.routes ||
    voyage.route?.routes ||
    voyage.routeData?.routes ||
    null;
  if (!Array.isArray(routes)) {
    return [];
  }
  return routes
    .map((route, routeIndex) => {
      const rawPoints = route?.data || route?.points || [];
      const tag = route?.tag || rawPoints.find((point) => point?.tag)?.tag || `route-${routeIndex + 1}`;
      if (isRouteExcluded(tag)) {
        return null;
      }
      const points = rawPoints
        .map((point, index) => {
          const t = parseTimestamp(point.timestamp ?? point.arrival ?? point.etd, index);
          const speed = toNumber(point.speed ?? point.operational?.sog ?? point.operational?.stw);
          const rpm = toNumber(point.operational?.rpm ?? point.rpm);
          const power = toNumber(point.operational?.pwr ?? point.power ?? point.powerKw);
          const fuel = toNumber(
            point.operational?.dailyFuelConsumption ?? point.fuelConsumption ?? point.fuel
          );
          return { t, speed, rpm, power, fuel };
        })
        .filter((point) => point.t !== null)
        .sort((a, b) => a.t - b.t);
      return {
        tag: String(tag),
        color: colorFromTag(String(tag)),
        points,
      };
    })
    .filter(Boolean)
    .filter((route) => route.points.length);
}

function parseTimestamp(value, fallbackIndex) {
  if (value === null || value === undefined || value === "") {
    return fallbackIndex;
  }
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  return fallbackIndex;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(num) ? num : null;
}

function buildSeriesChart(seriesByTag, metricLabel) {
  if (!seriesByTag.length) {
    return `<div class="series-empty">No data</div>`;
  }
  const allSeries = seriesByTag.flatMap((route) => route.series);
  if (!allSeries.length) {
    return `<div class="series-empty">No data</div>`;
  }
  const maxT = Math.max(...allSeries.map((point) => point.t));
  const isTime = maxT > 1e12;
  const payload = {
    metricLabel,
    isTime,
    series: seriesByTag.map((route) => ({
      name: route.tag,
      color: route.color,
      data: route.series.map((point, index) => [
        isTime ? point.t : index,
        point.value,
      ]),
    })),
  };
  return `<div class="series-echart" data-echart="${encodeURIComponent(
    JSON.stringify(payload)
  )}"></div>`;
}

function summarizeRange(values) {
  if (!values.length) {
    return null;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const format = (value) => Number(value.toFixed(2));
  return `${format(min)} - ${format(max)}`;
}

function initChartsIn(container) {
  if (!container || typeof echarts === "undefined") {
    return;
  }
  destroyChartsIn(container);
  const nodes = container.querySelectorAll(".series-echart");
  nodes.forEach((node) => {
    const encoded = node.getAttribute("data-echart");
    if (!encoded) {
      return;
    }
    let payload = null;
    try {
      payload = JSON.parse(decodeURIComponent(encoded));
    } catch (error) {
      console.warn("Failed to parse chart payload", error);
      return;
    }
    const chart = echarts.init(node);
    chart.setOption(buildEchartOption(payload));
    chartInstances.set(node, chart);
  });
  if (!resizeHandlerBound) {
    resizeHandlerBound = true;
    window.addEventListener("resize", () => {
      chartInstances.forEach((chart) => chart.resize());
    });
  }
}

function destroyChartsIn(container) {
  if (!container) {
    return;
  }
  const nodes = container.querySelectorAll(".series-echart");
  nodes.forEach((node) => {
    const chart = chartInstances.get(node);
    if (chart) {
      chart.dispose();
      chartInstances.delete(node);
    }
  });
}

function updateComputationListAuto(items) {
  elements.computationList.innerHTML = "";
  if (!items.length) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = "Auto-loading latest computations for selected voyages.";
    elements.computationList.appendChild(emptyItem);
    return;
  }
  items.forEach((item) => {
    const entry = document.createElement("li");
    entry.textContent = `${item.label} · latest computation ${item.computationId ?? "unknown"}`;
    elements.computationList.appendChild(entry);
  });
}
async function loadLatestComputationsForVoyages(selectedVoyages) {
  multiVoyageRequestId += 1;
  const requestId = multiVoyageRequestId;
  const autoItems = [];
  const mergedRoutes = [];

  for (const voyage of selectedVoyages) {
    const voyageId = findIdValue(voyage, ["id", "voyageId", "voyageID"]);
    if (!voyageId) {
      continue;
    }
    try {
      const queryPayload = safeParseJson(config.computationsQuery) ?? {};
      const url = buildUrlWithQuery(
        config.computationsEndpoint.replace("{id}", encodeURIComponent(voyageId)),
        queryPayload
      );
      const data = await fetchJson(url, { method: "GET" });
      if (requestId !== multiVoyageRequestId) {
        return;
      }
      const list = normalizeArray(data, ["computations", "items", "data", "results"]) || [];
      const latest = pickLatestComputation(list);
      const latestId = latest
        ? findIdValue(latest, ["id", "computationId", "computationID", "computation"])
        : null;
      const label = voyage.name || voyage.title || voyageId;
      autoItems.push({ label, computationId: latestId, voyageId });
      if (!latestId) {
        continue;
      }
      const routeUrl = buildVoyageRouteUrl(voyageId, latestId);
      const routeData = await fetchJson(routeUrl, { method: "GET" });
      if (requestId !== multiVoyageRequestId) {
        return;
      }
      const resolved = resolveRouteData(routeData) ?? routeData;
      const routeArray = getRoutesArray(resolved);
      routeArray.forEach((route, index) => {
        const tag = route.tag || `route-${index + 1}`;
        const nextRoute = { ...route, tag: `${label} � ${tag}` };
        mergedRoutes.push(nextRoute);
      });
    } catch (error) {
      console.error(error);
      autoItems.push({ label: voyage.name || voyage.title || voyageId, computationId: "error", voyageId });
    }
  }

  if (requestId !== multiVoyageRequestId) {
    return;
  }

  updateComputationListAuto(autoItems);
  const merged = mergedRoutes.length ? { routes: mergedRoutes } : null;
  lastRouteFeaturePoints = merged ? extractRouteFeaturePoints(merged) : [];
  baseRouteData = merged;
  solutionRouteData = null;
  baseRouteBounds = null;
  solutionRouteBounds = null;
  renderBaseRoute(merged);
  renderSolutionRoute(null);
  renderTimeseries(merged);
  renderWeatherTimeseries(merged);
  updateRouteFilters(merged);
  renderPareto(null);
  loadParetoFrontForVoyages(autoItems);
}

function pickLatestComputation(list) {
  if (!Array.isArray(list) || !list.length) {
    return null;
  }
  return list.reduce((latest, item) => {
    const latestId = findIdValue(latest, ["id", "computationId", "computationID", "computation"]);
    const itemId = findIdValue(item, ["id", "computationId", "computationID", "computation"]);
    if (latestId === null || latestId === undefined) {
      return item;
    }
    if (itemId === null || itemId === undefined) {
      return latest;
    }
    return Number(itemId) > Number(latestId) ? item : latest;
  }, list[0]);
}

async function loadParetoFrontForVoyages(items) {
  const valid = items.filter((item) => item.computationId && item.voyageId);
  if (!valid.length) {
    setParetoStatus("No pareto data for selected voyages.");
    renderPareto(null);
    return;
  }
  setParetoStatus("Loading pareto for selected voyages...");
  const series = [];
  for (const item of valid) {
    try {
      const url = buildParetoUrl(item.voyageId, item.computationId);
      const data = await fetchJson(url, { method: "GET" });
      const points = extractParetoPoints(data).map((point) => ({
        name: `${item.label} � ${point.label}`,
        value: [point.fuel, point.duration],
        solutionId: point.id ?? null,
        computationId: item.computationId,
        voyageId: item.voyageId,
      }));
      if (points.length) {
        series.push({
          name: item.label,
          color: colorFromTag(item.label),
          points,
        });
      }
    } catch (error) {
      console.error(error);
    }
  }
  if (!series.length) {
    setParetoStatus("No pareto points found for selected voyages.");
    renderPareto(null);
    return;
  }
  setParetoStatus("");
  const payload = buildMultiParetoPayload(series, lastRouteFeaturePoints);
  elements.paretoContainer.innerHTML = `<div class="pareto-echart" data-pareto="${encodeURIComponent(
    JSON.stringify(payload)
  )}"></div>`;
  initParetoChart();
}

function buildMultiParetoPayload(series, highlightPoints) {
  return {
    multi: true,
    series,
    highlightPoints: (highlightPoints || []).map((point) => ({
      name: point.tag,
      value: [point.fuel, point.duration],
      color: colorFromTag(point.tag),
    })),
  };
}

function bindPageTabs() {
  const tabs = document.querySelectorAll(".page-tab");
  const sections = document.querySelectorAll(".page-section");
  if (!tabs.length || !sections.length) {
    return;
  }
  const setActive = (tab) => {
    const target = tab.dataset.page;
    tabs.forEach((btn) => btn.classList.toggle("active", btn === tab));
    sections.forEach((section) => {
      section.classList.toggle("active", section.dataset.page === target);
    });
    if (target === "results" && map) {
      setTimeout(() => {
        map.invalidateSize();
        chartInstances.forEach((chart) => chart.resize());
        if (paretoChartInstance) {
          paretoChartInstance.resize();
        }
      }, 50);
    }
  };
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setActive(tab));
  });
  setActive(tabs[0]);
}
function bindChartTabs() {
  const tabs = document.querySelectorAll(".tab-button");
  const weatherContainer = document.getElementById("weatherTimeseriesContainer");
  const weatherActions = document.getElementById("weatherActions");
  const paretoPanel = document.getElementById("paretoPanel");
  if (!tabs.length) {
    return;
  }
  const setActive = (tab) => {
    tabs.forEach((btn) => btn.classList.toggle("active", btn === tab));
    const key = tab.dataset.tab;
    applyChartTabFilter(key, weatherContainer, weatherActions, paretoPanel);
  };
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setActive(tab));
  });
  setActive(tabs[0]);
}

function applyChartTabFilter(tabKey, weatherContainer, weatherActions, paretoPanel) {
  const cards = document.querySelectorAll(".series-card");
  cards.forEach((card) => {
    const metric = card.dataset.metric;
    let visible = true;
    if (tabKey === "performance") {
      visible = metric === "speed";
    } else if (tabKey === "engine") {
      visible = metric === "rpm" || metric === "power";
    } else if (tabKey === "fuel") {
      visible = metric === "fuel";
    } else if (tabKey === "weather") {
      visible = false;
    } else if (tabKey === "pareto") {
      visible = false;
    }
    card.classList.toggle("hidden", !visible);
  });
  if (weatherContainer) {
    weatherContainer.classList.toggle("hidden", tabKey !== "weather");
  }
  if (weatherActions) {
    weatherActions.classList.toggle("hidden", tabKey !== "weather");
  }
  if (paretoPanel) {
    paretoPanel.classList.toggle("hidden", tabKey !== "pareto");
  }
  if (tabKey === "pareto") {
    setTimeout(() => {
      if (paretoChartInstance) {
        paretoChartInstance.resize();
      } else {
        initParetoChart();
      }
    }, 50);
  }
}
function buildEchartOption(payload) {
  const series = payload.series || [];
  const colors = series.map((item) => item.color);
  const isTime = !!payload.isTime;
  return {
    animation: false,
    color: colors,
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "line",
      },
      valueFormatter: (value) => (Number.isFinite(value) ? value.toFixed(2) : value),
    },
    legend: {
      data: series.map((item) => item.name),
      bottom: 0,
    },
    grid: {
      left: 42,
      right: 18,
      top: 24,
      bottom: 48,
      containLabel: true,
    },
    xAxis: {
      type: isTime ? "time" : "value",
      name: isTime ? "Time" : "Index",
      nameLocation: "end",
      nameGap: 24,
      axisLabel: {
        formatter: isTime ? undefined : (value) => String(Math.round(value)),
      },
    },
    yAxis: {
      type: "value",
      name: payload.metricLabel || "",
      nameLocation: "end",
      nameGap: 28,
    },
    series: series.map((item) => ({
      name: item.name,
      type: "line",
      showSymbol: false,
      data: item.data,
      lineStyle: { width: 2 },
      emphasis: { focus: "series" },
      itemStyle: { color: item.color },
    })),
  };
}

function initParetoChart() {
  if (!elements.paretoContainer || typeof echarts === "undefined") {
    return;
  }
  const node = elements.paretoContainer.querySelector(".pareto-echart");
  if (!node) {
    return;
  }
  destroyParetoChart();
  const encoded = node.getAttribute("data-pareto");
  if (!encoded) {
    return;
  }
  let payload = null;
  try {
    payload = JSON.parse(decodeURIComponent(encoded));
  } catch (error) {
    console.warn("Failed to parse pareto payload", error);
    return;
  }
  paretoChartInstance = echarts.init(node);
  paretoChartInstance.setOption(buildParetoOption(payload));
  chartInstances.set(node, paretoChartInstance);
  paretoChartNode = node;
  paretoChartInstance.on("click", (params) => {
    if (payload?.multi) {
      alert("Select a single voyage to load a solution route.");
      return;
    }
    const data = params?.data;
    if (!data || !data.solutionId) {
      return;
    }
    if (!selectedVoyageId) {
      alert("No voyage ID selected for this solution.");
      return;
    }
    if (
      payload?.computationId &&
      String(payload.computationId) !== String(selectedComputationId)
    ) {
      alert("This solution belongs to a different computation. Please reload pareto.");
      return;
    }
    loadSolutionRoute(selectedVoyageId, data.solutionId);
  });
}

function destroyParetoChart() {
  if (paretoChartInstance) {
    paretoChartInstance.dispose();
    paretoChartInstance = null;
  }
  if (paretoChartNode) {
    chartInstances.delete(paretoChartNode);
    paretoChartNode = null;
  }
}

function buildParetoOption(payload) {
  const multiSeries = Array.isArray(payload.series) ? payload.series : null;
  const highlight = payload.highlightPoints || [];
  const series = [];
  if (multiSeries) {
    multiSeries.forEach((item) => {
      series.push({
        name: item.name,
        type: "scatter",
        data: item.points,
        symbolSize: 5,
        itemStyle: { color: item.color },
      });
    });
  } else {
    series.push({
      name: "Pareto",
      type: "scatter",
      data: payload.points || [],
      symbolSize: 6,
      itemStyle: { color: "#94a3b8" },
    });
  }
  if (highlight.length) {
    series.push({
      name: "Selected routes",
      type: "scatter",
      data: highlight.map((item) => ({
        name: item.name,
        value: item.value,
        itemStyle: { color: item.color },
      })),
      symbolSize: 10,
    });
  }
  return {
    animation: false,
    tooltip: {
      trigger: "item",
      formatter: (params) => {
        const data = params?.data || {};
        const fuel = Array.isArray(data.value) ? data.value[0] : null;
        const duration = Array.isArray(data.value) ? data.value[1] : null;
        const name = data.name || params.seriesName || "Point";
        return `${escapeHtml(name)}<br/>Fuel: ${formatNumber(
          Number(fuel)
        )}<br/>Duration: ${formatNumber(Number(duration))}`;
      },
    },
    legend: {
      data: series.map((item) => item.name),
      bottom: 0,
    },
    grid: {
      left: 50,
      right: 24,
      top: 28,
      bottom: 48,
      containLabel: true,
    },
    xAxis: {
      type: "value",
      name: "Total fuel",
      nameLocation: "end",
      nameGap: 24,
    },
    yAxis: {
      type: "value",
      name: "Duration (h)",
      nameLocation: "end",
      nameGap: 30,
    },
    series,
  };
}

function buildTicks(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }
  if (min === max) {
    return [min];
  }
  const ticks = [];
  for (let i = 0; i < count; i += 1) {
    ticks.push(min + (i / (count - 1)) * (max - min));
  }
  return ticks;
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return formatNumber(value);
  }
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(
    2,
    "0"
  )}`;
}

function formatNumber(value) {
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
  return String(Number(rounded));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isRouteExcluded(tag) {
  if (!tag) {
    return false;
  }
  const normalized = String(tag).trim().toLowerCase();
  return matchesTagSet(normalized, EXCLUDED_ROUTE_TAGS);
}

function isPreferredRouteTag(tag) {
  if (!tag) {
    return false;
  }
  const normalized = String(tag).trim().toLowerCase();
  return matchesTagSet(normalized, PREFERRED_ROUTE_TAGS);
}

function isTimeseriesRouteTag(tag) {
  if (!tag) {
    return false;
  }
  const normalized = String(tag).trim().toLowerCase();
  return matchesTagSet(normalized, TIMESERIES_ROUTE_TAGS);
}

function matchesTagSet(normalizedTag, tagSet) {
  if (!normalizedTag || !tagSet || !tagSet.size) {
    return false;
  }
  for (const token of tagSet) {
    if (matchesTagToken(normalizedTag, token)) {
      return true;
    }
  }
  return false;
}

function matchesTagToken(normalizedTag, token) {
  if (!normalizedTag || !token) {
    return false;
  }
  const escaped = escapeRegExp(String(token).toLowerCase());
  const regex = new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`);
  return regex.test(normalizedTag);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
}

function addRoutePointMarkers(layer, segment, shifts = [0]) {
  if (!segment.points || !segment.points.length) {
    return;
  }
  const weatherLookup = segment.weatherLookup;
  segment.points.forEach((point) => {
    const coord = normalizePoint(point);
    if (!coord) {
      return;
    }
    const tooltip = buildRouteTooltip(point, segment.tag, weatherLookup);
    shifts.forEach((shift) => {
      const shifted = shift === 0 ? coord : [coord[0], coord[1] + shift];
      const marker = L.circleMarker(shifted, {
        radius: 3,
        color: segment.color,
        weight: 1,
        fillColor: segment.color,
        fillOpacity: 0.6,
        interactive: shift === 0,
      }).addTo(layer);
      if (tooltip && shift === 0) {
        marker.bindTooltip(tooltip, { sticky: true, direction: "top" });
      }
    });
  });
}

function buildRouteTooltip(point, tag, weatherLookup) {
  const pieces = [];
  pieces.push(`<strong>${escapeHtml(tag)}</strong>`);
  const speed = toNumber(point.speed ?? point.operational?.sog ?? point.operational?.stw);
  const rpm = toNumber(point.operational?.rpm ?? point.rpm);
  const power = toNumber(point.operational?.pwr ?? point.power ?? point.powerKw);
  if (Number.isFinite(speed)) {
    pieces.push(`Speed: ${formatNumber(speed)}`);
  }
  if (Number.isFinite(rpm)) {
    pieces.push(`RPM: ${formatNumber(rpm)}`);
  }
  if (Number.isFinite(power)) {
    pieces.push(`Power: ${formatNumber(power)}`);
  }
  const weather = findWeatherForPoint(point, weatherLookup);
  if (weather) {
    const entries = [];
    if (Number.isFinite(weather.windSpeed)) {
      entries.push(`Wind: ${formatNumber(weather.windSpeed)} m/s`);
    }
    if (Number.isFinite(weather.waveHs)) {
      entries.push(`Wave Hs: ${formatNumber(weather.waveHs)} m`);
    }
    if (Number.isFinite(weather.sst)) {
      entries.push(`SST: ${formatNumber(weather.sst)} C`);
    }
    if (Number.isFinite(weather.airTemp)) {
      entries.push(`Air: ${formatNumber(weather.airTemp)} C`);
    }
    if (Number.isFinite(weather.currentSpeed)) {
      entries.push(`Current: ${formatNumber(weather.currentSpeed)} m/s`);
    }
    if (Number.isFinite(weather.tideHeight)) {
      entries.push(`Tide: ${formatNumber(weather.tideHeight)} m`);
    }
    if (entries.length) {
      pieces.push("Weather: " + entries.join(", "));
    }
  }
  if (!pieces.length) {
    return "";
  }
  return pieces.join("<br/>");
}

function buildWeatherLookup(route) {
  const batches = Array.isArray(route?.weatherBatches) ? route.weatherBatches : [];
  if (!batches.length) {
    return null;
  }
  const lookup = new Map();
  batches.forEach((batch) => {
    const dataPoints = batch?.dataPoints || [];
    dataPoints.forEach((point) => {
      const key = buildWeatherKey(point.lat, point.lon, point.t);
      if (key) {
        lookup.set(key, mapWeatherPoint(point));
      }
    });
  });
  return lookup;
}

function findWeatherForPoint(point, weatherLookup) {
  if (!weatherLookup) {
    return null;
  }
  const lat = toNumber(point.latitude ?? point.lat);
  const lon = toNumber(point.longitude ?? point.lon);
  const t = normalizeWeatherTime(point.timestamp ?? point.arrival ?? point.etd);
  const key = buildWeatherKey(lat, lon, t);
  if (!key) {
    return null;
  }
  return weatherLookup.get(key) || null;
}

function buildWeatherKey(lat, lon, t) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !t) {
    return null;
  }
  return `${lat.toFixed(5)}|${lon.toFixed(5)}|${t}`;
}

function updateRouteFilters(routeData) {
  if (!elements.routeFilters) {
    return;
  }
  if (!routeData) {
    elements.routeFilters.innerHTML = "<p>No routes loaded.</p>";
    routeTagVisibility.clear();
    return;
  }
  const rows = buildRouteSelectionRows(routeData);
  const next = new Map();
  rows.forEach((row) => {
    next.set(row.tag, routeTagVisibility.has(row.tag) ? routeTagVisibility.get(row.tag) : true);
  });
  routeTagVisibility.clear();
  next.forEach((value, key) => routeTagVisibility.set(key, value));
  renderRouteFilterControls(rows);
}

function renderRouteFilterControls(rows) {
  if (!elements.routeFilters) {
    return;
  }
  elements.routeFilters.innerHTML = "";
  if (!rows.length) {
    elements.routeFilters.textContent = "No routes available.";
    return;
  }
  const table = document.createElement("div");
  table.className = "route-table";
  const header = document.createElement("div");
  header.className = "route-row route-header";
  header.innerHTML = `
    <span></span>
    <span>Description</span>
    <span>Max service speed</span>
    <span>Min service speed</span>
    <span>Max cruise speed</span>
    <span>Min cruise speed</span>
    <span>Max service power</span>
    <span>Min service power</span>
    <span>Max service RPM</span>
    <span>Min service RPM</span>
    <span>Vessel draft</span>
  `;
  table.appendChild(header);
  rows.forEach((row) => {
    const line = document.createElement("div");
    line.className = "route-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = routeTagVisibility.get(row.tag) !== false;
    input.addEventListener("change", () => {
      routeTagVisibility.set(row.tag, input.checked);
      renderBaseRoute(baseRouteData);
      renderSolutionRoute(solutionRouteData);
    });
    const checkboxCell = document.createElement("span");
    checkboxCell.appendChild(input);
    const descriptionCell = document.createElement("span");
    descriptionCell.className = "route-description";
    descriptionCell.textContent = row.description;
    line.appendChild(checkboxCell);
    line.appendChild(descriptionCell);
    line.appendChild(buildRouteCell(row.maxServiceSpeed));
    line.appendChild(buildRouteCell(row.minServiceSpeed));
    line.appendChild(buildRouteCell(row.maxCruiseSpeed));
    line.appendChild(buildRouteCell(row.minCruiseSpeed));
    line.appendChild(buildRouteCell(row.maxServicePower));
    line.appendChild(buildRouteCell(row.minServicePower));
    line.appendChild(buildRouteCell(row.maxServiceRpm));
    line.appendChild(buildRouteCell(row.minServiceRpm));
    line.appendChild(buildRouteCell(row.vesselDraft));
    table.appendChild(line);
  });
  elements.routeFilters.appendChild(table);
}

function buildRouteSelectionRows(routeData) {
  const routes = getRoutesArray(routeData);
  return routes
    .map((route, index) => {
      const rawPoints = route?.data || route?.points || [];
      const tag = route?.tag || rawPoints.find((point) => point?.tag)?.tag || `route-${index + 1}`;
      if (isRouteExcluded(tag) || !isPreferredRouteTag(tag)) {
        return null;
      }
      return {
        tag: String(tag),
        description: buildRouteDescription(route, tag),
        maxServiceSpeed: pickRouteValue(route, "maxServiceSpeed"),
        minServiceSpeed: pickRouteValue(route, "minServiceSpeed"),
        maxCruiseSpeed: pickRouteValue(route, "maxCruiseSpeed"),
        minCruiseSpeed: pickRouteValue(route, "minCruiseSpeed"),
        maxServicePower: pickRouteValue(route, "maxServicePower"),
        minServicePower: pickRouteValue(route, "minServicePower"),
        maxServiceRpm: pickRouteValue(route, "maxServiceRpm"),
        minServiceRpm: pickRouteValue(route, "minServiceRpm"),
        vesselDraft: pickRouteValue(route, "vesselDraft"),
      };
    })
    .filter(Boolean);
}

function isRouteTagVisible(tag) {
  if (!tag) {
    return true;
  }
  if (!routeTagVisibility.size) {
    return true;
  }
  return routeTagVisibility.get(tag) !== false;
}

function buildRouteDescription(route, fallbackTag) {
  const description =
    route?.description ||
    route?.name ||
    route?.label ||
    route?.metadata?.description ||
    route?.summary;
  return String(description || fallbackTag || "Route");
}

function pickRouteValue(route, key) {
  if (!route || !key) {
    return null;
  }
  const candidates = [
    route,
    route.options,
    route.parameters,
    route.config,
    route.metadata,
    route.features,
  ];
  for (const candidate of candidates) {
    if (candidate && Object.prototype.hasOwnProperty.call(candidate, key)) {
      return candidate[key];
    }
  }
  return null;
}

function buildRouteCell(value) {
  const cell = document.createElement("span");
  if (value === null || value === undefined || value === "") {
    cell.textContent = "--";
    cell.className = "route-muted";
    return cell;
  }
  if (typeof value === "number") {
    cell.textContent = formatNumber(value);
    return cell;
  }
  cell.textContent = String(value);
  return cell;
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

function isEmptyObject(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
  );
}

function findIdValue(data, preferredKeys = [], depth = 2) {
  if (!data || typeof data !== "object") {
    return null;
  }
  const normalizedKeys = preferredKeys.map((key) => key.toLowerCase());
  const keyMap = Object.keys(data).reduce((acc, key) => {
    acc[key.toLowerCase()] = data[key];
    return acc;
  }, {});
  for (const key of preferredKeys) {
    if (data[key] !== undefined && data[key] !== null) {
      return data[key];
    }
  }
  for (const key of normalizedKeys) {
    if (keyMap[key] !== undefined && keyMap[key] !== null) {
      return keyMap[key];
    }
  }
  if (depth <= 0) {
    return null;
  }
  for (const value of Object.values(data)) {
    if (typeof value === "object" && value !== null) {
      const found = findIdValue(value, preferredKeys, depth - 1);
      if (found !== null && found !== undefined) {
        return found;
      }
    }
  }
  return null;
}
