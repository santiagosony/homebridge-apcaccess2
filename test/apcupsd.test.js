const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { parseStatus, queryStatus } = require('../lib/apcupsd');
const { startFakeApcupsd } = require('./fakeApcupsd');

test('parseStatus splits keys and values', () => {
  assert.deepEqual(
    {
      ...parseStatus(
        'UPSNAME  : myups\nSTATFLAG : 0x05000008\nDATE     : 2026-10-11 10:00:00 +0000  \n',
      ),
    },
    {
      UPSNAME: 'myups',
      STATFLAG: '0x05000008',
      DATE: '2026-10-11 10:00:00 +0000',
    },
  );
});

test('parseStatus stores unusual keys as plain values', () => {
  const status = parseStatus(
    '__proto__ : a\nconstructor : b\nhasOwnProperty : c\nSTATFLAG : 0x05000008\n',
  );

  assert.equal(Object.getPrototypeOf(status), null);
  assert.equal(status['__proto__'], 'a');
  assert.equal(status.constructor, 'b');
  assert.equal(status.hasOwnProperty, 'c');
  assert.equal(status.STATFLAG, '0x05000008');
  assert.equal({}.polluted, undefined);
});

test('queryStatus reads a chunked NIS response', async (t) => {
  const server = await startFakeApcupsd(['MODEL    : Back-UPS XS 700U', 'BCHARGE  : 87.0 Percent']);
  t.after(() => server.close());

  const status = await queryStatus({ host: '127.0.0.1', port: server.address().port });
  assert.equal(status.MODEL, 'Back-UPS XS 700U');
  assert.equal(status.BCHARGE, '87.0 Percent');
});

test('queryStatus rejects when nothing is listening', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));

  await assert.rejects(queryStatus({ host: '127.0.0.1', port }));
});

test('queryStatus times out on a silent server', async (t) => {
  const server = net.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  await assert.rejects(
    queryStatus({ host: '127.0.0.1', port: server.address().port, timeout: 100 }),
    /Timed out/,
  );
});

test('queryStatus can be cancelled', async (t) => {
  const server = net.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const controller = new AbortController();
  const request = queryStatus({
    host: '127.0.0.1',
    port: server.address().port,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);

  await assert.rejects(request, /cancelled/);
});

test('queryStatus rejects a response that never ends', async (t) => {
  // Keeps sending valid records without the end marker
  const server = net.createServer((socket) => {
    socket.once('data', () => {
      const record = Buffer.alloc(1002, 'x');
      record.writeUInt16BE(1000, 0);
      const send = () => {
        if (!socket.destroyed && socket.write(record)) setImmediate(send);
      };
      socket.on('drain', send);
      socket.on('error', () => {});
      send();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  await assert.rejects(
    queryStatus({ host: '127.0.0.1', port: server.address().port }),
    /too large/,
  );
});
