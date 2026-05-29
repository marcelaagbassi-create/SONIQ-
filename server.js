// ============================================================
//  SONIQ Server — API Proxy sécurisé
//  DAVIESLAY studio · Node.js + Express
// ============================================================

import 'dotenv/config';
import express       from 'express';
import cors          from 'cors';
import fetch         from 'node-fetch';
import FormData      from 'form-data';
import rateLimit     from 'express-rate-limit';

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Clés API (variables d'environnement uniquement) ──────────
const AUDD_KEY = process.env.AUDD_KEY;
const YT_KEY   = process.env.YT_KEY;

if (!AUDD_KEY || !YT_KEY) {
  console.warn('⚠️  Variables d\'environnement manquantes : AUDD_KEY, YT_KEY');
}

// ── CORS ─────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://marcelaagbassi-create.github.io',
  'http://localhost',
  'http://127.0.0.1',
  'null', // fichiers locaux
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
      cb(null, true);
    } else {
      cb(new Error('CORS: origine non autorisée — ' + origin));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ─────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Trop de requêtes, réessayez dans une minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// ── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    app:    'SONIQ Server',
    by:     'DAVIESLAY studio',
    routes: ['/api/recognize', '/api/youtube/search'],
  });
});

// ============================================================
//  POST /api/recognize
//  Proxy vers AudD — identification musicale
//  Body: multipart/form-data avec champ "audio" (fichier)
// ============================================================
app.post('/api/recognize', async (req, res) => {
  try {
    // Lire le body brut (audio base64 ou multipart)
    const contentType = req.headers['content-type'] || '';

    let auddForm;

    if (contentType.includes('application/json')) {
      // Audio encodé en base64 dans le JSON
      const { audioBase64, mimeType = 'audio/webm' } = req.body;
      if (!audioBase64) return res.status(400).json({ error: 'audioBase64 manquant' });
      const buf = Buffer.from(audioBase64, 'base64');
      auddForm  = new FormData();
      auddForm.append('file', buf, { filename: 'audio.webm', contentType: mimeType });
      auddForm.append('return', 'apple_music,spotify,lyrics');
      auddForm.append('api_token', AUDD_KEY);
    } else {
      // Multipart direct — on recrée le FormData avec la clé côté serveur
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks);

      // Extraire le fichier audio du multipart entrant
      const boundary = contentType.split('boundary=')[1];
      if (!boundary) return res.status(400).json({ error: 'Boundary multipart manquant' });

      const parts = raw.toString('binary').split('--' + boundary);
      let audioBuffer = null, audioMime = 'audio/webm';

      for (const part of parts) {
        if (part.includes('name="file"') || part.includes('name="audio"')) {
          const ctMatch = part.match(/Content-Type:\s*([^\r\n]+)/i);
          if (ctMatch) audioMime = ctMatch[1].trim();
          const bodyStart = part.indexOf('\r\n\r\n') + 4;
          const bodyEnd   = part.lastIndexOf('\r\n');
          if (bodyStart > 4 && bodyEnd > bodyStart) {
            audioBuffer = Buffer.from(part.slice(bodyStart, bodyEnd), 'binary');
          }
        }
      }

      if (!audioBuffer) return res.status(400).json({ error: 'Fichier audio non trouvé dans la requête' });

      auddForm = new FormData();
      auddForm.append('file', audioBuffer, { filename: 'audio.webm', contentType: audioMime });
      auddForm.append('return', 'apple_music,spotify,lyrics');
      auddForm.append('api_token', AUDD_KEY);
    }

    const auddRes = await fetch('https://api.audd.io/', {
      method:  'POST',
      body:    auddForm,
      headers: auddForm.getHeaders(),
    });

    if (!auddRes.ok) {
      return res.status(auddRes.status).json({ error: 'AudD HTTP ' + auddRes.status });
    }

    const data = await auddRes.json();
    res.json(data);

  } catch (err) {
    console.error('[/api/recognize]', err.message);
    res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
});

// ============================================================
//  GET /api/youtube/search?q=...&pageToken=...
//  Proxy vers YouTube Data API v3
// ============================================================
app.get('/api/youtube/search', async (req, res) => {
  try {
    const { q, pageToken } = req.query;
    if (!q) return res.status(400).json({ error: 'Paramètre q manquant' });

    let url = `https://www.googleapis.com/youtube/v3/search`
            + `?part=snippet`
            + `&type=video`
            + `&videoCategoryId=10`
            + `&maxResults=20`
            + `&q=${encodeURIComponent(q)}`
            + `&key=${YT_KEY}`;

    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

    const ytRes = await fetch(url);
    if (!ytRes.ok) {
      const err = await ytRes.text();
      console.error('[/api/youtube/search] YT error:', err);
      return res.status(ytRes.status).json({ error: 'YouTube API HTTP ' + ytRes.status });
    }

    const data = await ytRes.json();
    // On ne renvoie que ce dont le front a besoin (pas d'infos sensibles)
    const items = (data.items || []).map(it => ({
      videoId:   it.id.videoId,
      title:     it.snippet.title,
      artist:    it.snippet.channelTitle.replace(' - Topic', '').replace('VEVO', ''),
      thumb:     it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || '',
      published: it.snippet.publishedAt?.slice(0, 4) || '',
    }));

    res.json({
      items,
      nextPageToken: data.nextPageToken || null,
      totalResults:  data.pageInfo?.totalResults || 0,
    });

  } catch (err) {
    console.error('[/api/youtube/search]', err.message);
    res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
});

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route inconnue' });
});

// ── Démarrage ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ SONIQ Server démarré sur le port ${PORT}`);
  console.log(`   AUDD_KEY : ${AUDD_KEY ? '✓ configurée' : '✗ manquante'}`);
  console.log(`   YT_KEY   : ${YT_KEY   ? '✓ configurée' : '✗ manquante'}`);
});
