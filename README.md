# homebridge-apcaccess2

[![npm](https://img.shields.io/npm/v/homebridge-apcaccess2)](https://www.npmjs.com/package/homebridge-apcaccess2)
[![CI](https://github.com/santiagosony/homebridge-apcaccess2/actions/workflows/ci.yml/badge.svg)](https://github.com/santiagosony/homebridge-apcaccess2/actions/workflows/ci.yml)
[![CodeQL](https://github.com/santiagosony/homebridge-apcaccess2/actions/workflows/codeql.yml/badge.svg)](https://github.com/santiagosony/homebridge-apcaccess2/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/npm/l/homebridge-apcaccess2)](LICENSE)

A [Homebridge](https://github.com/homebridge/homebridge) plugin that brings an APC UPS managed by [apcupsd](http://www.apcupsd.org/) into Apple HomeKit: power cut alerts, battery charge and, optionally, temperature, load and line voltage.

It is the successor of [cr3ative/homebridge-apcaccess](https://github.com/cr3ative/homebridge-apcaccess), which is no longer maintained, and a drop-in replacement for it.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [What shows up in HomeKit](#what-shows-up-in-homekit)
- [Logging](#logging)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Security](#security)
- [Credits](#credits)
- [License](#license)

## Features

- **Power cut alerts** as a contact sensor, or as a leak or smoke sensor to get HomeKit critical alerts that break through Do Not Disturb.
- **Battery** charge, charging state and low battery, with optional earlier warnings by charge % or minutes of runtime left.
- **Optional sensors** for the UPS load, the input line voltage and the internal temperature.
- **Model, serial number and firmware** read from the UPS.
- **"No Response" instead of stale values** when apcupsd or the UPS can't be reached, recovering on its own.
- **Settings page** in the Homebridge UI.
- **No runtime dependencies:** it talks to apcupsd's network protocol directly.
- **Several UPS at once:** add one accessory per apcupsd instance.

## Requirements

- Homebridge 1.8 or later, including 2.x (tested with v2.5.0)
- Node.js 22, 24 or 26
- apcupsd with its Network Information Server enabled: `NETSERVER on` in `/etc/apcupsd/apcupsd.conf` (port 3551 by default)

## Installation

In the Homebridge UI, go to **Plugins**, search for **homebridge-apcaccess2** and install it. Or, from a shell in the Homebridge storage directory (usually `/var/lib/homebridge`):

```sh
npm install homebridge-apcaccess2
```

Then restart Homebridge and configure the plugin from its settings in the Homebridge UI. Updates show up in the Homebridge UI like for any other plugin.

### Moving from homebridge-apcaccess

This plugin uses the same `"accessory": "APCAccess"` type and the same options as the original, so your existing configuration keeps working and HomeKit keeps the same accessory, rooms and automations included.

1. Uninstall the old plugin: `npm uninstall homebridge-apcaccess`. Both can't be installed at the same time, since both register `APCAccess`.
2. Install this one (see above).
3. Restart Homebridge.

The sensors get new names (`<name> Power`, `<name> Charge`…); see the [changelog](CHANGELOG.md) for everything that changed.

## Configuration

Configure it from the Homebridge UI, or add an accessory to `config.json`. Every option except `accessory` and `name` is optional; these are the defaults:

```json
{
  "accessories": [
    {
      "accessory": "APCAccess",
      "name": "APC UPS",
      "host": "localhost",
      "port": 3551,
      "contactSensor": true,
      "powerSensorType": "contact",
      "temperatureSensor": false,
      "loadSensor": false,
      "voltageSensor": false,
      "lowBatteryLevel": 0,
      "lowBatteryMinutes": 0,
      "interval": 1,
      "errorLogsOnly": false,
      "logVoltage": false,
      "voltageLogThreshold": 5
    }
  ]
}
```

| Option                | Default     | Description                                                                                                                |
| --------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `name`                | `APC UPS`   | Accessory name, also used as prefix for the sensor names.                                                                  |
| `host`                | `localhost` | Host running apcupsd.                                                                                                      |
| `port`                | `3551`      | apcupsd's Network Information Server port.                                                                                 |
| `contactSensor`       | `true`      | Expose the power sensor (**UPS Power**). Turn off if you only want the battery status.                                     |
| `powerSensorType`     | `contact`   | `contact`, `leak` or `smoke` (see [What shows up in HomeKit](#what-shows-up-in-homekit)).                                  |
| `temperatureSensor`   | `false`     | Expose **UPS Temperature**.                                                                                                |
| `loadSensor`          | `false`     | Expose **UPS Load**.                                                                                                       |
| `voltageSensor`       | `false`     | Expose **UPS Voltage**.                                                                                                    |
| `lowBatteryLevel`     | `0` (off)   | Also report low battery when the charge is at or below this %.                                                             |
| `lowBatteryMinutes`   | `0` (off)   | While on battery, also report low battery when the estimated runtime left is at or below this many minutes.                |
| `interval`            | `1`         | Polling interval in seconds (minimum 1).                                                                                   |
| `errorLogsOnly`       | `false`     | Only log errors and warnings.                                                                                              |
| `logVoltage`          | `false`     | Log the line voltage when it changes, with or without the voltage sensor.                                                  |
| `voltageLogThreshold` | `5`         | Only log the voltage when it moved at least this % since the last logged value. `0` logs every change.                     |
| `model`               | —           | Only used if the UPS doesn't report its model.                                                                             |
| `serial`              | —           | Only used if the UPS doesn't report its serial number.                                                                     |
| `firmwareRevision`    | —           | Only used if the UPS doesn't report its firmware.                                                                          |
| `softwareRevision`    | —           | Only used if apcupsd doesn't report its version. Not shown in the Homebridge UI.                                           |
| `manufacturer`        | `APC`       | Manufacturer shown in HomeKit. Not shown in the Homebridge UI; still honoured if set in `config.json` by an older version. |

## What shows up in HomeKit

Each sensor is named after the accessory `name` (`UPS` in these examples):

| Sensor              | HomeKit type                            | Shows                                                    | Option                             |
| ------------------- | --------------------------------------- | -------------------------------------------------------- | ---------------------------------- |
| **UPS Power**       | Contact sensor (or leak / smoke sensor) | Open / leak / smoke while running on battery             | `contactSensor`, `powerSensorType` |
| **UPS Charge**      | Battery                                 | Charge %, charging state, low battery                    | always on                          |
| **UPS Temperature** | Temperature sensor                      | UPS internal temperature (`ITEMP`)                       | `temperatureSensor`                |
| **UPS Load**        | Light sensor                            | Load, % of rated power in use (`LOADPCT`), 23 lux = 23 % | `loadSensor`                       |
| **UPS Voltage**     | Light sensor                            | Input line voltage (`LINEV`), 222 lux = 222 V            | `voltageSensor`                    |

- **Power cut alerts:** the power sensor is a contact sensor by default. Set `powerSensorType` to `leak` or `smoke` to get HomeKit **critical alerts**, which get through Do Not Disturb and Focus as long as Critical Alerts are allowed for the Home app in the iPhone's notification settings. The Home app will word the power cut as a leak or smoke alarm.
- **Low battery** is reported when the UPS flags it, when the UPS asks for a new battery, or below the optional `lowBatteryLevel` / `lowBatteryMinutes` thresholds.
- **Load and voltage** are light sensors because HomeKit has no load or voltage sensor types, and a light sensor accepts any positive number. Being light sensors, they don't mix with the room's humidity or temperature readings.
- **Temperature** is only reported by Smart-UPS models. Back-UPS and most consumer models don't have it.
- **No Response:** the accessory shows as "No Response" instead of stale values when apcupsd can't be reached at startup, or for 3 polls in a row afterwards. The same happens when apcupsd loses contact with the UPS (`COMMLOST`, e.g. USB cable unplugged). It recovers on its own.
- **Accessory information:** the model, serial number and firmware are read from the UPS, and the software revision is the apcupsd version. The manufacturer is always `APC`.

## Logging

By default the log shows the connection, the UPS details at startup, and changes in power, battery level, low battery, charging state and "replace battery".

- **Line voltage** is only logged with `logVoltage`, and only when it moved at least `voltageLogThreshold` %.
- **Load and temperature** readings change often and are already visible in HomeKit, so they are only logged in Homebridge debug mode (`-D`).
- **`errorLogsOnly`** hides everything except errors and warnings, including the line voltage.

## Troubleshooting

**The accessory shows "No Response"**, or the log says `Polling UPS service failed`: the plugin can't get the UPS status from apcupsd.

1. On the machine running apcupsd, run `apcaccess status`. If that fails, apcupsd itself isn't running or can't see the UPS.
2. In `/etc/apcupsd/apcupsd.conf`, check that `NETSERVER on` is set. If Homebridge runs on **another machine**, also check `NISIP`: `127.0.0.1` only accepts connections from the same machine, while `0.0.0.0` accepts them from the network. Restart apcupsd after changing it.
3. Check that `host` and `port` match, and that no firewall blocks the port (3551 by default).
4. `apcupsd lost communication with the UPS (COMMLOST)` in the log means apcupsd is running but can't talk to the UPS: check its USB or serial cable.

For more detail, start Homebridge in debug mode (`-D`). Still stuck? [Open an issue](https://github.com/santiagosony/homebridge-apcaccess2/issues/new/choose).

## Contributing

Bug reports, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up the project, run the tests and propose a change, and the [changelog](CHANGELOG.md) for the release history.

## Security

Please don't report security problems in public issues. Use GitHub's [private vulnerability reporting](https://github.com/santiagosony/homebridge-apcaccess2/security/advisories/new) instead.

Every release is published to npm from GitHub Actions with [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers), so the package carries a provenance attestation that links it to this repository and the exact commit it was built from.

## Credits

This project is based on [homebridge-apcaccess](https://github.com/cr3ative/homebridge-apcaccess) by [Paul Curry (cr3ative)](https://github.com/cr3ative), with contributions from [davidjbradshaw](https://github.com/davidjbradshaw) and [ThisIsQasim](https://github.com/ThisIsQasim). Thanks Paul for the original plugin, and for suggesting this successor project when he stopped maintaining it.

It was forked and then vibecoded, written with an AI coding assistant and reviewed and tested by its maintainer, into what it is today: Homebridge 2.x support, a built-in apcupsd client, new sensors and many fixes.

Maintained by [santiagosony](https://github.com/santiagosony).

## License

[MIT](LICENSE). Copyright © 2020 Paul Curry and © 2026 santiagosony.
