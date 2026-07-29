// HA Energy Flow Card

const CARD_VERSION = "1.0.0";
const CARD_TAG = "ha_energy-flow-card";
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
  }

  static getConfigForm() {
    return {
      schema: [
        { name: "collection_key", selector: { text: {} } },
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
        { name: "title", selector: { text: {} } },
        { name: "show_card", selector: { boolean: {} } },
      ],
      computeLabel: (schema, localize) => {
        if (schema.name === "collection_key") return "Energy collection key";
        if (schema.name === "default_mode") return "Default view";
        if (schema.name === "show_card") return "Show card background";
        if (schema.name === "title") {
          return (
            localize("ui.panel.lovelace.editor.card.generic.title") || "Title"
          );
        }
        return undefined;
      },
      computeHelper: (schema) =>
        schema.name === "collection_key"
          ? "Use the same energy_* key as the related Energy cards."
          : undefined,
      assertConfig,
    };
  }

  static getStubConfig() {
    return {
      default_mode: "power",
      title: "",
      show_card: true,
    };
  }

  setConfig(config) {
    assertConfig(config);
    const previousKey = this._config.collection_key;
    const configurationChanged = this._configurationInitialized;
    this._config = {
      default_mode: "power",
      title: "",
      show_card: true,
      ...config,
    };
    if (!this._config.collection_key?.trim()) {
      delete this._config.collection_key;
    }
    this._configurationInitialized = true;
    if (!this._modeInitialized) {
      this._mode = this._config.default_mode;
      this._modeInitialized = true;
    }
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
  }

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    return {
      columns: 12,
      min_columns: 4,
      rows: 2,
      min_rows: 1,
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

  _setMode(mode) {
    if (!["power", "energy"].includes(mode) || mode === this._mode) return;
    this._mode = mode;
    this._render();
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
    const valueText =
      this._mode === "power"
        ? formatPower(this._hass, values.total)
        : formatEnergy(this._hass, values.total);
    const powerLabel = this._localize(
      "ui.panel.lovelace.cards.energy.power",
      "Power"
    );
    const energyLabel = this._localize(
      "ui.panel.lovelace.cards.energy.energy",
      "Energy"
    );
    const loadingLabel = this._localize(
      "ui.panel.lovelace.cards.energy.loading",
      "Loading energy data"
    );
    const noDataLabel = this._localize(
      "ui.panel.lovelace.cards.energy.no_data",
      "No data"
    );
    const wrapperTag = this._config.show_card === false ? "div" : "ha-card";
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
        .title {
          margin-bottom: 8px;
          color: var(--primary-text-color);
          font-size: var(--ha-font-size-l, 16px);
          font-weight: var(--ha-font-weight-medium, 500);
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-width: 0;
          margin-bottom: 8px;
        }
        .mode-switch {
          display: inline-grid;
          grid-template-columns: auto auto;
          min-width: 0;
          padding: 2px;
          border-radius: var(--ha-border-radius-pill, 999px);
          background: var(--secondary-background-color);
        }
        .mode-switch button {
          min-height: 28px;
          padding: 0 var(--ha-space-3, 12px);
          border: 0;
          border-radius: var(--ha-border-radius-pill, 999px);
          background: transparent;
          color: var(--secondary-text-color);
          font: inherit;
          cursor: pointer;
        }
        .mode-switch button[aria-pressed="true"] {
          background: var(--card-background-color);
          color: var(--primary-text-color);
          box-shadow: var(--ha-card-box-shadow, 0 1px 2px rgba(0, 0, 0, 0.16));
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
          height: 100%;
          min-height: 30px;
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
      }">
        ${title}
        <div class="header">
          <div class="mode-switch" role="group" aria-label="Display mode">
            <button type="button" data-mode="power" aria-pressed="${
              this._mode === "power"
            }">${escapeHtml(powerLabel)}</button>
            <button type="button" data-mode="energy" aria-pressed="${
              this._mode === "energy"
            }">${escapeHtml(energyLabel)}</button>
          </div>
          <div class="value">${escapeHtml(valueText)}</div>
        </div>
        ${
          this._error
            ? `<div class="message">${escapeHtml(this._error.message)}</div>`
            : !this._data
              ? `<div class="message">${escapeHtml(loadingLabel)}</div>`
              : values.total <= 0
                ? `<div class="message">${escapeHtml(noDataLabel)}</div>`
                : `<div class="bar ${
                    this._mode === "power" ? "animated" : ""
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
    this.shadowRoot.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        this._setMode(button.dataset.mode);
      });
    });
    if (this._nativeCard) this.shadowRoot.appendChild(this._nativeCard);
  }
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
  computeConsumption,
  getEnergyComposition,
  getEnergyStatisticIds,
  getPowerComposition,
  getTodayRange,
  normalizePower,
};
