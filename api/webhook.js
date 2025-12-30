const express = require('express');
const { ApifyApi } = require('apify-client');
const { exportDatasetToSupabase, validateExport } = require('../src/export-to-db');

const router = express.Router();

/**
 * Webhook endpoint to receive Apify run completion events
 * POST /api/webhook
 * 
 * Expected payload from Apify:
 * {
 *   "eventType": "ACTOR.RUN.SUCCEEDED",
 *   "resource": {
 *     "defaultDatasetId": "...",
 *     "id": "run-id",
 *     "status": "SUCCEEDED",
 *     ...
 *   }
 * }
 */
router.post('/', async (req, res) => {
    try {
        const { eventType, resource } = req.body;

        // Validate webhook payload
        if (!eventType || !resource) {
            return res.status(400).json({
                error: 'Invalid webhook payload',
                message: 'Missing eventType or resource'
            });
        }

        // Only process successful runs
        if (eventType !== 'ACTOR.RUN.SUCCEEDED' || resource.status !== 'SUCCEEDED') {
            return res.status(200).json({
                message: 'Event ignored',
                eventType,
                status: resource.status
            });
        }

        const runId = resource.id;
        const datasetId = resource.defaultDatasetId;

        console.log(`Processing webhook for run ${runId}, dataset ${datasetId}`);

        // Get Supabase configuration from environment
        const supabaseConfig = {
            url: process.env.SUPABASE_URL,
            key: process.env.SUPABASE_KEY
        };

        if (!supabaseConfig.url || !supabaseConfig.key) {
            throw new Error('Supabase configuration missing. Set SUPABASE_URL and SUPABASE_KEY environment variables.');
        }

        // Initialize Apify client
        const apifyToken = process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN;
        if (!apifyToken) {
            throw new Error('APIFY_API_TOKEN environment variable is required');
        }

        const apifyClient = new ApifyApi({ token: apifyToken });

        // Fetch dataset items from Apify
        const datasetClient = apifyClient.dataset(datasetId);
        const datasetItems = await datasetClient.listItems();
        const expectedCount = datasetItems.total || 0;

        console.log(`Dataset contains ${expectedCount} items`);

        // Create a mock dataset object for export function
        const mockDataset = {
            getData: async () => ({ items: datasetItems.items })
        };

        // Export to Supabase
        const exportStats = await exportDatasetToSupabase(mockDataset, supabaseConfig);

        // Validate export
        const validation = await validateExport(supabaseConfig, expectedCount);

        // Prepare response
        const response = {
            success: true,
            runId,
            datasetId,
            export: exportStats,
            validation,
            timestamp: new Date().toISOString()
        };

        // Log warning if validation fails
        if (!validation.withinThreshold) {
            console.warn('Export validation warning:', {
                expected: validation.expected,
                actual: validation.actual,
                difference: validation.difference
            });
            response.warning = `Row count mismatch: expected ${validation.expected}, got ${validation.actual}`;
        }

        // Send notification if configured (e.g., Slack, email)
        if (process.env.WEBHOOK_NOTIFICATION_URL) {
            try {
                const https = require('https');
                const http = require('http');
                const url = require('url');
                const notificationUrl = new URL(process.env.WEBHOOK_NOTIFICATION_URL);
                const client = notificationUrl.protocol === 'https:' ? https : http;
                
                const postData = JSON.stringify({
                    text: `NSR Scraper export completed: ${exportStats.valid} items exported, ${validation.actual} total in database`,
                    success: validation.withinThreshold
                });

                const options = {
                    hostname: notificationUrl.hostname,
                    port: notificationUrl.port || (notificationUrl.protocol === 'https:' ? 443 : 80),
                    path: notificationUrl.pathname + notificationUrl.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                await new Promise((resolve, reject) => {
                    const req = client.request(options, (res) => {
                        res.on('data', () => {});
                        res.on('end', resolve);
                    });
                    req.on('error', reject);
                    req.write(postData);
                    req.end();
                });
            } catch (notifError) {
                console.error('Failed to send notification:', notifError.message);
            }
        }

        res.status(200).json(response);
    } catch (error) {
        console.error('Webhook error:', error);

        // Send error notification if configured
        if (process.env.WEBHOOK_NOTIFICATION_URL) {
            try {
                const https = require('https');
                const http = require('http');
                const url = require('url');
                const notificationUrl = new URL(process.env.WEBHOOK_NOTIFICATION_URL);
                const client = notificationUrl.protocol === 'https:' ? https : http;
                
                const postData = JSON.stringify({
                    text: `NSR Scraper export failed: ${error.message}`,
                    success: false,
                    error: error.message
                });

                const options = {
                    hostname: notificationUrl.hostname,
                    port: notificationUrl.port || (notificationUrl.protocol === 'https:' ? 443 : 80),
                    path: notificationUrl.pathname + notificationUrl.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                await new Promise((resolve, reject) => {
                    const req = client.request(options, (res) => {
                        res.on('data', () => {});
                        res.on('end', resolve);
                    });
                    req.on('error', reject);
                    req.write(postData);
                    req.end();
                });
            } catch (notifError) {
                console.error('Failed to send error notification:', notifError.message);
            }
        }

        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Health check endpoint
 * GET /api/webhook/health
 */
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY)
    });
});

module.exports = router;

