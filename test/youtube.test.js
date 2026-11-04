'use strict';
// YouTube のカードの、API の呼び出し（偽の fetch）・読み上げる文の形・設定ファイルの形の試し。本物の API は呼ばない。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  youtubeApiKey, attachEmbedReferer, youtubePageUrl, formatDuration, formatPublished, videoText, embedUrl, createYouTubeClient, NO_KEY_MESSAGE, KEY_ENV,
} = require('../src/main/youtube');
const { validateConfig } = require('../src/main/config');

const FAKE_KEY = 'fake-key-for-test';

// 作り物の API の答え。search は動画の id だけ、videos は題・チャンネル・公開日・長さ。呼ばれた URL を控える。
function fakeFetch(calls, { status = 200, body = null } = {}) {
  return async (url) => {
    calls.push(url);
    if (status !== 200) return { ok: false, status, json: async () => body || {} };
    const u = new URL(url);
    if (u.pathname.endsWith('/search')) {
      return { ok: true, status, json: async () => ({ items: [{ id: { videoId: 'aaaaaaaaaaa' } }, { id: { videoId: 'bbbbbbbbbbb' } }, { id: { channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx' } }] }) };
    }
    return {
      ok: true,
      status,
      json: async () => ({
        items: [
          { id: 'bbbbbbbbbbb', snippet: { title: '作り物の授業 第2回', channelTitle: '作り物の大学', publishedAt: '2026-11-04T03:00:00Z' }, contentDetails: { duration: 'PT1H2M3S' } },
          { id: 'aaaaaaaaaaa', snippet: { title: '作り物の授業 第1回', channelTitle: '作り物の大学', publishedAt: '2026-11-03T03:00:00Z' }, contentDetails: { duration: 'PT12M34S' } },
        ],
      }),
    };
  };
}

test('YouTube: API キーは環境変数から読み、無ければ null', () => {
  assert.equal(youtubeApiKey({ [KEY_ENV]: ' abc ' }), 'abc');
  assert.equal(youtubeApiKey({}), null);
  assert.equal(NO_KEY_MESSAGE, 'YouTube の API キーが設定されていません。');
});

test('YouTube: 長さと公開日と一件の文の形', () => {
  assert.equal(formatDuration('PT12M34S'), '12分34秒');
  assert.equal(formatDuration('PT1H2M3S'), '1時間2分3秒');
  assert.equal(formatDuration('PT45S'), '45秒');
  assert.equal(formatDuration('PT1H'), '1時間');
  assert.equal(formatDuration('P1DT1M'), '24時間1分');
  assert.equal(formatDuration('nope'), '');
  assert.equal(formatPublished('2026-11-03T03:00:00Z'), '2026年11月3日');
  assert.equal(videoText({ title: '題', duration: '12分34秒', published: '2026年11月3日', channel: 'チャンネル' }), '題、長さ 12分34秒、公開日 2026年11月3日、チャンネル');
  assert.equal(embedUrl('aaaaaaaaaaa'), 'https://www.youtube-nocookie.com/embed/aaaaaaaaaaa?enablejsapi=1&rel=0');
  assert.equal(embedUrl('../x'), null);
});

test('YouTube: 探すと、search.list の動画の id だけを、videos.list の長さとチャンネル名で、search の順に返す', async () => {
  const calls = [];
  const client = createYouTubeClient({ fetch: fakeFetch(calls), key: FAKE_KEY });
  const v = await client.search('授業', 10);
  assert.deepEqual(v.map((x) => [x.id, x.title, x.duration, x.published, x.channel]), [
    ['aaaaaaaaaaa', '作り物の授業 第1回', '12分34秒', '2026年11月3日', '作り物の大学'],
    ['bbbbbbbbbbb', '作り物の授業 第2回', '1時間2分3秒', '2026年11月4日', '作り物の大学'],
  ]);
  const search = new URL(calls[0]);
  assert.equal(search.pathname, '/youtube/v3/search');
  assert.equal(search.searchParams.get('q'), '授業');
  assert.equal(search.searchParams.get('type'), 'video');
  assert.equal(search.searchParams.get('maxResults'), '10');
  assert.equal(new URL(calls[1]).searchParams.get('id'), 'aaaaaaaaaaa,bbbbbbbbbbb');
});

test('YouTube: 決まったチャンネルの新しい動画は、channelId と order=date で問い合わせる。チャンネルの id の形が違えば問い合わせない', async () => {
  const calls = [];
  const client = createYouTubeClient({ fetch: fakeFetch(calls), key: FAKE_KEY });
  await client.channelLatest('UCabcdefghijklmnopqrstuv', 5);
  const u = new URL(calls[0]);
  assert.equal(u.searchParams.get('channelId'), 'UCabcdefghijklmnopqrstuv');
  assert.equal(u.searchParams.get('order'), 'date');
  assert.equal(u.searchParams.get('maxResults'), '5');
  await assert.rejects(client.channelLatest('not-a-channel'), /チャンネルの id が正しくありません/);
  assert.equal(calls.length, 2);
});

test('YouTube: 誤りの文に API キー（と、キーを含む URL）を出さない', async () => {
  for (const [opts, re] of [
    [{ status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }] } } }, /今日使える回数/],
    [{ status: 400, body: { error: { errors: [{ reason: 'keyInvalid' }] } } }, /API キーが正しくないか/],
    [{ status: 500 }, /YouTube から読めませんでした（500）/],
  ]) {
    const client = createYouTubeClient({ fetch: fakeFetch([], opts), key: FAKE_KEY });
    await assert.rejects(client.search('授業'), (e) => re.test(e.message) && !e.message.includes(FAKE_KEY) && !e.message.includes('googleapis'));
  }
  const broken = createYouTubeClient({ fetch: async () => { throw new Error(`failed https://www.googleapis.com/?key=${FAKE_KEY}`); }, key: FAKE_KEY });
  await assert.rejects(broken.search('授業'), (e) => !e.message.includes(FAKE_KEY) && /ネットワークを確認してください/.test(e.message));
});

test('YouTube: 設定ファイルの形（"kind": "youtube"）', () => {
  const good = {
    id: 'yt-classes', name: '授業の動画', kind: 'youtube',
    cards: [
      { id: 'search', title: '動画を探す', action: 'youtube-search' },
      { id: 'latest', title: '新しい動画', action: 'youtube-channel', channelId: 'UCabcdefghijklmnopqrstuv', maxResults: 10 },
      { id: 'player', title: '再生', action: 'youtube-player' },
    ],
  };
  assert.deepEqual(validateConfig(good), []);
  const where = (c) => validateConfig(c).map((e) => e.where);
  assert.deepEqual(where({ ...good, url: 'https://www.youtube.com/' }), ['url']);
  assert.deepEqual(where({ ...good, cards: [good.cards[0], { ...good.cards[1], channelId: 'abc' }, good.cards[2]] }), ['cards[1].channelId']);
  assert.deepEqual(where({ ...good, cards: [good.cards[0], { ...good.cards[1], maxResults: 99 }, good.cards[2]] }), ['cards[1].maxResults']);
  assert.deepEqual(where({ ...good, cards: [good.cards[0]] }), ['cards']);
  assert.deepEqual(where({ ...good, cards: [{ ...good.cards[0], selector: 'a' }, good.cards[2]] }), ['cards[0].selector']);
  assert.deepEqual(where({ ...good, kind: 'video' }), ['kind', 'url', 'cards[0].action', 'cards[0].selector', 'cards[1].action', 'cards[1].selector', 'cards[2].action', 'cards[2].selector']);
});

test('YouTube: 埋め込みプレーヤーへの問い合わせだけに、アプリの id を名乗る Referer を付ける', () => {
  let filter = null;
  let listener = null;
  const ses = { webRequest: { onBeforeSendHeaders: (f, l) => { filter = f; listener = l; } } };
  assert.equal(attachEmbedReferer(ses, 'jp.example.app'), 'https://jp.example.app/');
  assert.deepEqual(filter, { urls: ['https://www.youtube-nocookie.com/*'] });
  let out = null;
  listener({ requestHeaders: { Accept: '*/*' } }, (r) => { out = r; });
  assert.deepEqual(out, { requestHeaders: { Accept: '*/*', Referer: 'https://jp.example.app/' } });
});

test('YouTube: プレーヤーから開こうとした窓は、YouTube のページだけを既定のブラウザに回す', () => {
  assert.equal(youtubePageUrl('https://www.youtube.com/watch?v=aaaaaaaaaaa'), 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
  assert.equal(youtubePageUrl('https://youtu.be/aaaaaaaaaaa'), 'https://youtu.be/aaaaaaaaaaa');
  assert.equal(youtubePageUrl('http://www.youtube.com/'), null);
  assert.equal(youtubePageUrl('https://www.youtube.com.example.org/'), null);
  assert.equal(youtubePageUrl('javascript:alert(1)'), null);
});
