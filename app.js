const DEFAULT_CONFIG = {
  baseUrl: "https://api.t-vos.com/v1.23",
  accessKey: "YOUR_ACCESS_KEY",
  token: "",
  endpoints: {
    runs: "/weather-routing/optimizations",
    runDetails: "/weather-routing/optimizations/{runId}",
    pareto: "/weather-routing/optimizations/{runId}/pareto",
    route: "/weather-routing/routes/{routeId}",
  },
};

const STORAGE_KEY = "theyr-routing-config";

const elements = {
  baseUrl: document.getElementById("baseUrl"),
  accessKey: document.getElementById("accessKey"),
  token: document.getElementById("token"),
  runsEndpoint: document.getElementById("runsEndpoint"),
  runDetailsEndpoint: document.getElementById("runDetailsEndpoint"),
  paretoEndpoint: document.getElementById("paretoEndpoint"),
  routeEndpoint: document.getElementById("routeEndpoint"),
  saveConfig: document.getElementById("saveConfig"),
  loadSwagger: document.getElementById("loadSwagger"),
  loadRuns: document.getElementById("loadRuns"),
  runsSelect: document.getElementById("runsSelect"),
  loadRun: document.getElementById("loadRun"),
  runMetrics: document.getElementById("runMetrics"),
  statusPill: document.getElementById("statusPill"),
  refreshPareto: document.getElementById("refreshPareto"),
  paretoRoutes: document.getElementById("paretoRoutes"),
};

let config = loadConfig();
let map;
let bestLayer;
let paretoLayer;
let paretoChart;
let currentRunId = null;
let paretoItems = [];

init();

function init() {
  hydrateInputs();
  initMap();
  initChart();
  bindEvents();
  updateStatus(!!config.token);
}

function bindEvents() {
  elements.saveConfig.addEventListener("click", () => {
    config = readConfigFromInputs();
    saveConfig(config);
    updateStatus(!!config.token);
  });

  elements.loadRuns.addEventListener("click", loadRuns);
  elements.loadRun.addEventListener("click", loadRun);
  elements.loadSwagger.addEventListener("click", loadSwaggerEndpoints);
  elements.refreshPareto.addEventListener("click", () => {
    if (currentRunId) {
      loadPareto(currentRunId);
    }
  });
}

function initMap() {
  map = L.map("map").setView([20, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  bestLayer = L.layerGroup().addTo(map);
  paretoLayer = L.layerGroup().addTo(map);
}

function initChart() {
  const ctx = document.getElementById("paretoChart");
  paretoChart = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Pareto front",
          data: [],
          backgroundColor: "#f97316",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: true,
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Best time",
          },
        },
        y: {
          title: {
            display: true,
            text: "FOA",
          },
        },
      },
      onClick: (_, elementsAtEvent) => {
        if (!elementsAtEvent.length) {
          return;
        }
        const index = elementsAtEvent[0].index;
        const item = paretoItems[index];
        if (item) {
          selectParetoRoute(item, index);
        }
      },
    },
  });
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
  elements.accessKey.value = config.accessKey;
  elements.token.value = config.token;
  elements.runsEndpoint.value = config.endpoints.runs;
  elements.runDetailsEndpoint.value = config.endpoints.runDetails;
  elements.paretoEndpoint.value = config.endpoints.pareto;
  elements.routeEndpoint.value = config.endpoints.route;
}

function readConfigFromInputs() {
  return {
    baseUrl: elements.baseUrl.value.trim(),
    accessKey: elements.accessKey.value.trim(),
    token: elements.token.value.trim(),
    endpoints: {
      runs: elements.runsEndpoint.value.trim(),
      runDetails: elements.runDetailsEndpoint.value.trim(),
      pareto: elements.paretoEndpoint.value.trim(),
      route: elements.routeEndpoint.value.trim(),
    },
  };
}

function updateStatus(isConnected) {
  elements.statusPill.textContent = isConnected ? "Token set" : "Disconnected";
  elements.statusPill.classList.toggle("connected", isConnected);
}

function buildUrl(path, params = {}) {
  let finalPath = path;
  Object.entries(params).forEach(([key, value]) => {
    finalPath = finalPath.replace(`{${key}}`, encodeURIComponent(value));
  });
  return `${config.baseUrl.replace(/\/$/, "")}${finalPath}`;
}

async function fetchJson(url) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (config.accessKey) {
    headers["X-API-Key"] = config.accessKey;
  }
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${message}`);
  }
  return response.json();
}

async function loadRuns() {
  setLoading(elements.loadRuns, true);
  try {
    config = readConfigFromInputs();
    saveConfig(config);
    const url = buildUrl(config.endpoints.runs);
    const data = await fetchJson(url);
    const runs = normalizeArray(data, ["runs", "items", "data", "results"]) || [];
    updateRunsSelect(runs);
    updateStatus(true);
  } catch (error) {
    console.error(error);
    alert(`Failed to load runs: ${error.message}`);
  } finally {
    setLoading(elements.loadRuns, false);
  }
}

async function loadSwaggerEndpoints() {
  setLoading(elements.loadSwagger, true);
  try {
    config = readConfigFromInputs();
    saveConfig(config);
    const swaggerUrl = `${config.baseUrl.replace(/\/$/, "")}/swagger/v1/swagger.json`;
    const data = await fetchJson(swaggerUrl);
    const endpoints = extractEndpointsFromSwagger(data);
    if (!endpoints) {
      alert("Could not infer endpoints from the swagger document.");
      return;
    }
    config.endpoints = { ...config.endpoints, ...endpoints };
    hydrateInputs();
    saveConfig(config);
  } catch (error) {
    console.error(error);
    alert(`Failed to load swagger: ${error.message}`);
  } finally {
    setLoading(elements.loadSwagger, false);
  }
}

function updateRunsSelect(runs) {
  elements.runsSelect.innerHTML = "<option value=\"\">Select a run...</option>";
  runs.forEach((run) => {
    const option = document.createElement("option");
    option.value = run.id || run.runId || run.uuid || run.name;
    option.textContent = run.name || run.title || `Run ${option.value}`;
    option.dataset.payload = JSON.stringify(run);
    elements.runsSelect.appendChild(option);
  });
}

async function loadRun() {
  const runId = elements.runsSelect.value;
  if (!runId) {
    alert("Select a run first.");
    return;
  }

  setLoading(elements.loadRun, true);
  try {
    config = readConfigFromInputs();
    saveConfig(config);
    const url = buildUrl(config.endpoints.runDetails, { runId });
    const data = await fetchJson(url);
    currentRunId = runId;
    const bestRoute = findBestRoute(data);
    if (bestRoute) {
      renderRoute(bestRoute, { color: "#0ea5e9" }, bestLayer);
      updateMetrics(bestRoute);
    }
    await loadPareto(runId);
  } catch (error) {
    console.error(error);
    alert(`Failed to load run: ${error.message}`);
  } finally {
    setLoading(elements.loadRun, false);
  }
}

async function loadPareto(runId) {
  setLoading(elements.refreshPareto, true);
  try {
    const url = buildUrl(config.endpoints.pareto, { runId });
    const data = await fetchJson(url);
    paretoItems = normalizeArray(data, ["pareto", "paretoFront", "routes", "items", "data"]) || [];
    updateParetoChart(paretoItems);
    updateParetoList(paretoItems);
  } catch (error) {
    console.error(error);
    alert(`Failed to load pareto front: ${error.message}`);
  } finally {
    setLoading(elements.refreshPareto, false);
  }
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

function findBestRoute(data) {
  if (!data) {
    return null;
  }
  if (data.bestRoute) {
    return data.bestRoute;
  }
  if (data.optimizedRoute) {
    return data.optimizedRoute;
  }
  if (Array.isArray(data.routes)) {
    return data.routes[0];
  }
  return data.route || null;
}

function extractEndpointsFromSwagger(swagger) {
  if (!swagger || !swagger.paths) {
    return null;
  }
  const paths = Object.keys(swagger.paths);
  if (!paths.length) {
    return null;
  }
  const runs = findSwaggerPath(paths, [/optimizations/i], [/pareto/i, /route/i, /routes/i, /{runId}/i]);
  const runDetails = findSwaggerPath(paths, [/optimizations/i, /\{runId\}/i], [/pareto/i]);
  const pareto = findSwaggerPath(paths, [/pareto/i], []);
  const route = findSwaggerPath(paths, [/routes?/i, /\{routeId\}/i], []);
  return {
    runs: runs ?? config.endpoints.runs,
    runDetails: runDetails ?? config.endpoints.runDetails,
    pareto: pareto ?? config.endpoints.pareto,
    route: route ?? config.endpoints.route,
  };
}

function findSwaggerPath(paths, mustIncludePatterns, mustExcludePatterns) {
  return (
    paths.find((path) => {
      const matchesInclude = mustIncludePatterns.every((pattern) => pattern.test(path));
      const matchesExclude = mustExcludePatterns.some((pattern) => pattern.test(path));
      return matchesInclude && !matchesExclude;
    }) ?? null
  );
}

function updateMetrics(route) {
  elements.runMetrics.innerHTML = "";
  const metrics = {
    FOA: findMetric(route, ["foa", "fuel", "fuelConsumption"]),
    "Best time": findMetric(route, ["best_time", "time", "duration", "eta"]),
    Distance: findMetric(route, ["distance", "length", "nm"]),
    "Avg speed": findMetric(route, ["avg_speed", "speed", "avgSpeed"]),
  };

  Object.entries(metrics).forEach(([label, value]) => {
    if (value === null || value === undefined) {
      return;
    }
    const card = document.createElement("div");
    card.className = "metric-card";
    card.innerHTML = `${label}<span>${value}</span>`;
    elements.runMetrics.appendChild(card);
  });
}

function findMetric(route, keys) {
  if (!route) {
    return null;
  }
  for (const key of keys) {
    if (route[key] !== undefined) {
      return route[key];
    }
    if (route.metrics && route.metrics[key] !== undefined) {
      return route.metrics[key];
    }
    if (route.summary && route.summary[key] !== undefined) {
      return route.summary[key];
    }
  }
  return null;
}

function renderRoute(route, style, layerGroup) {
  layerGroup.clearLayers();
  const coordinates = extractCoordinates(route);
  if (!coordinates.length) {
    return;
  }
  const polyline = L.polyline(coordinates, { ...style, weight: 4 }).addTo(layerGroup);
  map.fitBounds(polyline.getBounds(), { padding: [30, 30] });
}

function extractCoordinates(route) {
  if (!route) {
    return [];
  }
  if (route.geometry && Array.isArray(route.geometry.coordinates)) {
    return route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  }
  if (Array.isArray(route.coordinates)) {
    return route.coordinates.map((point) => normalizePoint(point)).filter(Boolean);
  }
  if (Array.isArray(route.path)) {
    return route.path.map((point) => normalizePoint(point)).filter(Boolean);
  }
  if (Array.isArray(route.waypoints)) {
    return route.waypoints.map((point) => normalizePoint(point)).filter(Boolean);
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

function updateParetoChart(items) {
  const dataset = items.map((item) => {
    const xValue = findMetric(item, ["best_time", "time", "duration", "eta"]);
    const yValue = findMetric(item, ["foa", "fuel", "fuelConsumption"]);
    return {
      x: xValue,
      y: yValue,
    };
  });

  paretoChart.data.datasets[0].data = dataset;
  paretoChart.update();
}

function updateParetoList(items) {
  elements.paretoRoutes.innerHTML = "";
  items.forEach((item, index) => {
    const button = document.createElement("button");
    const routeLabel = item.name || item.routeName || item.id || `Route ${index + 1}`;
    const time = findMetric(item, ["best_time", "time", "duration", "eta"]);
    const foa = findMetric(item, ["foa", "fuel", "fuelConsumption"]);
    button.textContent = `${routeLabel} · Time: ${time ?? "?"} · FOA: ${foa ?? "?"}`;
    button.addEventListener("click", () => selectParetoRoute(item, index));
    elements.paretoRoutes.appendChild(button);
  });
}

async function selectParetoRoute(item, index) {
  const buttons = elements.paretoRoutes.querySelectorAll("button");
  buttons.forEach((button, idx) => {
    button.classList.toggle("active", idx === index);
  });

  const routeId = item.routeId || item.id || item.uuid;
  if (item.geometry || item.coordinates || item.path) {
    renderRoute(item, { color: "#f97316" }, paretoLayer);
    return;
  }

  if (!routeId) {
    return;
  }

  try {
    const url = buildUrl(config.endpoints.route, { routeId });
    const data = await fetchJson(url);
    renderRoute(data, { color: "#f97316" }, paretoLayer);
  } catch (error) {
    console.error(error);
    alert(`Failed to load route ${routeId}: ${error.message}`);
  }
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
