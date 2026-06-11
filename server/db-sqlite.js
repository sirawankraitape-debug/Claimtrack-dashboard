/**
 * db-sqlite.js — SQLite database layer (better-sqlite3)
 * ใช้เมื่อไม่มี DATABASE_URL → เก็บข้อมูลใน claimtrack.db ในโฟลเดอร์เดียวกัน
 * Interface เดียวกับ db.js (PostgreSQL) ทุก function ทำงานแบบ sync แต่ return Promise ให้ compatible
 */
const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, 'claimtrack.db');
const db = new Database(DB_PATH);

// WAL mode → อ่าน/เขียนพร้อมกันได้ดีขึ้น
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ───── Default statuses (ตรงกับ HTML) ────────────────────────────
const DEFAULT_STATUSES = [
  { key:'new_proof',     label:'อยู่ระหว่างขอหลักฐานใหม่',          color:'#FB923C', grp:'ดำเนินการ',    terminal:0, sort_order:1  },
  { key:'confirm_price', label:'อยู่ระหว่างยืนยันราคาเคลม',         color:'#14B8A6', grp:'ดำเนินการ',    terminal:0, sort_order:2  },
  { key:'find_owner',    label:'อยู่ระหว่างขอรายชื่อผู้รับผิดชอบ',   color:'#F59E0B', grp:'ดำเนินการ',    terminal:0, sort_order:3  },
  { key:'sent_owner',    label:'ส่งเอกสารให้ผู้รับผิดชอบ',           color:'#8B5CF6', grp:'ดำเนินการ',    terminal:0, sort_order:4  },
  { key:'received',      label:'ได้รับเอกสารแล้ว',                   color:'#3B82F6', grp:'ดำเนินการ',    terminal:0, sort_order:5  },
  { key:'consider_co',   label:'ขอพิจารณาลงบริษัท',                 color:'#EC4899', grp:'ดำเนินการ',    terminal:0, sort_order:6  },
  { key:'CPF',           label:'CPF',                                color:'#F43F5E', grp:'ดำเนินการ',    terminal:0, sort_order:7  },
  { key:'fraud',         label:'เคสทุจริต',                          color:'#DC2626', grp:'ดำเนินการ',    terminal:1, sort_order:8  },
  { key:'closed',        label:'ปิดจบไม่เคลม',                      color:'#10B981', grp:'ดำเนินการ',    terminal:1, sort_order:9  },
  { key:'A00', label:'A00 อยู่ระหว่างการพิจารณา',                   color:'#38BDF8', grp:'สถานะเคลม',    terminal:0, sort_order:10 },
  { key:'A01', label:'A01 อยู่ระหว่างการส่งเอกสารประกอบการเคลม',    color:'#818CF8', grp:'สถานะเคลม',    terminal:0, sort_order:11 },
  { key:'A02', label:'A02 อยู่ระหว่างการตรวจสอบเอกสาร',             color:'#A78BFA', grp:'สถานะเคลม',    terminal:0, sort_order:12 },
  { key:'A03', label:'A03 อยู่ระหว่างการโอนเงิน',                   color:'#F472B6', grp:'สถานะเคลม',    terminal:0, sort_order:13 },
  { key:'A04', label:'A04 โอนเงิน',                                color:'#34D399', grp:'สถานะเคลม',    terminal:1, sort_order:14 },
  { key:'A89', label:'A89 ปิดจบ ไม่เคลม',                          color:'#94A3B8', grp:'สถานะเคลม',    terminal:1, sort_order:15 },
  { key:'B00', label:'B00 อยู่ระหว่างการประเมินผู้รับผิดชอบ',       color:'#FBBF24', grp:'สถานะเคลียร์', terminal:0, sort_order:20 },
  { key:'B01', label:'B01 อยู่ระหว่างการตอบกลับของ DC',            color:'#FB923C', grp:'สถานะเคลียร์', terminal:0, sort_order:21 },
  { key:'B02', label:'B02 อยู่ระหว่างการอนุมัติของผู้บริหาร',       color:'#F59E0B', grp:'สถานะเคลียร์', terminal:0, sort_order:22 },
  { key:'B03', label:'B03 ค้างส่งเอกสารหักเงิน',                   color:'#EF4444', grp:'สถานะเคลียร์', terminal:0, sort_order:23 },
  { key:'B04', label:'B04 เคลียร์รับเอกสาร',                       color:'#2DD4BF', grp:'สถานะเคลียร์', terminal:0, sort_order:24 },
  { key:'B05', label:'B05 บัญชีรับเอกสาร',                         color:'#22D3EE', grp:'สถานะเคลียร์', terminal:1, sort_order:25 },
];

// ───── สร้างตาราง + seed (synchronous) ──────────────────────────
const init = async () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id                TEXT PRIMARY KEY,
      receipt_no        TEXT UNIQUE NOT NULL,
      doc_date          TEXT,
      damage_type       TEXT,
      bill_no           TEXT,
      bill_date         TEXT,
      customer_type     TEXT,
      bill_type         TEXT,
      sender            TEXT,
      receiver          TEXT,
      product_type      TEXT,
      load_point        TEXT,
      unload_point      TEXT,
      bill_status       TEXT DEFAULT NULL,
      confirmed         INTEGER DEFAULT 0,
      confirm_at        TEXT,
      owner             TEXT DEFAULT '—',
      owner_cc          TEXT DEFAULT '—',
      claim_amount      REAL,
      fault_dc          TEXT DEFAULT '',
      consider_co_result TEXT,
      note              TEXT DEFAULT '',
      attachments       INTEGER DEFAULT 0,
      created_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id  TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      at       TEXT NOT NULL,
      text     TEXT,
      type     TEXT,
      by       TEXT
    );

    CREATE TABLE IF NOT EXISTS statuses (
      key        TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      color      TEXT NOT NULL,
      grp        TEXT DEFAULT 'กำหนดเอง',
      terminal   INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 999
    );
  `);

  // Seed statuses ถ้ายังไม่มี
  const count = db.prepare('SELECT COUNT(*) AS n FROM statuses').get().n;
  if (count === 0) {
    const ins = db.prepare(
      `INSERT OR IGNORE INTO statuses (key,label,color,grp,terminal,sort_order)
       VALUES (@key,@label,@color,@grp,@terminal,@sort_order)`
    );
    const seedAll = db.transaction((list) => list.forEach(s => ins.run(s)));
    seedAll(DEFAULT_STATUSES);
  }
};

// ───── Cases ────────────────────────────────────────────────────
const getAllCases = async () => {
  const cases  = db.prepare('SELECT * FROM cases ORDER BY created_at DESC').all();
  const events = db.prepare('SELECT * FROM events ORDER BY at ASC').all();

  const evMap = {};
  events.forEach(e => {
    if (!evMap[e.case_id]) evMap[e.case_id] = [];
    evMap[e.case_id].push({ at: new Date(e.at), text: e.text, type: e.type, by: e.by });
  });

  return cases.map(row => ({
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
    confirmAt:        row.confirm_at ? new Date(row.confirm_at) : null,
    owner:            row.owner    || '—',
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

  const upsert = db.prepare(`
    INSERT INTO cases
      (id,receipt_no,doc_date,damage_type,bill_no,bill_date,customer_type,bill_type,
       sender,receiver,product_type,load_point,unload_point,
       bill_status,confirmed,owner,owner_cc,fault_dc,claim_amount)
    VALUES
      (@id,@receipt_no,@doc_date,@damage_type,@bill_no,@bill_date,@customer_type,@bill_type,
       @sender,@receiver,@product_type,@load_point,@unload_point,
       @bill_status,@confirmed,@owner,@owner_cc,@fault_dc,@claim_amount)
    ON CONFLICT(receipt_no) DO UPDATE SET
      doc_date      = excluded.doc_date,
      damage_type   = excluded.damage_type,
      bill_no       = excluded.bill_no,
      bill_date     = excluded.bill_date,
      customer_type = excluded.customer_type,
      bill_type     = excluded.bill_type,
      sender        = excluded.sender,
      receiver      = excluded.receiver,
      product_type  = excluded.product_type,
      load_point    = excluded.load_point,
      unload_point  = excluded.unload_point,
      fault_dc      = excluded.fault_dc,
      claim_amount  = excluded.claim_amount
  `);

  const addEv = db.prepare(
    `INSERT INTO events (case_id,at,text,type,by) VALUES (@case_id,@at,@text,@type,@by)`
  );

  const doImport = db.transaction((list) => {
    for (const r of list) {
      const status    = EXCEL_STATUS_MAP[r.excelStatus] || null;
      const confirmed = r.confirmedText === 'ยืนยันรับ' ? 1 : 0;
      const owner     = (r.owner   && r.owner   !== '—') ? r.owner   : '—';
      const ownerCC   = (r.ownerCC && r.ownerCC !== '—') ? r.ownerCC : '—';
      const claimAmt  = (r.claimAmount != null && !isNaN(r.claimAmount) && r.claimAmount > 0)
                        ? r.claimAmount : null;

      const info = upsert.run({
        id: r.receiptNo, receipt_no: r.receiptNo, doc_date: r.docDate,
        damage_type: r.damageType, bill_no: r.billNo, bill_date: r.billDate,
        customer_type: r.customerType, bill_type: r.billType,
        sender: r.sender, receiver: r.receiver, product_type: r.productType,
        load_point: r.loadPoint, unload_point: r.unloadPoint,
        bill_status: status, confirmed,
        owner, owner_cc: ownerCC, fault_dc: r.faultDC || '', claim_amount: claimAmt,
      });

      if (info.changes > 0) {
        addEv.run({
          case_id: r.receiptNo, at: new Date().toISOString(),
          text: 'นำเข้าข้อมูลจากไฟล์ Excel', type: 'import', by: 'ระบบอัตโนมัติ',
        });
        added++;
      } else skipped++;
    }
  });

  doImport(rows);
  return { added, skipped };
};

const PATCH_MAP = {
  billStatus:       'bill_status',
  confirmed:        'confirmed',
  confirmAt:        'confirm_at',
  owner:            'owner',
  ownerCC:          'owner_cc',
  claimAmount:      'claim_amount',
  faultDC:          'fault_dc',
  considerCoResult: 'consider_co_result',
  note:             'note',
  attachments:      'attachments',
};

const updateCase = async (id, patch) => {
  const cols = Object.keys(patch).filter(k => PATCH_MAP[k]);
  if (!cols.length) return;
  const sets = cols.map(k => `${PATCH_MAP[k]}=@${k}`).join(',');
  const params = { id };
  cols.forEach(k => { params[k] = patch[k] instanceof Date ? patch[k].toISOString() : patch[k]; });
  // confirmed ต้องเป็น 0/1 ใน SQLite
  if (params.confirmed !== undefined) params.confirmed = params.confirmed ? 1 : 0;
  db.prepare(`UPDATE cases SET ${sets} WHERE id=@id`).run(params);
};

const addEvent = async (caseId, ev) => {
  db.prepare(`INSERT INTO events (case_id,at,text,type,by) VALUES (?,?,?,?,?)`)
    .run(caseId, new Date(ev.at || Date.now()).toISOString(), ev.text || '', ev.type || 'status', ev.by || 'ระบบ');
};

// ───── Statuses ─────────────────────────────────────────────────
const getAllStatuses = async () => {
  return db.prepare('SELECT * FROM statuses ORDER BY sort_order ASC').all()
    .map(r => ({ key: r.key, label: r.label, color: r.color, group: r.grp, terminal: !!r.terminal }));
};

const addStatus = async ({ label, color }) => {
  const key = 'custom_' + Date.now().toString(36);
  db.prepare(`INSERT INTO statuses (key,label,color,grp,sort_order) VALUES (?,?,?,?,?)`)
    .run(key, label, color, 'กำหนดเอง', 900 + (Date.now() % 1000));
  return { key, label, color, group: 'กำหนดเอง', terminal: false };
};

const deleteStatus = async (key) => {
  const row = db.prepare('SELECT grp FROM statuses WHERE key=?').get(key);
  if (!row || row.grp !== 'กำหนดเอง') throw new Error('ลบได้เฉพาะสถานะในกลุ่ม "กำหนดเอง" เท่านั้น');
  db.prepare('DELETE FROM statuses WHERE key=?').run(key);
};

// ───── Backup / Restore ─────────────────────────────────────────
const restoreAll = async (cases, statuses) => {
  const doRestore = db.transaction(() => {
    db.prepare('DELETE FROM events').run();
    db.prepare('DELETE FROM cases').run();
    db.prepare(`DELETE FROM statuses WHERE grp='กำหนดเอง'`).run();

    const insCase = db.prepare(`
      INSERT OR REPLACE INTO cases
        (id,receipt_no,doc_date,damage_type,bill_no,bill_date,customer_type,bill_type,
         sender,receiver,product_type,load_point,unload_point,bill_status,confirmed,confirm_at,
         owner,owner_cc,claim_amount,fault_dc,consider_co_result,note,attachments)
      VALUES
        (@id,@receipt_no,@doc_date,@damage_type,@bill_no,@bill_date,@customer_type,@bill_type,
         @sender,@receiver,@product_type,@load_point,@unload_point,@bill_status,@confirmed,@confirm_at,
         @owner,@owner_cc,@claim_amount,@fault_dc,@consider_co_result,@note,@attachments)
    `);
    const insEv = db.prepare(
      `INSERT INTO events (case_id,at,text,type,by) VALUES (@case_id,@at,@text,@type,@by)`
    );
    const insSt = db.prepare(
      `INSERT OR IGNORE INTO statuses (key,label,color,grp,terminal,sort_order) VALUES (@key,@label,@color,@grp,@terminal,@sort_order)`
    );

    for (const c of (cases || [])) {
      insCase.run({
        id: c.receiptNo || c.id,
        receipt_no: c.receiptNo || c.id,
        doc_date: c.docDate, damage_type: c.damageType,
        bill_no: c.billNo, bill_date: c.billDate,
        customer_type: c.customerType, bill_type: c.billType,
        sender: c.sender, receiver: c.receiver,
        product_type: c.productType, load_point: c.loadPoint, unload_point: c.unloadPoint,
        bill_status: c.billStatus, confirmed: c.confirmed ? 1 : 0,
        confirm_at: c.confirmAt ? new Date(c.confirmAt).toISOString() : null,
        owner: c.owner || '—', owner_cc: c.ownerCC || '—',
        claim_amount: c.claimAmount != null ? c.claimAmount : null,
        fault_dc: c.faultDC || '', consider_co_result: c.considerCoResult || null,
        note: c.note || '', attachments: c.attachments || 0,
      });
      for (const e of (c.events || [])) {
        insEv.run({
          case_id: c.receiptNo || c.id,
          at: new Date(e.at).toISOString(), text: e.text || '', type: e.type || '', by: e.by || '',
        });
      }
    }

    for (const s of (statuses || []).filter(s => s.group === 'กำหนดเอง')) {
      insSt.run({ key: s.key, label: s.label, color: s.color, grp: 'กำหนดเอง', terminal: 0, sort_order: 900 });
    }
  });

  doRestore();
};

module.exports = { init, getAllCases, importCases, updateCase, addEvent, getAllStatuses, addStatus, deleteStatus, restoreAll };
