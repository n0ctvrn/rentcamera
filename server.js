const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const basicAuth = require('express-basic-auth');

const DB_FILE = path.join(__dirname, 'rentcamera.db');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const auth = basicAuth({
  users: { 'admin': 'admin123' },
  challenge: true,
  realm: 'Admin Area'
});

app.get('/api/orders', auth, (req, res) => {
  const db = openDb();
  db.all('SELECT * FROM orders ORDER BY created DESC', (err, orders) => {
    if (err) {
      db.close();
      return res.status(500).json({ message: 'Database error' });
    }
    res.json(orders);
    db.close();
  });
});

function openDb() {
  return new sqlite3.Database(DB_FILE);
}

function initDb() {
  const db = openDb();
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS cameras (
      id INTEGER PRIMARY KEY,
      name TEXT,
      sub TEXT,
      cat TEXT,
      price INTEGER,
      icon TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cameraId INTEGER,
      date TEXT,
      orderId TEXT,
      UNIQUE(cameraId, date)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      cameraId INTEGER,
      cameraName TEXT,
      start TEXT,
      end TEXT,
      duration INTEGER,
      total INTEGER,
      name TEXT,
      phone TEXT,
      ktp TEXT,
      address TEXT,
      note TEXT,
      created TEXT
    )`);

    db.get('SELECT COUNT(*) AS count FROM cameras', (err, row) => {
      if (err) {
        console.error(err);
        db.close();
        return;
      }
      if (row.count === 0) {
        const stmt = db.prepare('INSERT INTO cameras (id, name, sub, cat, price, icon) VALUES (?, ?, ?, ?, ?, ?)');
        const items = [
          [1, 'Sony Cybershot WX220', 'Sony · Standard', 'standard', 50000, '📷'],
          [2, 'Canon IXUS 185', 'Canon · Standard', 'standard', 50000, '📸'],
          [3, 'Lumix DMC-TZ70', 'Panasonic · Premium', 'premium', 50000, '🎞️'],
          [4, 'Sony ZV-1', 'Sony · Premium', 'premium', 50000, '🎥'],
          [5, 'Fujifilm FinePix XP140', 'Fujifilm · Standard', 'standard', 50000, '📷'],
          [6, 'Tripod + Memory Card', 'Aksesoris · Bundle', 'aksesoris', 50000, '🎒']
        ];
        items.forEach(item => stmt.run(item));
        stmt.finalize(() => db.close());
      } else {
        db.close();
      }
    });
  });
}

app.get('/api/cameras', (req, res) => {
  const db = openDb();
  db.all('SELECT * FROM cameras', (err, cameras) => {
    if (err) {
      db.close();
      return res.status(500).json({ message: 'Database error' });
    }
    db.all('SELECT cameraId, date FROM bookings', (err2, bookings) => {
      if (err2) {
        db.close();
        return res.status(500).json({ message: 'Database error' });
      }
      const grouped = {};
      bookings.forEach(b => {
        if (!grouped[b.cameraId]) grouped[b.cameraId] = [];
        grouped[b.cameraId].push(b.date);
      });
      const payload = cameras.map(cam => ({
        ...cam,
        booked: grouped[cam.id] || []
      }));
      res.json(payload);
      db.close();
    });
  });
});

app.post('/api/book', (req, res) => {
  const {
    cameraId,
    start,
    end,
    duration,
    total,
    name,
    phone,
    ktp,
    address,
    note
  } = req.body;

  if (!cameraId || !start || !end || !duration || !total || !name || !phone || !ktp || !address) {
    return res.status(400).json({ message: 'Semua data wajib diisi' });
  }

  const orderId = 'ADY-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const dates = [];
  for (let cur = new Date(start); cur <= new Date(end); cur.setDate(cur.getDate() + 1)) {
    dates.push(cur.toISOString().slice(0, 10));
  }

  const db = openDb();
  db.serialize(() => {
    const placeholders = dates.map(() => '(?, ?, ?)').join(', ');
    const params = [];
    dates.forEach(date => {
      params.push(cameraId, date, orderId);
    });

    db.get('SELECT * FROM cameras WHERE id = ?', [cameraId], (err, camera) => {
      if (err) {
        db.close();
        return res.status(500).json({ message: 'Database error' });
      }
      if (!camera) {
        db.close();
        return res.status(404).json({ message: 'Kamera tidak ditemukan' });
      }

      db.all('SELECT date FROM bookings WHERE cameraId = ? AND date BETWEEN ? AND ?', [cameraId, start, end], (err2, row) => {
        if (err2) {
          db.close();
          return res.status(500).json({ message: 'Database error' });
        }
        if (row.length) {
          db.close();
          return res.status(409).json({ message: 'Tanggal yang dipilih sudah dipesan' });
        }

        db.run('BEGIN TRANSACTION');
        const bookingStmt = db.prepare('INSERT INTO bookings (cameraId, date, orderId) VALUES (?, ?, ?)');
        dates.forEach(date => bookingStmt.run(cameraId, date, orderId));
        bookingStmt.finalize(err3 => {
          if (err3) {
            db.run('ROLLBACK', () => db.close());
            return res.status(500).json({ message: 'Database error' });
          }

          db.run('INSERT INTO orders (id, cameraId, cameraName, start, end, duration, total, name, phone, ktp, address, note, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [orderId, cameraId, camera.name, start, end, duration, total, name, phone, ktp, address, note || '', new Date().toISOString()],
            err4 => {
              if (err4) {
                db.run('ROLLBACK', () => db.close());
                return res.status(500).json({ message: 'Database error' });
              }
              db.run('COMMIT', commitErr => {
                db.close();
                if (commitErr) {
                  return res.status(500).json({ message: 'Database error' });
                }
                res.json({ orderId });
              });
            }
          );
        });
      });
    });
  });
});

// ADMIN
app.get('/admin', auth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ROOT (halaman utama)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDb();

app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});
