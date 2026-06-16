const express = require('express');
const app = express();
const Database = require('better-sqlite3');
const path = require('path');

// --- 中介層設定 ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- 資料庫設定 ---
const db = new Database('contacts.db');

// 建立/更新資料表（自動補上置頂與修改人欄位）
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    phone      TEXT    NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_pinned  INTEGER DEFAULT 0,
    updated_name TEXT DEFAULT NULL,
    updated_at   DATETIME DEFAULT NULL
  )
`);

// 💡 預防萬一：如果使用者的舊資料庫已存在，動態補上新欄位
try { db.exec("ALTER TABLE contacts ADD COLUMN is_pinned INTEGER DEFAULT 0"); } catch(e){}
try { db.exec("ALTER TABLE contacts ADD COLUMN updated_name TEXT DEFAULT NULL"); } catch(e){}
try { db.exec("ALTER TABLE contacts ADD COLUMN updated_at DATETIME DEFAULT NULL"); } catch(e){}

console.log('✅ 資料庫連線與結構檢查成功');

// --- 驗證工具函式 ---
// 驗證是否為 09 開頭 + 8 位數字 (共 10 位數)
const validatePhone = (phone) => {
  const phoneRegex = /^09\d{8}$/;
  return phoneRegex.test(phone);
};

// ============================================================
// API 路由
// ============================================================

// 1. GET /contacts → 查詢資料（功能 4：支援名字搜尋 ?search=xxx ；功能 2：置頂優先排序）
app.get('/contacts', (req, res) => {
  const { search } = req.query;
  let rows;

  if (search) {
    // 關鍵字模糊搜尋名字
    rows = db.prepare(`
      SELECT * FROM contacts 
      WHERE name LIKE ? 
      ORDER BY is_pinned DESC, id DESC
    `).all(`%${search}%`);
  } else {
    // 預設撈出全部，排序：置頂(1)優先於未置頂(0)，之後按 ID 倒序
    rows = db.prepare('SELECT * FROM contacts ORDER BY is_pinned DESC, id DESC').all();
  }
  res.json(rows);
});

// 2. POST /contacts → 新增一筆資料（功能 1：防重複；加碼：電話號碼格式辨識）
app.post('/contacts', (req, res) => {
  const { name, phone } = req.body;
  
  // 基本非空驗證
  if (!name || !phone) {
    return res.status(400).json({ error: '姓名與電話不可為空' });
  }

  // 💡 電話號碼格式辨識
  if (!validatePhone(phone)) {
    return res.status(400).json({ error: '電話格式錯誤！必須為 09 開頭的 10 位數字。' });
  }

  // 功能 1：檢查重複姓名或電話
  const duplicate = db.prepare('SELECT id FROM contacts WHERE name = ? OR phone = ?').get(name, phone);
  if (duplicate) {
    return res.status(400).json({ error: '姓名或電話已存在，請勿重複新增！' });
  }

  const result = db.prepare('INSERT INTO contacts (name, phone) VALUES (?, ?)').run(name, phone);
  res.status(201).json({ message: '新增成功', id: result.lastInsertRowid });
});

// 3. PUT /contacts/:id → 修改指定 id 的資料（功能 1：防重複；功能 3：紀錄修改人與時間；加碼：電話辨識）
app.put('/contacts/:id', (req, res) => {
  const { name, phone, updated_name } = req.body;
  const { id } = req.params;

  // 基本非空驗證
  if (!name || !phone) {
    return res.status(400).json({ error: '姓名與電話不可為空' });
  }

  // 💡 電話號碼格式辨識
  if (!validatePhone(phone)) {
    return res.status(400).json({ error: '修改的電話格式錯誤！必須為 09 開頭的 10 位數字。' });
  }

  // 功能 1：檢查「其他聯絡人」是否有重複的名字或電話（排除當前修改的這筆 id）
  const duplicate = db.prepare('SELECT id FROM contacts WHERE (name = ? OR phone = ?) AND id != ?').get(name, phone, id);
  if (duplicate) {
    return res.status(400).json({ error: '修改後的姓名或電話已與其他聯絡人重複！' });
  }

  // 功能 3：更新資料，並寫入修改人與當前伺服器時間
  db.prepare(`
    UPDATE contacts 
    SET name = ?, phone = ?, updated_name = ?, updated_at = DATETIME('now', 'localtime') 
    WHERE id = ?
  `).run(name, phone, updated_name || '未知修改者', id);

  res.json({ message: '修改成功' });
});

// 4. PATCH /contacts/:id/pin → 切換置頂狀態（功能 2：全新獨立 API）
app.patch('/contacts/:id/pin', (req, res) => {
  const { id } = req.params;
  const { is_pinned } = req.body; // 前端傳入 1 (置頂) 或 0 (取消)

  db.prepare('UPDATE contacts SET is_pinned = ? WHERE id = ?').run(is_pinned, id);
  res.json({ message: is_pinned ? '已置頂' : '已取消置頂' });
});

// 5. DELETE /contacts/:id → 刪除指定 id 的資料
app.delete('/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id=?').run(req.params.id);
  res.json({ message: '刪除成功' });
});

// 預設首頁路由
app.get('/', (req, res) => {
  res.send('Hello World！伺服器正常運作中 🎉');
});

// 啟動伺服器，監聽 3000 port
app.listen(3000, () => {
  console.log('伺服器已啟動：http://localhost:3000');
});