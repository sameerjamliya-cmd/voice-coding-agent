const request = require('supertest');\
const express = require('express');\
const bodyParser = require('body-parser');\
const sqlite3 = require('sqlite3').verbose();\
const app = express();\
app.use(bodyParser.json());\
\
const db = new sqlite3.Database(':memory:');\
db.serialize(() => {\
  db.run(`CREATE TABLE bookmarks(\
    id INTEGER PRIMARY KEY AUTOINCREMENT,\
    url TEXT NOT NULL,\
    title TEXT NOT NULL\
  )`);\
});\
\
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
app.get('/bookmarks', (req, res) => {\
  db.all(`SELECT * FROM bookmarks`, [], (err, rows) => {\
    if (err) {\
      return res.status(500).json({ error: err.message });\
    }\
    res.json(rows);\
  });\
});\
\
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
describe('Bookmarks API', () => {\
  afterAll((done) => {\
    db.close(done);\
  });\
\
  it('should add a bookmark', async () => {\
    const response = await request(app)\
      .post('/bookmarks')\
      .send({ url: 'http://example.com', title: 'Example' });\
    expect(response.statusCode).toBe(201);\
    expect(response.body).toHaveProperty('id');\
  });\
\
  it('should list all bookmarks', async () => {\
    const response = await request(app).get('/bookmarks');\
    expect(response.statusCode).toBe(200);\
    expect(Array.isArray(response.body)).toBe(true);\
  });\
\
  it('should delete a bookmark by id', async () => {\
    const addResponse = await request(app)\
      .post('/bookmarks')\
      .send({ url: 'http://example.com', title: 'Example' });\
    const id = addResponse.body.id;\
    const deleteResponse = await request(app).delete(`/bookmarks/${id}`);\
    expect(deleteResponse.statusCode).toBe(204);\
  });\
});