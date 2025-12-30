const express = require('express');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.API_PORT || 3000;

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// Middleware
app.use(express.json());

// API Key authentication middleware
const authenticateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'API key required. Provide X-API-Key header.'
        });
    }

    // Validate API key (in production, use a proper key management system)
    const validApiKey = process.env.API_KEY;
    if (!validApiKey) {
        console.warn('API_KEY environment variable not set. API authentication disabled.');
        return next();
    }

    if (apiKey !== validApiKey) {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Invalid API key'
        });
    }

    next();
};

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api', limiter);
app.use('/api', authenticateApiKey);

// Import webhook routes
const webhookRouter = require('./webhook');
app.use('/api/webhook', webhookRouter);

/**
 * GET /api/specialists
 * Query specialists with filtering and pagination
 * 
 * Query parameters:
 * - state: Filter by state name
 * - specialty: Filter by specialty (partial match)
 * - name: Search by name (partial match)
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50, max: 100)
 */
app.get('/api/specialists', async (req, res) => {
    try {
        const {
            state,
            specialty,
            name,
            page = 1,
            limit = 50
        } = req.query;

        const pageNum = parseInt(page) || 1;
        const limitNum = Math.min(parseInt(limit) || 50, 100);
        const offset = (pageNum - 1) * limitNum;

        // Build query
        let query = supabase
            .from('specialists')
            .select('*', { count: 'exact' });

        // Apply filters
        if (state) {
            query = query.ilike('state', `%${state}%`);
        }

        if (specialty) {
            query = query.ilike('specialty', `%${specialty}%`);
        }

        if (name) {
            query = query.ilike('name', `%${name}%`);
        }

        // Apply pagination
        query = query
            .range(offset, offset + limitNum - 1)
            .order('name', { ascending: true });

        const { data, error, count } = await query;

        if (error) {
            throw error;
        }

        res.json({
            data: data || [],
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limitNum)
            }
        });
    } catch (error) {
        console.error('Error fetching specialists:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

/**
 * GET /api/specialists/:nsrNo
 * Get a single specialist by NSR number
 */
app.get('/api/specialists/:nsrNo', async (req, res) => {
    try {
        const { nsrNo } = req.params;

        const { data, error } = await supabase
            .from('specialists')
            .select('*')
            .eq('nsr_no', nsrNo)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    error: 'Not found',
                    message: `Specialist with NSR number ${nsrNo} not found`
                });
            }
            throw error;
        }

        res.json({ data });
    } catch (error) {
        console.error('Error fetching specialist:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

/**
 * GET /api/stats
 * Get statistics about specialists
 * 
 * Query parameters:
 * - groupBy: 'state' or 'specialty' (default: 'state')
 */
app.get('/api/stats', async (req, res) => {
    try {
        const { groupBy = 'state' } = req.query;

        if (groupBy === 'state') {
            const { data, error } = await supabase
                .from('specialists')
                .select('state, state_id')
                .not('state', 'is', null);

            if (error) throw error;

            // Count by state
            const stateCounts = {};
            (data || []).forEach(item => {
                const state = item.state || 'Unknown';
                stateCounts[state] = (stateCounts[state] || 0) + 1;
            });

            res.json({
                groupBy: 'state',
                counts: stateCounts,
                total: Object.values(stateCounts).reduce((a, b) => a + b, 0)
            });
        } else if (groupBy === 'specialty') {
            const { data, error } = await supabase
                .from('specialists')
                .select('specialty')
                .not('specialty', 'is', null);

            if (error) throw error;

            // Count by specialty
            const specialtyCounts = {};
            (data || []).forEach(item => {
                const specialty = item.specialty || 'Unknown';
                specialtyCounts[specialty] = (specialtyCounts[specialty] || 0) + 1;
            });

            res.json({
                groupBy: 'specialty',
                counts: specialtyCounts,
                total: Object.values(specialtyCounts).reduce((a, b) => a + b, 0)
            });
        } else {
            res.status(400).json({
                error: 'Invalid groupBy parameter',
                message: "groupBy must be 'state' or 'specialty'"
            });
        }
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', async (req, res) => {
    try {
        // Check Supabase connection
        const { count, error } = await supabase
            .from('specialists')
            .select('*', { count: 'exact', head: true });

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            database: {
                connected: !error,
                recordCount: count || 0,
                error: error?.message
            }
        });
    } catch (error) {
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`API server running on port ${PORT}`);
        console.log(`Health check: http://localhost:${PORT}/api/health`);
    });
}

module.exports = app;

