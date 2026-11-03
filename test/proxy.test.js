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
