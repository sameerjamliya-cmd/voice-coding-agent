const express = require('express');\
const bodyParser = require('body-parser');\
const sqlite3 = require('sqlite3').verbose();\
\
// Initialize Express app\
const app = express();\
app.use(bodyParser.json());\
\
// Initialize SQLite database\
const db = new sqlite3.Database('./bookmarks.db', (err) => {\
  if (err) {\
    console.error(err.message);\
  } else {\
    console.log('Connected to the bookmarks database.');\
  }\
});\
\
// Create bookmarks table if it doesn't exist\
db.run(`CREATE TABLE IF NOT EXISTS bookmarks(\
  id INTEGER PRIMARY KEY AUTOINCREMENT,\
  url TEXT NOT NULL,\
  title TEXT NOT NULL\
)`);\
\
// Add a bookmark\
app.post('/bookmarks', (req, res) => {\
  const { url, title } = req.body;\
  db.run(`INSERT INTO bookmarks(url, title) VALUES(?, ?)`, [url, title], function(err) {\
    if (err) {\
      return res.status(500).json({ error: err.message });\
    }\
    res.status(201).json({ id: this.lastID });\
  });\
});\
\
// List all bookmarks\
app.get('/bookmarks', (req, res) => {\
  db.all(`SELECT * FROM bookmarks`, [], (err, rows) => {\
    if (err) {\
      return res.status(500).json({ error: err.message });\
    }\
    res.json(rows);\
  });\
});\
\
// Delete a bookmark\
app.delete('/bookmarks/:id', (req, res) => {\
  const { id } = req.params;\
  db.run(`DELETE FROM bookmarks WHERE id = ?`, id, function(err) {\
    if (err) {\
      return res.status(500).json({ error: err.message });\
    }\
    if (this.changes === 0) {\
      return res.status(404).json({ error: 'Bookmark not found' });\
    }\
    res.status(204).end();\
  });\
});\
\
// Start the server\
const PORT = process.env.PORT || 3000;\
app.listen(PORT, () => {\
  console.log(`Server is running on port ${PORT}`);\
});\
\
// Close the database connection on exit\
process.on('SIGINT', () => {\
  db.close();\
  process.exit(0);\
});