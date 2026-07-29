import assert from "node:assert/strict";
import test from "node:test";

class MockShadowRoot {
  constructor() {
    this.innerHTML = "";
  }

  appendChild() {}

  querySelectorAll() {
    return [];
  }

  querySelector() {
    return null;
  }
}

class MockHTMLElement {
  constructor() {
    this.isConnected = false;
  }

  attachShadow() {
    this.shadowRoot = new MockShadowRoot();
    return this.shadowRoot;
  }
}

const registry = new Map();
globalThis.HTMLElement = MockHTMLElement;
globalThis.customElements = {
  define(name, constructor) {
    registry.set(name, constructor);
  },
  get(name) {
    return registry.get(name);
  },
};
globalThis.window = {
  customCards: [],
  setTimeout,
  clearTimeout,
};
globalThis.document = {
  createElement(name) {
    const Constructor = registry.get(name);
    return Constructor ? new Constructor() : { localName: name };
  },
};

const {
  buildConfigSchema,
  computeConsumption,
  getEnergyComposition,
  getEnergyPeriodLabel,
  getEnergyStatisticIds,
  getPowerComposition,
  getTodayRange,
  normalizePower,
} = await import("../ha_energy-flow-card.js");

const Card = registry.get("ha_energy-flow-card");

test("registers the repository-aligned card type once", () => {
  assert.equal(typeof Card, "function");
  assert.equal(
    window.customCards.filter((card) => card.type === "ha_energy-flow-card")
      .length,
    1
  );
});

test("uses Home Assistant relative period names and exact date fallbacks", () => {
  const labels = {
    today: "Localized today",
    yesterday: "Localized yesterday",
    this_week: "Localized this week",
    last_week: "Localized last week",
    this_month: "Localized this month",
    last_month: "Localized last month",
    this_year: "Localized this year",
    last_year: "Localized last year",
  };
  const hass = {
    locale: { language: "en" },
    config: { time_zone: "Europe/Zurich" },
    localize(key) {
      return labels[key.split(".").at(-1)] || "";
    },
  };
  const now = new Date("2026-07-29T12:00:00Z");

  assert.equal(
    getEnergyPeriodLabel(
      hass,
      new Date("2026-07-28T22:00:00Z"),
      new Date("2026-07-29T22:00:00Z"),
      now
    ),
    "Localized today"
  );
  assert.equal(
    getEnergyPeriodLabel(
      hass,
      new Date("2026-07-27T22:00:00Z"),
      new Date("2026-07-28T22:00:00Z"),
      now
    ),
    "Localized yesterday"
  );
  assert.equal(
    getEnergyPeriodLabel(
      hass,
      new Date("2026-07-19T22:00:00Z"),
      new Date("2026-07-26T22:00:00Z"),
      now
    ),
    "Localized last week"
  );
  assert.equal(
    getEnergyPeriodLabel(
      hass,
      new Date("2026-06-30T22:00:00Z"),
      new Date("2026-07-31T22:00:00Z"),
      now
    ),
    "Localized this month"
  );
  assert.equal(
    getEnergyPeriodLabel(
      hass,
      new Date("2026-07-04T22:00:00Z"),
      new Date("2026-07-05T22:00:00Z"),
      now
    ),
    "07/05/2026"
  );
  assert.equal(
    getEnergyPeriodLabel(
      hass,
      new Date("2026-07-04T22:00:00Z"),
      new Date("2026-07-07T22:00:00Z"),
      now
    ),
    "07/05/2026 – 07/07/2026"
  );
});

test("provides a visual editor schema and stub configuration", () => {
  assert.deepEqual(
    Card.getConfigForm().schema.map((entry) => entry.name),
    ["configuration", "interactions"]
  );
  const configuration = Card.getConfigForm().schema[0];
  assert.equal(configuration.type, "expandable");
  assert.equal(configuration.flatten, true);
  assert.deepEqual(
    configuration.schema.map((entry) => entry.name),
    ["title", "default_mode", "show_card"]
  );
  const interactions = Card.getConfigForm().schema[1];
  assert.equal(interactions.type, "expandable");
  assert.equal(interactions.flatten, true);
  assert.deepEqual(
    interactions.schema.map((entry) => entry.name),
    ["tap_action", "hold_action", "double_tap_action"]
  );
  assert.deepEqual(Card.getStubConfig(), {
    default_mode: "power",
    title: "",
    show_card: true,
    tap_action: { action: "none" },
    hold_action: { action: "none" },
    double_tap_action: { action: "none" },
  });
  assert.throws(
    () => Card.getConfigForm().assertConfig({ collection_key: "invalid" }),
    /must start with energy_/
  );
});

test("shows the collection key only for the Energy editor mode", () => {
  assert.deepEqual(
    buildConfigSchema("power")[0].schema.map((entry) => entry.name),
    ["title", "default_mode", "show_card"]
  );
  assert.deepEqual(
    buildConfigSchema("energy")[0].schema.map((entry) => entry.name),
    ["title", "default_mode", "collection_key", "show_card"]
  );
  assert.equal(
    Card.getConfigElement().constructor,
    registry.get("ha_energy-flow-card-editor")
  );
  assert.match(
    Card.getConfigForm().computeHelper({ name: "collection_key" }),
    /Optional.*today's values/
  );
});

test("updates the existing editor form without closing expandable sections", () => {
  const Editor = registry.get("ha_energy-flow-card-editor");
  const editor = new Editor();
  const form = {};
  let renderCount = 0;
  editor._form = form;
  editor._render = () => {
    renderCount += 1;
  };

  editor.setConfig({ default_mode: "power" });
  assert.equal(renderCount, 0);
  assert.equal(form.schema[0].title, "Configuration");
  assert.deepEqual(
    form.schema[0].schema.map((entry) => entry.name),
    ["title", "default_mode", "show_card"]
  );

  editor.setConfig({ default_mode: "energy" });
  assert.equal(renderCount, 0);
  assert.deepEqual(
    form.schema[0].schema.map((entry) => entry.name),
    ["title", "default_mode", "collection_key", "show_card"]
  );
});

test("fires Browser Mod compatible DOM events for tap actions", () => {
  const card = new Card();
  const events = [];
  card.dispatchEvent = (event) => {
    events.push(event);
    return true;
  };
  card.setConfig({
    default_mode: "power",
    tap_action: {
      action: "fire-dom-event",
      browser_mod: {
        service: "browser_mod.popup",
        data: { popup_card_id: "power" },
      },
    },
  });

  card._performAction("tap");

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "ll-custom");
  assert.equal(events[0].bubbles, true);
  assert.equal(events[0].composed, true);
  assert.deepEqual(events[0].detail, {
    action: "fire-dom-event",
    browser_mod: {
      service: "browser_mod.popup",
      data: { popup_card_id: "power" },
    },
  });
});

test("delegates standard tap actions to Home Assistant", () => {
  const card = new Card();
  const events = [];
  card.dispatchEvent = (event) => {
    events.push(event);
    return true;
  };
  card.setConfig({
    tap_action: {
      action: "navigate",
      navigation_path: "/energy",
    },
  });

  card._performAction("tap");

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "hass-action");
  assert.equal(events[0].detail.action, "tap");
  assert.deepEqual(events[0].detail.config.tap_action, {
    action: "navigate",
    navigation_path: "/energy",
  });
});

test("dispatches hold and double-tap actions with Home Assistant interaction names", () => {
  const card = new Card();
  const events = [];
  card.dispatchEvent = (event) => {
    events.push(event);
    return true;
  };
  card.setConfig({
    hold_action: { action: "navigate", navigation_path: "/hold" },
    double_tap_action: {
      action: "navigate",
      navigation_path: "/double",
    },
  });

  card._performAction("hold");
  card._performAction("double_tap");

  assert.deepEqual(
    events.map((event) => event.detail.action),
    ["hold", "double_tap"]
  );
});

test("delays taps only when a double-tap action is configured", async () => {
  const card = new Card();
  const interactions = [];
  card._performAction = (interaction) => interactions.push(interaction);
  card.setConfig({ tap_action: { action: "navigate" } });
  card._handleClick();
  assert.deepEqual(interactions, ["tap"]);

  interactions.length = 0;
  card.setConfig({
    tap_action: { action: "navigate" },
    double_tap_action: { action: "navigate" },
  });
  card._handleClick();
  assert.deepEqual(interactions, []);
  card._handleClick();
  assert.deepEqual(interactions, ["double_tap"]);
});

test("uses today's Energy dashboard data when no collection key is configured", () => {
  const prefs = {
    energy_sources: [
      { type: "solar", stat_energy_from: "solar" },
      {
        type: "grid",
        stat_energy_from: "grid_in",
        stat_energy_to: "grid_out",
      },
      {
        type: "battery",
        stat_energy_from: "battery_out",
        stat_energy_to: "battery_in",
      },
      { type: "gas", stat_energy_from: "gas" },
    ],
  };
  assert.deepEqual(getEnergyStatisticIds(prefs).sort(), [
    "battery_in",
    "battery_out",
    "grid_in",
    "grid_out",
    "solar",
  ]);

  const range = getTodayRange(
    { config: { time_zone: "Europe/Zurich" } },
    new Date("2026-07-29T12:00:00Z")
  );
  assert.equal(range.start.toISOString(), "2026-07-28T22:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-07-29T22:00:00.000Z");
});

test("normalizes supported power units to watts", () => {
  assert.equal(normalizePower(750, "W"), 750);
  assert.equal(normalizePower(1.5, "kW"), 1500);
  assert.equal(normalizePower(0.002, "MW"), 2000);
});

test("routes simultaneous solar, grid, and battery power like Home Assistant", () => {
  assert.deepEqual(
    computeConsumption({
      solar: 3000,
      fromGrid: 500,
      fromBattery: 1000,
      toGrid: 800,
      toBattery: 700,
    }),
    {
      solar: 1500,
      battery: 1000,
      grid: 500,
      total: 3000,
    }
  );
});

test("reads current power only from Energy dashboard rate entities", () => {
  const preferences = {
    energy_sources: [
      { type: "solar", stat_rate: "sensor.solar_power" },
      { type: "grid", stat_rate: "sensor.grid_power" },
      { type: "battery", stat_rate: "sensor.battery_power" },
    ],
  };
  const hass = {
    states: {
      "sensor.solar_power": {
        state: "2",
        attributes: { unit_of_measurement: "kW" },
      },
      "sensor.grid_power": {
        state: "500",
        attributes: { unit_of_measurement: "W" },
      },
      "sensor.battery_power": {
        state: "-250",
        attributes: { unit_of_measurement: "W" },
      },
    },
  };
  const tracked = new Set();

  assert.deepEqual(getPowerComposition(hass, preferences, tracked), {
    solar: 1750,
    battery: 0,
    grid: 500,
    total: 2250,
  });
  assert.deepEqual([...tracked].sort(), [
    "sensor.battery_power",
    "sensor.grid_power",
    "sensor.solar_power",
  ]);
});

test("calculates Energy shares per statistics interval before summing", () => {
  const data = {
    prefs: {
      energy_sources: [
        { type: "solar", stat_energy_from: "solar" },
        {
          type: "grid",
          stat_energy_from: "grid_in",
          stat_energy_to: "grid_out",
        },
        {
          type: "battery",
          stat_energy_from: "battery_out",
          stat_energy_to: "battery_in",
        },
      ],
    },
    stats: {
      solar: [
        { start: 1, change: 4 },
        { start: 2, change: 0 },
      ],
      grid_in: [
        { start: 1, change: 0 },
        { start: 2, change: 2 },
      ],
      grid_out: [{ start: 1, change: 1 }],
      battery_in: [{ start: 1, change: 1 }],
      battery_out: [{ start: 2, change: 1 }],
    },
  };

  assert.deepEqual(getEnergyComposition(data), {
    solar: 2,
    battery: 1,
    grid: 2,
    total: 5,
  });
});

test("shows a localized period label and animates only the Power view", () => {
  const card = new Card();
  card._data = {
    prefs: {
      energy_sources: [
        { type: "solar", stat_rate: "sensor.solar_power" },
      ],
    },
    stats: {},
  };
  card.setConfig({ collection_key: "energy_1", default_mode: "power" });
  card.hass = {
    locale: { language: "en" },
    localize(key) {
      if (key.endsWith("energy_period_selector.now")) return "Localized now";
      if (key.endsWith("periods.today")) return "Localized today";
      return "";
    },
    states: {
      "sensor.solar_power": {
        state: "1000",
        attributes: { unit_of_measurement: "W" },
      },
    },
  };
  assert.match(card.shadowRoot.innerHTML, /class="bar animated"/);
  assert.match(
    card.shadowRoot.innerHTML,
    /class="period-label">Localized now<\/div>/
  );
  assert.doesNotMatch(card.shadowRoot.innerHTML, /class="mode-switch"/);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /data-mode=/);
  assert.match(
    card.shadowRoot.innerHTML,
    /ha-card,[\s\S]*?\.card \{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/
  );
  assert.match(
    card.shadowRoot.innerHTML,
    /\.bar \{[\s\S]*?height: auto;[\s\S]*?min-height: 22px;[\s\S]*?flex: 1 1 30px;/
  );

  card.setConfig({ collection_key: "energy_1", default_mode: "energy" });
  assert.doesNotMatch(card.shadowRoot.innerHTML, /class="bar animated"/);
  assert.match(
    card.shadowRoot.innerHTML,
    /class="period-label">Localized today<\/div>/
  );
});
