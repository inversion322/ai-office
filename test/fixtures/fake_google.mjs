// Имитация Google для тестов YouTube: OAuth-токен (refresh и обмен кода с PKCE) и resumable-загрузка videos.insert. Настоящий Google в тестах не вызывается.
// mode: ok | quota (403 quotaExceeded при старте загрузки) | flaky (первая отправка файла обрывается 503, догрузка с места обрыва) | expire_once (первый запрос загрузки 401) | invalid_grant (refresh отклонён)
import http from 'node:http';
import crypto from 'node:crypto';

export function startFakeGoogle(mode = 'ok') {
  const st = { mode, tokenRequests: [], inits: [], puts: [], uploads: [], expectChallenge: null, expired: false, half: 0 };
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      const body = Buffer.concat(chunks), u = new URL(req.url, 'http://x'), send = (code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (u.pathname === '/token') {
        const f = new URLSearchParams(body.toString()); st.tokenRequests.push(Object.fromEntries(f));
        if (f.get('grant_type') === 'refresh_token') { if (st.mode === 'invalid_grant') return send(400, { error: 'invalid_grant' }); return send(200, { access_token: 'ya29.fake', expires_in: 3600 }); }
        if (f.get('grant_type') === 'authorization_code') {
          const okPkce = st.expectChallenge ? crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') === st.expectChallenge : true;
          if (f.get('code') !== 'GOODCODE' || !okPkce) return send(400, { error: 'invalid_grant' });
          return send(200, { access_token: 'ya29.fake', refresh_token: '1//fake-refresh', scope: 'https://www.googleapis.com/auth/youtube.upload', expires_in: 3600 });
        }
        return send(400, { error: 'unsupported_grant_type' });
      }
      if (u.pathname === '/upload/youtube/v3/videos' && req.method === 'POST') {
        st.inits.push({ headers: req.headers, meta: JSON.parse(body.toString() || '{}'), query: Object.fromEntries(u.searchParams) });
        if (req.headers.authorization !== 'Bearer ya29.fake') return send(401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } });
        if (st.mode === 'expire_once' && !st.expired) { st.expired = true; return send(401, { error: { code: 401, message: 'expired', errors: [{ reason: 'authError' }] } }); }
        if (st.mode === 'quota') return send(403, { error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } });
        return send(200, undefined, { Location: `http://127.0.0.1:${server.address().port}/session/1` });
      }
      if (u.pathname === '/session/1' && req.method === 'PUT') {
        const total = Number(req.headers['x-total'] || 0), cr = req.headers['content-range'] || '';
        st.puts.push({ range: cr, bytes: body.length });
        if (/^bytes \*\//.test(cr)) { return st.half ? send(308, undefined, { Range: `bytes=0-${st.half - 1}` }) : send(308, undefined); }
        if (st.mode === 'flaky' && !st.flakyDone) { st.flakyDone = true; st.half = Math.floor(body.length / 2); st.received = body.subarray(0, st.half); return send(503, { error: { code: 503, message: 'backend', errors: [{ reason: 'backendError' }] } }); }
        let all = body;
        if (cr) { const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(cr); if (!m || Number(m[1]) !== st.half) return send(400, { error: { message: 'bad range' } }); all = Buffer.concat([st.received, body]); }
        st.uploads.push(all); return send(200, { id: 'VID123', status: { privacyStatus: st.inits[st.inits.length - 1].meta.status.privacyStatus } });
      }
      send(404, { error: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => { const base = `http://127.0.0.1:${server.address().port}`; resolve({ st, base, token: base + '/token', upload: base + '/upload/youtube/v3/videos', close: () => new Promise((r) => server.close(r)) }); }));
}
