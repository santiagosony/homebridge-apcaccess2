# homebridge-apcaccess2

> **Beta.** This is the successor of [cr3ative/homebridge-apcaccess](https://github.com/cr3ative/homebridge-apcaccess), which is no longer maintained. It started as a fork of that project and was vibecoded (written with an AI coding assistant) into what it is today. It's tested, but please report anything odd in the [issues](https://github.com/santiagosony/homebridge-apcaccess2/issues).

A [Homebridge](https://github.com/homebridge/homebridge) plugin that exposes an APC UPS managed by [apcupsd](http://www.apcupsd.org/) to HomeKit: power cut alerts, battery charge and, optionally, temperature, load and line voltage.

Works with Homebridge 1.8 or later, including 2.x (tested with v2.4.0). Several UPS are supported: add one accessory per apcupsd instance.

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

## Requirements

- Homebridge 1.8 or later (including 2.x)
- Node.js 20, 22, 24 or 26 (Homebridge 2.x itself requires Node.js 22 or later)
- apcupsd with its Network Information Server enabled: `NETSERVER on` in `/etc/apcupsd/apcupsd.conf` (port 3551 by default)

The plugin has no runtime dependencies: it talks to apcupsd's network protocol directly, opening a new connection on every poll, so it recovers on its own when apcupsd restarts.

## Installation

The plugin is installed from GitHub. From the Homebridge UI terminal, or a shell in the Homebridge storage directory (usually `/var/lib/homebridge`):

```sh
npm install santiagosony/homebridge-apcaccess2
```

Then restart Homebridge and configure the plugin from its settings in the Homebridge UI. To update, run the same command again and restart Homebridge.

### Moving from homebridge-apcaccess

This plugin is a drop-in replacement for the original `homebridge-apcaccess`: it uses the same `"accessory": "APCAccess"` type and the same options, so your existing configuration keeps working and HomeKit keeps the same accessory (rooms and automations included).

1. Uninstall the old plugin: `npm uninstall homebridge-apcaccess`. Both can't be installed at the same time, since both register `APCAccess`.
2. Install this one with the command above.
3. Restart Homebridge.

The sensors get new names (`<name> Power`, `<name> Charge`…); see the [CHANGELOG](CHANGELOG.md) for everything that changed.

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
| `powerSensorType`     | `contact`   | `contact`, `leak` or `smoke` (see above).                                                                                  |
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

## Logging

By default the log shows the connection, the UPS details at startup, and changes in power, battery level, low battery, charging state and "replace battery".

- **Line voltage** is only logged with `logVoltage`, and only when it moved at least `voltageLogThreshold` %.
- **Load and temperature** readings change often and are already visible in HomeKit, so they are only logged in Homebridge debug mode (`-D`).
- **`errorLogsOnly`** hides everything except errors and warnings, including the line voltage.

## Development

```sh
npm install
npm test   # eslint + prettier check + unit tests, including tests against Homebridge 2's HAP-NodeJS
```

CI runs the same on Node 22 and 24 for every push and pull request.

## Credits

This project is based on [homebridge-apcaccess](https://github.com/cr3ative/homebridge-apcaccess) by [Paul Curry (cr3ative)](https://github.com/cr3ative), with contributions from [davidjbradshaw](https://github.com/davidjbradshaw) and [ThisIsQasim](https://github.com/ThisIsQasim). Thanks Paul for the original plugin, and for suggesting this successor project when he stopped maintaining it.

It was forked and then vibecoded, written with an AI coding assistant and reviewed and tested by its maintainer, into what it is today: Homebridge 2.x support, a built-in apcupsd client, new sensors and many fixes. See the [CHANGELOG](CHANGELOG.md).

Maintained by [santiagosony](https://github.com/santiagosony). Released under the [MIT License](LICENSE).
