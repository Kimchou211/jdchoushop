// ════════════════════════════════════════════════════════════
//  server.js  —  NyKa Shop  Complete Backend  v4.0
//  MySQL · JWT Auth · Bakong KHQR · Telegram · Products DB
// ════════════════════════════════════════════════════════════
const express = require('express');
const mysql   = require('mysql2/promise');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const QRCode  = require('qrcode');
const crypto  = require('crypto');
require('dotenv').config();

const app = express();

// ─── CONFIG ──────────────────────────────────────────────────
const BAKONG = {
  token   : process.env.BAKONG_TOKEN || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7ImlkIjoiOGEwZDkzMTc2ZTA2NDNhYiJ9LCJpYXQiOjE3NzI2MjUxNDUsImV4cCI6MTc4MDQwMTE0NX0.FLX6f1nhQfgqXnDaTuBvpHaXu-bZHgopGXH7b33740k",
  account : process.env.BAKONG_ACCOUNT || "kimchou_kren@bkrt",
  merchant: process.env.BAKONG_MERCHANT || "NyKa_Shop",
  city    : process.env.BAKONG_CITY || "Kampong Chhnang",
  country : "KH"
};
const TG = {
  token  : process.env.TG_TOKEN || "8504509149:AAGLc8ZLaV9ZI1CWGx1V-PRQjMNY88ubm2g",
  chat_id: process.env.TG_CHAT_ID || "8061490786",
  contact: process.env.TG_CONTACT || "https://t.me/krenkimchou"
};
const JWT_SECRET = process.env.JWT_SECRET || 'nyka_shop_2025_secret';
const PORT       = process.env.PORT       || 5000;

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE','OPTIONS','PATCH'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.options('/{*path}', cors()); // pre-flight
// Increase limit for base64 images
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── DATABASE ─────────────────────────────────────────────────
let db;
async function initDB() {
  try {
    db = await mysql.createPool({
      host             : process.env.DB_HOST || 'localhost',
      port             : process.env.DB_PORT || 3306,
      user             : process.env.DB_USER || 'root',
      password         : process.env.DB_PASS || '',
      database         : process.env.DB_NAME || 'nyka_shop',
      charset          : 'utf8mb4',
      waitForConnections: true,
      connectionLimit  : 10
    });
    // Test connection
    await db.execute('SELECT 1');
    console.log('✅ MySQL connected');
    await createTables();
    await seedAdmin();
    console.log('✅ Database ready');
  } catch(e) {
    console.error('❌ DB error:', e.message);
    console.log('⚠️  Server running without DB');
    db = null;
  }
}

async function createTables() {
  // Users table
  await db.execute(`CREATE TABLE IF NOT EXISTS users (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(120) NOT NULL,
    email      VARCHAR(160) UNIQUE NOT NULL,
    phone      VARCHAR(30)  DEFAULT '',
    address    TEXT         DEFAULT '',
    password   VARCHAR(255) NOT NULL,
    role       ENUM('user','admin') DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  // Products table — images stored as LONGTEXT (base64 JSON array)
  await db.execute(`CREATE TABLE IF NOT EXISTS products (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(220) NOT NULL,
    brand       VARCHAR(80)  DEFAULT '',
    description LONGTEXT     DEFAULT NULL,
    price       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    old_price   DECIMAL(10,2) DEFAULT NULL,
    icon        VARCHAR(30)  DEFAULT '🌸',
    category    VARCHAR(50)  DEFAULT '',
    badge       VARCHAR(20)  DEFAULT '',
    specs       LONGTEXT     DEFAULT NULL COMMENT 'JSON array of spec strings',
    images      LONGTEXT     DEFAULT NULL COMMENT 'JSON array of base64 or URL strings',
    rating      DECIMAL(3,1) DEFAULT 4.5,
    reviews     INT          DEFAULT 0,
    stock       INT          DEFAULT 100,
    active      TINYINT(1)   DEFAULT 1,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  // Orders table
  await db.execute(`CREATE TABLE IF NOT EXISTS orders (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    order_number   VARCHAR(60) UNIQUE NOT NULL,
    user_id        INT  DEFAULT NULL,
    user_name      VARCHAR(120) DEFAULT '',
    user_email     VARCHAR(160) DEFAULT '',
    user_phone     VARCHAR(30)  DEFAULT '',
    total_amount   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    currency       VARCHAR(5)  DEFAULT 'USD',
    status         ENUM('pending','paid','cancelled','refunded','delivered') DEFAULT 'pending',
    delivery_status VARCHAR(30) DEFAULT NULL,
    payment_method VARCHAR(30) DEFAULT 'bakong',
    bill_number    VARCHAR(60) DEFAULT '',
    khqr_string    TEXT,
    telegram_sent  TINYINT(1) DEFAULT 0,
    notes          TEXT DEFAULT '',
    paid_at        TIMESTAMP NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  // Order items table
  await db.execute(`CREATE TABLE IF NOT EXISTS order_items (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    order_id     INT NOT NULL,
    product_id   INT DEFAULT NULL,
    product_name VARCHAR(220) NOT NULL,
    product_icon VARCHAR(30)  DEFAULT '',
    price        DECIMAL(10,2) NOT NULL,
    quantity     INT NOT NULL DEFAULT 1,
    subtotal     DECIMAL(10,2) NOT NULL,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  // Payment logs
  await db.execute(`CREATE TABLE IF NOT EXISTS payment_logs (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    bill_number     VARCHAR(60) NOT NULL,
    order_id        INT DEFAULT NULL,
    action          VARCHAR(50) DEFAULT '',
    bakong_code     INT DEFAULT NULL,
    bakong_message  VARCHAR(255) DEFAULT '',
    md5_hash        VARCHAR(64) DEFAULT '',
    raw_response    TEXT DEFAULT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
}

async function seedAdmin() {
  if (!db) return;
  const [rows] = await db.execute("SELECT id FROM users WHERE email='admin@nyka.shop'");
  if (!rows.length) {
    const hash = await bcrypt.hash('admin123', 10);
    await db.execute(
      "INSERT INTO users (name,email,password,role) VALUES ('Admin NyKa','admin@nyka.shop',?,'admin')",
      [hash]
    );
    console.log('✅ Admin seeded: admin@nyka.shop / admin123');
  }
}

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────
function auth(req, res, next) {
  const t = req.headers['authorization']?.split(' ')[1];
  if (!t) return res.status(401).json({ success: false, message: 'No token' });
  try {
    req.user = jwt.verify(t, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ success: false, message: 'Invalid token' });
  }
}

function adminAuth(req, res, next) {
  const t = req.headers['authorization']?.split(' ')[1];
  if (!t) return res.status(401).json({ success: false, message: 'No token' });
  try {
    const user = jwt.verify(t, JWT_SECRET);
    if (user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin only' });
    req.user = user;
    next();
  } catch {
    res.status(403).json({ success: false, message: 'Invalid token' });
  }
}

// ─── KHQR BUILDER ─────────────────────────────────────────────
function crc16(s) {
  let c = 0xFFFF;
  for (let i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) c = (c & 0x8000) ? ((c<<1)^0x1021)&0xFFFF : (c<<1)&0xFFFF;
  }
  return c.toString(16).toUpperCase().padStart(4,'0');
}
function tlv(tag, val) { return `${tag}${String(val.length).padStart(2,'0')}${val}`; }
function buildKHQR({ amount, bill, currency='USD' }) {
  const isKHR = currency === 'KHR';
  const amt   = isKHR ? String(Math.round(+amount)) : (+amount).toFixed(2);
  const tag29 = tlv('00', BAKONG.account);
  const tag62 = tlv('01', bill.substring(0,20)) + tlv('07','nyka');
  let p = tlv('00','01') + tlv('01','12') + tlv('29',tag29)
        + tlv('52','5999') + tlv('58',BAKONG.country)
        + tlv('59',BAKONG.merchant) + tlv('60',BAKONG.city)
        + tlv('54',amt) + tlv('53', isKHR?'116':'840')
        + tlv('62',tag62) + '6304';
  return p + crc16(p);
}

// ─── TELEGRAM ─────────────────────────────────────────────────
async function tgSend(text) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG.chat_id, text, parse_mode: 'HTML' })
    });
    const d = await r.json();
    if (d.ok) console.log('📨 Telegram sent');
    else console.error('❌ Telegram:', d.description);
    return d.ok;
  } catch(e) { console.error('❌ Telegram error:', e.message); return false; }
}

function tgMsg(o) {
  const bar   = '━━━━━━━━━━━━━━━━━━━━━━';
  const items = (o.items||[]).map(i =>
    `  • ${i.icon||''} <b>${i.name}</b>  ×${i.qty||1}  →  <b>$${((+i.price)*(i.qty||1)).toFixed(2)}</b>`
  ).join('\n') || '  (គ្មានទំនិញ)';
  return `🛍 <b>ការបញ្ជាទិញថ្មី — NyKa Shop</b>
${bar}
📋 <b>Bill:</b> <code>${o.bill}</code>
👤 <b>អតិថិជន:</b> ${o.name||'Guest'}
📧 <b>Email:</b> ${o.email||'—'}
${bar}
🛒 <b>ទំនិញ:</b>
${items}
${bar}
💰 <b>សរុប: $${(+o.total).toFixed(2)}</b>
💳 <b>Bakong KHQR ✅</b>
🕐 ${new Date().toLocaleString('km-KH')}
${bar}
📲 <a href="${TG.contact}">ទំនាក់ទំនង Admin</a>`;
}

// ─── INVOICE HTML ─────────────────────────────────────────────
function invoice(o) {
  const rows = (o.items||[]).map(i=>`
    <tr>
      <td>${i.icon||''} ${i.name}</td>
      <td style="text-align:center;font-family:monospace">${i.qty||1}</td>
      <td style="text-align:right;font-family:monospace">$${(+i.price).toFixed(2)}</td>
      <td style="text-align:right;font-family:monospace"><b>$${((+i.price)*(i.qty||1)).toFixed(2)}</b></td>
    </tr>`).join('');
  return `<!DOCTYPE html><html lang="km">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${o.bill}</title>
<link href="https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
@media print{.noprint{display:none!important}body{background:#fff}.wrap{box-shadow:none}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f5f0ec;font-family:'Kantumruy Pro',sans-serif;color:#1a0a0f;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.wrap{background:#fff;border-radius:20px;max-width:560px;width:100%;overflow:hidden;box-shadow:0 20px 60px rgba(180,80,100,.15)}
.top{background:linear-gradient(135deg,#e11d48,#fb7185);padding:28px 32px;color:#fff}
.logo{font-size:1.4rem;font-weight:700;letter-spacing:-.02em}
.logo-sub{font-size:.7rem;opacity:.75;margin-top:2px;font-family:'JetBrains Mono',monospace;letter-spacing:.1em}
.paid-pill{display:inline-flex;align-items:center;gap:6px;margin-top:14px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);border-radius:100px;padding:5px 14px;font-size:.72rem;font-family:'JetBrains Mono',monospace}
.body{padding:28px 32px}
.metas{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:22px}
.meta{background:#fff5f7;border:1px solid #fce7ef;border-radius:10px;padding:12px}
.ml{font-size:.58rem;color:#b89ca2;font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px}
.mv{font-size:.8rem;font-weight:600;color:#e11d48;word-break:break-all}
.mv.dark{color:#1a0a0f}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
th{font-size:.6rem;color:#b89ca2;font-family:'JetBrains Mono',monospace;text-align:left;padding:6px 0;border-bottom:1px solid #f0e8e8;letter-spacing:.06em}
td{padding:10px 0;border-bottom:1px solid #fce7ef;font-size:.82rem}
.totbox{background:linear-gradient(135deg,#fff1f5,#fce7f3);border:1px solid #fecdd3;border-radius:12px;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.tl{font-size:.85rem;font-weight:600;color:#7c5c65}
.tv{font-family:'JetBrains Mono',monospace;font-size:1.6rem;font-weight:700;color:#e11d48}
.printbtn{display:block;width:100%;padding:13px;border:none;border-radius:10px;background:linear-gradient(135deg,#e11d48,#fb7185);color:#fff;font-family:'Kantumruy Pro',sans-serif;font-weight:700;font-size:.9rem;cursor:pointer}
.foot{background:#fff5f7;border-top:1px solid #fce7ef;padding:16px 32px;text-align:center;font-size:.72rem;color:#b89ca2;line-height:1.9}
.foot a{color:#e11d48;text-decoration:none;font-weight:600}
</style></head><body>
<div class="wrap">
  <div class="top">
    <div class="logo">🌸 NyKa Shop</div>
    <div class="logo-sub">វិក្កយបត្រ / Official Invoice</div>
    <div class="paid-pill">✅ Bakong KHQR — បានបង់ប្រាក់</div>
  </div>
  <div class="body">
    <div class="metas">
      <div class="meta"><div class="ml">លេខវិក្កយបត្រ</div><div class="mv">${o.bill}</div></div>
      <div class="meta"><div class="ml">ថ្ងៃម៉ោង</div><div class="mv" style="font-size:.65rem;color:#7c5c65">${new Date().toLocaleString('km-KH')}</div></div>
      <div class="meta"><div class="ml">អតិថិជន</div><div class="mv dark">${o.name||'Guest'}</div></div>
      <div class="meta"><div class="ml">Email</div><div class="mv" style="font-size:.65rem;color:#7c5c65">${o.email||'—'}</div></div>
    </div>
    <table>
      <thead><tr><th>ទំនិញ</th><th style="text-align:center">ចំ.</th><th style="text-align:right">តម្លៃ</th><th style="text-align:right">សរុប</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totbox"><span class="tl">💰 សរុបទឹកប្រាក់</span><span class="tv">$${(+o.total).toFixed(2)}</span></div>
    <button class="printbtn noprint" onclick="window.print()">🖨️ Print / Save PDF</button>
  </div>
  <div class="foot">
    🎉 សូមអរគុណ! NyKa Shop ដឹងគុណចំពោះការទុកចិត្ត<br>
    <a href="${TG.contact}" target="_blank">✈️ Telegram Admin</a><br>
    📍 ភ្នំពេញ, កម្ពុជា
  </div>
</div></body></html>`;
}

// ─── IN-MEMORY STORE (payment sessions) ───────────────────────
const store = {};

// ═══════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════

// Health check
app.get('/api/test', (_, res) =>
  res.json({ ok: true, db: !!db, bakong: BAKONG.account, time: new Date().toISOString() })
);

// ══════════════════════════════════════════
//  PRODUCTS — PUBLIC
// ══════════════════════════════════════════

// GET all active products
app.get('/api/products', async (req, res) => {
  if (!db) return res.json({ success: true, products: [] });
  try {
    const { category, search } = req.query;
    let sql = 'SELECT id,name,brand,description,price,old_price,icon,category,badge,specs,images,rating,reviews,stock,created_at FROM products WHERE active=1';
    const params = [];
    if (category && category !== 'all') { sql += ' AND category=?'; params.push(category); }
    if (search) { sql += ' AND (name LIKE ? OR brand LIKE ? OR description LIKE ?)'; const s = `%${search}%`; params.push(s,s,s); }
    sql += ' ORDER BY id DESC';
    const [rows] = await db.execute(sql, params);
    const products = rows.map(p => ({
      ...p,
      specs : p.specs  ? safeJSON(p.specs,  []) : [],
      images: p.images ? safeJSON(p.images, []) : [],
    }));
    res.json({ success: true, products });
  } catch(e) { console.error(e); res.json({ success: true, products: [] }); }
});

// GET single product
app.get('/api/products/:id', async (req, res) => {
  if (!db) return res.status(404).json({ success: false });
  try {
    const [rows] = await db.execute('SELECT * FROM products WHERE id=? AND active=1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const p = rows[0];
    p.specs  = safeJSON(p.specs,  []);
    p.images = safeJSON(p.images, []);
    res.json({ success: true, product: p });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ══════════════════════════════════════════
//  PRODUCTS — ADMIN (requires admin role)
// ══════════════════════════════════════════

// POST create product
app.post('/api/products', adminAuth, async (req, res) => {
  if (!db) return res.status(503).json({ success: false, message: 'DB not connected' });
  try {
    const {
      name, brand='', description='', price, old_price=null,
      icon='🌸', category='', badge='', specs=[], images=[],
      rating=4.5, reviews=0, stock=100
    } = req.body;
    if (!name || !price) return res.status(400).json({ success: false, message: 'name & price required' });
    const [r] = await db.execute(
      `INSERT INTO products (name,brand,description,price,old_price,icon,category,badge,specs,images,rating,reviews,stock,active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [name, brand, description||'', +price, old_price||null, icon||'🌸', category, badge||'',
       JSON.stringify(specs), JSON.stringify(images), +rating||4.5, +reviews||0, +stock||100]
    );
    console.log(`✅ Product created: ${name} (id=${r.insertId})`);
    res.status(201).json({ success: true, id: r.insertId, message: 'Product created' });
  } catch(e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

// PUT update product
app.put('/api/products/:id', adminAuth, async (req, res) => {
  if (!db) return res.status(503).json({ success: false, message: 'DB not connected' });
  try {
    const {
      name, brand='', description='', price, old_price=null,
      icon='🌸', category='', badge='', specs=[], images=[],
      rating=4.5, stock=100
    } = req.body;
    if (!name || !price) return res.status(400).json({ success: false, message: 'name & price required' });
    await db.execute(
      `UPDATE products SET name=?,brand=?,description=?,price=?,old_price=?,icon=?,category=?,badge=?,specs=?,images=?,rating=?,stock=?,updated_at=NOW() WHERE id=?`,
      [name, brand, description||'', +price, old_price||null, icon||'🌸', category, badge||'',
       JSON.stringify(specs), JSON.stringify(images), +rating||4.5, +stock||100, req.params.id]
    );
    console.log(`✅ Product updated: id=${req.params.id}`);
    res.json({ success: true, message: 'Product updated' });
  } catch(e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

// DELETE product (soft delete)
app.delete('/api/products/:id', adminAuth, async (req, res) => {
  if (!db) return res.status(503).json({ success: false, message: 'DB not connected' });
  try {
    await db.execute('UPDATE products SET active=0 WHERE id=?', [req.params.id]);
    console.log(`🗑️ Product deleted: id=${req.params.id}`);
    res.json({ success: true, message: 'Product deleted' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ══════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, phone='', address='', password } = req.body;
    if (!name||!email||!password)
      return res.status(400).json({ success: false, message: 'សូមបំពេញ ឈ្មោះ, អ៊ីមែល, លេខសំងាត់' });
    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'លេខសំងាត់ minimum ៦ characters' });
    if (!db) return res.status(503).json({ success: false, message: 'DB not connected' });

    const [ex] = await db.execute('SELECT id FROM users WHERE email=?', [email]);
    if (ex.length) return res.status(400).json({ success: false, message: 'អ៊ីមែលនេះបានចុះឈ្មោះរួចហើយ' });
    const hash = await bcrypt.hash(password, 10);
    const [r]  = await db.execute(
      'INSERT INTO users (name,email,phone,address,password,role) VALUES (?,?,?,?,?,?)',
      [name, email, phone, address, hash, 'user']
    );
    const token = jwt.sign({ id: r.insertId, email, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, message: 'ចុះឈ្មោះជោគជ័យ',
      user: { id: r.insertId, name, email, phone, address, role: 'user' }, token });
  } catch(e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password)
      return res.status(400).json({ success: false, message: 'សូមបំពេញ អ៊ីមែល និង លេខសំងាត់' });
    if (!db) return res.status(503).json({ success: false, message: 'DB not connected' });

    const [rows] = await db.execute('SELECT * FROM users WHERE email=?', [email]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password)))
      return res.status(400).json({ success: false, message: 'អ៊ីមែល ឬ លេខសំងាត់មិនត្រូវ' });
    const u = rows[0];
    const token = jwt.sign({ id: u.id, email: u.email, role: u.role }, JWT_SECRET, { expiresIn: '7d' });
    delete u.password;
    res.json({ success: true, message: 'ចូលគណនីជោគជ័យ', user: u, token });
  } catch(e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/user', auth, async (req, res) => {
  if (!db) return res.json({ success: true, user: { id: req.user.id, email: req.user.email } });
  const [rows] = await db.execute(
    'SELECT id,name,email,phone,address,role,created_at FROM users WHERE id=?', [req.user.id]
  );
  if (rows.length) return res.json({ success: true, user: rows[0] });
  res.status(404).json({ success: false });
});

// ── UPDATE USER PROFILE ──────────────────────────────
app.put('/api/user/update', auth, async (req, res) => {
  try {
    const { name, phone, address, password } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name required' });
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await db.execute(
        'UPDATE users SET name=?, phone=?, address=?, password=? WHERE id=?',
        [name, phone||'', address||'', hash, req.user.id]
      );
    } else {
      await db.execute(
        'UPDATE users SET name=?, phone=?, address=? WHERE id=?',
        [name, phone||'', address||'', req.user.id]
      );
    }
    const [rows] = await db.execute(
      'SELECT id,name,email,phone,address,role,created_at FROM users WHERE id=?', [req.user.id]
    );
    res.json({ success: true, user: rows[0] });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ══════════════════════════════════════════
//  CHECKOUT & PAYMENT
// ══════════════════════════════════════════

app.post('/api/bakong/checkout', async (req, res) => {
  try {
    const { amount, currency='USD', orderId, userId, userName, userEmail, userPhone='', items=[], notes='' } = req.body;
    if (!amount || isNaN(amount) || +amount <= 0)
      return res.status(400).json({ success: false, message: 'Invalid amount' });

    const bill  = (orderId || ('INV-'+Date.now())).substring(0,25);
    const khqr  = buildKHQR({ amount: +amount, bill, currency });
    const qrImg = await QRCode.toDataURL(khqr, { errorCorrectionLevel:'M', margin:2, width:300 });

    let dbId = null;
    if (db) {
      try {
        const [r] = await db.execute(
          `INSERT INTO orders (order_number,user_id,user_name,user_email,user_phone,total_amount,currency,status,payment_method,bill_number,khqr_string,notes)
           VALUES (?,?,?,?,?,?,'USD','pending','bakong',?,?,?)`,
          [bill, userId||null, userName||'', userEmail||'', userPhone||'', +amount,
           bill, khqr, notes||'']
        );
        dbId = r.insertId;
        for (const it of items) {
          const qty = +it.qty || +it.quantity || 1;
          await db.execute(
            `INSERT INTO order_items (order_id,product_id,product_name,product_icon,price,quantity,subtotal) VALUES (?,?,?,?,?,?,?)`,
            [dbId, it.id||it.product_id||null, it.name||'', it.icon||'', +it.price||0, qty, (+it.price||0)*qty]
          );
        }
        await db.execute(
          `INSERT INTO payment_logs (bill_number,order_id,action,bakong_message) VALUES (?,?,'checkout','Order created')`,
          [bill, dbId]
        );
      } catch(e) { console.error('DB checkout error:', e.message); }
    }

    store[bill] = {
      status:'pending', amount:+amount, currency, khqr, dbId,
      userId, userName, userEmail,
      items: items.map(i => ({ ...i, qty: +i.qty||+i.quantity||1 })),
      created: new Date().toISOString()
    };

    console.log(`💳 Checkout: ${bill} | ${currency} ${amount}`);
    res.json({
      success:true, qrImage:qrImg, khqrString:khqr, billNumber:bill,
      amount:+amount, currency, account:BAKONG.account, merchantName:BAKONG.merchant
    });
  } catch(e) { console.error(e); res.status(500).json({ success:false, message:e.message }); }
});

app.get('/api/bakong/status/:bill', async (req, res) => {
  const { bill } = req.params;
  const inf = store[bill];
  if (!inf) return res.json({ status: 'not_found' });
  if (inf.status === 'paid')
    return res.json({ status:'paid', billNumber:bill, amount:inf.amount, currency:inf.currency });

  try {
    const md5 = crypto.createHash('md5').update(inf.khqr).digest('hex');
    const bkr = await fetch('https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${BAKONG.token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ md5 })
    });
    const bk = await bkr.json();
    console.log(`🔍 Bakong [${bill}]:`, bk.responseCode, bk.responseMessage);

    if (db && inf.dbId) {
      try {
        await db.execute(
          `INSERT INTO payment_logs (bill_number,order_id,action,bakong_code,bakong_message,md5_hash,raw_response) VALUES (?,?,'check_status',?,?,?,?)`,
          [bill, inf.dbId, bk.responseCode||null, bk.responseMessage||'', md5, JSON.stringify(bk)]
        );
      } catch{}
    }

    if (bk.responseCode === 0 && bk.data) {
      inf.status = 'paid';
      inf.paidAt = new Date().toISOString();
      if (db && inf.dbId) {
        try { await db.execute(`UPDATE orders SET status='paid',paid_at=NOW() WHERE id=?`, [inf.dbId]); } catch{}
      }
      const tgOk = await tgSend(tgMsg({ bill, name:inf.userName, email:inf.userEmail, total:inf.amount, items:inf.items }));
      if (db && inf.dbId) {
        try { await db.execute(`UPDATE orders SET telegram_sent=? WHERE id=?`, [tgOk?1:0, inf.dbId]); } catch{}
      }
      console.log(`✅ Payment confirmed: ${bill}`);
      return res.json({ status:'paid', billNumber:bill, amount:inf.amount, currency:inf.currency });
    }
    return res.json({ status:'pending', billNumber:bill });
  } catch(e) {
    console.error('Bakong API error:', e.message);
    return res.json({ status: inf.status, billNumber: bill });
  }
});

// Manual confirm (for testing)
app.post('/api/bakong/confirm/:bill', async (req, res) => {
  const { bill } = req.params;
  if (!store[bill]) return res.status(404).json({ success:false, message:'Not found' });
  store[bill].status = 'paid';
  store[bill].paidAt = new Date().toISOString();
  if (db && store[bill].dbId) {
    try {
      await db.execute(`UPDATE orders SET status='paid',paid_at=NOW() WHERE id=?`, [store[bill].dbId]);
      await db.execute(
        `INSERT INTO payment_logs (bill_number,order_id,action,bakong_message) VALUES (?,?,'manual_confirm','Manual confirmation')`,
        [bill, store[bill].dbId]
      );
    } catch(e) { console.error('DB confirm error:', e.message); }
  }
  res.json({ success:true, bill });
});

// Invoice page
app.get('/api/invoice/:bill', (req, res) => {
  const { bill } = req.params;
  const inf = store[bill];
  if (!inf || inf.status !== 'paid') return res.status(404).send(
    `<html><body style="background:#fff5f7;color:#e11d48;display:flex;height:100vh;align-items:center;justify-content:center;font-family:sans-serif;text-align:center"><div><h2>Invoice រកមិនឃើញ</h2><p style="color:#b89ca2;margin-top:8px">${bill}</p></div></body></html>`
  );
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(invoice({ bill, name:inf.userName, email:inf.userEmail, total:inf.amount, items:inf.items }));
});

// ══════════════════════════════════════════
//  ORDERS
// ══════════════════════════════════════════

// User's own orders
app.get('/api/orders', auth, async (req, res) => {
  if (!db) return res.json({ success:true, orders:[] });
  try {
    const [rows] = await db.execute(`
      SELECT o.id, o.order_number, o.user_name, o.user_email,
             o.total_amount, o.currency, o.status, o.delivery_status,
             o.bill_number, o.paid_at, o.created_at,
             GROUP_CONCAT(CONCAT_WS('||',oi.product_icon,oi.product_name,oi.price,oi.quantity,oi.subtotal)
               ORDER BY oi.id SEPARATOR ';;') AS items_raw
      FROM orders o
      LEFT JOIN order_items oi ON o.id=oi.order_id
      WHERE o.user_id=?
      GROUP BY o.id ORDER BY o.created_at DESC`, [req.user.id]);
    res.json({ success:true, orders: parseOrderRows(rows) });
  } catch(e) { console.error(e); res.json({ success:true, orders:[] }); }
});

// ══════════════════════════════════════════
//  ADMIN ROUTES
// ══════════════════════════════════════════

// Admin login (same endpoint, checks role)
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!db) return res.status(503).json({ success: false, message: 'DB not connected' });
    const [rows] = await db.execute('SELECT * FROM users WHERE email=? AND role=?', [email, 'admin']);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password)))
      return res.status(400).json({ success: false, message: 'Admin credentials incorrect' });
    const u = rows[0];
    const token = jwt.sign({ id: u.id, email: u.email, role: u.role }, JWT_SECRET, { expiresIn: '1d' });
    delete u.password;
    res.json({ success: true, message: 'Admin login success', user: u, token });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// All orders
app.get('/api/admin/orders', adminAuth, async (req, res) => {
  if (!db) return res.json({ success:true, orders:[] });
  try {
    const { status, search } = req.query;
    let sql = `
      SELECT o.id, o.order_number, o.user_id, o.user_name, o.user_email, o.user_phone,
             o.total_amount, o.currency, o.status, o.delivery_status,
             o.payment_method, o.bill_number, o.telegram_sent, o.notes,
             o.paid_at, o.created_at,
             GROUP_CONCAT(CONCAT_WS('||',oi.product_icon,oi.product_name,oi.price,oi.quantity,oi.subtotal)
               ORDER BY oi.id SEPARATOR ';;') AS items_raw
      FROM orders o
      LEFT JOIN order_items oi ON o.id=oi.order_id`;
    const params = [];
    const where = [];
    if (status) { where.push('o.status=?'); params.push(status); }
    if (search) { where.push('(o.user_name LIKE ? OR o.user_email LIKE ? OR o.order_number LIKE ?)'); const s=`%${search}%`; params.push(s,s,s); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' GROUP BY o.id ORDER BY o.created_at DESC';
    const [rows] = await db.execute(sql, params);
    res.json({ success:true, orders: parseOrderRows(rows) });
  } catch(e) { console.error(e); res.json({ success:true, orders:[] }); }
});

// Update order status / delivery
app.put('/api/admin/orders/:id/status', adminAuth, async (req, res) => {
  if (!db) return res.status(503).json({ success:false, message:'DB not connected' });
  try {
    const { status, delivery_status, notes } = req.body;
    const allowed = ['pending','paid','cancelled','refunded','delivered'];
    const sets = ['updated_at=NOW()'];
    const params = [];
    if (status && allowed.includes(status)) { sets.push('status=?'); params.push(status); }
    if (delivery_status) { sets.push('delivery_status=?'); params.push(delivery_status); }
    if (notes !== undefined) { sets.push('notes=?'); params.push(notes); }
    params.push(req.params.id);
    await db.execute(`UPDATE orders SET ${sets.join(',')} WHERE id=?`, params);
    res.json({ success:true });
  } catch(e) { console.error(e); res.status(500).json({ success:false, message:e.message }); }
});

// All users
app.get('/api/admin/users', adminAuth, async (req, res) => {
  if (!db) return res.json({ success:true, users:[] });
  try {
    const [rows] = await db.execute('SELECT id,name,email,phone,address,role,created_at FROM users ORDER BY created_at DESC');
    res.json({ success:true, users:rows });
  } catch(e) { res.json({ success:true, users:[] }); }
});

// Dashboard stats
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  if (!db) return res.json({ success:true, stats:{} });
  try {
    const [[{ total_orders }]]   = await db.execute('SELECT COUNT(*) as total_orders FROM orders');
    const [[{ paid_orders }]]    = await db.execute("SELECT COUNT(*) as paid_orders FROM orders WHERE status='paid'");
    const [[{ total_revenue }]]  = await db.execute("SELECT COALESCE(SUM(total_amount),0) as total_revenue FROM orders WHERE status='paid'");
    const [[{ total_users }]]    = await db.execute('SELECT COUNT(*) as total_users FROM users');
    const [[{ total_products }]] = await db.execute('SELECT COUNT(*) as total_products FROM products WHERE active=1');
    const [[{ today_revenue }]]  = await db.execute("SELECT COALESCE(SUM(total_amount),0) as today_revenue FROM orders WHERE status='paid' AND DATE(paid_at)=CURDATE()");
    const [[{ pending_orders }]] = await db.execute("SELECT COUNT(*) as pending_orders FROM orders WHERE status='pending'");
    res.json({ success:true, stats:{ total_orders, paid_orders, total_revenue, total_users, total_products, today_revenue, pending_orders } });
  } catch(e) { console.error(e); res.json({ success:true, stats:{} }); }
});

// Revenue chart data (last 7 days)
app.get('/api/admin/revenue-chart', adminAuth, async (req, res) => {
  if (!db) return res.json({ success:true, data:[] });
  try {
    const [rows] = await db.execute(`
      SELECT DATE(paid_at) as date, COALESCE(SUM(total_amount),0) as revenue, COUNT(*) as count
      FROM orders WHERE status='paid' AND paid_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(paid_at) ORDER BY date ASC`);
    res.json({ success:true, data:rows });
  } catch(e) { res.json({ success:true, data:[] }); }
});

// Admin: get all products (including inactive)
app.get('/api/admin/products', adminAuth, async (req, res) => {
  if (!db) return res.json({ success:true, products:[] });
  try {
    const [rows] = await db.execute('SELECT id,name,brand,price,old_price,icon,category,badge,specs,images,rating,reviews,stock,active,created_at FROM products ORDER BY id DESC');
    const products = rows.map(p => ({
      ...p,
      specs : safeJSON(p.specs,  []),
      images: safeJSON(p.images, []),
    }));
    res.json({ success:true, products });
  } catch(e) { res.json({ success:true, products:[] }); }
});

// ─── HELPERS ──────────────────────────────────────────────────
function safeJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function parseOrderRows(rows) {
  return rows.map(o => {
    const items = (o.items_raw||'').split(';;').filter(Boolean).map(s => {
      const [icon,name,price,qty,sub] = s.split('||');
      return { icon, name, price:+price, qty:+qty, subtotal:+sub };
    });
    delete o.items_raw;
    return { ...o, items };
  });
}

// Serve static files
app.use(express.static('.'));

// ═══════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════
async function start() {
  await initDB();
  app.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log(`║  🌸  NyKa Shop  Server  →  port ${PORT}           ║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  💳  Bakong   : ${BAKONG.account}   ║`);
    console.log(`║  🔐  Admin    : admin@nyka.shop / admin123    ║`);
    console.log(`║  📡  Health   : http://localhost:${PORT}/api/test  ║`);
    console.log(`║  🗄️   Database : ${process.env.DB_NAME||'nyka_shop'}                  ║`);
    console.log('╚══════════════════════════════════════════════╝\n');
  });
}
start().catch(console.error);
