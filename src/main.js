const { Actor, Dataset } = require('apify');
const { CheerioCrawler, Configuration } = require('crawlee');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
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
    let input = await Actor.getInput();
    
    // Fallback: Read input.json directly if Actor.getInput() returns null (local development)
    if (!input) {
        const inputPath = path.join(__dirname, '..', 'input.json');
        if (fs.existsSync(inputPath)) {
            try {
                input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
                console.log('Read input from input.json (local fallback)');
            } catch (e) {
                console.warn('Failed to read input.json:', e.message);
            }
        }
    }

    const {
        startUrls = [],
        states = [],
        maxConcurrency = 10, // Safe default for local testing (can increase for Apify cloud)
        maxRequestsPerCrawl = 0,
        proxyConfiguration = { useApifyProxy: true },
        fullCrawl = false,
        totalPages = 1006,
        sameDomainDelaySecs = 2 // Delay between requests to same domain (replaces invalid minConcurrencyDelaySecs)
    } = input || {};

    // Initialize storage for local development
    // This ensures the crawler has proper storage even when not running in Apify
    if (!process.env.APIFY_TOKEN) {
        const storageDir = path.join(__dirname, '..', 'storage');
        Configuration.getGlobalConfig().set('storageClientOptions', {
            localDataDirectory: storageDir
        });
        console.log('Initialized local storage at:', storageDir);
    }

    console.log('Starting NSR Scraper...');
    console.log('Raw input:', JSON.stringify(input, null, 2));
    console.log('Configuration:', {
        mode: fullCrawl ? 'fullCrawl' : 'stateFiltered',
        statesCount: states.length || 'all',
        states: states,
        totalPages: fullCrawl ? totalPages : 'N/A',
        maxConcurrency,
        maxRequestsPerCrawl
    });

    // Generate start URLs if not provided
    const urls = [];

    if (startUrls.length > 0) {
        // Use provided URLs
        urls.push(...startUrls);
    } else if (fullCrawl) {
        // Full crawl mode: Generate pages 1 to totalPages for unfiltered list
        console.log(`Generating ${totalPages} pages for full crawl...`);
        for (let page = 1; page <= totalPages; page++) {
            const pageUrl = page === 1 
                ? `${NSR_BASE_URL}/list1pview.asp`
                : `${NSR_BASE_URL}/list1pview.asp?page=${page}`;
            urls.push({
                url: pageUrl,
                uniqueKey: `PAGE-${page}`,
                userData: {
                    label: 'LIST',
                    page
                }
            });
        }
        console.log(`Generated ${urls.length} page URLs for full crawl`);
    } else {
        // State-filtered mode: Generate URLs for each state - use GET requests with query parameters (classic ASP)
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

            // Generate GET URL directly - skip form extraction entirely (classic ASP)
            const searchUrl = buildSearchGetUrl(stateId);
            urls.push({
                url: searchUrl,
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
    console.log('URLs to crawl:', JSON.stringify(urls, null, 2));

    // Initialize proxy configuration
    let proxyConfig = null;
    try {
        proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
        console.log('Proxy configuration:', proxyConfig ? 'configured' : 'disabled');
    } catch (error) {
        console.warn('Failed to create proxy configuration (local mode):', error.message);
        proxyConfig = null; // Allow crawler to run without proxy in local mode
    }

    // Disable snapshotter for local development (avoids EPERM errors in sandbox)
    if (!process.env.APIFY_TOKEN) {
        Configuration.getGlobalConfig().set('enableSnapshotter', false);
    }

    // Create crawler
    const crawler = new CheerioCrawler({
        proxyConfiguration: proxyConfig,
        maxConcurrency,
        sameDomainDelaySecs, // Delay between requests to same domain (prevents rate limiting)
        maxRequestsPerCrawl: maxRequestsPerCrawl > 0 ? maxRequestsPerCrawl : undefined,
        requestHandlerTimeoutSecs: 120, // Increased from 60 for slower responses
        maxRequestRetries: 5,
        useSessionPool: true,
        persistCookiesPerSession: true,
        sessionPoolOptions: {
            maxPoolSize: 10
        },
        keepAlive: true,

        // Pre-navigation hook to inject session cookies and headers
        preNavigationHooks: [
            async ({ request, session, log }, gotOptions) => {
                // Initialize headers object
                gotOptions.headers = gotOptions.headers || {};
                
                // Force session cookies into the Cookie header
                if (session) {
                    try {
                        const cookieString = await session.getCookieString(request.url);
                        if (cookieString) {
                            gotOptions.headers.cookie = cookieString;
                            log.debug('Injected session cookies', { 
                                cookieString: cookieString.substring(0, 100) + '...',
                                url: request.url 
                            });
                        }
                    } catch (error) {
                        log.debug('Failed to get cookie string from session', { error: error.message });
                    }
                }

                // Set Referer for requests to list1pview.asp (GET or POST)
                if (request.url.includes('list1pview.asp')) {
                    gotOptions.headers.referer = NSR_SEARCH_URL;
                    gotOptions.headers.origin = NSR_BASE_URL;
                } else if (request.url.includes('list1viewdetails.asp')) {
                    // Profile pages should refer back to the listing page
                    gotOptions.headers.referer = `${NSR_BASE_URL}/list1pview.asp`;
                    gotOptions.headers.origin = NSR_BASE_URL;
                }

                // ALWAYS set realistic User-Agent (most important fix for 403 errors)
                gotOptions.headers['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
                
                // Add more browser-like headers to avoid bot detection
                gotOptions.headers['accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
                gotOptions.headers['accept-language'] = 'en-US,en;q=0.9';
                gotOptions.headers['accept-encoding'] = 'gzip, deflate, br';
                gotOptions.headers['upgrade-insecure-requests'] = '1';
                gotOptions.headers['sec-fetch-site'] = 'same-origin';
                gotOptions.headers['sec-fetch-mode'] = 'navigate';
                gotOptions.headers['sec-fetch-user'] = '?1';
                gotOptions.headers['sec-fetch-dest'] = 'document';
                gotOptions.headers['cache-control'] = 'max-age=0';
            },
        ],

        // Request handler
        async requestHandler({ request, $, log, crawler, session }) {
            const { label, stateId, stateName, nsrNo, page } = request.userData;

            log.info(`Processing ${label}`, {
                url: request.url,
                stateId,
                stateName,
                page
            });

            try {
                if (label === 'LIST' || label === 'SEARCH') {
                    await handleListPage({ $, log, stateId, stateName, request, crawler, label });
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
            const statusCode = error.statusCode || error.code;
            const is403 = statusCode === 403 || error.message?.includes('403') || error.message?.includes('Forbidden');
            
            if (is403) {
                log.error(`❌ 403 Forbidden (Bot Detection): ${request.url}`, {
                    error: error.message,
                    statusCode,
                    userData: request.userData,
                    suggestion: 'This may indicate bot detection. Check User-Agent and headers.'
                });
            } else {
                log.error(`Request failed: ${request.url}`, {
                    error: error.message,
                    statusCode,
                    userData: request.userData
                });
            }
        }
    });

    // Run the crawler
    await crawler.run(urls);

    console.log('Scraper finished!');
});

/**
 * Build GET request URL for search (classic ASP - no form needed)
 * Directly construct the search URL with query parameters
 * @param {number} stateId - State ID to search
 * @param {number} page - Page number (optional, defaults to 1)
 * @returns {string} Search URL with query parameters
 */
function buildSearchGetUrl(stateId, page = 1) {
    const searchUrl = new URL(`${NSR_BASE_URL}/list1pview.asp`);
    searchUrl.searchParams.set('state_ForSearch', stateId.toString());
    if (page > 1) {
        searchUrl.searchParams.set('page', page.toString());
    }
    // Optionally add buttonSearch if needed (but likely not required for GET)
    // searchUrl.searchParams.set('buttonSearch', 'Show');
    
    return searchUrl.toString();
}

/**
 * Check if a URL is a valid next page for state-filtered results
 * Filters out links to unfiltered full list (e.g., page=1006)
 * @param {string} url - URL to check
 * @param {string} currentUrl - Current page URL for comparison
 * @param {number} currentPage - Current page number
 * @returns {boolean} True if URL is valid next page
 */
function isValidNextPageUrl(url, currentUrl, currentPage) {
    try {
        const urlObj = new URL(url);
        const pageParam = urlObj.searchParams.get('page');
        
        // Ignore links to unfiltered full list (high page numbers like 1006)
        if (pageParam) {
            const pageNum = parseInt(pageParam);
            // Filter out page numbers >= 1000 (unfiltered list) or <= currentPage
            if (pageNum >= 1000 || pageNum <= currentPage) {
                return false;
            }
        }
        
        // Must be different from current URL
        if (url === currentUrl) {
            return false;
        }
        
        // Must preserve state filter (state_ForSearch parameter)
        const currentUrlObj = new URL(currentUrl);
        const currentStateFilter = currentUrlObj.searchParams.get('state_ForSearch');
        const nextStateFilter = urlObj.searchParams.get('state_ForSearch');
        
        // If current URL has state filter, next URL must have the same filter
        if (currentStateFilter && nextStateFilter !== currentStateFilter) {
            return false;
        }
        
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Find next page URL from pagination controls
 * Tries multiple strategies: Next link, page numbers, or constructing URL
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @param {string} currentUrl - Current page URL
 * @param {number} currentPage - Current page number
 * @param {string} html - Optional HTML string (to avoid parsing twice)
 * @returns {string|null} Next page URL or null if no next page
 */
function findNextPageUrl($, currentUrl, currentPage = 1, html = null) {
    // Strategy 1: Look for "Next" link with href (filtered to exclude unfiltered list links)
    const nextSelectors = [
        'a:contains("Next")',
        'a:contains("›")',
        'a:contains(">>")',
        'a:contains(">")',
        '[class*="next"] a',
        '.pagination a:last-child'
    ];

    for (const selector of nextSelectors) {
        const $next = $(selector).not('.disabled, [disabled]');
        if ($next.length > 0) {
            const href = $next.attr('href');
            if (href && !href.includes('javascript:') && !href.includes('#')) {
                try {
                    const absoluteUrl = new URL(href, currentUrl).href;
                    // Validate it's a valid next page (not page=1006, preserves state filter, etc.)
                    if (isValidNextPageUrl(absoluteUrl, currentUrl, currentPage)) {
                        const nextUrlObj = new URL(absoluteUrl);
                        const nextPageParam = nextUrlObj.searchParams.get('page');
                        // If it has a page param, verify it's actually next
                        if (!nextPageParam || parseInt(nextPageParam) > currentPage) {
                            return absoluteUrl;
                        }
                    }
                } catch (e) {
                    // Invalid URL, continue
                }
            }
        }
    }

    // Strategy 2: Look for page number links and find the next one (filtered)
    const pageLinks = [];
    $('a[href*="page="], a[href*="list1pview"]').each((i, el) => {
        const $el = $(el);
        const href = $el.attr('href');
        if (!href || href.includes('javascript:')) return;
        
        try {
            const absoluteUrl = new URL(href, currentUrl).href;
            // Validate URL first
            if (!isValidNextPageUrl(absoluteUrl, currentUrl, currentPage)) {
                return; // Skip invalid URLs (e.g., page=1006)
            }
            
            const urlObj = new URL(absoluteUrl);
            const pageParam = urlObj.searchParams.get('page');
            if (pageParam) {
                const pageNum = parseInt(pageParam);
                if (pageNum > currentPage && pageNum < 1000) {
                    pageLinks.push({ page: pageNum, url: absoluteUrl });
                }
            } else {
                // Link without page param - might be page 2 if we're on page 1
                const text = $el.text().trim();
                const textPageNum = parseInt(text);
                if (!isNaN(textPageNum) && textPageNum > currentPage && textPageNum < 1000) {
                    pageLinks.push({ page: textPageNum, url: absoluteUrl });
                }
            }
        } catch (e) {
            // Invalid URL, skip
        }
    });

    if (pageLinks.length > 0) {
        // Return the smallest page number > currentPage
        pageLinks.sort((a, b) => a.page - b.page);
        return pageLinks[0].url;
    }

    // Strategy 3: Check pagination info to prevent infinite loops
    const htmlToParse = html || $.html();
    const paginationInfo = parsePaginationInfo(htmlToParse);
    
    // Only proceed if pagination info indicates there's a next page
    const hasNextPage = paginationInfo.hasNext && 
                       paginationInfo.currentPage < paginationInfo.totalPages;
    
    if (!hasNextPage) {
        // No next page according to pagination info - stop here
        return null;
    }

    // Strategy 4: Construct next page URL by adding/updating page parameter
    // Only do this if pagination info confirms there's a next page
    try {
        const currentUrlObj = new URL(currentUrl);
        const nextPage = currentPage + 1;
        
        // Only construct if next page is reasonable (< 1000 to avoid unfiltered list)
        if (nextPage >= 1000) {
            return null; // Don't construct high page numbers
        }
        
        currentUrlObj.searchParams.set('page', nextPage.toString());
        const nextUrl = currentUrlObj.toString();
        
        // CRITICAL: Verify the constructed URL is valid and different
        if (isValidNextPageUrl(nextUrl, currentUrl, currentPage)) {
            return nextUrl;
        }
    } catch (e) {
        // Invalid URL construction
    }

    return null;
}


/**
 * Handle listing page (unfiltered list or state-filtered search results)
 */
async function handleListPage({ $, log, stateId, stateName, request, crawler, label }) {
    const html = $.html();
    const page = request.userData.page || 1;
    const isFullCrawl = label === 'LIST';

    // Check if page has results
    if (!hasResults(html)) {
        const context = isFullCrawl ? `page ${page}` : `state: ${stateName}`;
        log.info(`No results found for ${context}`);
        return;
    }

    // Parse listing page
    const specialists = parseListingPage(html);
    const context = isFullCrawl ? `page ${page}` : `${stateName} (page ${page})`;
    log.info(`Found ${specialists.length} specialists on ${context}`);

    // Enqueue profile pages
    for (const specialist of specialists) {
        await crawler.addRequests([{
            url: specialist.profileUrl,
            userData: {
                label: 'PROFILE',
                nsrNo: specialist.nsrNo,
                stateId, // Will be extracted from profile page
                stateName // Will be extracted from profile page
            }
        }]);
    }

    if (isFullCrawl) {
        // For full crawl, all pages are pre-generated, so no need to handle pagination
        log.info(`Finished page ${page} - enqueued ${specialists.length} profiles`);
    } else {
        // State-filtered mode: PAGINATION DISABLED due to pagination quirks
        log.info(`Finished ${stateName} - scraped ${specialists.length} specialists from page 1 (pagination disabled for filtered results)`);
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
