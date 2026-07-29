# HA Energy Flow Card

A compact Home Assistant card that shows how much of the home's consumption
comes from solar, battery, and grid sources.

The card reads both modes directly from the Energy dashboard configuration:

- **Power** uses the current `stat_rate` entities configured for solar, grid,
  and battery sources. Its bar is animated to indicate live data.
- **Energy** uses the recorder statistics for the active Energy dashboard
  period. Its bar is static.

No source entity has to be configured in the card.

## Features

- In-card Power/Energy switch
- Live Power composition with animation
- Period-based Energy composition without animation
- Uses Home Assistant's Energy dashboard source configuration
- Uses the active Energy collection period
- Uses Home Assistant's language, number format, units, colors, and themes
- Handles grid export and battery charging before assigning home-consumption
  shares
- Includes a built-in visual card editor
- Honors the operating system's reduced-motion preference

## Requirements

- A configured Home Assistant Energy dashboard
- Solar, grid, or battery Energy sources
- Recorder statistics for Energy mode
- Power sensors configured in the Energy dashboard for Power mode

Home Assistant only exposes a live source when a power sensor is configured for
that Energy source. Missing Power sources are treated as zero.

## HACS installation

[![Open your Home Assistant instance and open this repository in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=psym88&repository=ha_energy-flow-card&category=plugin)

1. Open HACS and select **Custom repositories** from the three-dot menu.
2. Add `https://github.com/psym88/ha_energy-flow-card` with the **Dashboard**
   category.
3. Install **HA Energy Flow Card**.
4. Reload Home Assistant and clear the browser cache if necessary.

HACS normally registers this resource automatically:

```text
/hacsfiles/ha_energy-flow-card/ha_energy-flow-card.js?hacstag=…
```

## Configuration

```yaml
type: custom:ha_energy-flow-card
collection_key: energy_1
default_mode: power
show_card: true
```

Use the same `collection_key` for this card, the Energy period selector, and
other Energy cards that should share a period.

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `collection_key` | No | `energy_1` | Shared Energy collection key; it must start with `energy_` |
| `default_mode` | No | `power` | Initial mode: `power` or `energy` |
| `title` | No | Empty | Optional card title |
| `show_card` | No | `true` | Whether to render the Home Assistant card background |

All options are available in the visual editor. The Power/Energy switch remains
available directly on the rendered card.

## How values are calculated

Power mode reads the current rate entities from the Energy dashboard and
normalizes their units to watts. Energy mode reads the dashboard's normalized
kWh statistics for its selected period.

For both modes, the card follows Home Assistant's source-routing order:

1. Grid surplus can charge the battery.
2. Solar can charge the battery.
3. Solar can be exported to the grid.
4. Battery power can be exported to the grid.
5. Remaining solar, battery, and grid values are assigned to home consumption.

Energy routing is calculated separately for every recorder interval and only
then summed. This avoids incorrect source shares when flows change direction
within the selected period.

## Manual installation

Copy `ha_energy-flow-card.js` to `/config/www/ha_energy-flow-card.js`, then
register `/local/ha_energy-flow-card.js` as a JavaScript module.

## Development

```bash
npm run check
npm test
```

Edit `ha_energy-flow-card.js` directly. The card is intentionally kept as a
single dependency-free file and requires no build step.

## Language policy

Repository code, comments, user-facing strings, documentation, examples,
release notes, and commit messages must be written in English. See
[AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
