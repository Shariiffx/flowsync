const express  = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors     = require('cors');
const crypto   = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// ── CONFIG ────────────────────────────────────────────────────────────────
const MONGO_URI = 'mongodb+srv://myselfsharifmolla_db_user:Flowsync2026@flowsync.wdhhooo.mongodb.net/?retryWrites=true&w=majority&appName=Flowsync';
const DB_NAME   = 'flowsync';
const PORT      = process.env.PORT || 3001;

// ── CONNECT ───────────────────────────────────────────────────────────────
let db;
MongoClient.connect(MONGO_URI)
  .then(client => {
    db = client.db(DB_NAME);
    console.log('✅  MongoDB Atlas connected  →  database: ' + DB_NAME);

    // Create indexes for fast lookups
    db.collection('users').createIndex({ username: 1 }, { unique: true });
    db.collection('schedules').createIndex({ username: 1, name: 1 });
    db.collection('weeklyplans').createIndex({ username: 1, name: 1 });
    db.collection('trackerdata').createIndex({ username: 1, date: 1 });
    db.collection('appliedranges').createIndex({ username: 1 });

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

function ok(res, data = {})      { res.json({ ok: true, ...data }); }
function err(res, msg, code=400) { res.status(code).json({ ok: false, error: msg }); }

// ── HEALTH CHECK ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: DB_NAME, time: now() });
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

    const exists = await col('users').findOne({ username });
    if (exists) return err(res, 'Username already taken', 409);

    await col('users').insertOne({
      username,
      name,
      password: hash(password),
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
    if (!user)          return err(res, 'User not found', 404);
    if (user.password !== hash(password))
                        return err(res, 'Incorrect password', 401);

    await col('users').updateOne({ username }, { $set: { lastLogin: now() } });
    return ok(res, { username, name: user.name });
  } catch (e) { return err(res, e.message, 500); }
});

// ══════════════════════════════════════════════════════════════════════════
//  SCHEDULES
// ══════════════════════════════════════════════════════════════════════════

// GET all schedules for a user
app.get('/api/schedules/:username', async (req, res) => {
  try {
    const docs = await col('schedules')
      .find({ username: req.params.username })
      .sort({ updatedAt: -1 })
      .toArray();
    res.json(docs);
  } catch (e) { return err(res, e.message, 500); }
});

// SAVE (upsert) a schedule
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

// DELETE a schedule
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

// GET tracker records — optionally filter by date list
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

// UPSERT a tracker day (when calendar is applied)
app.post('/api/tracker', async (req, res) => {
  try {
    const { username, date, sched, slots, tasks } = req.body;
    if (!username || !date) return err(res, 'Missing fields');

    await col('trackerdata').updateOne(
      { username, date },
      { $setOnInsert: { username, date, sched, slots, tasks, createdAt: now() },
        $set:         { updatedAt: now() } },
      { upsert: true }
    );
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});

// PATCH tasks for one day (checkbox toggle)
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
//  ADMIN ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════

// Global stats
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [users, schedules, weeklyplans, trackerdays] = await Promise.all([
      col('users').countDocuments(),
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

// All tracker data (latest 300 records)
app.get('/api/admin/tracker', async (req, res) => {
  try {
    const docs = await col('trackerdata')
      .find({})
      .sort({ date: -1 })
      .limit(300)
      .toArray();
    res.json(docs);
  } catch (e) { return err(res, e.message, 500); }
});

// Delete a user + all their data
app.delete('/api/admin/users/:username', async (req, res) => {
  try {
    const u = req.params.username;
    await Promise.all([
      col('users').deleteOne({ username: u }),
      col('schedules').deleteMany({ username: u }),
      col('weeklyplans').deleteMany({ username: u }),
      col('trackerdata').deleteMany({ username: u }),
      col('appliedranges').deleteMany({ username: u }),
    ]);
    return ok(res, { deleted: u });
  } catch (e) { return err(res, e.message, 500); }
});
