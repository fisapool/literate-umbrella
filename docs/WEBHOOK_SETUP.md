# Apify Webhook Setup Guide

This guide explains how to set up the Apify webhook to automatically export scraped data to Supabase when a crawl completes.

## Overview

The webhook approach provides cleaner separation of concerns:
- **Crawler**: Focuses solely on scraping data
- **Webhook**: Handles database export reliably with retries and validation

## Prerequisites

1. Deployed webhook endpoint (see deployment options below)
2. Supabase project with schema deployed
3. Environment variables configured

## Step 1: Deploy Webhook Endpoint

### Option A: Vercel/Netlify Function

1. Create a new function file: `api/webhook.js` (or `netlify/functions/webhook.js`)
2. Copy the webhook router code from `api/webhook.js`
3. Deploy to Vercel or Netlify
4. Note the webhook URL (e.g., `https://your-app.vercel.app/api/webhook`)

### Option B: Express Server

1. Deploy the Express server (`api/server.js`) to your hosting provider
2. Ensure the server is accessible publicly
3. Note the webhook URL (e.g., `https://api.yourdomain.com/api/webhook`)

### Option C: Apify Webhook Service

You can also create a separate Apify Actor that handles webhooks, but the external service approach is recommended for better reliability.

## Step 2: Configure Apify Webhook

1. Go to your Apify Actor in the Apify Console
2. Navigate to **Integrations** → **Webhooks**
3. Click **Add Webhook**
4. Configure the webhook:
   - **Event**: Select `ACTOR.RUN.SUCCEEDED`
   - **URL**: Enter your webhook endpoint URL
   - **Method**: `POST`
   - **Headers** (optional): Add any required headers
   - **Payload**: Leave default (Apify will send the run event)

5. Click **Save**

## Step 3: Configure Environment Variables

Set these environment variables in your webhook service:

```bash
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-supabase-anon-key
WEBHOOK_NOTIFICATION_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL  # Optional
```

For Apify Actors, set these in:
- **Settings** → **Environment variables** (for the webhook service)
- Or use Apify Secrets for sensitive values

## Step 4: Test the Webhook

1. Run your scraper Actor manually
2. Wait for it to complete successfully
3. Check the webhook endpoint logs for export confirmation
4. Verify data in Supabase

## Step 5: Set Up Scheduled Crawls

1. In Apify Console, go to your Actor
2. Navigate to **Schedules**
3. Click **Create Schedule**
4. Configure:
   - **Name**: e.g., "Daily NSR Crawl"
   - **Cron expression**: e.g., `0 2 * * *` (daily at 2 AM)
   - **Input**: Use default or configure specific states
5. Click **Create**

The webhook will automatically trigger after each scheduled run completes.

## Monitoring

- Check webhook logs in your hosting provider
- Monitor Supabase dashboard for new records
- Set up notifications (Slack, email) via `WEBHOOK_NOTIFICATION_URL`
- Use the monitoring utilities in `api/monitoring.js` to check data freshness

## Troubleshooting

### Webhook not triggering
- Verify the webhook is configured for `ACTOR.RUN.SUCCEEDED` event
- Check that the Actor run actually succeeded
- Review Apify webhook logs in the console

### Export failures
- Check Supabase credentials are correct
- Verify database schema is deployed
- Review webhook endpoint logs for error details
- Ensure Supabase project has sufficient quota

### Row count mismatches
- Check webhook validation logs
- Verify dataset was fully scraped
- Review for duplicate NSR numbers or data issues

