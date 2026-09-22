require('dotenv').config();
const express = require('express');
const { neon } = require('@neondatabase/serverless');
const path = require('path');

const app = express();
const PORT = 3000;

// Connect to Neon database
const sql = neon(process.env.DATABASE_URL);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname))); // Serve your existing index.html, style.css, app.js

// Explicitly serve index.html at the root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- API ENDPOINT FOR THE ESP32 ---
app.post('/api/scan', async (req, res) => {
  try {
    const { tag_uid } = req.body;

    if (!tag_uid) {
      return res.status(400).json({ error: 'tag_uid is required' });
    }

    // Look up the item in the Neon database
    const result = await sql`
      SELECT name, price FROM items WHERE tag_uid = ${tag_uid}
    `;

    if (result.length === 0) {
      return res.json({ found: false, message: 'Item not found' });
    }

    // Send back the name and price
    return res.json({ found: true, item: result[0] });

  } catch (error) {
    console.error('Scan API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ SmartCart server running at http://localhost:${PORT}`);
  console.log(`📡 ESP32 endpoint: http://localhost:${PORT}/api/scan`);
});