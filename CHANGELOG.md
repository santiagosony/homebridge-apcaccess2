# [1.0.1]

- Declare the `supports-hap` keyword, so the Homebridge UI shows the plugin as HomeKit (HAP) compatible.
- CI also tests Node.js 26.
- Node.js 20 (end-of-life since April 2026) is no longer listed as supported; Node.js 22, 24 and 26 are.
- README: npm and CI badges, and a Troubleshooting section.

# [1.0.0]

First stable release. It includes everything from the 1.0.0 betas below, plus:

- Fix: a `powerSensorType` value like `constructor` or `toString` crashed the plugin at startup; any value other than `contact`, `leak` or `smoke` now falls back to the contact sensor.
- Hardening: the apcupsd response is parsed into an object without a prototype, so key names coming from the network (e.g. `__proto__`, `constructor`) are stored as plain values.
- Hardening: responses from apcupsd are limited to 64 KB (a real one is 1-2 KB), so a broken or hostile server can't make the plugin use unbounded memory.
- CodeQL code scanning on every push, pull request and weekly, for the JavaScript code and the GitHub Actions workflows.

# [1.0.0-beta.3]

- Published from GitHub Actions with npm Trusted Publishing, so the package on npm carries a provenance attestation linking it to this repository. No changes to the plugin itself.

# [1.0.0-beta.2]

First release of **homebridge-apcaccess2**, the successor of [homebridge-apcaccess](https://github.com/cr3ative/homebridge-apcaccess) 1.0.3 by Paul Curry. Forked and vibecoded (written with an AI coding assistant) from that project; it's a drop-in replacement: same `APCAccess` accessory type and options.

(1.0.0-beta.1 was withdrawn from npm right after publishing; npm doesn't allow reusing a version number.)

Changes since homebridge-apcaccess 1.0.3:

## Compatibility

- Homebridge 2.x support (tested with v2.4.0), while keeping Homebridge 1.8 or later working.
  - Use `Service.Battery`: HAP-NodeJS 1.x/2.x removed `Service.BatteryService`, which caused `TypeError: Service.BatteryService is not a constructor`.
  - Replace the deprecated `on('get', callback)` handlers with `onGet`.
- Replace the unmaintained `apcaccess` dependency with a small built-in apcupsd client: a new connection per poll with a 5 s timeout, so the plugin recovers on its own when apcupsd restarts or the network drops. The plugin has no runtime dependencies.

## New

- `config.schema.json`, so the plugin can be configured from the Homebridge UI.
- `powerSensorType` (`contact`, `leak` or `smoke`): publish the power sensor as a leak or smoke sensor, so power cuts arrive as HomeKit critical alerts.
- `contactSensor` (default `true`): turn off the power sensor if you only want the battery status.
- `loadSensor`: the UPS load (`LOADPCT`) as a light sensor (lux = %).
- `voltageSensor`: the input line voltage (`LINEV`) as a light sensor (lux = volts).
- `lowBatteryLevel` (%) and `lowBatteryMinutes` (runtime left while on battery): report low battery before the UPS does.
- `logVoltage` and `voltageLogThreshold` (default 5 %): optionally log the line voltage, only when it changed at least that much since the last logged value.
- The accessory shows as "No Response" in HomeKit, instead of its last known values, when apcupsd can't be reached (at startup, or for 3 polls in a row) or apcupsd lost contact with the UPS (`COMMLOST`).

## Changed

- Sensors are named after what they show: `<name> Power`, `<name> Charge`, `<name> Temperature`, `<name> Load` and `<name> Voltage` (e.g. "UPS Charge").
- The model, serial number, firmware and apcupsd version reported by the UPS now actually show up in HomeKit and the Homebridge UI. The accessory name always comes from the `name` option; the UPS name is only logged.
- The manufacturer defaults to `APC` and is no longer asked for in the settings (`manufacturer` in `config.json` is still honoured).
- "Replace battery" from the UPS is reported as low battery, with a warning in the log (it was shown as "Not chargeable").
- Load and temperature readings are only logged in debug mode (`-D`); the line voltage only with `logVoltage`.
- Temperature keeps its decimals and is pushed to HomeKit on every poll.
- Polls never overlap, start once all sensors exist, and the interval is at least 1 second.

## Fixed

- With `errorLogsOnly` on, a low battery or an unreachable apcupsd threw `update.error is not a function`, which could stop Homebridge. Unexpected polling errors are now always caught and logged.
- When apcupsd lost contact with the UPS (`COMMLOST`, e.g. USB cable unplugged) the plugin reported a power cut, a false critical alert with the leak or smoke sensor types. "On battery" is now read from apcupsd's on-battery flag.
- Shutting down while a request to apcupsd was in flight kept the plugin polling after shutdown, and Homebridge had to force-exit after 5 s. The request is now cancelled on shutdown.
- With several UPS configured, one UPS could hide another's log lines.

## Internal

- ESLint 9 (flat config), Prettier 3 and `node:test` unit tests, including tests against Homebridge 2's HAP-NodeJS; `prettier-eslint` and `eslint-config-airbnb-base` dropped.
- GitHub Actions CI on Node 22 and 24.

---

The versions below are from the original [homebridge-apcaccess](https://github.com/cr3ative/homebridge-apcaccess) by Paul Curry.

# [1.0.3]

- Remove instances of WARN, log as INFO or ERROR only to clean up suppression.
- Update packages.

# [1.0.2]

- BATTV isn't guaranteed to be present; fix parseData to not rely on key presence.

# [1.0.1]

- Pretty new display name (via [davidjbradshaw](https://github.com/davidjbradshaw))

# [1.0.0]

- Significant improvements / rewrite, sufficient to declare this v1.0.0, by [davidjbradshaw](https://github.com/davidjbradshaw). Thank you!
- Push realtime data to HomeBridge, rather than just waiting for it to be pulled
- Improved logging
  - Power disconnect/reconnect is now a warning
  - Battery level now shows time remaining and voltage
  - warn/error now also have code to stop the same message being shown twice
- Code refactor
  - Created parse functions, to allow code reuse
  - Upgraded to latest version of esLint/prettier
  - log.update -> log.update.info
  - Defined consts for bitwise values
  - Defined consts for default values
  - Defined consts for magic numbers
- Updated README to show default values

# [0.2.2]

- Add optional temperature sensor. Optional temperature sensor added by [ThisIsQasim](https://github.com/ThisIsQasim). Thank you!
- Logging reduced by default, and new option to omit all logging except errors. Logging improvements by [davidjbradshaw](https://github.com/davidjbradshaw). Thank you!

# [0.1.2]

- Report zero battery level if no bad value passed through to avoid crash.

# [0.1.0]

- Publish battery service in Home friendly way

# [0.0.8]

- Fix client promise handling

# [0.0.7]

- ESLint and Prettier

# [0.0.5/0.0.6]

- Cache the JSON result
- Refactor state
- Secure NPM profile and add keywords

# [0.0.4]

- Tweak name config

# [0.0.3]

- Learned how to push changes to homekit using updateValue. So now it alerts properly!
- We're due a refactor now. But it works!

# [0.0.2]

- Added Battery statistics (on Sensor; in future we may want to reveal as BatteryService)

# [0.0.1]

- Contact State reported on enquiry
