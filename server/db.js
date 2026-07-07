/**
 * db.js — PostgreSQL database layer (pg)
 * ใช้ DATABASE_URL env variable สำหรับเชื่อมต่อ PostgreSQL (Neon / Supabase / Render)
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

// ───── Default statuses ────────────────────────────────────────
const DEFAULT_STATUSES = [
  { key:'new_proof',     label:'อยู่ระหว่างขอหลักฐานใหม่',          color:'#FB923C', grp:'ดำเนินการ',    terminal:false, sort_order:1  },
  { key:'confirm_price', label:'อยู่ระหว่างยืนยันราคาเคลม',         color:'#14B8A6', grp:'ดำเนินการ',    terminal:false, sort_order:2  },
  { key:'find_owner',    label:'อยู่ระหว่างขอรายชื่อผู้รับผิดชอบ',   color:'#F59E0B', grp:'ดำเนินการ',    terminal:false, sort_order:3  },
  { key:'sent_owner',    label:'ส่งเอกสารให้ผู้รับผิดชอบ',           color:'#8B5CF6', grp:'ดำเนินการ',    terminal:false, sort_order:4  },
  { key:'received',      label:'ได้รับเอกสารแล้ว',                  color:'#3B82F6', grp:'ดำเนินการ',    terminal:false, sort_order:5  },
  { key:'delay_analyze', label:'เคสวิเคราะห์ล่าช้า เคลมระบุชื่อผู้รับผิดชอบ', color:'#EA580C', grp:'ดำเนินการ', terminal:false, sort_order:6  },
  { key:'no_driven',     label:'ไม่มีใน Drive N',                    color:'#64748B', grp:'ดำเนินการ',    terminal:false, sort_order:7  },
  { key:'consider_co',   label:'ขอพิจารณาลงบริษัท',                 color:'#EC4899', grp:'ดำเนินการ',    terminal:false, sort_order:8  },
  { key:'CPF',           label:'CPF',                                color:'#F43F5E', grp:'ดำเนินการ',    terminal:false, sort_order:9  },
  { key:'fraud',         label:'เคสทุจริต',                          color:'#DC2626', grp:'ดำเนินการ',    terminal:true,  sort_order:10 },
  { key:'closed',        label:'ปิดจบไม่เคลม',                      color:'#10B981', grp:'ดำเนินการ',    terminal:true,  sort_order:11 },
  { key:'A00', label:'A00 อยู่ระหว่างการพิจารณา',                   color:'#38BDF8', grp:'สถานะเคลม',    terminal:false, sort_order:12 },
  { key:'A01', label:'A01 อยู่ระหว่างการส่งเอกสารประกอบการเคลม',    color:'#818CF8', grp:'สถานะเคลม',    terminal:false, sort_order:13 },
  { key:'A02', label:'A02 อยู่ระหว่างการตรวจสอบเอกสาร',             color:'#A78BFA', grp:'สถานะเคลม',    terminal:false, sort_order:14 },
  { key:'A03', label:'A03 อยู่ระหว่างการโอนเงิน',                   color:'#F472B6', grp:'สถานะเคลม',    terminal:false, sort_order:15 },
  { key:'A04', label:'A04 โอนเงิน',                                color:'#34D399', grp:'สถานะเคลม',    terminal:true,  sort_order:16 },
  { key:'A89', label:'A89 ปิดจบ ไม่เคลม',                          color:'#94A3B8', grp:'สถานะเคลม',    terminal:true,  sort_order:17 },
  { key:'B00', label:'B00 อยู่ระหว่างการประเมินผู้รับผิดชอบ',       color:'#FBBF24', grp:'สถานะเคลียร์', terminal:false, sort_order:20 },
  { key:'B01', label:'B01 อยู่ระหว่างการตอบกลับของ DC',            color:'#FB923C', grp:'สถานะเคลียร์', terminal:false, sort_order:21 },
  { key:'B02', label:'B02 อยู่ระหว่างการอนุมัติของผู้บริหาร',       color:'#F59E0B', grp:'สถานะเคลียร์', terminal:false, sort_order:22 },
  { key:'B03', label:'B03 ค้างส่งเอกสารหักเงิน',                   color:'#EF4444', grp:'สถานะเคลียร์', terminal:false, sort_order:23 },
  { key:'B04', label:'B04 เคลียร์รับเอกสาร',                       color:'#2DD4BF', grp:'สถานะเคลียร์', terminal:false, sort_order:24 },
  { key:'B05', label:'B05 บัญชีรับเอกสาร',                         color:'#22D3EE', grp:'สถานะเคลียร์', terminal:true,  sort_order:25 },
];

// ───── สร้างตาราง + seed statuses (เรียกครั้งแรกตอน server start) ────
const init = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cases (
      id                  TEXT PRIMARY KEY,
      receipt_no          TEXT UNIQUE NOT NULL,
      doc_date            TEXT,
      damage_type         TEXT,
      bill_no             TEXT,
      bill_date           TEXT,
      customer_type       TEXT,
      bill_type           TEXT,
      sender              TEXT,
      receiver            TEXT,
      product_type        TEXT,
      load_point          TEXT,
      unload_point        TEXT,
      bill_status         TEXT DEFAULT NULL,
      confirmed           BOOLEAN DEFAULT false,
      owner               TEXT DEFAULT '—',
      owner_cc            TEXT DEFAULT '—',
      claim_amount        REAL,
      fault_dc            TEXT DEFAULT '',
      consider_co_result  TEXT,
      note                TEXT DEFAULT '',
      attachments         INTEGER DEFAULT 0,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS events (
      id        SERIAL PRIMARY KEY,
      case_id   TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      at        TIMESTAMPTZ NOT NULL,
      text      TEXT,
      type      TEXT,
      by        TEXT
    );

    CREATE TABLE IF NOT EXISTS statuses (
      key        TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      color      TEXT NOT NULL,
      grp        TEXT DEFAULT 'กำหนดเอง',
      terminal   BOOLEAN DEFAULT false,
      sort_order INTEGER DEFAULT 999
    );

    CREATE TABLE IF NOT EXISTS users (
      id           SERIAL PRIMARY KEY,
      username     TEXT UNIQUE NOT NULL,
      password     TEXT NOT NULL,
      display_name TEXT,
      role         TEXT DEFAULT 'user',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Upsert default statuses and always sync sort_order
  for (const s of DEFAULT_STATUSES) {
    await pool.query(
      `INSERT INTO statuses (key,label,color,grp,terminal,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (key) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
      [s.key, s.label, s.color, s.grp, s.terminal, s.sort_order]
    );
  }

  // ล้าง status เคสที่ยังไม่ยืนยัน (migration สำหรับข้อมูลเก่า)
  await pool.query('UPDATE cases SET bill_status = NULL WHERE confirmed = false AND bill_status IS NOT NULL');

  // Seed default users ถ้ายังไม่มี user
  const { rows: userRows } = await pool.query('SELECT COUNT(*) AS n FROM users');
  if (parseInt(userRows[0].n) === 0) {
    const seedUsers = [
      ['admin',      'admin1234',      'ผู้ดูแลระบบ', 'admin'],
      ['standard',   'standard1234',   'Standard',    'user'],
      ['clearclaim', 'clearclaim1234', 'Clear Claim',  'user'],
    ];
    for (const [u, p, d, r] of seedUsers) {
      await pool.query(
        `INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4)`,
        [u, p, d, r]
      );
    }
  }
};

// ───── Cases ────────────────────────────────────────────────────
const getAllCases = async () => {
  const [casesRes, eventsRes] = await Promise.all([
    pool.query('SELECT * FROM cases ORDER BY created_at DESC'),
    pool.query('SELECT * FROM events ORDER BY at ASC'),
  ]);
  const evMap = {};
  eventsRes.rows.forEach(e => {
    if (!evMap[e.case_id]) evMap[e.case_id] = [];
    evMap[e.case_id].push({ at: new Date(e.at), text: e.text, type: e.type, by: e.by });
  });
  return casesRes.rows.map(row => ({
    id:               row.id,
    receiptNo:        row.receipt_no,
    docDate:          row.doc_date,
    damageType:       row.damage_type,
    billNo:           row.bill_no,
    billDate:         row.bill_date,
    customerType:     row.customer_type,
    billType:         row.bill_type,
    sender:           row.sender,
    receiver:         row.receiver,
    productType:      row.product_type,
    loadPoint:        row.load_point,
    unloadPoint:      row.unload_point,
    billStatus:       row.bill_status,
    confirmed:        !!row.confirmed,
    owner:            row.owner   || '—',
    ownerCC:          row.owner_cc || '—',
    claimAmount:      row.claim_amount != null ? row.claim_amount : null,
    faultDC:          row.fault_dc || '',
    considerCoResult: row.consider_co_result || null,
    note:             row.note || '',
    attachments:      row.attachments || 0,
    events:           evMap[row.id] || [],
  }));
};

const EXCEL_STATUS_MAP = {
  'ได้รับเอกสารแล้ว':              'received',
  'อยู่ระหว่างขอรายชื่อผู้รับผิดชอบ': 'find_owner',
  'ส่งเอกสารให้ผู้รับผิดชอบ':        'sent_owner',
  'อยู่ระหว่างขอหลักฐานใหม่':        'new_proof',
  'อยู่ระหว่างยืนยันราคาเคลม':       'confirm_price',
  'ขอพิจารณาลงบริษัท':              'consider_co',
  'ปิดจบไม่เคลม':                   'closed',
  'CPF':                            'CPF',
  'เคสทุจริต':                       'fraud',
};

const importCases = async (rows) => {
  let added = 0, skipped = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const confirmed = r.confirmedText === 'ยืนยันรับ';
      const status    = confirmed ? (EXCEL_STATUS_MAP[r.excelStatus] || null) : null;
      const owner     = (r.owner   && r.owner   !== '—') ? r.owner   : '—';
      const ownerCC   = (r.ownerCC && r.ownerCC !== '—') ? r.ownerCC : '—';
      const faultDC   = r.faultDC || '';

      const claimAmt = (r.claimAmount != null && !isNaN(r.claimAmount) && r.claimAmount > 0)
        ? r.claimAmount : null;

      const res = await client.query(
        `INSERT INTO cases
           (id,receipt_no,doc_date,damage_type,bill_no,bill_date,customer_type,bill_type,
            sender,receiver,product_type,load_point,unload_point,
            bill_status,confirmed,owner,owner_cc,fault_dc,claim_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (receipt_no) DO UPDATE SET
           doc_date     = EXCLUDED.doc_date,
           damage_type  = EXCLUDED.damage_type,
           bill_no      = EXCLUDED.bill_no,
           bill_date    = EXCLUDED.bill_date,
           customer_type= EXCLUDED.customer_type,
           bill_type    = EXCLUDED.bill_type,
           sender       = EXCLUDED.sender,
           receiver     = EXCLUDED.receiver,
           product_type = EXCLUDED.product_type,
           load_point   = EXCLUDED.load_point,
           unload_point = EXCLUDED.unload_point,
           fault_dc     = EXCLUDED.fault_dc,
           claim_amount = EXCLUDED.claim_amount`,
        [r.receiptNo, r.receiptNo, r.docDate, r.damageType, r.billNo, r.billDate,
         r.customerType, r.billType, r.sender, r.receiver, r.productType, r.loadPoint, r.unloadPoint,
         status, confirmed, owner, ownerCC, faultDC, claimAmt]
      );
      if (res.rowCount > 0) {
        await client.query(
          `INSERT INTO events (case_id,at,text,type,by) VALUES ($1,$2,$3,$4,$5)`,
          [r.receiptNo, new Date().toISOString(), 'นำเข้าข้อมูลจากไฟล์ Excel', 'import', 'ระบบอัตโนมัติ']
        );
        added++;
      } else skipped++;
    }
    // ล้าง status เคสที่ยังไม่ยืนยัน — ไม่ควรมีสถานะ
    await client.query('UPDATE cases SET bill_status = NULL WHERE confirmed = false');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { added, skipped };
};

const updateCase = async (id, patch) => {
  const map = {
    billStatus:       'bill_status',
    confirmed:        'confirmed',
    owner:            'owner',
    ownerCC:          'owner_cc',
    claimAmount:      'claim_amount',
    faultDC:          'fault_dc',
    considerCoResult: 'consider_co_result',
    note:             'note',
    attachments:      'attachments',
  };
  const cols = Object.keys(patch).filter(k => map[k]);
  if (!cols.length) return;
  const sets = cols.map((k, i) => `${map[k]}=$${i + 1}`).join(',');
  const vals = cols.map(k => patch[k]);
  await pool.query(`UPDATE cases SET ${sets} WHERE id=$${cols.length + 1}`, [...vals, id]);
};

const addEvent = async (caseId, ev) => {
  await pool.query(
    `INSERT INTO events (case_id,at,text,type,by) VALUES ($1,$2,$3,$4,$5)`,
    [caseId, new Date(ev.at || Date.now()).toISOString(), ev.text || '', ev.type || 'status', ev.by || 'ระบบ']
  );
};

// ───── Statuses ─────────────────────────────────────────────────
const getAllStatuses = async () => {
  const { rows } = await pool.query('SELECT * FROM statuses ORDER BY sort_order ASC');
  return rows.map(r => ({ key: r.key, label: r.label, color: r.color, group: r.grp, terminal: !!r.terminal }));
};

const addStatus = async ({ label, color }) => {
  const key = 'custom_' + Date.now().toString(36);
  await pool.query(
    `INSERT INTO statuses (key,label,color,grp,sort_order) VALUES ($1,$2,$3,$4,$5)`,
    [key, label, color, 'กำหนดเอง', 900 + (Date.now() % 1000)]
  );
  return { key, label, color, group: 'กำหนดเอง', terminal: false };
};

const deleteStatus = async (key) => {
  const { rows } = await pool.query('SELECT grp FROM statuses WHERE key=$1', [key]);
  if (!rows[0] || rows[0].grp !== 'กำหนดเอง') throw new Error('ลบได้เฉพาะสถานะในกลุ่ม "กำหนดเอง" เท่านั้น');
  await pool.query('DELETE FROM statuses WHERE key=$1', [key]);
};

// ───── Backup / Restore ─────────────────────────────────────────
const restoreAll = async (cases, statuses) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM events');
    await client.query('DELETE FROM cases');
    await client.query(`DELETE FROM statuses WHERE grp='กำหนดเอง'`);

    for (const c of (cases || [])) {
      await client.query(
        `INSERT INTO cases
           (id,receipt_no,doc_date,damage_type,bill_no,bill_date,customer_type,bill_type,
            sender,receiver,product_type,load_point,unload_point,bill_status,confirmed,
            owner,owner_cc,claim_amount,fault_dc,consider_co_result,note,attachments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         ON CONFLICT (id) DO UPDATE SET
           bill_status=EXCLUDED.bill_status, confirmed=EXCLUDED.confirmed,
           owner=EXCLUDED.owner, owner_cc=EXCLUDED.owner_cc,
           claim_amount=EXCLUDED.claim_amount, fault_dc=EXCLUDED.fault_dc,
           consider_co_result=EXCLUDED.consider_co_result, note=EXCLUDED.note,
           attachments=EXCLUDED.attachments`,
        [c.receiptNo, c.receiptNo, c.docDate, c.damageType, c.billNo, c.billDate,
         c.customerType, c.billType, c.sender, c.receiver, c.productType,
         c.loadPoint, c.unloadPoint, c.billStatus, c.confirmed ? true : false,
         c.owner || '—', c.ownerCC || '—',
         c.claimAmount != null ? c.claimAmount : null,
         c.faultDC || '', c.considerCoResult || null, c.note || '', c.attachments || 0]
      );
      for (const e of (c.events || [])) {
        await client.query(
          `INSERT INTO events (case_id,at,text,type,by) VALUES ($1,$2,$3,$4,$5)`,
          [c.receiptNo, new Date(e.at).toISOString(), e.text, e.type, e.by]
        );
      }
    }

    for (const s of (statuses || []).filter(s => s.group === 'กำหนดเอง')) {
      await client.query(
        `INSERT INTO statuses (key,label,color,grp,terminal,sort_order) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [s.key, s.label, s.color, 'กำหนดเอง', false, 900]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

// ───── Users / Auth ─────────────────────────────────────────────
const loginUser = async (username, password) => {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE username = $1 AND password = $2',
    [username, password]
  );
  if (!rows[0]) return null;
  const u = rows[0];
  return { id: u.id, username: u.username, displayName: u.display_name, role: u.role };
};

const getAllUsers = async () => {
  const { rows } = await pool.query('SELECT id, username, display_name, role, created_at FROM users ORDER BY id ASC');
  return rows.map(u => ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, createdAt: u.created_at }));
};

const addUser = async ({ username, password, displayName, role = 'user' }) => {
  const { rows } = await pool.query(
    'INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [username, password, displayName || username, role]
  );
  return { id: rows[0].id, username, displayName: displayName || username, role };
};

const updateUser = async (id, patch) => {
  const fields = [], vals = [];
  if (patch.password    !== undefined) { fields.push(`password=$${fields.length+1}`);     vals.push(patch.password); }
  if (patch.displayName !== undefined) { fields.push(`display_name=$${fields.length+1}`); vals.push(patch.displayName); }
  if (patch.role        !== undefined) { fields.push(`role=$${fields.length+1}`);          vals.push(patch.role); }
  if (!fields.length) return;
  vals.push(id);
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id=$${vals.length}`, vals);
};

const deleteUser = async (id) => {
  await pool.query('DELETE FROM users WHERE id=$1', [id]);
};

module.exports = { init, getAllCases, importCases, updateCase, addEvent, getAllStatuses, addStatus, deleteStatus, restoreAll, loginUser, getAllUsers, addUser, updateUser, deleteUser, pool };
