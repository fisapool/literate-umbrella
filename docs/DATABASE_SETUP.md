# NSR Scraper Database Setup Guide

Complete guide for setting up Supabase database, webhook integration, API server, monitoring, and scheduled crawls.

## Table of Contents

1. [Supabase Setup](#supabase-setup)
2. [Database Schema](#database-schema)
3. [Webhook Configuration](#webhook-configuration)
4. [API Server Setup](#api-server-setup)
5. [Security Configuration](#security-configuration)
6. [Monitoring Setup](#monitoring-setup)
7. [Scheduled Crawls](#scheduled-crawls)
8. [Testing](#testing)
9. [Troubleshooting](#troubleshooting)

## Supabase Setup

### Step 1: Create Supabase Project

1. Go to [Supabase](https://app.supabase.com)
2. Click **New Project**
3. Fill in:
   - **Name**: e.g., "NSR Scraper"
   - **Database Password**: Choose a strong password
   - **Region**: Select closest to your users
4. Click **Create new project**
5. Wait for project to initialize (2-3 minutes)

### Step 2: Get API Credentials

1. Go to **Settings** → **API**
2. Copy:
   - **Project URL** (SUPABASE_URL)
   - **anon/public key** (SUPABASE_KEY)
3. Save these for environment variables

## Database Schema

### Step 1: Run Schema Migration

1. Go to **SQL Editor** in Supabase dashboard
2. Open `supabase/schema.sql` from this project
3. Copy the entire SQL script
4. Paste into SQL Editor
5. Click **Run** (or press Cmd/Ctrl + Enter)
6. Verify success message

### Step 2: Verify Schema

Run this query to verify the table was created:

```sql
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'specialists'
ORDER BY ordinal_position;
```

You should see all columns including `nsr_no`, `name`, `specialty`, `last_scraped`, etc.

### Step 3: Verify Indexes

```sql
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'specialists';
```

You should see indexes on `state`, `specialty`, `state_specialty`, and `last_scraped`.

## Webhook Configuration

See [WEBHOOK_SETUP.md](./WEBHOOK_SETUP.md) for detailed webhook setup instructions.

### Quick Setup

1. Deploy webhook endpoint (Vercel, Netlify, or Express server)
2. In Apify Console → Actor → Integrations → Webhooks
3. Add webhook:
   - Event: `ACTOR.RUN.SUCCEEDED`
   - URL: Your webhook endpoint
   - Method: `POST`

## API Server Setup

### Option A: Local Development

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file from `.env.example`:
```bash
cp .env.example .env
```

3. Fill in environment variables:
```bash
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-supabase-anon-key
API_PORT=3000
API_KEY=your-secure-api-key-here
```

4. Start server:
```bash
node api/server.js
```

Server will run on `http://localhost:3000`

### Option B: Production Deployment

#### Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Create `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "api/server.js"
    }
  ]
}
```

3. Deploy: `vercel --prod`

#### Railway/Render

1. Set start command: `node api/server.js`
2. Set environment variables
3. Deploy

## Security Configuration

### API Key Authentication

1. Generate a secure API key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. Set in environment:
```bash
API_KEY=your-generated-key
```

3. Use in API requests:
```bash
curl -H "X-API-Key: your-generated-key" \
  http://localhost:3000/api/specialists
```

### Rate Limiting

Rate limiting is configured by default:
- **Window**: 15 minutes
- **Max requests**: 100 per IP
- Adjust in `api/server.js` if needed

### Supabase Row Level Security (Optional)

For additional security, enable RLS:

```sql
-- Enable RLS
ALTER TABLE specialists ENABLE ROW LEVEL SECURITY;

-- Create policy (adjust as needed)
CREATE POLICY "Allow read access" ON specialists
    FOR SELECT
    USING (true);
```

## Monitoring Setup

### Apify Notifications

1. Go to Apify Console → Actor → Integrations → Notifications
2. Add notification:
   - **Event**: `ACTOR.RUN.FAILED` or `ACTOR.RUN.TIMED_OUT`
   - **Channel**: Email or Slack
   - **Recipients**: Your email/Slack webhook

### Data Freshness Monitoring

Use the monitoring utilities:

```javascript
const { validateDataFreshness } = require('./api/monitoring');

const result = await validateDataFreshness({
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY
}, 24); // Max age: 24 hours

console.log(result);
// { fresh: true, lastScraped: '2024-01-01T00:00:00Z', ageHours: 12 }
```

### Row Count Checks

```javascript
const { checkRowCounts } = require('./api/monitoring');

const stats = await checkRowCounts({
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY
});

console.log(stats);
// { total: 5000, byState: { 'Johor': 500, ... }, lastScraped: '...' }
```

## Scheduled Crawls

### Step 1: Create Schedule in Apify

1. Go to Apify Console → Actor → **Schedules**
2. Click **Create Schedule**
3. Configure:
   - **Name**: "Daily NSR Crawl"
   - **Cron**: `0 2 * * *` (daily at 2 AM UTC)
   - **Input**: Leave default or customize
4. Click **Create**

### Step 2: Verify Webhook Integration

Ensure webhook is configured (see [Webhook Configuration](#webhook-configuration))

### Step 3: Monitor Scheduled Runs

- Check Apify Console → **Runs** for scheduled executions
- Monitor webhook logs for export confirmations
- Verify data updates in Supabase

## Testing

### Test Database Connection

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{
  "status": "ok",
  "database": {
    "connected": true,
    "recordCount": 0
  }
}
```

### Test API Endpoints

1. **List specialists**:
```bash
curl -H "X-API-Key: your-key" \
  "http://localhost:3000/api/specialists?state=Johor&limit=10"
```

2. **Get single specialist**:
```bash
curl -H "X-API-Key: your-key" \
  "http://localhost:3000/api/specialists/123456"
```

3. **Get statistics**:
```bash
curl -H "X-API-Key: your-key" \
  "http://localhost:3000/api/stats?groupBy=state"
```

### Test Webhook

1. Run scraper manually in Apify
2. Check webhook endpoint logs
3. Verify data in Supabase

## Troubleshooting

### Database Connection Issues

**Problem**: API returns database connection errors

**Solutions**:
- Verify `SUPABASE_URL` and `SUPABASE_KEY` are correct
- Check Supabase project is active (not paused)
- Verify network connectivity

### Export Failures

**Problem**: Webhook reports export errors

**Solutions**:
- Check Supabase credentials in webhook environment
- Verify schema is deployed correctly
- Review webhook logs for specific error messages
- Check Supabase project quota/limits

### Row Count Mismatches

**Problem**: Validation shows row count differences

**Solutions**:
- Verify dataset was fully scraped (check Apify run)
- Check for duplicate NSR numbers
- Review export logs for skipped records
- Re-run export if needed

### API Authentication Issues

**Problem**: 401/403 errors from API

**Solutions**:
- Verify `X-API-Key` header is included
- Check `API_KEY` environment variable matches
- Ensure API key is set in production environment

### Rate Limiting

**Problem**: Too many requests errors

**Solutions**:
- Adjust rate limit settings in `api/server.js`
- Use API key rotation for high-volume clients
- Consider caching for frequently accessed data

## Next Steps

- Set up monitoring dashboards (Grafana, Datadog, etc.)
- Implement delta crawls using `last_scraped` field
- Add additional API endpoints as needed
- Set up automated backups for Supabase

## Support

For issues or questions:
1. Check logs in Apify Console
2. Review Supabase dashboard for errors
3. Check webhook endpoint logs
4. Review this documentation

