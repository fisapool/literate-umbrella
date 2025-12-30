#!/usr/bin/env node

/**
 * Performance timing script for full crawl
 * Measures execution time and compares with baseline
 */

const { Actor } = require('apify');
const fs = require('fs');
const path = require('path');

// Configuration
const OUTPUT_DIR = path.join(__dirname, 'test-output');
const TIMING_RESULTS_FILE = path.join(OUTPUT_DIR, 'timing-results.json');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Load previous timing results for comparison
 */
function loadPreviousResults() {
    if (fs.existsSync(TIMING_RESULTS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(TIMING_RESULTS_FILE, 'utf8'));
        } catch (error) {
            console.warn('Could not load previous results:', error.message);
        }
    }
    return null;
}

/**
 * Save timing results
 */
function saveResults(results) {
    const allResults = loadPreviousResults() || { runs: [] };
    allResults.runs.push(results);
    allResults.lastRun = results;
    fs.writeFileSync(TIMING_RESULTS_FILE, JSON.stringify(allResults, null, 2));
}

/**
 * Format duration
 */
function formatDuration(seconds) {
    if (seconds < 60) {
        return `${seconds.toFixed(2)}s`;
    } else if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(0);
        return `${mins}m ${secs}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = (seconds % 60).toFixed(0);
        return `${hours}h ${mins}m ${secs}s`;
    }
}

/**
 * Main timing function
 */
async function runTimingTest() {
    console.log('='.repeat(60));
    console.log('NSR Scraper Performance Timing Test');
    console.log('='.repeat(60));
    console.log('');

    // Load input configuration
    let input;
    const inputFile = path.join(__dirname, 'input.json');
    if (fs.existsSync(inputFile)) {
        input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    } else {
        console.error('input.json not found. Using default configuration.');
        input = {
            states: [],
            maxConcurrency: 30,
            maxRequestsPerCrawl: 0
        };
    }

    const testConfig = {
        states: input.states || [],
        maxConcurrency: input.maxConcurrency || 30,
        maxRequestsPerCrawl: input.maxRequestsPerCrawl || 0,
        timestamp: new Date().toISOString()
    };

    console.log('Test Configuration:');
    console.log(`  States: ${testConfig.states.length > 0 ? testConfig.states.join(', ') : 'ALL'}`);
    console.log(`  Max Concurrency: ${testConfig.maxConcurrency}`);
    console.log(`  Max Requests: ${testConfig.maxRequestsPerCrawl || 'unlimited'}`);
    console.log('');

    const startTime = Date.now();
    const timing = {
        startTime: new Date().toISOString(),
        config: testConfig,
        phases: {},
        summary: {}
    };

    // Initialize Actor
    await Actor.init({ storageDir: path.join(__dirname, 'test-storage-timing') });

    try {
        console.log('Starting crawl...\n');
        console.log('Note: This will run the full scraper. Make sure input.json is configured correctly.\n');

        // Run the scraper
        const crawlStartTime = Date.now();
        
        // Import and execute the main scraper
        // We need to wrap it to catch completion
        const { spawn } = require('child_process');
        const { promisify } = require('util');
        const exec = promisify(require('child_process').exec);
        
        console.log('Executing scraper (this may take a while)...\n');
        
        // Run the scraper as a subprocess and capture timing
        const scraperStart = Date.now();
        
        try {
            const { stdout, stderr } = await exec('node src/main.js', {
                cwd: __dirname,
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer
            });
            
            // Log output
            if (stdout) console.log(stdout);
            if (stderr) console.error(stderr);
            
        } catch (error) {
            // If the process exits with an error, we still want to measure time
            console.error('Scraper process error:', error.message);
            if (error.stdout) console.log(error.stdout);
            if (error.stderr) console.error(error.stderr);
        }
        
        const crawlEndTime = Date.now();
        const crawlDuration = (crawlEndTime - crawlStartTime) / 1000;

        timing.phases.crawl = {
            startTime: new Date(crawlStartTime).toISOString(),
            endTime: new Date(crawlEndTime).toISOString(),
            duration: crawlDuration
        };

        // Get dataset statistics
        const datasetInfo = await dataset.getInfo();
        
        const totalDuration = (Date.now() - startTime) / 1000;

        timing.summary = {
            totalDuration,
            crawlDuration,
            recordsCollected: datasetInfo?.itemCount || 0,
            requestsProcessed: 0, // Would need crawler stats to track this
            requestsFailed: 0,
            requestsRetried: 0,
            recordsPerSecond: datasetInfo?.itemCount ? parseFloat((datasetInfo.itemCount / totalDuration).toFixed(2)) : 0,
            requestsPerSecond: 0
        };

        timing.endTime = new Date().toISOString();

        // Print results
        console.log('\n' + '='.repeat(60));
        console.log('Performance Results');
        console.log('='.repeat(60));
        console.log(`Total Duration: ${formatDuration(timing.summary.totalDuration)}`);
        console.log(`Crawl Duration: ${formatDuration(timing.summary.crawlDuration)}`);
        console.log(`Records Collected: ${timing.summary.recordsCollected}`);
        console.log(`Records/Second: ${timing.summary.recordsPerSecond}`);
        console.log(`Requests Processed: ${timing.summary.requestsProcessed}`);
        console.log(`Requests/Second: ${timing.summary.requestsPerSecond}`);
        if (timing.summary.requestsFailed > 0) {
            console.log(`Requests Failed: ${timing.summary.requestsFailed}`);
        }
        console.log('');

        // Compare with previous results
        const previousResults = loadPreviousResults();
        if (previousResults && previousResults.lastRun) {
            const previous = previousResults.lastRun.summary;
            const current = timing.summary;

            console.log('Comparison with Previous Run:');
            console.log('─'.repeat(60));
            
            const durationDiff = current.totalDuration - previous.totalDuration;
            const durationPercent = ((durationDiff / previous.totalDuration) * 100).toFixed(1);
            const durationSymbol = durationDiff < 0 ? '↓' : '↑';
            console.log(`Duration: ${formatDuration(Math.abs(durationDiff))} ${durationSymbol} (${durationPercent}%)`);

            if (previous.recordsCollected > 0 && current.recordsCollected > 0) {
                const recordsDiff = current.recordsCollected - previous.recordsCollected;
                const recordsPercent = ((recordsDiff / previous.recordsCollected) * 100).toFixed(1);
                const recordsSymbol = recordsDiff > 0 ? '↑' : '↓';
                console.log(`Records: ${Math.abs(recordsDiff)} ${recordsSymbol} (${recordsPercent}%)`);
            }

            if (previous.recordsPerSecond > 0 && current.recordsPerSecond > 0) {
                const speedDiff = current.recordsPerSecond - previous.recordsPerSecond;
                const speedPercent = ((speedDiff / previous.recordsPerSecond) * 100).toFixed(1);
                const speedSymbol = speedDiff > 0 ? '↑' : '↓';
                console.log(`Speed: ${speedDiff.toFixed(2)} records/s ${speedSymbol} (${speedPercent}%)`);
            }

            console.log('');
        }

        // Save results
        saveResults(timing);
        console.log(`Results saved to: ${TIMING_RESULTS_FILE}`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('Timing test failed:', error);
        timing.error = error.message;
        timing.endTime = new Date().toISOString();
        saveResults(timing);
        process.exit(1);
    } finally {
        await Actor.exit();
    }
}

// Run timing test
if (require.main === module) {
    runTimingTest().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
}

module.exports = { runTimingTest };

