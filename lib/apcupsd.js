const net = require('node:net');

const DEFAULT_TIMEOUT = 5000;

// Parse the plain-text output of the apcupsd NIS "status" command
// ("KEY      : value" per line) into an object.
const parseStatus = (text) => {
  // No prototype: keys come from the network, so names like "__proto__" or "constructor"
  // are stored as plain values and can't clash with built-in object properties
  const result = Object.create(null);

  text.split('\n').forEach((line) => {
    const index = line.indexOf(':');
    if (index === -1) return;

    const key = line.slice(0, index).trim();
    if (key) result[key] = line.slice(index + 1).trim();
  });

  return result;
};

// Minimal client for the apcupsd Network Information Server (NIS) protocol.
// Every request opens a fresh connection, exactly like the `apcaccess` CLI does,
// so a restarted apcupsd daemon or a dropped network link recovers on its own.
// `signal` (an AbortSignal) cancels the request, e.g. when Homebridge shuts down.
const queryStatus = ({ host = 'localhost', port = 3551, timeout = DEFAULT_TIMEOUT, signal } = {}) =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) });
    let buffer = Buffer.alloc(0);
    let output = '';
    let settled = false;

    const onAbort = () => finish(new Error('Request to apcupsd cancelled'));

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort);

    socket.setTimeout(timeout, () =>
      finish(new Error(`Timed out talking to apcupsd at ${host}:${port}`)),
    );

    socket.on('connect', () => {
      const command = Buffer.from('status', 'ascii');
      const header = Buffer.alloc(2);
      header.writeUInt16BE(command.length, 0);
      socket.write(Buffer.concat([header, command]));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Each record is prefixed with a 2 byte big-endian length; a zero length ends the response
      while (buffer.length >= 2) {
        const length = buffer.readUInt16BE(0);

        if (length === 0) {
          finish(null, parseStatus(output));
          return;
        }

        if (buffer.length < length + 2) return;

        output += buffer.toString('ascii', 2, length + 2);
        buffer = buffer.subarray(length + 2);
      }
    });

    socket.on('error', finish);
    socket.on('close', () =>
      finish(new Error(`Connection to apcupsd at ${host}:${port} closed unexpectedly`)),
    );
  });

module.exports = {
  parseStatus,
  queryStatus,
};
