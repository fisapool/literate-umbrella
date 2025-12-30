const { createClient } = require('@supabase/supabase-js');

/**
 * Export Apify dataset to Supabase
 * @param {Object} dataset - Apify Dataset instance
 * @param {Object} supabaseConfig - Supabase configuration { url, key }
 * @returns {Promise<Object>} Export statistics
 */
async function exportDatasetToSupabase(dataset, supabaseConfig) {
    const { url, key } = supabaseConfig;

    if (!url || !key) {
        throw new Error('Supabase URL and key are required');
    }

    const supabase = createClient(url, key);

    console.log('Starting dataset export to Supabase...');

    // Fetch all items from dataset
    // dataset can be an Apify Dataset or a mock object with getData() method
    const datasetData = await dataset.getData();
    const items = datasetData.items || [];
    const totalItems = items.length;

    console.log(`Found ${totalItems} items in dataset`);

    if (totalItems === 0) {
        console.log('No items to export');
        return {
            total: 0,
            inserted: 0,
            updated: 0,
            errors: 0
        };
    }

    // Transform data to match Supabase schema
    const transformedItems = items.map(item => ({
        nsr_no: item.nsrNo || item.nsr_no,
        name: item.name || null,
        title: item.title || null,
        gender: item.gender || null,
        specialty: item.specialty || null,
        state: item.state || null,
        state_id: item.stateId || item.state_id || null,
        state_category: item.state_category || item.stateCategory || null,
        city: item.city || null,
        address: item.address || null,
        establishment: item.establishment || null,
        sector: item.sector || null,
        last_renewal_date: item.lastRenewalDate || item.last_renewal_date || null,
        profile_url: item.profileUrl || item.profile_url || null,
        qualifications: item.qualifications || null,
        qualifications_structured: item.qualificationsStructured || item.qualifications_structured || null,
        last_scraped: new Date().toISOString()
    }));

    // Filter out items without valid NSR number
    const validItems = transformedItems.filter(item => item.nsr_no);

    if (validItems.length < totalItems) {
        console.log(`Warning: ${totalItems - validItems.length} items skipped due to missing NSR number`);
    }

    // Batch upsert to Supabase (upsert uses nsr_no as unique key)
    const batchSize = 1000;
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    const errorDetails = [];

    for (let i = 0; i < validItems.length; i += batchSize) {
        const batch = validItems.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(validItems.length / batchSize);

        console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} items)...`);

        try {
            const { data, error } = await supabase
                .from('specialists')
                .upsert(batch, {
                    onConflict: 'nsr_no',
                    ignoreDuplicates: false
                })
                .select('nsr_no');

            if (error) {
                throw error;
            }

            // Count new vs updated (rough estimate - Supabase doesn't return this directly)
            // We'll track by checking if record existed before
            const existingCount = await supabase
                .from('specialists')
                .select('nsr_no', { count: 'exact', head: true })
                .in('nsr_no', batch.map(item => item.nsr_no));

            // For simplicity, we'll assume all are updates if we have existing records
            // In production, you might want to track this more precisely
            updated += batch.length;
            console.log(`Batch ${batchNum} completed successfully`);
        } catch (error) {
            console.error(`Error processing batch ${batchNum}:`, error.message);
            errors += batch.length;
            errorDetails.push({
                batch: batchNum,
                error: error.message,
                items: batch.length
            });

            // Try individual inserts for this batch to identify problematic records
            for (const item of batch) {
                try {
                    await supabase
                        .from('specialists')
                        .upsert(item, { onConflict: 'nsr_no' });
                    updated++;
                    errors--;
                } catch (itemError) {
                    console.error(`Failed to insert item ${item.nsr_no}:`, itemError.message);
                }
            }
        }
    }

    // Get final count from Supabase
    const { count: finalCount } = await supabase
        .from('specialists')
        .select('*', { count: 'exact', head: true });

    const stats = {
        total: totalItems,
        valid: validItems.length,
        inserted: 0, // Approximate - Supabase upsert doesn't distinguish
        updated: updated,
        errors: errors,
        finalCount: finalCount || 0,
        errorDetails: errorDetails.length > 0 ? errorDetails : undefined
    };

    console.log('Export completed:', stats);

    if (errors > 0) {
        console.warn(`Export completed with ${errors} errors. Check errorDetails for details.`);
    }

    return stats;
}

/**
 * Validate export by comparing row counts
 * @param {Object} supabaseConfig - Supabase configuration
 * @param {number} expectedCount - Expected number of records
 * @returns {Promise<Object>} Validation result
 */
async function validateExport(supabaseConfig, expectedCount) {
    const { url, key } = supabaseConfig;
    const supabase = createClient(url, key);

    const { count, error } = await supabase
        .from('specialists')
        .select('*', { count: 'exact', head: true });

    if (error) {
        throw new Error(`Validation failed: ${error.message}`);
    }

    const actualCount = count || 0;
    const difference = Math.abs(actualCount - expectedCount);
    const threshold = Math.max(10, expectedCount * 0.01); // 1% or 10 records, whichever is larger

    return {
        expected: expectedCount,
        actual: actualCount,
        difference,
        withinThreshold: difference <= threshold,
        threshold
    };
}

module.exports = {
    exportDatasetToSupabase,
    validateExport
};

