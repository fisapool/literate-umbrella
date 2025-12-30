const { Actor, Dataset } = require('apify');
const { PlaywrightCrawler } = require('crawlee');
const {
    MALAYSIAN_STATES,
    NSR_SEARCH_URL,
    STATE_NAME_TO_ID
} = require('./constants');
const {
    parseListingPage,
    parseProfilePage,
    hasResults
} = require('./parser');
const { getStateById, sleep } = require('./utils');

/**
 * Main Actor entry point
 */
Actor.main(async () => {
    const input = await Actor.getInput();

    const {
        startUrls = [],
        states = [],
        maxConcurrency = 5,
        maxRequestsPerCrawl = 0,
        proxyConfiguration = { useApifyProxy: true }
    } = input || {};

    console.log('Starting NSR Scraper...');
    console.log('Configuration:', {
        statesCount: states.length || 'all',
        maxConcurrency,
        maxRequestsPerCrawl
    });

    // Generate start URLs if not provided
    const urls = [];

    if (startUrls.length > 0) {
        // Use provided URLs
        urls.push(...startUrls);
    } else {
        // Generate URLs for each state
        const statesToScrape = states.length > 0
            ? states.map(s => STATE_NAME_TO_ID[s.toLowerCase()]).filter(Boolean)
            : Object.keys(MALAYSIAN_STATES).map(id => parseInt(id));

        for (const stateId of statesToScrape) {
            const stateInfo = getStateById(stateId);
            if (!stateInfo) continue;

            // Skip special categories unless explicitly requested
            if (stateInfo.category === 'special' && states.length === 0) {
                continue;
            }

            urls.push({
                url: `${NSR_SEARCH_URL}?state=${stateId}`,
                uniqueKey: `SEARCH-${stateId}-1`,
                userData: {
                    label: 'SEARCH',
                    stateId,
                    stateName: stateInfo.displayName,
                    page: 1
                }
            });
        }
    }

    console.log(`Generated ${urls.length} start URLs`);

    // Initialize proxy configuration
    const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);

    // Create crawler
    const crawler = new PlaywrightCrawler({
        proxyConfiguration: proxyConfig,
        maxConcurrency,
        maxRequestsPerCrawl: maxRequestsPerCrawl > 0 ? maxRequestsPerCrawl : undefined,

        // Use headless browser
        launchContext: {
            launchOptions: {
                headless: true
            }
        },

        // Request handler
        async requestHandler({ request, page, log, enqueueLinks, crawler }) {
            const { label, stateId, stateName, nsrNo } = request.userData;

            log.info(`Processing ${label}`, {
                url: request.url,
                stateId,
                stateName
            });

            try {
                if (label === 'SEARCH') {
                    await handleSearchPage({ page, log, stateId, stateName, request, crawler });
                } else if (label === 'PROFILE') {
                    await handleProfilePage({ page, log, nsrNo, request });
                }
            } catch (error) {
                log.error(`Error processing ${label}:`, {
                    error: error.message,
                    url: request.url
                });
            }
        },

        // Error handler
        failedRequestHandler({ request, log }, error) {
            log.error(`Request failed: ${request.url}`, {
                error: error.message
            });
        }
    });

    // Run the crawler
    await crawler.run(urls);

    console.log('Scraper finished!');
});

/**
 * Handle search/listing page
 */
async function handleSearchPage({ page, log, stateId, stateName, request, crawler }) {

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // If this is the first page for this state, submit the search form
    if (request.userData.page === 1) {
        try {
            // Wait for the state dropdown to be available
            await page.waitForSelector('select[name="state_ForSearch"]', { timeout: 10000 });

            // Select state
            await page.selectOption('select[name="state_ForSearch"]', stateId.toString());

            // Submit form
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
                page.click('input[name="buttonSearch"]')
            ]);

            // Small delay for results to load
            await sleep(2000);
        } catch (error) {
            log.warning('Could not submit search form, continuing...', {
                error: error.message
            });
        }
    }

    // Get page content
    const html = await page.content();

    // Check if page has results
    if (!hasResults(html)) {
        log.info(`No results found for state: ${stateName}`);
        return;
    }

    // Parse listing page
    const specialists = parseListingPage(html);
    log.info(`Found ${specialists.length} specialists on page ${request.userData.page}`);

    // Enqueue profile pages
    for (const specialist of specialists) {
        await crawler.addRequests([{
            url: specialist.profileUrl,
            userData: {
                label: 'PROFILE',
                nsrNo: specialist.nsrNo,
                stateId,
                stateName
            }
        }]);
    }

    // Check for pagination - enqueue next page if exists
    try {
        const nextPageButton = await page.$('a:has-text("Next"), a:has-text("›"), .pagination a:last-child');

        if (nextPageButton) {
            const isDisabled = await nextPageButton.getAttribute('class');

            if (!isDisabled || !isDisabled.includes('disabled')) {
                const nextPageUrl = await nextPageButton.getAttribute('href');

                if (nextPageUrl) {
                    const absoluteUrl = new URL(nextPageUrl, request.url).href;

                    await crawler.addRequests([{
                        url: absoluteUrl,
                        uniqueKey: `SEARCH-${stateId}-${request.userData.page + 1}`,
                        userData: {
                            label: 'SEARCH',
                            stateId,
                            stateName,
                            page: request.userData.page + 1
                        }
                    }]);

                    log.info(`Enqueued next page: ${request.userData.page + 1}`);
                }
            }
        }
    } catch (error) {
        log.debug('No next page found', { error: error.message });
    }
}

/**
 * Handle profile page
 */
async function handleProfilePage({ page, log, nsrNo, request }) {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Get page content
    const html = await page.content();

    // Parse profile page
    const specialist = parseProfilePage(html, nsrNo);

    log.info(`Extracted specialist: ${specialist.name || nsrNo}`);

    // Push to dataset
    await Dataset.pushData(specialist);
}
