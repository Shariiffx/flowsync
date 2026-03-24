const express  = require('express');
const { MongoClient } = require('mongodb');
const cors     = require('cors');
const crypto   = require('crypto');
const https    = require('https');
const path     = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ── CONFIG ────────────────────────────────────────────────────────────────
const MONGO_URI  = 'mongodb+srv://myselfsharifmolla_db_user:CH2m1FLhr7kgIZ6p@flowsync.wdhhooo.mongodb.net/flowsync?retryWrites=true&w=majority&appName=Flowsync';
const DB_NAME    = 'flowsync';
const PORT       = process.env.PORT || 3001;
const RESEND_KEY = 're_LiqjkTT8_AKdE8Pm1MNVDb6dXpsutHEBw';
const FROM_EMAIL = 'FlowSync <onboarding@resend.dev>';
const APP_URL    = process.env.APP_URL || 'https://myflowsync.netlify.app'; // update to your Netlify URL after deploy

// ── CONNECT ───────────────────────────────────────────────────────────────
let db;
MongoClient.connect(MONGO_URI)
  .then(client => {
    db = client.db(DB_NAME);
    console.log('✅  MongoDB Atlas connected  →  database: ' + DB_NAME);
    db.collection('users').createIndex({ username: 1 }, { unique: true });
    db.collection('users').createIndex({ email: 1 });
    db.collection('schedules').createIndex({ username: 1, name: 1 });
    db.collection('weeklyplans').createIndex({ username: 1, name: 1 });
    db.collection('trackerdata').createIndex({ username: 1, date: 1 });
    db.collection('appliedranges').createIndex({ username: 1 });
    db.collection('passwordresets').createIndex({ token: 1 });
    db.collection('passwordresets').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    app.listen(PORT, () => console.log('🚀  FlowSync API  →  http://localhost:' + PORT));
  })
  .catch(err => { console.error('❌  MongoDB connection failed:', err.message); process.exit(1); });

// ── HELPERS ───────────────────────────────────────────────────────────────
const col  = name => db.collection(name);
const hash = pw   => crypto.createHash('sha256').update(pw).digest('hex');
const now  = ()   => new Date().toISOString();
function ok(res, data={})      { res.json({ ok:true, ...data }); }
function err(res, msg, code=400) { res.status(code).json({ ok:false, error:msg }); }

// ── SEND EMAIL VIA RESEND ─────────────────────────────────────────────────
function sendEmail(to, subject, html) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ from: FROM_EMAIL, to, subject, html });
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (res.statusCode >= 400) reject(new Error(parsed.message || 'Email send failed'));
        else resolve(parsed);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── HEALTH ────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok:true, db:DB_NAME, time:now() }));

// ══════════════════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════════════════

// REGISTER (now includes email)
app.post('/api/register', async (req, res) => {
  try {
    const { username, name, email, password } = req.body;
    if (!username || !name || !email || !password)
      return err(res, 'All fields are required');
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
      return err(res, 'Username: 3-20 chars, letters/numbers/_ only');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return err(res, 'Please enter a valid email address');

    const exists = await col('users').findOne({ username });
    if (exists) return err(res, 'Username already taken', 409);
    const emailExists = await col('users').findOne({ email: email.toLowerCase() });
    if (emailExists) return err(res, 'Email already registered', 409);

    await col('users').insertOne({
      username, name,
      email: email.toLowerCase(),
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
    if (!user)                          return err(res, 'User not found', 404);
    if (user.password !== hash(password)) return err(res, 'Incorrect password', 401);
    await col('users').updateOne({ username }, { $set: { lastLogin: now() } });
    return ok(res, { username, name: user.name, email: user.email });
  } catch (e) { return err(res, e.message, 500); }
});

// FORGOT PASSWORD — send reset email
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return err(res, 'Email is required');

    const user = await col('users').findOne({ email: email.toLowerCase() });
    // Always return ok — don't reveal if email exists (security)
    if (!user) return ok(res, { message: 'If that email exists, a reset link has been sent.' });

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save token to DB (remove old ones for this user first)
    await col('passwordresets').deleteMany({ username: user.username });
    await col('passwordresets').insertOne({
      username: user.username,
      email: user.email,
      token,
      expiresAt,
      createdAt: now(),
    });

    // Build reset link — points to your frontend reset page
    const resetLink = APP_URL + '/reset-password.html?token=' + token;

    // Send email via Resend
    await sendEmail(
      user.email,
      'Reset your FlowSync password',
      `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07070d;font-family:'Outfit',Arial,sans-serif">
  <div style="max-width:480px;margin:40px auto;background:#0f0f1a;border:1px solid #252538;border-radius:16px;overflow:hidden">
    <div style="padding:28px 32px;border-bottom:1px solid #252538">
      <div style="font-size:22px;font-weight:700;color:#f0f0fa;letter-spacing:-.5px">flow<span style="color:#6c5ce7">sync</span></div>
    </div>
    <div style="padding:32px">
      <div style="font-size:20px;font-weight:600;color:#f0f0fa;margin-bottom:10px">Reset your password</div>
      <div style="font-size:14px;color:#8888aa;line-height:1.7;margin-bottom:24px">
        Hey <strong style="color:#f0f0fa">${user.name}</strong>,<br><br>
        We received a request to reset the password for your FlowSync account (<strong style="color:#a29bfe">@${user.username}</strong>).<br><br>
        Click the button below to set a new password. This link expires in <strong style="color:#f0f0fa">1 hour</strong>.
      </div>
      <a href="${resetLink}" style="display:inline-block;background:#6c5ce7;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:600;margin-bottom:24px">Reset my password</a>
      <div style="font-size:12px;color:#4a4a66;line-height:1.6;border-top:1px solid #252538;padding-top:18px">
        If you didn't request this, you can safely ignore this email — your password won't change.<br><br>
        Or copy this link into your browser:<br>
        <span style="color:#6c5ce7;word-break:break-all">${resetLink}</span>
      </div>
    </div>
  </div>
</body>
</html>`
    );

    console.log('📧  Reset email sent to:', user.email);
    return ok(res, { message: 'If that email exists, a reset link has been sent.' });
  } catch (e) {
    console.error('Forgot password error:', e.message);
    return err(res, 'Failed to send reset email. Please try again.', 500);
  }
});

// RESET PASSWORD — validate token and set new password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return err(res, 'Token and new password are required');
    if (password.length < 6)  return err(res, 'Password must be at least 6 characters');

    const reset = await col('passwordresets').findOne({ token });
    if (!reset)                       return err(res, 'Reset link is invalid', 400);
    if (new Date() > new Date(reset.expiresAt))
                                      return err(res, 'Reset link has expired — request a new one', 400);

    // Update password
    await col('users').updateOne(
      { username: reset.username },
      { $set: { password: hash(password), updatedAt: now() } }
    );

    // Delete used token
    await col('passwordresets').deleteOne({ token });

    console.log('🔑  Password reset for:', reset.username);
    return ok(res, { message: 'Password updated successfully. You can now log in.' });
  } catch (e) { return err(res, e.message, 500); }
});

// VERIFY RESET TOKEN — check if token is still valid (for the reset page)
app.get('/api/auth/verify-token/:token', async (req, res) => {
  try {
    const reset = await col('passwordresets').findOne({ token: req.params.token });
    if (!reset || new Date() > new Date(reset.expiresAt))
      return err(res, 'Reset link is invalid or expired', 400);
    return ok(res, { username: reset.username });
  } catch (e) { return err(res, e.message, 500); }
});

// ══════════════════════════════════════════════════════════════════════════
//  SCHEDULES
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/schedules/:username', async (req, res) => {
  try {
    const docs = await col('schedules').find({ username: req.params.username }).sort({ updatedAt: -1 }).toArray();
    res.json(docs);
  } catch (e) { return err(res, e.message, 500); }
});
app.post('/api/schedules', async (req, res) => {
  try {
    const { username, name, slots } = req.body;
    if (!username || !name || !slots) return err(res, 'Missing fields');
    await col('schedules').updateOne({ username, name }, { $set: { username, name, slots, updatedAt: now() } }, { upsert: true });
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});
app.delete('/api/schedules/:username/:name', async (req, res) => {
  try {
    await col('schedules').deleteOne({ username: req.params.username, name: decodeURIComponent(req.params.name) });
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});

// ══════════════════════════════════════════════════════════════════════════
//  WEEKLY PLANS
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/weeklyplans/:username', async (req, res) => {
  try {
    const docs = await col('weeklyplans').find({ username: req.params.username }).sort({ updatedAt: -1 }).toArray();
    res.json(docs);
  } catch (e) { return err(res, e.message, 500); }
});
app.post('/api/weeklyplans', async (req, res) => {
  try {
    const { username, name, days } = req.body;
    if (!username || !name || !days) return err(res, 'Missing fields');
    await col('weeklyplans').updateOne({ username, name }, { $set: { username, name, days, updatedAt: now() } }, { upsert: true });
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});
app.delete('/api/weeklyplans/:username/:name', async (req, res) => {
  try {
    await col('weeklyplans').deleteOne({ username: req.params.username, name: decodeURIComponent(req.params.name) });
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});

// ══════════════════════════════════════════════════════════════════════════
//  TRACKER DATA
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/tracker/:username', async (req, res) => {
  try {
    const filter = { username: req.params.username };
    if (req.query.dates) filter.date = { $in: req.query.dates.split(',') };
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
      { $setOnInsert: { username, date, sched, slots, tasks, createdAt: now() }, $set: { updatedAt: now() } },
      { upsert: true }
    );
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});
app.patch('/api/tracker/:username/:date', async (req, res) => {
  try {
    const { tasks } = req.body;
    if (!tasks) return err(res, 'Missing tasks');
    await col('trackerdata').updateOne({ username: req.params.username, date: req.params.date }, { $set: { tasks, updatedAt: now() } });
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});

// ══════════════════════════════════════════════════════════════════════════
//  APPLIED RANGES
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/appliedranges/:username', async (req, res) => {
  try {
    const docs = await col('appliedranges').find({ username: req.params.username }).sort({ appliedAt: -1 }).toArray();
    res.json(docs);
  } catch (e) { return err(res, e.message, 500); }
});
app.post('/api/appliedranges', async (req, res) => {
  try {
    const { username, plan, from, to, repeat } = req.body;
    if (!username || !plan) return err(res, 'Missing fields');
    await col('appliedranges').insertOne({ username, plan, from, to, repeat, appliedAt: now() });
    return ok(res);
  } catch (e) { return err(res, e.message, 500); }
});

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [users, schedules, weeklyplans, trackerdays] = await Promise.all([
      col('users').countDocuments(), col('schedules').countDocuments(),
      col('weeklyplans').countDocuments(), col('trackerdata').countDocuments(),
    ]);
    const allTracker = await col('trackerdata').find({}).toArray();
    let totalTasks=0, doneTasks=0;
    allTracker.forEach(d => Object.values(d.tasks||{}).forEach(v => {
      if (v===true){ totalTasks++; doneTasks++; } if (v===false) totalTasks++;
    }));
    res.json({ users, schedules, weeklyplans, trackerdays, totalTasks, doneTasks, globalPct: totalTasks?Math.round(doneTasks/totalTasks*100):0 });
  } catch (e) { return err(res, e.message, 500); }
});
app.get('/api/admin/users', async (req, res) => {
  try {
    const docs = await col('users').find({}, { projection: { password:0 } }).sort({ createdAt:-1 }).toArray();
    res.json(docs);
  } catch (e) { return err(res, e.message, 500); }
});
app.get('/api/admin/schedules', async (req, res) => {
  try { res.json(await col('schedules').find({}).sort({ username:1 }).toArray()); }
  catch (e) { return err(res, e.message, 500); }
});
app.get('/api/admin/tracker', async (req, res) => {
  try { res.json(await col('trackerdata').find({}).sort({ date:-1 }).limit(300).toArray()); }
  catch (e) { return err(res, e.message, 500); }
});
app.delete('/api/admin/users/:username', async (req, res) => {
  try {
    const u = req.params.username;
    await Promise.all([
      col('users').deleteOne({ username:u }),
      col('schedules').deleteMany({ username:u }),
      col('weeklyplans').deleteMany({ username:u }),
      col('trackerdata').deleteMany({ username:u }),
      col('appliedranges').deleteMany({ username:u }),
      col('passwordresets').deleteMany({ username:u }),
    ]);
    return ok(res, { deleted:u });
  } catch (e) { return err(res, e.message, 500); }
});
