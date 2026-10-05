/**
 * Klien API untuk backend Google Apps Script.
 * - POST dengan Content-Type text/plain (permintaan "simple" -> tanpa preflight CORS)
 * - timeout, penanganan offline, retry untuk permintaan baca, pesan error ramah pengguna
 */
const Api = (function () {
  const cfg = window.SIPAKEM_CONFIG || {};
  const TIMEOUT_MS = 45000;
  const TOKEN_KEY = 'sipakem_token';
  let token = null;
  try { token = sessionStorage.getItem(TOKEN_KEY); } catch (e) { /* storage diblokir */ }

  function ApiErr(code, message, data) {
    const e = new Error(message);
    e.name = 'ApiErr';
    e.code = code;
    e.data = data;
    return e;
  }

  function configured() { return /^https?:\/\/\S+/.test(cfg.API_URL || ''); }
  function setToken(t) {
    token = t || null;
    try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* abaikan */ }
  }
  function hasToken() { return !!token; }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function request(url, init) {
    if (!configured()) {
      throw ApiErr('CONFIG', 'Aplikasi belum terhubung ke database. Isi API_URL pada js/config.js (lihat README).');
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw ApiErr('OFFLINE', 'Tidak ada koneksi internet. Periksa jaringan Anda lalu coba lagi.');
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, Object.assign({ redirect: 'follow', signal: ctl.signal }, init));
    } catch (e) {
      if (e && e.name === 'AbortError') throw ApiErr('TIMEOUT', 'Server tidak merespons (waktu habis). Coba lagi sebentar lagi.');
      throw ApiErr('NETWORK', 'Gagal terhubung ke server. Periksa internet Anda, atau pastikan deployment Web App diatur "Anyone".');
    } finally {
      clearTimeout(timer);
    }
    let body;
    try { body = await res.json(); }
    catch (e) {
      throw ApiErr('BAD_RESPONSE', 'Respons server tidak valid (HTTP ' + res.status + '). Pastikan URL berakhiran /exec dan deployment diatur "Anyone".');
    }
    if (!body || body.ok !== true) {
      const code = (body && body.code) || 'SERVER';
      const err = ApiErr(code, (body && body.error) || 'Terjadi kesalahan pada server.', body && body.data);
      if (code === 'AUTH') {
        setToken(null);
        if (typeof Api.onAuthExpired === 'function') Api.onAuthExpired(err);
      }
      throw err;
    }
    return body.data;
  }

  /** opts.retry = true hanya untuk aksi baca (aman diulang). */
  async function call(action, payload, opts) {
    opts = opts || {};
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, token: token, payload: payload || {} })
    };
    const attempts = opts.retry ? 2 : 1;
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try { return await request(cfg.API_URL, init); }
      catch (e) {
        lastErr = e;
        if (!(opts.retry && (e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.code === 'BAD_RESPONSE')) || i === attempts - 1) throw e;
        await sleep(1200);
      }
    }
    throw lastErr;
  }

  /** Verifikasi publik (GET) — dipakai verifikasi.html */
  async function verify(kode) {
    const url = cfg.API_URL + (cfg.API_URL.indexOf('?') >= 0 ? '&' : '?') + 'action=verify&kode=' + encodeURIComponent(kode);
    let lastErr;
    for (let i = 0; i < 2; i++) {
      try { return await request(url, { method: 'GET' }); }
      catch (e) {
        lastErr = e;
        if (!(e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.code === 'BAD_RESPONSE') || i === 1) throw e;
        await sleep(1200);
      }
    }
    throw lastErr;
  }

  function msg(e) { return (e && e.message) ? e.message : 'Terjadi kesalahan tak terduga.'; }

  return { call: call, verify: verify, setToken: setToken, hasToken: hasToken, configured: configured, msg: msg, onAuthExpired: null };
})();
