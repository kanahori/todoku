'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { proxySwitches } = require('../src/main/proxy');

test('https_proxy が無ければ何も渡さない', () => {
  assert.deepEqual(proxySwitches({}), []);
  assert.deepEqual(proxySwitches({ https_proxy: '  ' }), []);
  // no_proxy だけでは渡さない。
  assert.deepEqual(proxySwitches({ no_proxy: 'localhost' }), []);
});

test('https_proxy（無ければ HTTPS_PROXY）を proxy-server に渡す', () => {
  assert.deepEqual(proxySwitches({ https_proxy: 'http://proxy.example.jp:8080' }), [['proxy-server', 'http://proxy.example.jp:8080']]);
  assert.deepEqual(proxySwitches({ HTTPS_PROXY: 'http://proxy.example.jp:3128' }), [['proxy-server', 'http://proxy.example.jp:3128']]);
  // 小文字の方を先に見る。
  assert.deepEqual(proxySwitches({ https_proxy: 'http://a.example:1', HTTPS_PROXY: 'http://b.example:2' }), [['proxy-server', 'http://a.example:1']]);
});

test('no_proxy は、セミコロン区切りにして proxy-bypass-list に渡す', () => {
  assert.deepEqual(
    proxySwitches({ https_proxy: 'http://proxy.example.jp:8080', no_proxy: 'localhost, 127.0.0.1,.example.ac.jp' }),
    [['proxy-server', 'http://proxy.example.jp:8080'], ['proxy-bypass-list', 'localhost;127.0.0.1;.example.ac.jp']],
  );
  assert.deepEqual(
    proxySwitches({ HTTPS_PROXY: 'http://proxy.example.jp:8080', NO_PROXY: 'localhost' }),
    [['proxy-server', 'http://proxy.example.jp:8080'], ['proxy-bypass-list', 'localhost']],
  );
});

const { parseProxyList, canConnect, chooseSystemProxy } = require('../src/main/proxy');

test('resolveProxy の答えから、入口の一覧と DIRECT を取り出す', () => {
  assert.deepEqual(parseProxyList('DIRECT'), { proxies: [], direct: true });
  assert.deepEqual(parseProxyList('PROXY proxy.example.jp:8080'), { proxies: [{ host: 'proxy.example.jp', port: 8080 }], direct: false });
  assert.deepEqual(parseProxyList('PROXY a.example:3128; HTTPS b.example:443; DIRECT'),
    { proxies: [{ host: 'a.example', port: 3128 }, { host: 'b.example', port: 443 }], direct: true });
  assert.deepEqual(parseProxyList('SOCKS5 [::1]:1080'), { proxies: [{ host: '::1', port: 1080 }], direct: false });
  assert.deepEqual(parseProxyList(''), { proxies: [], direct: false });
});

test('システムのプロキシ: 入口に届けばそのまま、届かなければ直に繋いで一行残す、もともと直なら何もしない', async () => {
  const run = async (answer, reachable) => {
    const calls = { direct: 0, tried: [], logs: [] };
    const result = await chooseSystemProxy({
      resolveProxy: async () => answer,
      setDirect: async () => { calls.direct += 1; },
      connect: async (host, port) => { calls.tried.push(`${host}:${port}`); return reachable.includes(host); },
      log: (line) => calls.logs.push(line),
    });
    return { result, ...calls };
  };
  const campus = await run('PROXY proxy.example.jp:8080', ['proxy.example.jp']);
  assert.deepEqual(campus, { result: 'proxy', direct: 0, tried: ['proxy.example.jp:8080'], logs: [] });
  const outside = await run('PROXY proxy.example.jp:8080', []);
  assert.equal(outside.result, 'direct');
  assert.equal(outside.direct, 1);
  assert.deepEqual(outside.logs, ['システムのプロキシの入口（proxy.example.jp:8080）に届かないので、直に繋ぎます。']);
  const second = await run('PROXY a.example:1; PROXY b.example:2', ['b.example']);
  assert.deepEqual([second.result, second.direct, second.tried], ['proxy', 0, ['a.example:1', 'b.example:2']]);
  const none = await run('DIRECT', []);
  assert.deepEqual([none.result, none.direct, none.tried], ['none', 0, []]);
  const failed = await chooseSystemProxy({ resolveProxy: async () => { throw new Error('x'); }, setDirect: async () => { throw new Error('呼ばない'); } });
  assert.equal(failed, 'unknown');
});

test('繋がるかの試し: 開いている口には繋がり、閉じた口と時間切れは届かない', async () => {
  const net = require('node:net');
  const server = net.createServer((s) => s.end());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    assert.equal(await canConnect('127.0.0.1', port, 1000), true);
  } finally {
    await new Promise((r) => server.close(r));
  }
  assert.equal(await canConnect('127.0.0.1', port, 1000), false);
});
