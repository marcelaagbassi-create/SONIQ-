// ============================================================
//  SONIQ Server v2.0 — ACRCloud + YouTube proxy
//  DAVIESLAY studio · Node.js + Express
// ============================================================

import 'dotenv/config';
import express    from 'express';
import cors       from 'cors';
import fetch      from 'node-fetch';
import crypto     from 'crypto';
import FormData   from 'form-data';
import rateLimit  from 'express-rate-limit';

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Clés (variables d'environnement uniquement) ──────────────
const ACR_HOST   = process.env.ACR_HOST;   // ex: identify-eu-west-1.acrcloud.com
const ACR_KEY    = process.env.ACR_KEY;
const ACR_SECRET = process.env.ACR_SECRET;
const YT_KEY     = process.env.YT_KEY;

if (!ACR_HOST || !ACR_KEY || !ACR_SECRET) {
  console.warn('⚠️  Variables ACRCloud manquantes : ACR_HOST, ACR_KEY, ACR_SECRET');
}
if (!YT_KEY) {
  console.warn('⚠️  Variable YT_KEY manquante');
}

// ── CORS ─────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://marcelaagbassi-create.github.io',
  'http://localhost',
  'http://127.0.0.1',
  'null',
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.some(o => origin.startsWith(o))) cb(null, true);
    else cb(new Error('CORS bloqué : ' + origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '15mb' }));

// ── Rate limiting ─────────────────────────────────────────────
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: { error: 'Trop de requêtes, réessayez dans une minute.' },
}));

// ── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status:  'ok',
    app:     'SONIQ Server v2.0',
    by:      'DAVIESLAY studio',
    engine:  'ACRCloud',
    routes:  ['/api/recognize', '/api/youtube/search'],
  });
});

// ============================================================
//  Signature ACRCloud
// ============================================================
function buildAcrSignature(method, uri, timestamp) {
  const str = [method, uri, ACR_KEY, 'audio', '1', timestamp].join('\n');
  return crypto.createHmac('sha1', ACR_SECRET).update(str).digest('base64');
}

// ============================================================
//  POST /api/recognize
//  Reconnaissance musicale via ACRCloud
//  Body JSON : { audioBase64: string, mimeType: string }
// ============================================================
app.post('/api/recognize', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/webm' } = req.body;
    if (!audioBase64) return res.status(400).json({ error: 'audioBase64 manquant' });

    const audioBuf   = Buffer.from(audioBase64, 'base64');
    const timestamp  = Math.floor(Date.now() / 1000);
    const endpoint   = '/v1/identify';
    const signature  = buildAcrSignature('POST', endpoint, timestamp);

    const form = new FormData();
    form.append('sample',          audioBuf, { filename: 'audio.webm', contentType: mimeType });
    form.append('sample_bytes',    String(audioBuf.length));
    form.append('access_key',      ACR_KEY);
    form.append('data_type',       'audio');
    form.append('signature_version','1');
    form.append('signature',       signature);
    form.append('timestamp',       String(timestamp));

    const acrRes = await fetch(`https://${ACR_HOST}${endpoint}`, {
      method:  'POST',
      body:    form,
      headers: form.getHeaders(),
      timeout: 15000,
    });

    if (!acrRes.ok) throw new Error('ACRCloud HTTP ' + acrRes.status);

    const acrData = await acrRes.json();
    console.log('[ACR] status:', acrData.status?.msg);

    // Normaliser la réponse au format attendu par le frontend
    const normalized = normalizeAcrResponse(acrData);
    res.json(normalized);

  } catch (err) {
    console.error('[/api/recognize]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  Normaliser la réponse ACRCloud → format SONIQ
// ============================================================
function normalizeAcrResponse(acr) {
  const code = acr.status?.code;

  // 0 = trouvé, 1001 = non trouvé
  if (code !== 0) {
    return {
      status: 'error',
      error: {
        error_code:    code,
        error_message: acr.status?.msg || 'Non reconnu',
      },
    };
  }

  const music = acr.metadata?.music?.[0];
  if (!music) return { status: 'error', error: { error_code: 1001, error_message: 'Aucun résultat' } };

  // Construire un objet compatible avec le frontend SONIQ
  const result = {
    title:        music.title        || '',
    artist:       music.artists?.map(a => a.name).join(', ') || '',
    album:        music.album?.name  || '',
    release_date: music.release_date || '',
    label:        music.label        || '',
    timecode:     music.play_offset_ms
                    ? `${Math.floor(music.play_offset_ms/60000)}:${String(Math.floor((music.play_offset_ms%60000)/1000)).padStart(2,'0')}`
                    : null,
    score:        music.score        || 0,
    // Liens externes si disponibles
    spotify:      music.external_metadata?.spotify
                    ? {
                        external_urls: { spotify: `https://open.spotify.com/track/${music.external_metadata.spotify.track?.id}` },
                        album: { images: music.external_metadata.spotify.album?.id
                          ? [{ url: `https://i.scdn.co/image/${music.external_metadata.spotify.album.id}` }]
                          : [] },
                        preview_url: null,
                      }
                    : null,
    apple_music:  music.external_metadata?.apple_music || null,
    deezer:       music.external_metadata?.deezer || null,
    youtube:      music.external_metadata?.youtube || null,
  };

  return { status: 'success', result };
}

// ============================================================
//  GET /api/youtube/search?q=...&pageToken=...
// ============================================================
app.get('/api/youtube/search', async (req, res) => {
  try {
    const { q, pageToken } = req.query;
    if (!q) return res.status(400).json({ error: 'Paramètre q manquant' });

    let url = `https://www.googleapis.com/youtube/v3/search`
            + `?part=snippet&type=video&videoCategoryId=10&maxResults=20`
            + `&q=${encodeURIComponent(q)}&key=${YT_KEY}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

    const ytRes = await fetch(url);
    if (!ytRes.ok) throw new Error('YouTube API HTTP ' + ytRes.status);

    const data  = await ytRes.json();
    if (data.error) throw new Error(data.error.message || 'YouTube API error');

    const items = (data.items || []).map(it => ({
      videoId:   it.id.videoId,
      title:     it.snippet.title,
      artist:    it.snippet.channelTitle.replace(/ - Topic$/,'').replace(/VEVO$/,'').trim(),
      thumb:     it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || '',
      published: it.snippet.publishedAt?.slice(0, 4) || '',
    }));

    res.json({ items, nextPageToken: data.nextPageToken || null });

  } catch (err) {
    console.error('[/api/youtube/search]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route inconnue' }));

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ SONIQ Server v2.0 démarré — port ${PORT}`);
  console.log(`   ACR_HOST  : ${ACR_HOST  ? '✓ ' + ACR_HOST : '✗ manquant'}`);
  console.log(`   ACR_KEY   : ${ACR_KEY   ? '✓ configurée' : '✗ manquante'}`);
  console.log(`   ACR_SECRET: ${ACR_SECRET? '✓ configurée' : '✗ manquante'}`);
  console.log(`   YT_KEY    : ${YT_KEY    ? '✓ configurée' : '✗ manquante'}\n`);
});
