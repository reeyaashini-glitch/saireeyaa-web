// Entry point for Vercel (serverless). Sets up the database once per cold start, then hands over to Express.
let mod, failure;
function load() { if (!mod && !failure) { try { mod = require('../server'); } catch (e) { failure = e; } } }
module.exports = async (req, res) => {
  load();
  if (failure) { res.statusCode = 500; res.setHeader('Content-Type', 'text/plain'); return res.end('Startup problem: ' + failure.message); }
  try { await mod.init(); } catch (e) { console.error('Startup failed:', e); res.statusCode = 500; res.setHeader('Content-Type', 'text/plain'); return res.end('Database problem: ' + e.message); }
  return mod.app(req, res);
};
