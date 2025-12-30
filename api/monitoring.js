const { createClient } = require('@supabase/supabase-js');

/**
 * Monitoring utilities for Supabase database
 */

/**
 * Check Supabase row counts
 * @param {Object} supabaseConfig - Supabase configuration { url, key }
 * @returns {Promise<Object>} Row count statistics
 */
async function checkRowCounts(supabaseConfig) {
    const { url, key } = supabaseConfig;
    const supabase = createClient(url, key);

    try {
        // Get total count
        const { count: totalCount, error: totalError } = await supabase
            .from('specialists')
            .select('*', { count: 'exact', head: true });

        if (totalError) throw totalError;

        // Get count by state
        const { data: stateData, error: stateError } = await supabase
            .from('specialists')
            .select('state')
            .not('state', 'is', null);

        if (stateError) throw stateError;

        const stateCounts = {};
        (stateData || []).forEach(item => {
            const state = item.state || 'Unknown';
            stateCounts[state] = (stateCounts[state] || 0) + 1;
        });

        // Get most recent scrape time
        const { data: recentData, error: recentError } = await supabase
            .from('specialists')
            .select('last_scraped')
            .order('last_scraped', { ascending: false })
            .limit(1)
            .single();

        return {
            total: totalCount || 0,
            byState: stateCounts,
            lastScraped: recentData?.last_scraped || null,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        throw new Error(`Failed to check row counts: ${error.message}`);
    }
}

/**
 * Validate data freshness
 * @param {Object} supabaseConfig - Supabase configuration
 * @param {number} maxAgeHours - Maximum age in hours before data is considered stale
 * @returns {Promise<Object>} Freshness validation result
 */
async function validateDataFreshness(supabaseConfig, maxAgeHours = 24) {
    const { url, key } = supabaseConfig;
    const supabase = createClient(url, key);

    try {
        // Get most recent scrape time
        const { data, error } = await supabase
            .from('specialists')
            .select('last_scraped')
            .order('last_scraped', { ascending: false })
            .limit(1)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return {
                    fresh: false,
                    message: 'No data found in database',
                    lastScraped: null
                };
            }
            throw error;
        }

        const lastScraped = data?.last_scraped ? new Date(data.last_scraped) : null;
        if (!lastScraped) {
            return {
                fresh: false,
                message: 'No scrape timestamp found',
                lastScraped: null
            };
        }

        const now = new Date();
        const ageHours = (now - lastScraped) / (1000 * 60 * 60);
        const isFresh = ageHours <= maxAgeHours;

        return {
            fresh: isFresh,
            lastScraped: lastScraped.toISOString(),
            ageHours: Math.round(ageHours * 100) / 100,
            maxAgeHours,
            message: isFresh
                ? `Data is fresh (${Math.round(ageHours * 100) / 100} hours old)`
                : `Data is stale (${Math.round(ageHours * 100) / 100} hours old, max: ${maxAgeHours} hours)`
        };
    } catch (error) {
        throw new Error(`Failed to validate data freshness: ${error.message}`);
    }
}

/**
 * Get export statistics
 * @param {Object} supabaseConfig - Supabase configuration
 * @returns {Promise<Object>} Export statistics
 */
async function getExportStats(supabaseConfig) {
    const { url, key } = supabaseConfig;
    const supabase = createClient(url, key);

    try {
        // Get counts by scrape time (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data, error } = await supabase
            .from('specialists')
            .select('last_scraped, scraped_at')
            .gte('last_scraped', sevenDaysAgo.toISOString());

        if (error) throw error;

        const stats = {
            totalRecords: 0,
            recordsScrapedLast7Days: data?.length || 0,
            lastScrapeTime: null,
            scrapeFrequency: 'unknown'
        };

        // Get total count
        const { count, error: countError } = await supabase
            .from('specialists')
            .select('*', { count: 'exact', head: true });

        if (!countError) {
            stats.totalRecords = count || 0;
        }

        // Get most recent scrape
        if (data && data.length > 0) {
            const sorted = data.sort((a, b) => {
                const timeA = new Date(a.last_scraped || a.scraped_at || 0);
                const timeB = new Date(b.last_scraped || b.scraped_at || 0);
                return timeB - timeA;
            });
            stats.lastScrapeTime = sorted[0].last_scraped || sorted[0].scraped_at;
        }

        return stats;
    } catch (error) {
        throw new Error(`Failed to get export stats: ${error.message}`);
    }
}

module.exports = {
    checkRowCounts,
    validateDataFreshness,
    getExportStats
};

