const { Actor, Dataset } = require('apify');
const { CheerioCrawler } = require('crawlee');
const cheerio = require('cheerio');
const {
    MALAYSIAN_STATES,
    NSR_SEARCH_URL,
    NSR_BASE_URL,
    STATE_NAME_TO_ID,
    SELECTORS
} = require('./constants');
const {
    parseListingPage,
    parseProfilePage,
    hasResults,
    parsePaginationInfo
} = require('./parser');
const { getStateById } = require('./utils');

/**
 * Main Actor entry point
 */
Actor.main(async () => {
    const input = await Actor.getInput();

    const {
        startUrls = [],
        states = [],
        maxConcurrency = 30,
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
        // Generate URLs for each state - start with search page to extract form fields
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
                url: NSR_SEARCH_URL,
                uniqueKey: `SEARCH-FORM-${stateId}`,
                userData: {
                    label: 'SEARCH_FORM',
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
    const crawler = new CheerioCrawler({
        proxyConfiguration: proxyConfig,
        maxConcurrency,
        maxRequestsPerCrawl: maxRequestsPerCrawl > 0 ? maxRequestsPerCrawl : undefined,
        requestHandlerTimeoutSecs: 60,
        maxRequestRetries: 5,
        minConcurrencyDelaySecs: 0.5,

        // Request handler
        async requestHandler({ request, $, log, crawler }) {
            const { label, stateId, stateName, nsrNo } = request.userData;

            log.info(`Processing ${label}`, {
                url: request.url,
                stateId,
                stateName
            });

            try {
                if (label === 'SEARCH_FORM') {
                    await handleSearchForm({ $, log, stateId, stateName, request, crawler });
                } else if (label === 'SEARCH') {
                    await handleSearchPage({ $, log, stateId, stateName, request, crawler });
                } else if (label === 'PROFILE') {
                    await handleProfilePage({ $, log, nsrNo, request });
                }
            } catch (error) {
                log.error(`Error processing ${label}:`, {
                    error: error.message,
                    url: request.url,
                    stack: error.stack
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
 * Extract form fields from search page (Approach B)
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @returns {Object} Form data object
 */
function extractFormFields($) {
    const formData = {};

    // Extract all form inputs (including hidden fields)
    $('form').find('input, select').each((index, element) => {
        const $el = $(element);
        const name = $el.attr('name');
        const type = $el.attr('type') || $el.prop('tagName').toLowerCase();

        if (!name) return;

        if (type === 'hidden' || type === 'input') {
            formData[name] = $el.attr('value') || '';
        } else if (type === 'select') {
            // Get selected value or first option
            const selected = $el.find('option:selected');
            formData[name] = selected.length ? selected.attr('value') || selected.text() : $el.find('option').first().attr('value') || '';
        } else if (type === 'checkbox' || type === 'radio') {
            if ($el.is(':checked')) {
                formData[name] = $el.attr('value') || 'on';
            }
        }
    });

    return formData;
}

/**
 * Build POST request for search form submission
 * @param {number} stateId - State ID to search
 * @param {Object} formData - Extracted form fields
 * @returns {Object} Request object for enqueueing
 */
function buildSearchPostRequest(stateId, formData) {
    // Update state field
    formData.state_ForSearch = stateId.toString();

    // Build form data string
    const formDataString = Object.entries(formData)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');

    // Determine POST URL (form action or results URL)
    const postUrl = `${NSR_BASE_URL}/list1pview.asp`;

    return {
        url: postUrl,
        method: 'POST',
        payload: formDataString,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': NSR_SEARCH_URL
        }
    };
}

/**
 * Handle initial search form page - extract fields and POST
 */
async function handleSearchForm({ $, log, stateId, stateName, request, crawler }) {
    log.info(`Extracting form fields for state: ${stateName}`);

    // Extract all form fields including hidden ones (viewstate, etc.)
    const formData = extractFormFields($);

    // Build POST request
    const postRequest = buildSearchPostRequest(stateId, formData);

    // Enqueue POST request with results page label
    await crawler.addRequests([{
        ...postRequest,
        uniqueKey: `SEARCH-${stateId}-1`,
        userData: {
            label: 'SEARCH',
            stateId,
            stateName,
            page: 1
        }
    }]);

    log.info(`Enqueued POST request for state: ${stateName}`);
}

/**
 * Handle search/listing page (results after form submission)
 */
async function handleSearchPage({ $, log, stateId, stateName, request, crawler }) {
    const html = $.html();

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
        const paginationInfo = parsePaginationInfo(html);

        if (paginationInfo.hasNext) {
            // Find next page link
            const $next = $('a:contains("Next"), a:contains("›"), .pagination a:last-child').not('.disabled');

            if ($next.length > 0) {
                const nextPageUrl = $next.attr('href');

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
async function handleProfilePage({ $, log, nsrNo, request }) {
    const html = $.html();

    // Parse profile page
    const specialist = parseProfilePage(html, nsrNo);

    log.info(`Extracted specialist: ${specialist.name || nsrNo}`);

    // Push to dataset
    await Dataset.pushData(specialist);
}
