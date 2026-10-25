const { queryStatus } = require('./lib/apcupsd');
const { logOnlyError, logMin } = require('./lib/logUpdate');

const PLUGIN_NAME = 'homebridge-apcaccess2';
const ACCESSORY_NAME = 'APCAccess';

const DEFAULT_INTERVAL = 1;
const DEFAULT_NAME = 'APC UPS';
const DEFAULT_MANUFACTURER = 'APC';
const DEFAULT_MODEL = 'APCAccess UPS';
const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 3551;

const FULLY_CHARGED = 100;
// Consecutive failed polls before HomeKit shows the UPS as "No Response"
const MAX_FAILED_POLLS = 3;
const SECOND = 1000;
const MIN_LIGHT_LEVEL = 0.0001;
// Default minimum change, in %, before the line voltage is logged again
const DEFAULT_VOLTAGE_LOG_THRESHOLD = 5;
const UNKNOWN = 'unknown';

// AccessoryInformation characteristic -> apcupsd key / config option / default
const DEVICE_INFO = {
  Model: { key: 'MODEL', config: 'model', fallback: DEFAULT_MODEL },
  SerialNumber: { key: 'SERIALNO', config: 'serial', fallback: UNKNOWN },
  FirmwareRevision: { key: 'FIRMWARE', config: 'firmwareRevision', fallback: UNKNOWN },
  SoftwareRevision: { key: 'VERSION', config: 'softwareRevision', fallback: UNKNOWN },
};

// Sensor types that can report mains power; each is "triggered" while running on battery.
// Leak and smoke alerts are critical notifications in HomeKit (they break through Do Not Disturb).
const POWER_SENSORS = {
  contact: {
    service: 'ContactSensor',
    characteristic: 'ContactSensorState',
    onBattery: 'CONTACT_NOT_DETECTED',
    onMains: 'CONTACT_DETECTED',
  },
  leak: {
    service: 'LeakSensor',
    characteristic: 'LeakDetected',
    onBattery: 'LEAK_DETECTED',
    onMains: 'LEAK_NOT_DETECTED',
  },
  smoke: {
    service: 'SmokeSensor',
    characteristic: 'SmokeDetected',
    onBattery: 'SMOKE_DETECTED',
    onMains: 'SMOKE_NOT_DETECTED',
  },
};

// STATFLAG bits, as defined in apcupsd's include/defines.h
const UPS_ONBATT = 0x10;
const UPS_BATT_LOW = 0x40;
const UPS_REPLACE_BATT = 0x80;
const UPS_COMMLOST = 0x100;

let Service;
let Characteristic;
let HapStatusError;
let HAPStatus;

class APCAccess {
  constructor(log, config, api) {
    this.config = config || {};
    this.log = this.config.errorLogsOnly ? logOnlyError(log) : logMin(log);
    this.latestJSON = {};
    this.loaded = false;
    this.connected = false;
    this.failedPolls = 0;
    this.pollTimer = undefined;
    // Cancels the in-flight apcupsd request and stops polling when Homebridge shuts down
    this.shutdown = new AbortController();

    this.state = Object.seal({
      onBattery: undefined,
      batteryLevel: undefined,
      lowBattery: undefined,
      chargingState: undefined,
    });

    const name = this.config.name || DEFAULT_NAME;

    this.informationService = new Service.AccessoryInformation();
    this.informationService
      // apcupsd doesn't report a manufacturer; `manufacturer` is still honoured for older configs
      .setCharacteristic(
        Characteristic.Manufacturer,
        this.config.manufacturer || DEFAULT_MANUFACTURER,
      )
      .setCharacteristic(Characteristic.Name, name);

    // Homebridge copies the required AccessoryInformation characteristics into its own
    // service once, at startup, so later updateCharacteristic() calls never reach HomeKit.
    // It does copy onGet handlers though, so serve the UPS-reported values through them.
    Object.entries(DEVICE_INFO).forEach(([characteristic, { key, config, fallback }]) => {
      const getValue = () => this.getDeviceInfo(key, this.config[config] || fallback);
      this.informationService
        .getCharacteristic(Characteristic[characteristic])
        .updateValue(getValue())
        .onGet(getValue);
    });

    // Enabled unless explicitly turned off, to keep the behaviour of older versions
    if (this.config.contactSensor !== false) {
      this.powerSensor = POWER_SENSORS[this.config.powerSensorType] || POWER_SENSORS.contact;
      this.powerService = this.withConfiguredName(
        new Service[this.powerSensor.service](`${name} Power`),
      );
      this.powerService
        .getCharacteristic(Characteristic[this.powerSensor.characteristic])
        .onGet(this.whenConnected(() => this.getPowerSensorValue()));
    }

    // HAP-NodeJS >= 1.0 (Homebridge 2.x) renamed BatteryService to Battery
    const BatteryService = Service.Battery || Service.BatteryService;
    this.batteryService = this.withConfiguredName(new BatteryService(`${name} Charge`, 'charge'));
    this.batteryService
      .getCharacteristic(Characteristic.BatteryLevel)
      .onGet(this.whenConnected(() => this.parseBatteryLevel()));
    this.batteryService
      .getCharacteristic(Characteristic.ChargingState)
      .onGet(this.whenConnected(() => Characteristic.ChargingState[this.parseChargingState()]));
    this.batteryService
      .getCharacteristic(Characteristic.StatusLowBattery)
      .onGet(
        this.whenConnected(() => Characteristic.StatusLowBattery[this.parseLowBatteryValue()]),
      );

    if (this.config.temperatureSensor) {
      this.temperatureService = this.withConfiguredName(
        new Service.TemperatureSensor(`${name} Temperature`),
      );
      this.temperatureService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .onGet(this.whenConnected(() => this.getTemperature()));
    }

    if (this.config.loadSensor) {
      // HomeKit has no "load" sensor; a light sensor accepts any positive reading (shown as lux).
      // Same type as the voltage sensor, and it doesn't mix with the room's humidity sensors.
      this.loadService = this.withConfiguredName(new Service.LightSensor(`${name} Load`, 'load'));
      this.loadService
        .getCharacteristic(Characteristic.CurrentAmbientLightLevel)
        .onGet(this.whenConnected(() => this.getLoad()));
    }

    if (this.config.voltageSensor) {
      // HomeKit has no voltage sensor; a light sensor accepts any positive reading (shown as lux)
      this.voltageService = this.withConfiguredName(
        new Service.LightSensor(`${name} Voltage`, 'voltage'),
      );
      this.voltageService
        .getCharacteristic(Characteristic.CurrentAmbientLightLevel)
        .onGet(this.whenConnected(() => this.getVoltage()));
    }

    // Only start polling once all services exist
    this.poll();

    if (api) {
      api.on('shutdown', () => this.stop());
    }
  }

  stop() {
    this.shutdown.abort();
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }

  // Wraps an onGet handler so HomeKit shows "No Response" while apcupsd can't be reached,
  // instead of the last known (and possibly wrong) values
  whenConnected = (getValue) => () => {
    if (!this.connected) {
      throw HapStatusError
        ? new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
        : new Error('apcupsd is not reachable');
    }
    return getValue();
  };

  // iOS shows ConfiguredName, not Name, for the extra services of an accessory
  withConfiguredName = (service) => {
    if (Characteristic.ConfiguredName) {
      service.setCharacteristic(Characteristic.ConfiguredName, service.displayName);
    }
    return service;
  };

  getServices() {
    // Required by Homebridge; expose services this accessory claims to have
    const services = [this.informationService, this.powerService, this.batteryService].filter(
      Boolean,
    );

    if (this.temperatureService) {
      services.push(this.temperatureService);
    }

    if (this.loadService) {
      services.push(this.loadService);
    }

    if (this.voltageService) {
      services.push(this.voltageService);
    }

    return services;
  }

  async poll() {
    try {
      await this.getLatestJSON();
    } catch (err) {
      // Never let an unexpected error become an unhandled rejection, which stops Homebridge
      this.log.error('Unexpected error while polling the UPS:', err);
    } finally {
      // Schedule the next poll only after this one finished, so requests never pile up
      if (!this.shutdown.signal.aborted) {
        this.pollTimer = setTimeout(
          this.poll.bind(this),
          Math.max(Number(this.config.interval) || DEFAULT_INTERVAL, 1) * SECOND,
        );
      }
    }
  }

  async getLatestJSON() {
    try {
      const status = await queryStatus({
        host: this.config.host || DEFAULT_HOST,
        port: Number(this.config.port) || DEFAULT_PORT,
        signal: this.shutdown.signal,
      });

      // apcupsd still answers when it can't talk to the UPS (e.g. USB cable unplugged), but the
      // flags are then stale or cleared, which would look like a power cut
      if (Number(status.STATFLAG) & UPS_COMMLOST) {
        throw new Error('apcupsd lost communication with the UPS (COMMLOST)');
      }

      this.latestJSON = status;

      this.failedPolls = 0;
      if (!this.connected) {
        this.connected = true;
        this.log.info('Connected!');
      }

      if (!this.loaded) this.firstRun();
      this.doPolledChecks();
    } catch (err) {
      if (this.shutdown.signal.aborted) return;
      this.failedPolls += 1;

      if (this.connected && this.failedPolls >= MAX_FAILED_POLLS) {
        this.connected = false;
        this.log.error('Lost connection to the UPS, it will show as not responding:', err.message);
        // Forget what HomeKit was told, so everything is pushed again once reconnected
        Object.keys(this.state).forEach((key) => {
          this.state[key] = undefined;
        });
      } else {
        this.log.update.error('Polling UPS service failed:', err.message);
      }
    }
  }

  firstRun() {
    this.loaded = true;
    this.setDeviceInfo();
  }

  setDeviceInfo() {
    this.log.info('UPS name:', this.parseData('UPSNAME'));

    Object.entries(DEVICE_INFO).forEach(([characteristic, { key, config, fallback }]) => {
      const info = this.getDeviceInfo(key, this.config[config] || fallback);
      this.log.info(`${characteristic}:`, info);
      this.informationService.updateCharacteristic(Characteristic[characteristic], info);
    });
  }

  // Prefer what the UPS reports, then the user's config, then a default
  getDeviceInfo = (key, fallback) => {
    const value = this.parseData(key);
    return value === UNKNOWN ? fallback : value;
  };

  getTemperature() {
    // ITEMP, e.g. "29.2 C"
    const temperature = parseFloat(this.latestJSON.ITEMP);

    if (Number.isNaN(temperature)) {
      if (this.loaded) this.log.update.error('Unable to determine Temperature');
      return 0;
    }

    // Already visible in HomeKit; only logged in debug mode to keep the log quiet
    this.log.debug('Temperature:', temperature);
    return temperature;
  }

  parseData = (key) => this.latestJSON[key]?.trim() || UNKNOWN;

  parseNumber = (key) => {
    const value = parseInt(this.latestJSON[key], 10);
    return Number.isNaN(value) ? 0 : value;
  };

  parseStatFlag = () => {
    const value = Number(this.latestJSON.STATFLAG);
    return Number.isNaN(value) ? 0 : value;
  };

  parseBatteryLevel = () => Math.min(Math.max(this.parseNumber('BCHARGE'), 0), 100);

  parseTimeLeft = () => this.parseNumber('TIMELEFT');

  isOnBattery = () => Boolean(this.parseStatFlag() & UPS_ONBATT);

  parseLowBatteryValue = () => (this.isLowBattery() ? 'BATTERY_LEVEL_LOW' : 'BATTERY_LEVEL_NORMAL');

  // The UPS asks for a new battery; there's no HomeKit field for it, so it's reported as low battery
  needsNewBattery = () => Boolean(this.parseStatFlag() & UPS_REPLACE_BATT);

  // Low when the UPS says so, or when below the optional thresholds from the config
  isLowBattery = () => {
    if (this.parseStatFlag() & UPS_BATT_LOW) return true;
    if (this.needsNewBattery()) return true;
    if (!this.loaded) return false;

    const level = Number(this.config.lowBatteryLevel);
    if (level > 0 && this.parseBatteryLevel() <= level) return true;

    // On mains TIMELEFT is the runtime a full battery would give, so only check it on battery
    const minutes = Number(this.config.lowBatteryMinutes);
    const timeLeft = parseFloat(this.latestJSON.TIMELEFT);
    return minutes > 0 && this.isOnBattery() && timeLeft <= minutes;
  };

  parseChargingState = () =>
    this.isOnBattery() || this.parseBatteryLevel() === FULLY_CHARGED ? 'NOT_CHARGING' : 'CHARGING';

  // Value of the mains power sensor: "triggered" (open / leak / smoke) while on battery
  getPowerSensorValue() {
    const { characteristic, onBattery, onMains } = this.powerSensor;
    return Characteristic[characteristic][this.isOnBattery() ? onBattery : onMains];
  }

  checkContact() {
    const onBattery = this.isOnBattery();

    this.log.update.info('Power:', onBattery ? 'Disconnected' : 'Connected');

    if (this.powerService && this.state.onBattery !== onBattery) {
      this.log.debug('Pushing power state change; ', onBattery, this.state.onBattery);
      this.powerService.updateCharacteristic(
        Characteristic[this.powerSensor.characteristic],
        this.getPowerSensorValue(),
      );
      this.state.onBattery = onBattery;
    }
  }

  checkLowBattery() {
    const lowBattery = Characteristic.StatusLowBattery[this.parseLowBatteryValue()];

    this.log.update[lowBattery ? 'error' : 'info']('Battery state:', lowBattery ? 'Low' : 'Normal');
    this.log.update[this.needsNewBattery() ? 'warn' : 'info'](
      'Replace battery:',
      this.needsNewBattery() ? 'Yes, the UPS reports its battery needs replacing' : 'No',
    );

    if (this.state.lowBattery !== lowBattery) {
      this.log.debug('Pushing low battery state change; ', lowBattery, this.state.lowBattery);
      this.batteryService.updateCharacteristic(Characteristic.StatusLowBattery, lowBattery);
      this.state.lowBattery = lowBattery;
    }
  }

  checkCharging() {
    const value = this.parseChargingState();
    const chargingState = Characteristic.ChargingState[value];

    this.log.update.info('Charging state:', value);

    if (this.state.chargingState !== chargingState) {
      this.log.debug('Pushing charging state change; ', chargingState, this.state.chargingState);
      this.batteryService.updateCharacteristic(Characteristic.ChargingState, chargingState);
      this.state.chargingState = chargingState;
    }
  }

  checkBatteryLevel() {
    const batteryLevel = this.parseBatteryLevel();

    if (this.state.batteryLevel !== batteryLevel) {
      this.log.update.info(
        'Battery Level:',
        `${batteryLevel}% ${this.parseData(
          'BATTV',
        )} (${this.parseTimeLeft()} estimated minutes remaining)`,
      );
      this.log.debug('Pushing battery level change; ', batteryLevel, this.state.batteryLevel);

      this.batteryService.updateCharacteristic(Characteristic.BatteryLevel, batteryLevel);
      this.state.batteryLevel = batteryLevel;
    }
  }

  getLoad() {
    // LOADPCT, e.g. "23.0 Percent"
    const load = parseFloat(this.latestJSON.LOADPCT);

    if (Number.isNaN(load)) {
      if (this.loaded) this.log.update.error('Unable to determine Load');
      return MIN_LIGHT_LEVEL;
    }

    // Changes constantly with what's plugged in; only logged in debug mode to keep the log quiet
    this.log.debug('Load:', `${load}%`);
    // CurrentAmbientLightLevel can't go below 0.0001
    return Math.max(load, MIN_LIGHT_LEVEL);
  }

  checkLoad() {
    if (!this.loadService) return;

    this.loadService.updateCharacteristic(Characteristic.CurrentAmbientLightLevel, this.getLoad());
  }

  getVoltage() {
    // LINEV, e.g. "222.0 Volts"; 0 during a power cut
    const voltage = parseFloat(this.latestJSON.LINEV);

    if (Number.isNaN(voltage)) {
      if (this.loaded) this.log.update.error('Unable to determine Line voltage');
      return MIN_LIGHT_LEVEL;
    }

    // CurrentAmbientLightLevel can't go below 0.0001
    return Math.max(voltage, MIN_LIGHT_LEVEL);
  }

  checkVoltage() {
    this.logVoltage();
    if (!this.voltageService) return;

    this.voltageService.updateCharacteristic(
      Characteristic.CurrentAmbientLightLevel,
      this.getVoltage(),
    );
  }

  // Optional (`logVoltage`), and only when the voltage moved at least `voltageLogThreshold` %
  // since the last logged value, so small fluctuations (e.g. 220 <-> 222 V) don't flood the log
  logVoltage() {
    if (!this.config.logVoltage) return;

    const voltage = parseFloat(this.latestJSON.LINEV);
    if (Number.isNaN(voltage)) return;

    const configured = this.config.voltageLogThreshold;
    const threshold =
      configured === undefined || configured === '' || Number.isNaN(Number(configured))
        ? DEFAULT_VOLTAGE_LOG_THRESHOLD
        : Math.max(Number(configured), 0);

    const last = this.lastLoggedVoltage;
    const changed =
      last === undefined ||
      (last === 0
        ? voltage !== 0
        : voltage !== last && (Math.abs(voltage - last) / last) * 100 >= threshold);
    if (!changed) return;

    this.log.info('Line voltage:', `${voltage} V`);
    this.lastLoggedVoltage = voltage;
  }

  checkTemperature() {
    if (!this.temperatureService) return;

    this.temperatureService.updateCharacteristic(
      Characteristic.CurrentTemperature,
      this.getTemperature(),
    );
  }

  doPolledChecks() {
    this.checkContact();
    this.checkLowBattery();
    this.checkCharging();
    this.checkBatteryLevel();
    this.checkTemperature();
    this.checkLoad();
    this.checkVoltage();
  }
}

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  ({ HapStatusError, HAPStatus } = api.hap);
  api.registerAccessory(PLUGIN_NAME, ACCESSORY_NAME, APCAccess);
};
