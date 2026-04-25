# Start the YANA Bot

## Step 1 — Start PostgreSQL (Windows)

PostgreSQL does not auto-start on Windows. Open PowerShell as Administrator:

```powershell
Start-Service postgresql-x64-16
```

Or via pg_ctl:
```bash
"C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe" start -D "C:\Program Files\PostgreSQL\16\data"
```

## Step 2 — Start Redis

Redis should already be running. Verify:
```bash
redis-cli ping
# Expected: PONG
```

## Step 3 — Start the server

```bash
npm run dev
```

Expected output:
```
[INFO ] [Platform] YANA / OGO Platform starting...
[INFO ] [Platform] Server started {"port":"3000"}
[DEBUG] [Database] New connection established
[INFO ] [StateStore] Redis client connected {"host":"localhost","port":6379}
```

If you see `Database unavailable` warnings, PostgreSQL isn't running or credentials are wrong.

## Step 4 — Expose to Twilio (for WhatsApp testing)

```bash
ngrok http 3000
```

Copy the `https://` URL and set it as your Twilio WhatsApp Sandbox webhook.

## Step 5 — Send a message

Send `Hi` to your Twilio sandbox number on WhatsApp. You should receive the numbered menu within 1–2 seconds.

---

## Troubleshooting

**"Database unavailable"** → PostgreSQL not running or wrong credentials in `.env`

**"Redis client error"** → Redis not running. Start with `redis-server`

**No reply on WhatsApp** → Check ngrok is running and Twilio webhook URL is correct

**Port 3000 in use:**
```bash
netstat -ano | findstr :3000
taskkill /PID <pid> /F
```
