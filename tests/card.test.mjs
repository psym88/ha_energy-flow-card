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

const {
  computeConsumption,
  getEnergyComposition,
  getPowerComposition,
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

test("provides a visual editor schema and stub configuration", () => {
  assert.deepEqual(
    Card.getConfigForm().schema.map((entry) => entry.name),
    ["collection_key", "default_mode", "title", "show_card"]
  );
  assert.deepEqual(Card.getStubConfig(), {
    collection_key: "energy_1",
    default_mode: "power",
    title: "",
    show_card: true,
  });
  assert.throws(
    () => Card.getConfigForm().assertConfig({ collection_key: "invalid" }),
    /must start with energy_/
  );
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

test("animates only the Power view", () => {
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
    states: {
      "sensor.solar_power": {
        state: "1000",
        attributes: { unit_of_measurement: "W" },
      },
    },
  };
  assert.match(card.shadowRoot.innerHTML, /class="bar animated"/);

  card._setMode("energy");
  assert.doesNotMatch(card.shadowRoot.innerHTML, /class="bar animated"/);
});
