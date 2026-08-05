// HA Energy Flow Card

const CARD_VERSION = "1.2.4-beta.1";
const CARD_TAG = "ha_energy-flow-card";
const EDITOR_TAG = "ha_energy-flow-card-editor";
const HOLD_DELAY_MS = 500;
const DOUBLE_TAP_DELAY_MS = 250;
const POINTER_MOVE_TOLERANCE_PX = 10;
const SOURCE_COLORS = Object.freeze({
  solar: "var(--energy-solar-color, #ff9800)",
  battery: "var(--energy-battery-out-color, #4caf50)",
  grid: "var(--energy-grid-consumption-color, #488fc2)",
});
const SOURCE_ICONS = Object.freeze({
  solar: "mdi:weather-sunny",
  battery: "mdi:battery",
  grid: "mdi:transmission-tower",
});

function assertConfig(config) {
  if (
    config?.collection_key !== undefined &&
    (typeof config.collection_key !== "string" ||
      !config.collection_key.startsWith("energy_"))
  ) {
    throw new Error("collection_key must start with energy_");
  }
  if (
    config?.default_mode !== undefined &&
    !["power", "energy"].includes(config.default_mode)
  ) {
    throw new Error('default_mode must be "power" or "energy"');
  }
  for (const actionName of [
    "tap_action",
    "hold_action",
    "double_tap_action",
  ]) {
    if (
      config?.[actionName] !== undefined &&
      (typeof config[actionName] !== "object" ||
        config[actionName] === null)
    ) {
      throw new Error(`${actionName} must be an action configuration`);
    }
  }
}

function getEnergyStatisticIds(preferences) {
  const ids = new Set();
  for (const source of preferences?.energy_sources || []) {
    if (!["solar", "grid", "battery"].includes(source.type)) continue;
    if (source.stat_energy_from) ids.add(source.stat_energy_from);
    if (source.stat_energy_to) ids.add(source.stat_energy_to);
  }
  return [...ids];
}

function getTimeZoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
}

function getZonedDate(year, month, day, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day);
  const parts = getTimeZoneParts(new Date(utcGuess), timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return new Date(utcGuess - (representedAsUtc - utcGuess));
}

function getTodayRange(hass, now = new Date()) {
  const timeZone =
    hass?.config?.time_zone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  const today = getTimeZoneParts(now, timeZone);
  const nextDay = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  return {
    start: getZonedDate(today.year, today.month, today.day, timeZone),
    end: getZonedDate(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
      timeZone
    ),
  };
}

function getCalendarParts(hass, date) {
  const timeZone =
    hass?.config?.time_zone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  return getTimeZoneParts(date, timeZone);
}

function getCalendarOrdinal(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000;
}

function getInclusiveRangeEnd(hass, start, end) {
  if (!(end instanceof Date) || end <= start) return start;
  const parts = getCalendarParts(hass, end);
  return parts.hour === 0 && parts.minute === 0 && parts.second === 0
    ? new Date(end.getTime() - 1)
    : end;
}

function getLocalizedPeriod(hass, key) {
  return hass?.localize?.(`ui.components.selectors.period.periods.${key}`) || "";
}

function formatPeriodDate(hass, date) {
  return new Intl.DateTimeFormat(getLanguage(hass), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: hass?.config?.time_zone,
  }).format(date);
}

function getEnergyPeriodLabel(hass, start, end, now = new Date()) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    return getLocalizedPeriod(hass, "today") || "Today";
  }

  const inclusiveEnd = getInclusiveRangeEnd(hass, start, end);
  const startParts = getCalendarParts(hass, start);
  const endParts = getCalendarParts(hass, inclusiveEnd);
  const todayParts = getCalendarParts(hass, now);
  const startOrdinal = getCalendarOrdinal(startParts);
  const endOrdinal = getCalendarOrdinal(endParts);
  const todayOrdinal = getCalendarOrdinal(todayParts);
  const rangeDays = endOrdinal - startOrdinal + 1;

  if (rangeDays === 1) {
    const dayOffset = startOrdinal - todayOrdinal;
    const key =
      dayOffset === 0
        ? "today"
        : dayOffset === -1
          ? "yesterday"
          : dayOffset === 1
            ? "tomorrow"
            : undefined;
    const localized = key ? getLocalizedPeriod(hass, key) : "";
    return localized || formatPeriodDate(hass, start);
  }

  if (rangeDays === 7) {
    const key =
      startOrdinal <= todayOrdinal && endOrdinal >= todayOrdinal
        ? "this_week"
        : endOrdinal < todayOrdinal && todayOrdinal - endOrdinal <= 7
          ? "last_week"
          : startOrdinal > todayOrdinal && startOrdinal - todayOrdinal <= 7
            ? "next_week"
            : undefined;
    const localized = key ? getLocalizedPeriod(hass, key) : "";
    if (localized) return localized;
  }

  const nextDay = new Date(
    Date.UTC(endParts.year, endParts.month - 1, endParts.day + 1)
  );
  const fullMonth =
    startParts.day === 1 &&
    nextDay.getUTCDate() === 1 &&
    startParts.year === endParts.year &&
    startParts.month === endParts.month;
  if (fullMonth) {
    const monthOffset =
      (startParts.year - todayParts.year) * 12 +
      startParts.month -
      todayParts.month;
    const key =
      monthOffset === 0
        ? "this_month"
        : monthOffset === -1
          ? "last_month"
          : monthOffset === 1
            ? "next_month"
            : undefined;
    const localized = key ? getLocalizedPeriod(hass, key) : "";
    if (localized) return localized;
  }

  const fullYear =
    startParts.month === 1 &&
    startParts.day === 1 &&
    endParts.month === 12 &&
    endParts.day === 31 &&
    startParts.year === endParts.year;
  if (fullYear) {
    const yearOffset = startParts.year - todayParts.year;
    const key =
      yearOffset === 0
        ? "this_year"
        : yearOffset === -1
          ? "last_year"
          : yearOffset === 1
            ? "next_year"
            : undefined;
    const localized = key ? getLocalizedPeriod(hass, key) : "";
    return localized || String(startParts.year);
  }

  return `${formatPeriodDate(hass, start)} – ${formatPeriodDate(
    hass,
    inclusiveEnd
  )}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getLanguage(hass) {
  return hass?.locale?.language || hass?.language || "en";
}

function formatNumber(hass, value, options) {
  return new Intl.NumberFormat(getLanguage(hass), {
    ...(hass?.locale?.number_format === "none"
      ? { useGrouping: false }
      : {}),
    ...options,
  }).format(value);
}

function formatPower(hass, watts) {
  const absolute = Math.abs(watts);
  if (absolute >= 1000000) {
    return `${formatNumber(hass, watts / 1000000, {
      maximumFractionDigits: 2,
    })} MW`;
  }
  if (absolute >= 1000) {
    return `${formatNumber(hass, watts / 1000, {
      maximumFractionDigits: 2,
    })} kW`;
  }
  return `${formatNumber(hass, watts, { maximumFractionDigits: 0 })} W`;
}

function formatEnergy(hass, kilowattHours) {
  const absolute = Math.abs(kilowattHours);
  if (absolute >= 1000) {
    return `${formatNumber(hass, kilowattHours / 1000, {
      maximumFractionDigits: 2,
    })} MWh`;
  }
  if (absolute < 1 && absolute > 0) {
    return `${formatNumber(hass, kilowattHours * 1000, {
      maximumFractionDigits: 0,
    })} Wh`;
  }
  return `${formatNumber(hass, kilowattHours, {
    maximumFractionDigits: 2,
  })} kWh`;
}

function normalizePower(value, unit) {
  if (!Number.isFinite(value)) return 0;
  const normalizedUnit = String(unit || "W").replace(/\s/g, "").toLowerCase();
  if (normalizedUnit === "kw") return value * 1000;
  if (normalizedUnit === "mw") return value * 1000000;
  if (normalizedUnit === "gw") return value * 1000000000;
  return value;
}

function currentPower(hass, entityId) {
  if (!entityId) return 0;
  const state = hass?.states?.[entityId];
  const value = Number.parseFloat(state?.state);
  return normalizePower(value, state?.attributes?.unit_of_measurement);
}

function computeConsumption({
  fromGrid = 0,
  toGrid = 0,
  solar = 0,
  toBattery = 0,
  fromBattery = 0,
}) {
  let gridRemaining = Math.max(fromGrid, 0);
  let gridExportRemaining = Math.max(toGrid, 0);
  let solarRemaining = Math.max(solar, 0);
  let batteryChargeRemaining = Math.max(toBattery, 0);
  let batteryRemaining = Math.max(fromBattery, 0);

  const usedTotal = Math.max(
    0,
    gridRemaining +
      solarRemaining +
      batteryRemaining -
      gridExportRemaining -
      batteryChargeRemaining
  );
  let homeRemaining = usedTotal;

  const excessGridToBattery = Math.max(
    0,
    Math.min(batteryChargeRemaining, gridRemaining - homeRemaining)
  );
  batteryChargeRemaining -= excessGridToBattery;
  gridRemaining -= excessGridToBattery;

  const solarToBattery = Math.min(solarRemaining, batteryChargeRemaining);
  batteryChargeRemaining -= solarToBattery;
  solarRemaining -= solarToBattery;

  const solarToGrid = Math.min(solarRemaining, gridExportRemaining);
  gridExportRemaining -= solarToGrid;
  solarRemaining -= solarToGrid;

  const batteryToGrid = Math.min(batteryRemaining, gridExportRemaining);
  gridExportRemaining -= batteryToGrid;
  batteryRemaining -= batteryToGrid;

  const remainingGridToBattery = Math.min(
    gridRemaining,
    batteryChargeRemaining
  );
  gridRemaining -= remainingGridToBattery;

  const solarUsed = Math.min(homeRemaining, solarRemaining);
  homeRemaining -= solarUsed;
  const batteryUsed = Math.min(homeRemaining, batteryRemaining);
  homeRemaining -= batteryUsed;
  const gridUsed = Math.min(homeRemaining, gridRemaining);

  return {
    solar: solarUsed,
    battery: batteryUsed,
    grid: gridUsed,
    total: usedTotal,
  };
}

function getPowerComposition(hass, preferences, trackedEntities) {
  let solar = 0;
  let fromGrid = 0;
  let toGrid = 0;
  let netBattery = 0;

  for (const source of preferences?.energy_sources || []) {
    const entityId = source.stat_rate;
    if (!entityId) continue;
    trackedEntities.add(entityId);
    const value = currentPower(hass, entityId);

    if (source.type === "solar") {
      solar += Math.max(value, 0);
    } else if (source.type === "grid") {
      if (value >= 0) fromGrid += value;
      else toGrid += Math.abs(value);
    } else if (source.type === "battery") {
      netBattery += value;
    }
  }

  return computeConsumption({
    fromGrid,
    toGrid,
    solar,
    fromBattery: Math.max(netBattery, 0),
    toBattery: Math.max(-netBattery, 0),
  });
}

function addStatisticChanges(target, rows) {
  for (const row of rows || []) {
    if (!Number.isFinite(row?.change)) continue;
    const timestamp = Number(row.start);
    target.set(timestamp, (target.get(timestamp) || 0) + row.change);
  }
}

function getEnergyComposition(data) {
  const streams = {
    fromGrid: new Map(),
    toGrid: new Map(),
    solar: new Map(),
    fromBattery: new Map(),
    toBattery: new Map(),
  };

  for (const source of data?.prefs?.energy_sources || []) {
    if (source.type === "solar") {
      addStatisticChanges(streams.solar, data.stats?.[source.stat_energy_from]);
    } else if (source.type === "grid") {
      addStatisticChanges(
        streams.fromGrid,
        data.stats?.[source.stat_energy_from]
      );
      addStatisticChanges(streams.toGrid, data.stats?.[source.stat_energy_to]);
    } else if (source.type === "battery") {
      addStatisticChanges(
        streams.fromBattery,
        data.stats?.[source.stat_energy_from]
      );
      addStatisticChanges(
        streams.toBattery,
        data.stats?.[source.stat_energy_to]
      );
    }
  }

  const timestamps = new Set(
    Object.values(streams).flatMap((stream) => [...stream.keys()])
  );
  const total = { solar: 0, battery: 0, grid: 0, total: 0 };

  for (const timestamp of timestamps) {
    const interval = computeConsumption({
      fromGrid: streams.fromGrid.get(timestamp) || 0,
      toGrid: streams.toGrid.get(timestamp) || 0,
      solar: streams.solar.get(timestamp) || 0,
      fromBattery: streams.fromBattery.get(timestamp) || 0,
      toBattery: streams.toBattery.get(timestamp) || 0,
    });
    total.solar += interval.solar;
    total.battery += interval.battery;
    total.grid += interval.grid;
    total.total += interval.total;
  }

  return total;
}

function buildConfigSchema(mode = "power") {
  const configuration = [
    { name: "title", selector: { text: {} } },
    {
      name: "default_mode",
      selector: {
        select: {
          mode: "dropdown",
          options: [
            { value: "power", label: "Power" },
            { value: "energy", label: "Energy" },
          ],
        },
      },
    },
  ];
  if (mode === "energy") {
    configuration.push({
      name: "collection_key",
      selector: { text: {} },
    });
  }
  configuration.push({
    name: "show_card",
    selector: { boolean: {} },
  });

  return [
    {
      name: "configuration",
      type: "expandable",
      title: "Configuration",
      flatten: true,
      schema: configuration,
    },
    {
      name: "interactions",
      type: "expandable",
      title: "Interactions",
      flatten: true,
      schema: [
        {
          name: "tap_action",
          selector: {
            ui_action: {
              default_action: "none",
            },
          },
        },
        {
          name: "hold_action",
          selector: {
            ui_action: {
              default_action: "none",
            },
          },
        },
        {
          name: "double_tap_action",
          selector: {
            ui_action: {
              default_action: "none",
            },
          },
        },
      ],
    },
  ];
}

function computeConfigLabel(schema, localize = () => "") {
  if (schema.name === "collection_key") return "Energy collection key";
  if (schema.name === "default_mode") return "Default view";
  if (schema.name === "show_card") return "Show card background";
  if (schema.name === "tap_action") return "Tap action";
  if (schema.name === "hold_action") return "Hold action";
  if (schema.name === "double_tap_action") return "Double-tap action";
  if (schema.name === "title") {
    return localize("ui.panel.lovelace.editor.card.generic.title") || "Title";
  }
  return undefined;
}

function computeConfigHelper(schema) {
  return schema.name === "collection_key"
    ? "Optional. Without a collection key, Energy mode displays today's values. Use the same energy_* key to share a period with related Energy cards."
    : undefined;
}

class HaEnergyFlowCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = undefined;
    this._form = undefined;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  get hass() {
    return this._hass;
  }

  setConfig(config) {
    assertConfig(config);
    this._config = { ...config };
    if (this._form) {
      this._updateForm();
    } else {
      this._render();
    }
  }

  _updateForm() {
    if (!this._form) return;
    this._form.hass = this._hass;
    this._form.data = this._config;
    this._form.schema = buildConfigSchema(
      this._config.default_mode || "power"
    );
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
      </style>
      <ha-form></ha-form>
    `;
    this._form = this.shadowRoot.querySelector("ha-form");
    if (!this._form) return;
    this._updateForm();
    this._form.computeLabel = (schema) =>
      computeConfigLabel(
        schema,
        this._hass?.localize?.bind(this._hass) || (() => "")
      );
    this._form.computeHelper = computeConfigHelper;
    this._form.addEventListener("value-changed", (event) => {
      event.stopPropagation();
      this._config = { ...event.detail.value };
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: this._config },
          bubbles: true,
          composed: true,
        })
      );
      this._updateForm();
    });
  }
}

class HaEnergyFlowCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = undefined;
    this._data = undefined;
    this._mode = "power";
    this._trackedEntities = new Set();
    this._unsubscribe = undefined;
    this._nativeCard = undefined;
    this._initializationPromise = undefined;
    this._refreshTimer = undefined;
    this._holdTimer = undefined;
    this._tapTimer = undefined;
    this._pointerStart = undefined;
    this._holdTriggered = false;
  }

  static getConfigForm() {
    return {
      schema: buildConfigSchema("power"),
      computeLabel: computeConfigLabel,
      computeHelper: computeConfigHelper,
      assertConfig,
    };
  }

  static getConfigElement() {
    return document.createElement(EDITOR_TAG);
  }

  static getStubConfig() {
    return {
      default_mode: "power",
      title: "",
      show_card: true,
      tap_action: { action: "none" },
      hold_action: { action: "none" },
      double_tap_action: { action: "none" },
    };
  }

  setConfig(config) {
    assertConfig(config);
    this._clearInteractionTimers();
    const previousKey = this._config.collection_key;
    const configurationChanged = this._configurationInitialized;
    this._config = {
      default_mode: "power",
      title: "",
      show_card: true,
      tap_action: { action: "none" },
      hold_action: { action: "none" },
      double_tap_action: { action: "none" },
      ...config,
    };
    if (!this._config.collection_key?.trim()) {
      delete this._config.collection_key;
    }
    this._configurationInitialized = true;
    this._mode = this._config.default_mode;
    if (configurationChanged && previousKey !== this._config.collection_key) {
      this._disconnectCollection();
      window.clearTimeout(this._refreshTimer);
      this._refreshTimer = undefined;
      this._nativeCard?.remove();
      this._nativeCard = undefined;
      this._initializationPromise = undefined;
      this._data = undefined;
    }
    this._render();
    this._initialize();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (this._nativeCard) this._nativeCard.hass = hass;

    if (
      this._mode === "power" &&
      [...this._trackedEntities].some(
        (entityId) => oldHass?.states?.[entityId] !== hass?.states?.[entityId]
      )
    ) {
      this._render();
    } else if (!oldHass || getLanguage(oldHass) !== getLanguage(hass)) {
      this._render();
    }
    this._initialize();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    this._initialize();
  }

  disconnectedCallback() {
    this._disconnectCollection();
    window.clearTimeout(this._refreshTimer);
    this._refreshTimer = undefined;
    this._clearInteractionTimers();
  }

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    return {
      columns: 6,
      rows: "auto",
    };
  }

  async _initialize() {
    if (
      !this.isConnected ||
      !this._hass ||
      this._initializationPromise
    ) {
      return this._initializationPromise;
    }
    this._initializationPromise = (
      this._config.collection_key
        ? this._connectCollection()
        : this._loadToday()
    ).catch((error) => {
        this._initializationPromise = undefined;
        this._error = error;
        this._render();
      });
    return this._initializationPromise;
  }

  async _loadToday() {
    const prefs = await this._hass.callWS({ type: "energy/get_prefs" });
    const statisticIds = getEnergyStatisticIds(prefs);
    const { start, end } = getTodayRange(this._hass);
    const stats = statisticIds.length
      ? await this._hass.callWS({
          type: "recorder/statistics_during_period",
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          statistic_ids: statisticIds,
          period: "hour",
          units: { energy: "kWh" },
          types: ["change"],
        })
      : {};
    this._data = { prefs, stats, start, end };
    this._error = undefined;
    this._render();
    this._scheduleTodayRefresh();
  }

  _scheduleTodayRefresh() {
    window.clearTimeout(this._refreshTimer);
    const nextRefresh = new Date();
    nextRefresh.setMinutes(20, 0, 0);
    if (nextRefresh <= new Date()) {
      nextRefresh.setHours(nextRefresh.getHours() + 1);
    }
    this._refreshTimer = window.setTimeout(() => {
      this._initializationPromise = undefined;
      this._initialize();
    }, nextRefresh.getTime() - Date.now());
  }

  async _connectCollection() {
    if (typeof window.loadCardHelpers !== "function") {
      throw new Error("Home Assistant card helpers are unavailable");
    }
    const helpers = await window.loadCardHelpers();
    this._nativeCard = await helpers.createCardElement({
      type: "energy-distribution",
      collection_key: this._config.collection_key,
    });
    this._nativeCard.classList.add("native-loader");
    this._nativeCard.setAttribute("aria-hidden", "true");
    this._nativeCard.hass = this._hass;
    this.shadowRoot.appendChild(this._nativeCard);

    const connectionKey = `_${this._config.collection_key}`;
    let collection;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      collection = this._hass.connection?.[connectionKey];
      if (collection) break;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    if (!collection?.subscribe) {
      throw new Error("The Energy dashboard data collection is unavailable");
    }
    this._unsubscribe = collection.subscribe((data) => {
      this._data = data;
      this._error = undefined;
      this._render();
    });
    if (collection.state) {
      this._data = collection.state;
      this._render();
    }
  }

  _disconnectCollection() {
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  _localize(key, fallback) {
    return this._hass?.localize?.(key) || fallback;
  }

  _hasAction(actionName) {
    const action = this._config[actionName];
    return !!action?.action && action.action !== "none";
  }

  _performAction(interaction) {
    const actionName = `${interaction}_action`;
    const actionConfig = this._config[actionName];
    if (!this._hasAction(actionName)) return;

    if (actionConfig.action === "fire-dom-event") {
      this.dispatchEvent(
        new CustomEvent("ll-custom", {
          detail: actionConfig,
          bubbles: true,
          composed: true,
        })
      );
      return;
    }

    this.dispatchEvent(
      new CustomEvent("hass-action", {
        detail: {
          config: this._config,
          action: interaction,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  _handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    this._pointerStart = { x: event.clientX, y: event.clientY };
    this._holdTriggered = false;
    window.clearTimeout(this._holdTimer);
    if (this._hasAction("hold_action")) {
      this._holdTimer = window.setTimeout(() => {
        this._holdTimer = undefined;
        this._holdTriggered = true;
        this._performAction("hold");
      }, HOLD_DELAY_MS);
    }
  }

  _handlePointerMove(event) {
    if (!this._pointerStart) return;
    const moved = Math.hypot(
      event.clientX - this._pointerStart.x,
      event.clientY - this._pointerStart.y
    );
    if (moved > POINTER_MOVE_TOLERANCE_PX) {
      window.clearTimeout(this._holdTimer);
      this._holdTimer = undefined;
      this._pointerStart = undefined;
    }
  }

  _handlePointerEnd() {
    window.clearTimeout(this._holdTimer);
    this._holdTimer = undefined;
    this._pointerStart = undefined;
  }

  _handleClick() {
    if (this._holdTriggered) {
      this._holdTriggered = false;
      return;
    }
    if (!this._hasAction("double_tap_action")) {
      this._performAction("tap");
      return;
    }
    if (this._tapTimer) {
      window.clearTimeout(this._tapTimer);
      this._tapTimer = undefined;
      this._performAction("double_tap");
      return;
    }
    this._tapTimer = window.setTimeout(() => {
      this._tapTimer = undefined;
      this._performAction("tap");
    }, DOUBLE_TAP_DELAY_MS);
  }

  _clearInteractionTimers() {
    window.clearTimeout(this._holdTimer);
    window.clearTimeout(this._tapTimer);
    this._holdTimer = undefined;
    this._tapTimer = undefined;
    this._pointerStart = undefined;
    this._holdTriggered = false;
  }

  _renderSegment(type, value, total) {
    const percentage = total > 0 ? (value / total) * 100 : 0;
    const showIcon = percentage >= 12;
    const label = this._localize(
      `ui.panel.lovelace.cards.energy.energy_distribution.${type}`,
      type[0].toUpperCase() + type.slice(1)
    );
    return `
      <div
        class="segment ${type}"
        style="width: ${Math.max(0, percentage)}%; background: ${SOURCE_COLORS[type]}"
        title="${escapeHtml(label)}: ${formatNumber(this._hass, percentage, {
          maximumFractionDigits: 1,
        })}%"
      >
        ${
          showIcon
            ? `<ha-icon icon="${SOURCE_ICONS[type]}" aria-hidden="true"></ha-icon>`
            : ""
        }
      </div>
    `;
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    const preferences = this._data?.prefs;
    this._trackedEntities.clear();
    const values =
      this._mode === "power"
        ? getPowerComposition(
            this._hass,
            preferences,
            this._trackedEntities
          )
        : getEnergyComposition(this._data);
    const hasPowerData = [...this._trackedEntities].some((entityId) =>
      Number.isFinite(
        Number.parseFloat(this._hass?.states?.[entityId]?.state)
      )
    );
    const hasEnergyDataSources = getEnergyStatisticIds(preferences).length > 0;
    const valueText =
      this._mode === "power"
        ? formatPower(this._hass, values.total)
        : formatEnergy(this._hass, values.total);
    const loadingLabel = this._localize(
      "ui.panel.lovelace.cards.energy.loading",
      "Loading energy data"
    );
    const noDataLabel = this._localize(
      "ui.panel.lovelace.cards.energy.no_data",
      "No data"
    );
    const periodLabel =
      this._mode === "power"
        ? this._localize(
            "ui.panel.lovelace.components.energy_period_selector.now",
            "Now"
          )
        : getEnergyPeriodLabel(
            this._hass,
            this._data?.start,
            this._data?.end
          );
    const wrapperTag = this._config.show_card === false ? "div" : "ha-card";
    const actionable = [
      "tap_action",
      "hold_action",
      "double_tap_action",
    ].some((actionName) => this._hasAction(actionName));
    const title = this._config.title
      ? `<div class="title">${escapeHtml(this._config.title)}</div>`
      : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100%;
        }
        ha-card,
        .card {
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 86px;
          padding: 12px 10px;
          background: var(--ha-card-background, var(--card-background-color));
          color: var(--primary-text-color);
          overflow: hidden;
        }
        .card.frameless {
          padding: 0;
          background: transparent;
        }
        .card.actionable {
          cursor: pointer;
          touch-action: manipulation;
          user-select: none;
          -webkit-user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .title {
          flex: none;
          margin-bottom: 8px;
          color: var(--primary-text-color);
          font-size: var(--ha-font-size-l, 16px);
          font-weight: var(--ha-font-weight-medium, 500);
        }
        .header {
          display: flex;
          flex: none;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-width: 0;
          margin-bottom: 8px;
        }
        .period-label {
          color: var(--primary-text-color);
          font-size: var(--ha-font-size-m, 14px);
          font-weight: var(--ha-font-weight-medium, 500);
        }
        .value {
          overflow: hidden;
          color: var(--primary-text-color);
          font-size: var(--ha-font-size-m, 14px);
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bar {
          position: relative;
          display: flex;
          width: 100%;
          height: auto;
          min-height: 22px;
          flex: 1 1 30px;
          overflow: hidden;
          border-radius: calc(var(--ha-card-border-radius, 12px) - 3px);
          background: var(--secondary-background-color);
        }
        .bar.animated::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 2;
          pointer-events: none;
          background-image: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.18) 25%,
            transparent 25%,
            transparent 50%,
            rgba(255, 255, 255, 0.18) 50%,
            rgba(255, 255, 255, 0.18) 75%,
            transparent 75%,
            transparent
          );
          background-size: 28px 28px;
          animation: live-flow 1.2s linear infinite;
        }
        .segment {
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 0;
          overflow: hidden;
        }
        .segment ha-icon {
          position: relative;
          z-index: 3;
          flex: none;
          color: rgba(255, 255, 255, 0.95);
          --mdc-icon-size: 16px;
        }
        .message {
          display: grid;
          flex: 1 1 30px;
          min-height: 30px;
          place-items: center;
          color: var(--secondary-text-color);
        }
        .native-loader {
          display: none !important;
        }
        @keyframes live-flow {
          from { background-position: 0 0; }
          to { background-position: 28px 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .bar.animated::after {
            animation: none;
          }
        }
      </style>
      <${wrapperTag} class="card ${
        this._config.show_card === false ? "frameless" : ""
      } ${actionable ? "actionable" : ""}" ${
        actionable ? 'role="button" tabindex="0"' : ""
      }>
        ${title}
        <div class="header">
          <div class="period-label">${escapeHtml(periodLabel)}</div>
          <div class="value">${escapeHtml(valueText)}</div>
        </div>
        ${
          this._error
            ? `<div class="message">${escapeHtml(this._error.message)}</div>`
            : !this._data
              ? `<div class="message">${escapeHtml(loadingLabel)}</div>`
              : (this._mode === "power" && !hasPowerData) ||
                  (this._mode === "energy" && !hasEnergyDataSources)
                ? `<div class="message">${escapeHtml(noDataLabel)}</div>`
                : `<div class="bar ${
                    this._mode === "power" && values.total > 0
                      ? "animated"
                      : ""
                  }">
                    ${this._renderSegment("solar", values.solar, values.total)}
                    ${this._renderSegment(
                      "battery",
                      values.battery,
                      values.total
                    )}
                    ${this._renderSegment("grid", values.grid, values.total)}
                  </div>`
        }
      </${wrapperTag}>
    `;
    const cardElement = this.shadowRoot.querySelector(".card");
    if (actionable && cardElement) {
      cardElement.addEventListener("pointerdown", (event) =>
        this._handlePointerDown(event)
      );
      cardElement.addEventListener("pointermove", (event) =>
        this._handlePointerMove(event)
      );
      cardElement.addEventListener("pointerup", () => this._handlePointerEnd());
      cardElement.addEventListener("pointercancel", () =>
        this._handlePointerEnd()
      );
      cardElement.addEventListener("click", () => this._handleClick());
      cardElement.addEventListener("contextmenu", (event) => {
        if (this._hasAction("hold_action")) event.preventDefault();
      });
      cardElement.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this._performAction("tap");
      });
    }
    if (this._nativeCard) this.shadowRoot.appendChild(this._nativeCard);
  }
}

if (!customElements.get(EDITOR_TAG)) {
  customElements.define(EDITOR_TAG, HaEnergyFlowCardEditor);
}

if (!customElements.get(CARD_TAG)) {
  customElements.define(CARD_TAG, HaEnergyFlowCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === CARD_TAG)) {
  window.customCards.push({
    type: CARD_TAG,
    name: "HA Energy Flow Card",
    description:
      "Shows the Energy dashboard home-consumption share by solar, battery, and grid.",
    preview: true,
    documentationURL: "https://github.com/psym88/ha_energy-flow-card",
  });
}

console.info(
  `%c HA ENERGY FLOW CARD %c v${CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;"
);

export {
  buildConfigSchema,
  computeConsumption,
  getEnergyComposition,
  getEnergyPeriodLabel,
  getEnergyStatisticIds,
  getPowerComposition,
  getTodayRange,
  normalizePower,
};
