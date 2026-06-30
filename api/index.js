'use strict';

// Vercel serverless entry point. This runs the FULL Transfado app — the UI,
// the auth/session layer, the dashboard/admin APIs, and the /v1 REST API — as
// one serverless function, so every route works on Vercel (not just the
// homepage). server/index.js exports the configured Express app and, because
// it's imported here rather than run directly, it does NOT bind a port.
//
// On Vercel the data store writes to /tmp (see server/db.js); demo data is
// seeded on cold start so sign-in works immediately.
module.exports = require('../server/index.js');
