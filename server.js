const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const DB_FILE = path.join(__dirname, 'rentcamera.db');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
  secret: 'your-secret-key-rentcamera-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true }
}));

// Custom middleware untuk protect root route
app.get('/', (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
});

// Static files SETELAH session middleware dan route proteksi
app.use(express.static(__dirname));

// Middleware untuk check login
const checkLogin = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Silakan login terlebih dahulu' });
  }
  next();
};

const checkAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ message: 'Anda tidak memiliki akses' });
  }
  next();
};

// API: Login
app.post('/api/login', (req, res) => {
  const { username, password, userType } = req.body;

  if (!username || !password || !userType) {
    return res.status(400).json({ message: 'Username, password, dan tipe user harus diisi' });
  }

  if (userType === 'admin' && username === 'admin' && password === 'admin123') {
    req.session.user = { id: 1, username: 'admin', role: 'admin' };
    return res.json({ message: 'Login berhasil', role: 'admin' });
  }

  const db = openDb();
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      db.close();
      return res.status(500).json({ message: 'Database error' });
    }

    if (!user) {
      db.close();
      return res.status(401).json({ message: 'Username atau password salah' });
    }

    bcrypt.compare(password, user.password, (err, isMatch) => {
      db.close();
      if (err) {
        return res.status(500).json({ message: 'Terjadi kesalahan' });
      }

      if (!isMatch) {
        return res.status(401).json({ message: 'Username atau password salah' });
      }

      req.session.user = { id: user.id, username: user.username, role: 'user' };
      res.json({ message: 'Login berhasil', role: 'user' });
    });
  });
});

// API: Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: 'Logout gagal' });
    }
    res.json({ message: 'Logout berhasil' });
  });
});

// API: Check session
app.get('/api/session', (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ message: 'Tidak ada session' });
  }
});

// API: Register user
app.post('/api/register', (req, res) => {
  const { username, password, passwordConfirm } = req.body;

  if (!username || !password || !passwordConfirm) {
    return res.status(400).json({ message: 'Semua field wajib diisi' });
  }

  if (password !== passwordConfirm) {
    return res.status(400).json({ message: 'Password tidak cocok' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password minimal 6 karakter' });
  }

  const db = openDb();
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      db.close();
      return res.status(500).json({ message: 'Database error' });
    }

    if (user) {
      db.close();
      return res.status(409).json({ message: 'Username sudah digunakan' });
    }

    bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
        db.close();
        return res.status(500).json({ message: 'Terjadi kesalahan' });
      }

      db.run('INSERT INTO users (username, password, created) VALUES (?, ?, ?)',
        [username, hash, new Date().toISOString()],
        (err) => {
          db.close();
          if (err) {
            return res.status(500).json({ message: 'Database error' });
          }
          res.json({ message: 'Registrasi berhasil, silakan login' });
        }
      );
    });
  });
});

// ============ ADMIN APIs - ORDERS ============

// API: Get all orders (admin)
app.get('/api/admin/orders', checkAdmin, (req, res) => {
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

// ============ ADMIN APIs - CAMERA CATALOG ============

// API: Add new camera (admin)
app.post('/api/admin/cameras', checkAdmin, (req, res) => {
  const { name, sub, cat, price, icon } = req.body;

  if (!name || !sub || !cat || !price || !icon) {
    return res.status(400).json({ message: 'Semua field wajib diisi' });
  }

  const db = openDb();
  db.run('INSERT INTO cameras (name, sub, cat, price, icon) VALUES (?, ?, ?, ?, ?)',
    [name, sub, cat, parseInt(price), icon],
    function(err) {
      if (err) {
        db.close();
        return res.status(500).json({ message: 'Database error' });
      }
      res.json({ message: 'Kamera berhasil ditambahkan', id: this.lastID });
      db.close();
    }
  );
});

// API: Update camera (admin)
app.put('/api/admin/cameras/:id', checkAdmin, (req, res) => {
  const { id } = req.params;
  const { name, sub, cat, price, icon } = req.body;

  if (!name || !sub || !cat || !price || !icon) {
    return res.status(400).json({ message: 'Semua field wajib diisi' });
  }

  const db = openDb();
  db.run('UPDATE cameras SET name = ?, sub = ?, cat = ?, price = ?, icon = ? WHERE id = ?',
    [name, sub, cat, parseInt(price), icon, id],
    function(err) {
      if (err) {
        db.close();
        return res.status(500).json({ message: 'Database error' });
      }
      if (this.changes === 0) {
        db.close();
        return res.status(404).json({ message: 'Kamera tidak ditemukan' });
      }
      res.json({ message: 'Kamera berhasil diperbarui' });
      db.close();
    }
  );
});

// API: Delete camera (admin)
app.delete('/api/admin/cameras/:id', checkAdmin, (req, res) => {
  const { id } = req.params;

  const db = openDb();
  // Cek apakah ada booking untuk kamera ini
  db.get('SELECT COUNT(*) as count FROM bookings WHERE cameraId = ?', [id], (err, row) => {
    if (err) {
      db.close();
      return res.status(500).json({ message: 'Database error' });
    }

    if (row.count > 0) {
      db.close();
      return res.status(400).json({ message: 'Tidak bisa menghapus kamera yang memiliki pemesanan' });
    }

    db.run('DELETE FROM cameras WHERE id = ?', [id], function(err) {
      if (err) {
        db.close();
        return res.status(500).json({ message: 'Database error' });
      }
      if (this.changes === 0) {
        db.close();
        return res.status(404).json({ message: 'Kamera tidak ditemukan' });
      }
      res.json({ message: 'Kamera berhasil dihapus' });
      db.close();
    });
  });
});

// ============ USER APIs ============

// API: Get user's bookings
app.get('/api/user/bookings', checkLogin, (req, res) => {
  const db = openDb();
  db.all('SELECT * FROM orders ORDER BY created DESC', (err, bookings) => {
    if (err) {
      db.close();
      return res.status(500).json({ message: 'Database error' });
    }
    res.json(bookings);
    db.close();
  });
});

function openDb() {
  const db = new sqlite3.Database(DB_FILE, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, err => {
    if (err) {
      console.error(`Gagal membuka database ${DB_FILE}:`, err.message);
    }
  });
  db.configure('busyTimeout', 5000);
  return db;
}

function initDb() {
  const db = openDb();
  db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created TEXT
    )`);

    // Cameras table
    db.run(`CREATE TABLE IF NOT EXISTS cameras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        const stmt = db.prepare('INSERT INTO cameras (name, sub, cat, price, icon) VALUES (?, ?, ?, ?, ?)');
        const items = [
          ['Sony Cybershot WX220', 'Sony · Standard', 'standard', 50000, '📷'],
          ['Canon IXUS 185', 'Canon · Standard', 'standard', 50000, '📸'],
          ['Lumix DMC-TZ70', 'Panasonic · Premium', 'premium', 50000, '🎞️'],
          ['Sony ZV-1', 'Sony · Premium', 'premium', 50000, '🎥'],
          ['Fujifilm FinePix XP140', 'Fujifilm · Standard', 'standard', 50000, '📷'],
          ['Tripod + Memory Card', 'Aksesoris · Bundle', 'aksesoris', 50000, '🎒']
        ];
        items.forEach(item => stmt.run(...item));
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/user-dashboard');
  }
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/admin', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/user-dashboard', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'user-dashboard.html'));
});

initDb();

app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});
