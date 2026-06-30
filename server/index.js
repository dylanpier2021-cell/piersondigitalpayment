'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const seed = require('./seed');
const billing = require('./billing');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Load + seed (first run only) before serving traffic.
db.load();
const seeded = seed.ensureSeeded();
if (seeded) {
  console.log('Seeded sandbox data:', JSON.stringify(seeded));
}

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(auth.attachUser);

// ---- API routes ----
app.use('/auth', require('./routes/auth'));
app.use('/api/merchant', require('./routes/merchant'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/owner', require('./routes/owner'));
app.use('/api/public', require('./routes/public'));
app.use('/v1', require('./routes/api'));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: config.PROCESSING_MODE, name: db.getData().meta.settings.platformName });
});

// ---- Clean-URL pages ----
function page(file) {
  return (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
}
app.get('/', page('index.html'));
app.get('/login', page('login.html'));
app.get('/signup', page('signup.html'));
app.get('/dashboard', page('dashboard.html'));
app.get('/admin', page('admin.html'));
app.get('/docs', page('docs.html'));
app.get('/pay/:id', page('checkout.html'));

// ---- Legal / policy pages ----
app.get('/legal', page('legal/index.html'));
app.get('/legal/terms', page('legal/terms.html'));
app.get('/legal/privacy', page('legal/privacy.html'));
app.get('/legal/acceptable-use', page('legal/acceptable-use.html'));

// Serve the compliance/gap-analysis doc (lives at the project root).
app.get(['/COMPLIANCE.md', '/compliance'], (req, res) => {
  res.type('text/markdown; charset=utf-8').sendFile(path.join(__dirname, '..', 'COMPLIANCE.md'), (err) => {
    if (err) res.status(404).send('Not found');
  });
});

// ---- Static assets ----
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// ---- 404 ----
app.use((req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/v1') || req.path.startsWith('/auth')) {
    return res.status(404).json({ error: { message: 'Not found.' } });
  }
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'), (err) => {
    if (err) res.status(404).send('Not found');
  });
});

// ---- Error handler ----
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: { message: 'Internal server error.' } });
});

// ---- Recurring billing ticker ----
function runBilling(label) {
  try {
    const result = billing.processDueSubscriptions();
    if (result.charged || result.failed) {
      console.log(`[billing${label ? ' ' + label : ''}] charged=${result.charged} failed=${result.failed}`);
    }
  } catch (err) {
    console.error('[billing] error:', err.message);
  }
}
runBilling('startup');

// Only run the long-lived server bits when started directly (`node server/index.js`).
// When imported as a serverless function (e.g. Vercel via api/index.js) we must
// NOT bind a port or hold the process open — we just export the Express app.
if (require.main === module) {
  const ticker = setInterval(() => runBilling(), 60 * 1000);
  if (ticker.unref) ticker.unref();

  const server = app.listen(config.PORT, () => {
    console.log('');
    console.log('  ╔════════════════════════════════════════════════╗');
    console.log('  ║   Transfado  —  the new way to get paid        ║');
    console.log('  ║   sandbox mode · no real cards are charged     ║');
    console.log('  ╚════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  ▸ App:        http://localhost:${config.PORT}`);
    console.log(`  ▸ Admin:      http://localhost:${config.PORT}/admin`);
    console.log(`  ▸ Dashboard:  http://localhost:${config.PORT}/dashboard`);
    console.log('');
    console.log(`  Admin login:  ${config.ADMIN_EMAIL} / ${config.ADMIN_PASSWORD}`);
    console.log('  Client login: boochies@example.com / demo1234');
    console.log('');
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down…');
    server.close(() => process.exit(0));
  });
}

module.exports = app;
