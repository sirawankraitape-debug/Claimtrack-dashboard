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

// ─── NC Manager (อ่านขั้นตอน/ลักษณะความผิด จับคู่ด้วยเลขที่บิล) ─────
// ตั้ง env: NC_MANAGER_URL (ไม่ตั้ง = ค่าเริ่มต้นด้านล่าง) และ NC_API_KEY (ต้องตรงกับ NC Manager)
const NC_URL = (process.env.NC_MANAGER_URL || 'https://nc-manager-production.up.railway.app').replace(/\/+$/, '');
let ncCache = { at: 0, map: {} };
app.get('/api/nc-lookup', async (req, res) => {
  const key = process.env.NC_API_KEY;
  if (!key) return res.json({ configured: false, map: {} });
  if (Date.now() - ncCache.at < 5 * 60 * 1000) return res.json({ configured: true, map: ncCache.map });
  try {
    const r = await fetch(`${NC_URL}/api/integration/nc-summary`, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`NC Manager ตอบ ${r.status}`);
    const map = {};
    for (const row of (await r.json()).rows || []) {
      if (!/\d/.test(row.bill)) continue;   // ข้ามบิลที่เป็น "-" หรือค่าว่างใน NC
      if (!map[row.bill]) map[row.bill] = { no: row.no, step: row.step, offense: row.offense, count: 0 };   // แถวแรก = NC ล่าสุด
      map[row.bill].count++;
    }
    ncCache = { at: Date.now(), map };
    res.json({ configured: true, map });
  } catch (e) {
    res.json({ configured: true, map: ncCache.map, error: e.message });   // ล้มเหลว = ใช้ข้อมูลเดิมที่แคชไว้ ไม่ให้หน้าเคสพัง
  }
});

// ─── Statuses API ─────────────────────────────────────────────
app.get('/api/statuses', async (req, res) => {
  try { res.json(await DB.getAllStatuses()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/statuses', async (req, res) => {
  // ปิดการ "ระบุสถานะเอง" — ไม่อนุญาตให้สร้างสถานะกำหนดเองผ่าน API
  res.status(403).json({ error: 'ปิดการเพิ่มสถานะเอง — ใช้ได้เฉพาะสถานะที่กำหนดไว้ในระบบ' });
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

// ─── Auth API ─────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    const user = await DB.loginUser(username, password);
    if (!user) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    res.json({ ok: true, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users', async (req, res) => {
  try { res.json(await DB.getAllUsers()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', async (req, res) => {
  try {
    const user = await DB.addUser(req.body);
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/users/:id', async (req, res) => {
  try {
    await DB.updateUser(Number(req.params.id), req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await DB.deleteUser(Number(req.params.id));
    res.json({ ok: true });
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
