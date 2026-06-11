/**
 * ClaimTrack — Node.js Backend
 * รันด้วย: node server.js  |  PORT env ควบคุม port
 *
 * โหมดฐานข้อมูล (เลือกอัตโนมัติ):
 *   DATABASE_URL ไม่มี  → SQLite  (claimtrack.db ในโฟลเดอร์นี้) ← ง่าย รันในเครื่อง
 *   DATABASE_URL มีค่า  → PostgreSQL (Neon / Supabase / Render)  ← สำหรับ cloud
 */
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const DB      = process.env.DATABASE_URL ? require('./db') : require('./db-sqlite');

const DB_MODE = process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite';

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// เสิร์ฟไฟล์ HTML + static จากโฟลเดอร์ parent
// รองรับทั้งชื่อ index.html และชื่อภาษาไทย
app.use(express.static(path.join(__dirname, '..')));
app.get('/', (req, res) => {
  const fs = require('fs');
  const candidates = ['index.html', 'ระบบติดตามยืนยันเคสเคลม.html'];
  for (const name of candidates) {
    const full = path.join(__dirname, '..', name);
    if (fs.existsSync(full)) return res.sendFile(full);
  }
  res.status(404).send('ไม่พบไฟล์ HTML');
});

// ─── SSE — Real-time broadcast ────────────────────────────────
const sseClients = new Set();

function broadcast(event, data = {}) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => {
    try { res.write(msg); } catch { sseClients.delete(res); }
  });
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');
  sseClients.add(res);

  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); sseClients.delete(res); }
  }, 25000);

  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

// ─── Cases API ───────────────────────────────────────────────
app.get('/api/cases', async (req, res) => {
  try { res.json(await DB.getAllCases()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cases/import', async (req, res) => {
  try {
    const { added, skipped } = await DB.importCases(req.body);
    broadcast('cases_updated', { source: 'import', added, skipped });
    res.json({ ok: true, added, skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/cases/:id', async (req, res) => {
  try {
    await DB.updateCase(req.params.id, req.body);
    broadcast('cases_updated', { source: 'patch', id: req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cases/:id/events', async (req, res) => {
  try {
    await DB.addEvent(req.params.id, req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Statuses API ─────────────────────────────────────────────
app.get('/api/statuses', async (req, res) => {
  try { res.json(await DB.getAllStatuses()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/statuses', async (req, res) => {
  try {
    const s = await DB.addStatus(req.body);
    broadcast('statuses_updated', { source: 'add', key: s.key });
    res.json(s);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/statuses/:key', async (req, res) => {
  try {
    await DB.deleteStatus(req.params.key);
    broadcast('statuses_updated', { source: 'delete', key: req.params.key });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Backup / Restore ─────────────────────────────────────────
app.get('/api/backup', async (req, res) => {
  try {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      cases: await DB.getAllCases(),
      statuses: await DB.getAllStatuses(),
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition',
      `attachment; filename="claimtrack_backup_${new Date().toISOString().slice(0,10)}.json"`);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/restore', async (req, res) => {
  try {
    const { cases, statuses } = req.body;
    await DB.restoreAll(cases, statuses);
    broadcast('cases_updated',    { source: 'restore' });
    broadcast('statuses_updated', { source: 'restore' });
    res.json({ ok: true, caseCount: (cases||[]).length, statusCount: (statuses||[]).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', db: DB_MODE, clients: sseClients.size }));

// ─── Init DB แล้วค่อย start server ───────────────────────────
DB.init()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      // หา IP ของเครื่องนี้เพื่อแสดง URL สำหรับแชร์ใน LAN
      let lanIP = 'YOUR_IP';
      try {
        const os  = require('os');
        const ifs = os.networkInterfaces();
        for (const name of Object.keys(ifs)) {
          for (const iface of ifs[name]) {
            if (iface.family === 'IPv4' && !iface.internal) { lanIP = iface.address; break; }
          }
          if (lanIP !== 'YOUR_IP') break;
        }
      } catch {}

      console.log('\n╔══════════════════════════════════════════════╗');
      console.log('║   ✅  ClaimTrack Server พร้อมใช้งาน         ║');
      console.log('╠══════════════════════════════════════════════╣');
      console.log(`║   💻  เครื่องนี้ :  http://localhost:${PORT}      ║`);
      console.log(`║   🌐  LAN (แชร์) :  http://${lanIP}:${PORT}  ║`);
      console.log(`║   🗄️  ฐานข้อมูล  :  ${DB_MODE.padEnd(28)}║`);
      console.log('╚══════════════════════════════════════════════╝\n');
      console.log('   กด Ctrl+C เพื่อหยุด server\n');
    });
  })
  .catch(err => {
    console.error('❌  DB init failed:', err.message);
    process.exit(1);
  });
