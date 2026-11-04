'use strict';
// YouTube のカード（設定ファイルの "kind": "youtube"）のための、YouTube Data API v3 の呼び出しと、読み上げる文の形。
// 画面を読む作りは当てない（YouTube の利用規約が、自動化された手段での利用を禁じているため）。データは公式の API だけで取り、
// 再生は公式の埋め込みプレーヤー（youtube-nocookie.com/embed）で行う。取ったデータは保存しない（毎回 API に問い合わせる）。
// API キーは環境変数 TODOKU_YOUTUBE_API_KEY から読む。画面には渡さず、知らせの文やログにも出さない（URL に入るので、誤りの文に URL を入れない）。

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const EMBED_BASE = 'https://www.youtube-nocookie.com/embed/';
const KEY_ENV = 'TODOKU_YOUTUBE_API_KEY';
const DEFAULT_MAX = 10;
const NO_KEY_MESSAGE = 'YouTube の API キーが設定されていません。';
// 一件の動画の id（英数字・_・- の 11字）と、チャンネルの id（UC で始まる 24字）。
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

function youtubeApiKey(env = process.env) {
  const key = String(env[KEY_ENV] || '').trim();
  return key || null;
}

// ISO 8601 の長さ（PT1H2M3S）を「1時間2分3秒」「12分34秒」「45秒」にする。読めなければ空。
function formatDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m) return '';
  const [d, h, mi, s] = m.slice(1).map((x) => Number(x || 0));
  const hours = d * 24 + h;
  const parts = [];
  if (hours) parts.push(`${hours}時間`);
  if (mi) parts.push(`${mi}分`);
  if (s || parts.length === 0) parts.push(`${s}秒`);
  return parts.join('');
}

// 公開日（ISO の日時）を「2026年11月3日」にする（その機械の時刻で）。
function formatPublished(iso) {
  const d = new Date(String(iso || ''));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// 一覧の一件の文:「題、長さ 12分34秒、公開日 2026年11月3日、チャンネル名」。
function videoText(v) {
  return [v.title, v.duration ? `長さ ${v.duration}` : '', v.published ? `公開日 ${v.published}` : '', v.channel].filter(Boolean).join('、');
}

function embedUrl(videoId) {
  if (!VIDEO_ID.test(String(videoId || ''))) return null;
  // enablejsapi=1: 画面から postMessage で再生・一時停止などを送るため。自動では再生しない（autoplay を付けない）。
  return `${EMBED_BASE}${videoId}?enablejsapi=1&rel=0`;
}

// 埋め込みプレーヤーへの問い合わせに、このアプリを名乗る Referer を付ける。
// Todoku の画面は file:// で開くので Referer が付かず、埋め込みプレーヤーが誤り 153 を返して再生しなかった（2026-11-05 に一度だけ本物で確かめた）。
// YouTube の決まりは、埋め込むアプリが Referer で自分を名乗ることを求めている。名乗りはアプリの id（package.json の build.appId）。
function attachEmbedReferer(ses, appId) {
  const referer = `https://${String(appId)}/`;
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/*'] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, Referer: referer } });
  });
  return referer;
}

// 埋め込みプレーヤーの中の「YouTube で見る」などで開こうとした窓は、Todoku の中に開かず、YouTube のページなら既定のブラウザで開く。
function youtubePageUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && /^(www\.|m\.)?(youtube\.com|youtu\.be)$/.test(u.hostname) ? u.href : null;
  } catch (e) {
    return null;
  }
}

// fetch は Electron の net.fetch などを渡す（試しでは偽物）。キーは呼ぶ側で読んで渡す。
function createYouTubeClient({ fetch, key }) {
  const get = async (path, params) => {
    const qs = new URLSearchParams({ ...params, key });
    let res;
    try {
      res = await fetch(`${API_BASE}/${path}?${qs.toString()}`);
    } catch (e) {
      // 誤りの文に URL（キーを含む）を入れない。
      throw new Error('YouTube に問い合わせられませんでした。ネットワークを確認してください。');
    }
    if (!res.ok) {
      let reason = '';
      try {
        const body = await res.json();
        reason = body && body.error && Array.isArray(body.error.errors) && body.error.errors[0] ? String(body.error.errors[0].reason || '') : '';
      } catch (e) {
        reason = '';
      }
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') throw new Error('YouTube の API の、今日使える回数を越えました。明日もう一度試してください。');
      if (res.status === 400 || res.status === 403) throw new Error('YouTube の API キーが正しくないか、使えない設定です。');
      throw new Error(`YouTube から読めませんでした（${res.status}）。`);
    }
    return res.json();
  };
  // search.list で見つけた動画の id から、videos.list で長さとチャンネル名を足す。
  const detail = async (ids) => {
    if (ids.length === 0) return [];
    const data = await get('videos', { part: 'snippet,contentDetails', id: ids.join(','), maxResults: String(ids.length) });
    const byId = new Map((data.items || []).map((v) => [v.id, v]));
    return ids.map((id) => byId.get(id)).filter(Boolean).map((v) => ({
      id: v.id,
      title: String((v.snippet && v.snippet.title) || ''),
      channel: String((v.snippet && v.snippet.channelTitle) || ''),
      published: formatPublished(v.snippet && v.snippet.publishedAt),
      duration: formatDuration(v.contentDetails && v.contentDetails.duration),
      embedUrl: embedUrl(v.id),
    })).filter((v) => v.embedUrl);
  };
  const ids = (data) => (data.items || []).map((it) => it.id && it.id.videoId).filter((id) => VIDEO_ID.test(String(id || '')));
  return {
    async search(query, max = DEFAULT_MAX) {
      const q = String(query || '').trim();
      if (!q) throw new Error('探す言葉を入れてください。');
      const data = await get('search', { part: 'snippet', type: 'video', q, maxResults: String(max), safeSearch: 'moderate' });
      return detail(ids(data));
    },
    async channelLatest(channelId, max = DEFAULT_MAX) {
      if (!CHANNEL_ID.test(String(channelId || ''))) throw new Error('チャンネルの id が正しくありません。');
      const data = await get('search', { part: 'snippet', type: 'video', channelId, order: 'date', maxResults: String(max) });
      return detail(ids(data));
    },
  };
}

module.exports = {
  KEY_ENV, NO_KEY_MESSAGE, VIDEO_ID, CHANNEL_ID, DEFAULT_MAX, EMBED_BASE,
  youtubeApiKey, attachEmbedReferer, youtubePageUrl, formatDuration, formatPublished, videoText, embedUrl, createYouTubeClient,
};
