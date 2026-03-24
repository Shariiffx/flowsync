const express  = require('express');
const { MongoClient } = require('mongodb');
const cors     = require('cors');
const crypto   = require('crypto');
const path     = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (index.html, reset-password.html) from the same folder
app.use(express.static(path.join(__dirname)));

// ── CONFIG ────────────────────────────────────────────────────────────────
const MONGO_URI = 'mongodb+srv://myselfsharifmolla_db_user:Flowsync2026@flowsync.wdhhooo.mongodb.net/?retryWrites=true&w=majority&appName=Flowsync';
const DB_NAME   = 'flowsync';
const PORT      = process.env.PORT || 3001;
const ADMIN_USERNAME = 'sharifmolla354';
const ADMIN_PASSWORD = '7506035297';

// ── CONNECT ───────────────────────────────────────────────────────────────
let db;
MongoClient.connect(MONGO_URI)
  .then(async client => {
    db = client.db(DB_NAME);
    console.log('✅  MongoDB Atlas connected  →  database: ' + DB_NAME);

    // Create indexes
    db.collection('users').createIndex({ username: 1 }, { unique: true });
    db.collection('schedules').createIndex({ username: 1, name: 1 });
    db.collection('weeklyplans').createIndex({ username: 1, name: 1 });
    db.collection('trackerdata').createIndex({ username: 1, date: 1 });
    db.collection('appliedranges').createIndex({ username: 1 });
    db.collection('passwordresets').createIndex({ token: 1 });
    db.collection('passwordresets').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    // ── SEED ADMIN (super user) ──────────────────────────────────────────
    const adminExists = await db.collection('users').findOne({ username: ADMIN_USERNAME });
    if (!adminExists) {
      await db.collection('users').insertOne({
        username: ADMIN_USERNAME,
        name: 'Super Admin',
        password: hash(ADMIN_PASSWORD),
        role: 'admin',
        createdAt: now(),
        lastLogin: now(),
      });
      console.log('✅  Admin user "' + ADMIN_USERNAME + '" created');
    } else {
      // Ensure existing admin has role field and correct password
      await db.collection('users').updateOne(
        { username: ADMIN_USERNAME },
        { $set: { role: 'admin', password: hash(ADMIN_PASSWORD) } }
      );
      console.log('ℹ️   Admin user "' + ADMIN_USERNAME + '" already exists — password synced');
    }

    // Remove the legacy demo user if it exists (cleanup)
    const demoDeleted = await db.collection('users').deleteOne({ username: 'demo' });
    if (demoDeleted.deletedCount) console.log('🗑️   Removed legacy demo user');

    app.listen(PORT, () =>
      console.log('🚀  FlowSync API  →  http://localhost:' + PORT)
    );
  })
  .catch(err => {
    console.error('❌  MongoDB connection failed:', err.message);
    process.exit(1);
  });

// ── HELPERS ───────────────────────────────────────────────────────────────
const col  = name => db.collection(name);
const hash = pw   => crypto.createHash('sha256').update(pw).digest('hex');
const now  = ()   => new Date().toISOString();
const genToken = () => crypto.randomBytes(32).toString('hex');

function ok(res, data = {})      { res.json({ ok: true, ...data }); }
function err(res, msg, code=400) { res.status(code).json({ ok: false, error: msg }); }

// ── HEALTH CHECK ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: DB_NAME + ' (MongoDB Atlas)', time: now() });
});

// ══════════════════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════════════════

// REGISTER
app.post('/api/register', async (req, res) => {
  try {
    const { username, name, password } = req.body;
    if (!username || !name || !password)
      return err(res, 'All fields are required');
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
      return err(res, 'Username: 3-20 chars, letters/numbers/_ only');
    if (username === ADMIN_USERNAME)
      return err(res, 'This username is reserved');

    const exists = await col('users').findOne({ username });
    if (exists) return err(res, 'Username already taken', 409);

    await col('users').insertOne({
      username,
      name,
      password: hash(password),
      role: 'user',
      createdAt: now(),
      lastLogin: now(),
    });
    return ok(res, { username, name });
  } catch (e) { return err(res, e.message, 500); }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return err(res, 'Fill in all fields');

    const user = await col('users').findOne({ username });
    if (!user)                        return err(res, 'User not found', 404);
    if (user.password !== hash(password)) return err(res, 'Incorrect password', 401);

    await col('users').updateOne({ username }, { $set: { lastLogin: now() } });
    return ok(res, { username, name: user.name, role: user.role || 'user' });
  } catch (e) { return err(res, e.message, 500); }
});

// ── PASSWORD RESET ────────────────────────────────────────────────────────

// REQUEST reset (generate token)
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return err(res, 'Username is required');

    const user = await col('users').findOne({ username });
    if (!user) return err(res, 'User not found', 404);

    const token = genToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Remove any existing reset tokens for this user
    await col('passwordresets').deleteMany({ username });

    await col('passwordresets').insertOne({
      token,
      username,
      expiresAt,
      createdAt: now(),
    });

    // In production you'd email this. For now, return it directly.
    const resetLink = `http://localhost:${PORT}/reset-password.html?token=${token}`;
    return ok(res, { token, resetLink, message: 'Reset token generated. Use the resetLink to reset your password.' });
  } catch (e) { return err(res, e.message, 500); }
});

// VERIFY reset token
app.get('/api/auth/verify-token/:token', async (req, res) => {
  try {
    const doc = await col('passwordresets').findOne({ token: req.params.token });
    if (!doc) return err(res, 'Invalid or expired reset token', 404);
    if (new Date(doc.expiresAt) < new Date()) {
      await col('passwordresets').deleteOne({ token: req.params.token });
      return err(res, 'Reset token has expired', 410);
    }
    return ok(res, { username: doc.username });
  } catch (e) { return err(res, e.message, 500); }
});

// DO reset password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return err(res, 'Token and password are required');
    if (password.length < 6)  return err(res, 'Password must be at least 6 characters');

    const doc = await col('passwordresets').findOne({ token });
    if (!doc) return err(res, 'Invalid or expired reset token', 404);
    if (new Date(doc.expiresAt) < new Date()) {
      await col('passwordresets').deleteOne({ token });
      return err(res, 'Reset token has expired', 410);
    }

    await col('users').updateOne(
      { username: doc.username },
      { $set: { password: hash(password), updatedAt: now() } }
    );
    await col('passwordresets').deleteOne({ token });

    return ok(res, { message: 'Password updated successfully' });
  } catch (e) { return err(res, e.message, 500); }
});

// ══════════════════════════════════════════════════════════════════════════
//  SCHEDULES
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/schedules/:username', async (req, res) => {
  try {
    const docs = await col('schedules')
      .find({ username: req.params.username })
      .sort({ updatedAt: -1 })
      .toArray();
    res.json(docs);
  } catch (e) { return err(res, e.message, 500); }
});

app.post('/api/schedules', async (req, res) => {
  try {
    const { username, name, slots } = req.body;
    if (!username || !name || !slots) return err(res, 'Missing fields');

    await col('schedules').updateOne(
      { username, name },
      { $set: { username, name, slots, updatedAt: now() } },
      { upsert: true }
    );
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});

app.delete('/api/schedules/:username/:name', async (req, res) => {
  try {
    await col('schedules').deleteOne({
      username: req.params.username,
      name:     decodeURIComponent(req.params.name),
    });
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});

// ══════════════════════════════════════════════════════════════════════════
//  WEEKLY PLANS
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/weeklyplans/:username', async (req, res) => {
  try {
    const docs = await col('weeklyplans')
      .find({ username: req.params.username })
      .sort({ updatedAt: -1 })
      .toArray();
    res.json(docs);
  } catch (e) { return err(res, e.message, 500); }
});

app.post('/api/weeklyplans', async (req, res) => {
  try {
    const { username, name, days } = req.body;
    if (!username || !name || !days) return err(res, 'Missing fields');

    await col('weeklyplans').updateOne(
      { username, name },
      { $set: { username, name, days, updatedAt: now() } },
      { upsert: true }
    );
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});

app.delete('/api/weeklyplans/:username/:name', async (req, res) => {
  try {
    await col('weeklyplans').deleteOne({
      username: req.params.username,
      name:     decodeURIComponent(req.params.name),
    });
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});

// ══════════════════════════════════════════════════════════════════════════
//  TRACKER DATA
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/tracker/:username', async (req, res) => {
  try {
    const filter = { username: req.params.username };
    if (req.query.dates) {
      filter.date = { $in: req.query.dates.split(',') };
    }
    const docs = await col('trackerdata').find(filter).sort({ date: 1 }).toArray();
    res.json(docs);
  } catch (e) { return err(res, e.message, 500); }
});

app.post('/api/tracker', async (req, res) => {
  try {
    const { username, date, sched, slots, tasks } = req.body;
    if (!username || !date) return err(res, 'Missing fields');

    await col('trackerdata').updateOne(
      { username, date },
      {
        $setOnInsert: { username, date, sched, slots, tasks, createdAt: now() },
        $set:         { updatedAt: now() }
      },
      { upsert: true }
    );
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});

app.patch('/api/tracker/:username/:date', async (req, res) => {
  try {
    const { tasks } = req.body;
    if (!tasks) return err(res, 'Missing tasks');

    await col('trackerdata').updateOne(
      { username: req.params.username, date: req.params.date },
      { $set: { tasks, updatedAt: now() } }
    );
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});

// ══════════════════════════════════════════════════════════════════════════
//  APPLIED RANGES
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/appliedranges/:username', async (req, res) => {
  try {
    const docs = await col('appliedranges')
      .find({ username: req.params.username })
      .sort({ appliedAt: -1 })
      .toArray();
    res.json(docs);
  } catch (e) { return err(res, e.message, 500); }
});

app.post('/api/appliedranges', async (req, res) => {
  try {
    const { username, plan, from, to, repeat } = req.body;
    if (!username || !plan) return err(res, 'Missing fields');

    await col('appliedranges').insertOne({
      username, plan, from, to, repeat, appliedAt: now(),
    });
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN ENDPOINTS  (super user only — verified by username on client)
// ══════════════════════════════════════════════════════════════════════════

// Global stats
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [users, schedules, weeklyplans, trackerdays] = await Promise.all([
      col('users').countDocuments({ role: { $ne: 'admin' } }),  // exclude admins from count
      col('schedules').countDocuments(),
      col('weeklyplans').countDocuments(),
      col('trackerdata').countDocuments(),
    ]);

    const allTracker = await col('trackerdata').find({}).toArray();
    let totalTasks = 0, doneTasks = 0;
    allTracker.forEach(d =>
      Object.values(d.tasks || {}).forEach(v => {
        if (v === true)  { totalTasks++; doneTasks++; }
        if (v === false) { totalTasks++; }
      })
    );

    res.json({
      users, schedules, weeklyplans, trackerdays,
      totalTasks, doneTasks,
      globalPct: totalTasks ? Math.round(doneTasks / totalTasks * 100) : 0,
    });
  } catch (e) { return err(res, e.message, 500); }
});

// All users (no passwords)
app.get('/api/admin/users', async (req, res) => {
  try {
    const docs = await col('users')
      .find({}, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(docs);
  } catch (e) { return err(res, e.message, 500); }
});

// All schedules
app.get('/api/admin/schedules', async (req, res) => {
  try {
    const docs = await col('schedules').find({}).sort({ username: 1 }).toArray();
    res.json(docs);
  } catch (e) { return err(res, e.message, 500); }
});

// All tracker data (latest 500 records)
app.get('/api/admin/tracker', async (req, res) => {
  try {
    const docs = await col('trackerdata')
      .find({})
      .sort({ date: -1 })
      .limit(500)
      .toArray();
    res.json(docs);
  } catch (e) { return err(res, e.message, 500); }
});

// Delete a user + all their data
app.delete('/api/admin/users/:username', async (req, res) => {
  try {
    const u = req.params.username;
    if (u === ADMIN_USERNAME) return err(res, 'Cannot delete the super admin', 403);
    await Promise.all([
      col('users').deleteOne({ username: u }),
      col('schedules').deleteMany({ username: u }),
      col('weeklyplans').deleteMany({ username: u }),
      col('trackerdata').deleteMany({ username: u }),
      col('appliedranges').deleteMany({ username: u }),
      col('passwordresets').deleteMany({ username: u }),
    ]);
    return ok(res, { deleted: u });
  } catch (e) { return err(res, e.message, 500); }
});

// ── CATCH-ALL: serve index.html for any non-API route ────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
