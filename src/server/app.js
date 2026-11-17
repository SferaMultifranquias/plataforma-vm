const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createStockCheckRouter, createReceivedStockRouter } = require('./routes/stock-checks');
const { createOrdersAdminRouter } = require('./routes/orders-admin');
const { createUsersAdminRouter } = require('./routes/users-admin');

const app = express();
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const SUPABASE_UMD_FILE = path.resolve(ROOT_DIR, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
const BODY_SIZE_LIMIT = '10kb';

function isLocalOrigin(origin) {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  } catch {
    return false;
  }
}

app.use(cors({
  origin: (origin, callback) => callback(null, isLocalOrigin(origin)),
}));

app.use(express.json({ limit: BODY_SIZE_LIMIT }));
app.use(express.urlencoded({ limit: BODY_SIZE_LIMIT, extended: true }));

app.use('/api/admin/stock-checks', createStockCheckRouter());
app.use('/api/admin/received-stock', createReceivedStockRouter());
app.use('/api/admin/orders', createOrdersAdminRouter());
app.use('/api/admin/users', createUsersAdminRouter());

app.get('/vendor/supabase/supabase.js', (req, res) => {
  if (!fs.existsSync(SUPABASE_UMD_FILE)) {
    res.status(404).type('text/plain').send('Supabase browser bundle not found.');
    return;
  }

  res.sendFile(SUPABASE_UMD_FILE, (error) => {
    if (!error) return;
    if (!res.headersSent) {
      res.status(error.statusCode === 404 ? 404 : 500).type('text/plain').send('Supabase browser bundle not found.');
    }
  });
});

app.get('/api/config', (req, res) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      error: 'Configuracao do Supabase incompleta.',
      code: 'CONFIG_INCOMPLETE',
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseAnonKey: Boolean(supabaseAnonKey),
      hasViteSupabaseUrl: Boolean(process.env.VITE_SUPABASE_URL),
      hasViteSupabaseAnonKey: Boolean(process.env.VITE_SUPABASE_ANON_KEY),
    });
  }

  res.json({
    supabaseUrl: supabaseUrl,
    supabaseAnonKey: supabaseAnonKey,
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hora: new Date().toISOString() });
});

app.use(express.static(PUBLIC_DIR, {
  setHeaders: function setCacheHeaders(res, filePath) {
    var ext = path.extname(filePath).toLowerCase();
    if (ext === '.html' || ext === '.js' || ext === '.mjs') {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
    }
  },
}));

app.get(['/dashboard', '/login', '/pedidos', '/novo-pedido', '/lojas', '/usuarios', '/estoque', '/suprimentos', '/dashboard-suprimentos'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(function jsonParseErrorHandler(err, req, res, next) {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ code: 'MALFORMED_JSON', error: 'Corpo da requisição inválido.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', error: 'Corpo da requisição excede o limite permitido.' });
  }
  next(err);
});

module.exports = app;
