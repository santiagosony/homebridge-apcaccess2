const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const net = require('node:net');
const { startFakeApcupsd } = require('./fakeApcupsd');

const STATUS = [
  'UPSNAME  : rack-ups',
  'MODEL    : Back-UPS XS 700U',
  'SERIALNO : 3B1234X56789',
  'VERSION  : 3.14.14 (31 May 2016) debian',
  'FIRMWARE : 924.Z3 .I USB FW:Z3',
  'STATFLAG : 0x05000048',
  'BCHARGE  : 42.0 Percent',
  'TIMELEFT : 12.5 Minutes',
  'BATTV    : 13.2 Volts',
  'ITEMP    : 29.2 C',
  'LOADPCT  : 23.0 Percent',
  'LINEV    : 222.0 Volts',
];

const silentLog = () => {
  const log = () => {};
  ['info', 'warn', 'error', 'debug', 'success'].forEach((level) => {
    log[level] = () => {};
  });
  return log;
};

// Running on battery: UPS_ONBATT (0x10) set, UPS_ONLINE (0x08) cleared
const ON_BATTERY = STATUS.map((line) =>
  line.startsWith('STATFLAG') ? 'STATFLAG : 0x05000050' : line,
);

const createAccessory = async (t, { status = STATUS, log = silentLog(), ...config }) => {
  const { HAPLibraryVersion, ...hap } = await import('@homebridge/hap-nodejs');
  const server = await startFakeApcupsd(status);

  const api = new EventEmitter();
  api.hap = hap;
  let Accessory;
  api.registerAccessory = (plugin, name, constructor) => {
    assert.equal(plugin, 'homebridge-apcaccess2');
    assert.equal(name, 'APCAccess');
    Accessory = constructor;
  };
  require('..')(api);
  t.diagnostic(`HAP-NodeJS ${HAPLibraryVersion()}`);

  const accessory = new Accessory(
    log,
    { name: 'UPS', host: '127.0.0.1', port: server.address().port, interval: 60, ...config },
    api,
  );
  t.after(() => {
    api.emit('shutdown');
    server.close();
  });

  return { accessory, hap, api };
};

const waitForFirstPoll = async (accessory) => {
  for (let i = 0; i < 50 && !accessory.loaded; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(accessory.loaded);
};

test('works against the HAP-NodeJS shipped with Homebridge 2', async (t) => {
  const { accessory, hap } = await createAccessory(t, {
    temperatureSensor: true,
    loadSensor: true,
  });
  const { Characteristic, Service } = hap;

  const services = accessory.getServices();
  assert.equal(services.length, 5);
  assert.ok(services.some((service) => service instanceof Service.Battery));

  // Mimic Homebridge: it copies the plugin's AccessoryInformation into the accessory's own service
  const bridgedInfo = new Service.AccessoryInformation();
  bridgedInfo.replaceCharacteristicsFromService(accessory.informationService);

  await waitForFirstPoll(accessory);

  const value = (service, characteristic) => service.getCharacteristic(characteristic).value;

  assert.equal(value(accessory.batteryService, Characteristic.BatteryLevel), 42);
  assert.equal(
    value(accessory.batteryService, Characteristic.StatusLowBattery),
    Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW,
  );
  assert.equal(
    value(accessory.batteryService, Characteristic.ChargingState),
    Characteristic.ChargingState.CHARGING,
  );
  assert.equal(
    value(accessory.powerService, Characteristic.ContactSensorState),
    Characteristic.ContactSensorState.CONTACT_DETECTED,
  );
  assert.ok(
    Math.abs(value(accessory.temperatureService, Characteristic.CurrentTemperature) - 29.2) < 0.01,
  );
  assert.ok(accessory.loadService instanceof Service.LightSensor);
  assert.equal(value(accessory.loadService, Characteristic.CurrentAmbientLightLevel), 23);
  assert.equal(value(accessory.loadService, Characteristic.ConfiguredName), 'UPS Load');
  assert.equal(value(accessory.batteryService, Characteristic.Name), 'UPS Charge');
  assert.equal(value(accessory.powerService, Characteristic.ConfiguredName), 'UPS Power');
  assert.equal(
    value(accessory.temperatureService, Characteristic.ConfiguredName),
    'UPS Temperature',
  );
  assert.equal(value(accessory.batteryService, Characteristic.ConfiguredName), 'UPS Charge');
  assert.equal(value(accessory.informationService, Characteristic.SerialNumber), '3B1234X56789');

  // Values reported by the UPS reach the service HomeKit actually reads
  const read = (characteristic) => bridgedInfo.getCharacteristic(characteristic).handleGetRequest();
  assert.equal(await read(Characteristic.SerialNumber), '3B1234X56789');
  assert.equal(await read(Characteristic.Model), 'Back-UPS XS 700U');
  assert.equal(await read(Characteristic.FirmwareRevision), '924.Z3 .I USB FW:Z3');
  assert.equal(await read(Characteristic.SoftwareRevision), '3.14.14 (31 May 2016) debian');
  assert.equal(await read(Characteristic.Name), 'UPS');
  assert.equal(await read(Characteristic.Manufacturer), 'APC');

  // onGet handlers answer HomeKit reads
  assert.equal(
    await accessory.batteryService
      .getCharacteristic(Characteristic.BatteryLevel)
      .handleGetRequest(),
    42,
  );
});

test('the contact sensor can be turned off', async (t) => {
  const { accessory, hap } = await createAccessory(t, { contactSensor: false });
  const { Characteristic, Service } = hap;
  await waitForFirstPoll(accessory);

  const services = accessory.getServices();
  assert.equal(services.length, 2);
  assert.ok(!services.some((service) => service instanceof Service.ContactSensor));
  assert.equal(accessory.batteryService.getCharacteristic(Characteristic.BatteryLevel).value, 42);
});

for (const [type, service, characteristic, value] of [
  ['leak', 'LeakSensor', 'LeakDetected', 'LEAK_DETECTED'],
  ['smoke', 'SmokeSensor', 'SmokeDetected', 'SMOKE_DETECTED'],
]) {
  test(`the power sensor can be a ${type} sensor`, async (t) => {
    const { accessory, hap } = await createAccessory(t, {
      powerSensorType: type,
      status: ON_BATTERY,
    });
    const { Characteristic, Service } = hap;
    await waitForFirstPoll(accessory);

    assert.ok(accessory.powerService instanceof Service[service]);
    assert.ok(!accessory.getServices().some((s) => s instanceof Service.ContactSensor));
    assert.equal(
      accessory.powerService.getCharacteristic(Characteristic[characteristic]).value,
      Characteristic[characteristic][value],
    );
  });
}

test('shows "No Response" while apcupsd is unreachable', async (t) => {
  // Nothing listens on port 1
  const { accessory, hap } = await createAccessory(t, { port: 1 });
  const { Characteristic, HapStatusError } = hap;

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(accessory.connected, false);

  const handler = accessory.batteryService.getCharacteristic(
    Characteristic.BatteryLevel,
  ).getHandler;
  assert.throws(handler, HapStatusError);
});

test('only gives up on apcupsd after several failed polls in a row', async (t) => {
  const { accessory } = await createAccessory(t, {});
  await waitForFirstPoll(accessory);
  assert.equal(accessory.connected, true);

  accessory.config.port = 1;
  await accessory.getLatestJSON();
  await accessory.getLatestJSON();
  assert.equal(accessory.connected, true);

  await accessory.getLatestJSON();
  assert.equal(accessory.connected, false);
  assert.equal(accessory.state.batteryLevel, undefined);
});

// Charge 42 %, 12.5 minutes left, UPS low battery flag not set
const NOT_LOW = STATUS.map((line) =>
  line.startsWith('STATFLAG') ? 'STATFLAG : 0x05000008' : line,
);
const NOT_LOW_ON_BATTERY = STATUS.map((line) =>
  line.startsWith('STATFLAG') ? 'STATFLAG : 0x05000010' : line,
);

for (const [description, status, config, expected] of [
  ['no thresholds', NOT_LOW, {}, 'BATTERY_LEVEL_NORMAL'],
  ['charge below lowBatteryLevel', NOT_LOW, { lowBatteryLevel: 50 }, 'BATTERY_LEVEL_LOW'],
  ['charge above lowBatteryLevel', NOT_LOW, { lowBatteryLevel: 30 }, 'BATTERY_LEVEL_NORMAL'],
  [
    'runtime below lowBatteryMinutes on battery',
    NOT_LOW_ON_BATTERY,
    { lowBatteryMinutes: 15 },
    'BATTERY_LEVEL_LOW',
  ],
  [
    'runtime below lowBatteryMinutes on mains',
    NOT_LOW,
    { lowBatteryMinutes: 15 },
    'BATTERY_LEVEL_NORMAL',
  ],
  ['UPS low battery flag', STATUS, {}, 'BATTERY_LEVEL_LOW'],
]) {
  test(`low battery: ${description}`, async (t) => {
    const { accessory, hap } = await createAccessory(t, { status, ...config });
    const { Characteristic } = hap;
    await waitForFirstPoll(accessory);

    assert.equal(
      accessory.batteryService.getCharacteristic(Characteristic.StatusLowBattery).value,
      Characteristic.StatusLowBattery[expected],
    );
  });
}

test('the line voltage sensor reports LINEV', async (t) => {
  const { accessory, hap } = await createAccessory(t, { voltageSensor: true });
  const { Characteristic, Service } = hap;
  await waitForFirstPoll(accessory);

  assert.ok(accessory.voltageService instanceof Service.LightSensor);
  assert.ok(accessory.getServices().includes(accessory.voltageService));
  const value = (characteristic) =>
    accessory.voltageService.getCharacteristic(characteristic).value;
  assert.equal(value(Characteristic.CurrentAmbientLightLevel), 222);
  assert.equal(value(Characteristic.ConfiguredName), 'UPS Voltage');
});

test('the line voltage sensor handles a power cut (0 V)', async (t) => {
  const status = STATUS.map((line) => (line.startsWith('LINEV') ? 'LINEV    : 0.0 Volts' : line));
  const { accessory, hap } = await createAccessory(t, { voltageSensor: true, status });
  await waitForFirstPoll(accessory);

  const { Characteristic } = hap;
  assert.equal(
    accessory.voltageService.getCharacteristic(Characteristic.CurrentAmbientLightLevel).value,
    0.0001,
  );
});

test('COMMLOST is "No Response", not a power cut', async (t) => {
  // apcupsd answers, but has lost the UPS: online/on battery bits cleared, commlost set
  const status = STATUS.map((line) =>
    line.startsWith('STATFLAG') ? 'STATFLAG : 0x05000100' : line,
  );
  const { accessory, hap } = await createAccessory(t, { status, powerSensorType: 'leak' });
  const { Characteristic, HapStatusError } = hap;

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(accessory.connected, false);
  assert.equal(accessory.loaded, false);

  const leak = accessory.powerService.getCharacteristic(Characteristic.LeakDetected);
  assert.throws(leak.getHandler, HapStatusError);
  assert.notEqual(leak.value, Characteristic.LeakDetected.LEAK_DETECTED);
});

test('"replace battery" is reported as low battery, not as "not chargeable"', async (t) => {
  // Online, battery full, UPS_replacebatt set
  const status = STATUS.map((line) => {
    if (line.startsWith('STATFLAG')) return 'STATFLAG : 0x05000088';
    if (line.startsWith('BCHARGE')) return 'BCHARGE  : 100.0 Percent';
    return line;
  });
  const { accessory, hap } = await createAccessory(t, { status });
  const { Characteristic } = hap;
  await waitForFirstPoll(accessory);

  const value = (characteristic) =>
    accessory.batteryService.getCharacteristic(characteristic).value;
  assert.equal(
    value(Characteristic.StatusLowBattery),
    Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW,
  );
  assert.equal(value(Characteristic.ChargingState), Characteristic.ChargingState.NOT_CHARGING);
});

test('shutdown cancels an in-flight poll and stops polling', async (t) => {
  // apcupsd that accepts the connection but never answers
  const sockets = new Set();
  const silent = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.resume(); // read, so the client closing the connection is noticed
  });
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  t.after(() => silent.close());

  const { accessory, api } = await createAccessory(t, { port: silent.address().port });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(sockets.size, 1);

  api.emit('shutdown');
  await new Promise((resolve) => setTimeout(resolve, 100));

  // The request was cancelled right away instead of waiting for its 5 s timeout
  assert.equal(sockets.size, 0);
  assert.equal(accessory.pollTimer, undefined);
  assert.equal(accessory.failedPolls, 0);
});

const voltageLogLines = async (t, config, voltages) => {
  const lines = [];
  const log = silentLog();
  log.info = (...args) => {
    if (args[0] === 'Line voltage:') lines.push(args[1]);
  };

  const { accessory } = await createAccessory(t, { log, ...config });
  await waitForFirstPoll(accessory);

  voltages.forEach((voltage) => {
    accessory.latestJSON = { ...accessory.latestJSON, LINEV: `${voltage} Volts` };
    accessory.checkVoltage();
  });
  return lines;
};

test('line voltage is not logged by default', async (t) => {
  assert.deepEqual(await voltageLogLines(t, { voltageSensor: true }, [220, 200, 0]), []);
});

test('line voltage is logged only past the threshold (5 % by default)', async (t) => {
  // First poll logs 222 V; 220 (-0.9 %) and 215 (-3.2 %) are skipped; 210 (-5.4 %) and 0 are logged
  const lines = await voltageLogLines(
    t,
    { logVoltage: true },
    [220, 222, 215, 210, 211, 0, 0, 222],
  );
  assert.deepEqual(lines, ['222 V', '210 V', '0 V', '222 V']);
});

test('a voltage log threshold of 0 logs every change', async (t) => {
  const lines = await voltageLogLines(
    t,
    { logVoltage: true, voltageLogThreshold: 0 },
    [220, 220, 222],
  );
  assert.deepEqual(lines, ['222 V', '220 V', '222 V']);
});

test('load and temperature readings only go to the debug log', async (t) => {
  const lines = [];
  const log = silentLog();
  ['info', 'warn', 'error', 'debug'].forEach((level) => {
    log[level] = (...args) => lines.push([level, args[0]]);
  });

  const { accessory } = await createAccessory(t, {
    log,
    loadSensor: true,
    temperatureSensor: true,
  });
  await waitForFirstPoll(accessory);
  accessory.latestJSON = { ...accessory.latestJSON, LOADPCT: '24.0 Percent', ITEMP: '30.0 C' };
  accessory.doPolledChecks();

  const levels = (message) => [...new Set(lines.filter(([, m]) => m === message).map(([l]) => l))];
  assert.deepEqual(levels('Load:'), ['debug']);
  assert.deepEqual(levels('Temperature:'), ['debug']);
});

test('an unknown power sensor type falls back to a contact sensor', async (t) => {
  for (const powerSensorType of ['nonsense', 'constructor', 'toString', '__proto__']) {
    const { accessory, hap } = await createAccessory(t, { powerSensorType });
    assert.ok(accessory.powerService instanceof hap.Service.ContactSensor, powerSensorType);
  }
});
