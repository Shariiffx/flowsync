# FlowSync v3 — Setup Guide

## MongoDB Atlas ✅
- Cluster : flowsync.0yqwxte.mongodb.net
- User    : myselfsharifmolla_db_user
- Database: flowsync
- Collections auto-created on first run:
    users · schedules · weeklyplans · trackerdata · appliedranges

---

## Run in 3 steps

### 1 — Install Node.js
Download from https://nodejs.org  (LTS version, 18+)

### 2 — Start the backend
```bash
cd backend
npm install
npm start
```
You should see:
```
✅  MongoDB Atlas connected  →  database: flowsync
🚀  FlowSync API  →  http://localhost:3001
```

### 3 — Open the frontend
Double-click  frontend/index.html  in your file explorer
(or drag it into Chrome / Firefox)

The green dot in the top bar confirms the DB is live.

---

## Atlas Network Access (IMPORTANT)
If the backend fails to connect, go to:
  Atlas → Security → Network Access → + Add IP → Allow Access from Anywhere (0.0.0.0/0)

---

## Push to GitHub
```bash
git add .
git commit -m "FlowSync v3 — full MongoDB backend"
git push
```

---

## Security reminder
Change your DB password after testing:
  Atlas → Database Access → Edit User → Edit Password
