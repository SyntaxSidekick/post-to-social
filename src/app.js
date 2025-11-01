const express = require('express');
const path = require('path');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Create necessary directories
const createDirectories = () => {
  const dirs = ['./data', './uploads', './logs'];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

// Initialize database
const initDatabase = () => {
  const db = new sqlite3.Database(process.env.DATABASE_PATH || './data/scheduler.db');
  
  // Create tables
  db.serialize(() => {
    // Posts table
    db.run(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        platforms TEXT NOT NULL,
        scheduled_time DATETIME NOT NULL,
        status TEXT DEFAULT 'scheduled',
        series_id INTEGER,
        series_order INTEGER,
        media_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        posted_at DATETIME,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0
      )
    `);
    
    // Series table
    db.run(`
      CREATE TABLE IF NOT EXISTS series (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        platforms TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL,
        start_time DATETIME NOT NULL,
        status TEXT DEFAULT 'scheduled',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Social accounts table
    db.run(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        username TEXT,
        access_token TEXT,
        refresh_token TEXT,
        expires_at DATETIME,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Posting history table
    db.run(`
      CREATE TABLE IF NOT EXISTS posting_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER,
        platform TEXT NOT NULL,
        status TEXT NOT NULL,
        response_data TEXT,
        error_message TEXT,
        posted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts (id)
      )
    `);
  });
  
  return db;
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_PATH || './uploads');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB default
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images and videos are allowed'));
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Initialize app
createDirectories();
const db = initDatabase();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// API Routes
app.get('/api/posts', (req, res) => {
  db.all(`
    SELECT p.*, s.name as series_name 
    FROM posts p 
    LEFT JOIN series s ON p.series_id = s.id 
    ORDER BY p.scheduled_time ASC
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/posts', upload.single('media'), (req, res) => {
  const { content, platforms, scheduled_time, series_id, series_order } = req.body;
  const media_path = req.file ? req.file.filename : null;
  
  db.run(`
    INSERT INTO posts (content, platforms, scheduled_time, media_path, series_id, series_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [content, platforms, scheduled_time, media_path, series_id, series_order], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ id: this.lastID, message: 'Post scheduled successfully' });
  });
});

app.post('/api/series', (req, res) => {
  const { name, platforms, interval_minutes, start_time, posts } = req.body;
  
  db.serialize(() => {
    db.run(`
      INSERT INTO series (name, platforms, interval_minutes, start_time)
      VALUES (?, ?, ?, ?)
    `, [name, platforms, interval_minutes, start_time], function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      const seriesId = this.lastID;
      const stmt = db.prepare(`
        INSERT INTO posts (content, platforms, scheduled_time, series_id, series_order)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      posts.forEach((post, index) => {
        const postTime = new Date(start_time);
        postTime.setMinutes(postTime.getMinutes() + (index * interval_minutes));
        stmt.run([post.content, platforms, postTime.toISOString(), seriesId, index + 1]);
      });
      
      stmt.finalize();
      res.json({ id: seriesId, message: 'Series scheduled successfully' });
    });
  });
});

app.delete('/api/posts/:id', (req, res) => {
  const { id } = req.params;
  
  db.run('DELETE FROM posts WHERE id = ? AND status = "scheduled"', [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Post not found or already posted' });
      return;
    }
    res.json({ message: 'Post deleted successfully' });
  });
});

app.get('/api/history', (req, res) => {
  db.all(`
    SELECT h.*, p.content, p.scheduled_time
    FROM posting_history h
    JOIN posts p ON h.post_id = p.id
    ORDER BY h.posted_at DESC
    LIMIT 100
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Social Media Scheduler running on http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop the server');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});

module.exports = app;