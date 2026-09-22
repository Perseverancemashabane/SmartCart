require('dotenv').config();
const express = require('express');
const { neon } = require('@neondatabase/serverless');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const sql = neon(process.env.DATABASE_URL);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html at the root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- ESP32 SCANS A TAG ---
app.post('/api/scan', async (req, res) => {
  try {
    const { tag_uid } = req.body;
    if (!tag_uid) return res.status(400).json({ error: 'tag_uid is required' });

    const result = await sql`
      SELECT name, price FROM items WHERE tag_uid = ${tag_uid}
    `;

    if (result.length === 0) {
      await sql`
        INSERT INTO scans (tag_uid, name, price) 
        VALUES (${tag_uid}, 'Unknown', 0)
      `;
      return res.json({ found: false, message: 'Item not found' });
    }

    await sql`
      INSERT INTO scans (tag_uid, name, price) 
      VALUES (${tag_uid}, ${result[0].name}, ${result[0].price})
    `;

    return res.json({ found: true, item: result[0] });
  } catch (error) {
    console.error('Scan API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- FRONTEND POLLS THIS ---
app.get('/api/scan/latest', async (req, res) => {
  try {
    const result = await sql`
      SELECT id, tag_uid, name, price, scanned_at 
      FROM scans 
      ORDER BY id DESC 
      LIMIT 1
    `;
    if (result.length === 0) return res.json({ hasScan: false });
    return res.json({ hasScan: true, scan: result[0] });
  } catch (error) {
    console.error('Latest Scan API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Only listen locally (Vercel handles the server in production)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ SmartCart server running at http://localhost:${PORT}`);
    console.log(`📡 ESP32 endpoint: http://localhost:${PORT}/api/scan`);
  });
}

// Export for Vercel
module.exports = app;