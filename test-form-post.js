#!/usr/bin/env node

/**
 * Test script to verify form POST functionality and data structure
 * Compares output with expected structure from Playwright version
 */

const { Actor, Dataset } = require('apify');
const { CheerioCrawler, RequestList } = require('crawlee');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const {
    NSR_SEARCH_URL,
    NSR_BASE_URL,
    STATE_NAME_TO_ID
} = require('./src/constants');
const { getStateById } = require('./src/utils');
const { parseListingPage, parseProfilePage, hasResults, parsePaginationInfo } = require('./src/parser');

// Test configuration
const TEST_STATES = ['melaka', 'johor', 'selangor']; // Test 2-3 states for comprehensive testing
const OUTPUT_DIR = path.join(__dirname, 'test-output');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Build GET request URL for search (classic ASP - no form needed)
 * Directly construct the search URL with query parameters
 * @param {number} stateId - State ID to search
 * @param {number} page - Page number (optional, defaults to 1)
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
 * Find next page URL from pagination controls
 * Tries multiple strategies: Next link, page numbers, or constructing URL
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @param {string} currentUrl - Current page URL
 * @param {number} currentPage - Current page number
 * @param {string} html - Optional HTML string (to avoid parsing twice)
 * @returns {string|null} Next page URL or null if no next page
 */
function findNextPageUrl($, currentUrl, currentPage = 1, html = null) {
    // Strategy 1: Look for "Next" link with href
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
                    // Verify it's a different page
                    const nextUrl = new URL(absoluteUrl);
                    const nextPageParam = nextUrl.searchParams.get('page');
                    if (nextPageParam && parseInt(nextPageParam) > currentPage) {
                        return absoluteUrl;
                    } else if (!nextPageParam && currentPage === 1) {
                        // First page might not have page param, but link might go to page 2
                        return absoluteUrl;
                    }
                } catch (e) {
                    // Invalid URL, continue
                }
            }
        }
    }

    // Strategy 2: Look for page number links and find the next one
    const pageLinks = [];
    $('a, button').each((i, el) => {
        const $el = $(el);
        const text = $el.text().trim();
        const pageNum = parseInt(text);
        if (!isNaN(pageNum) && pageNum > currentPage) {
            const href = $el.attr('href');
            if (href && !href.includes('javascript:')) {
                try {
                    const absoluteUrl = new URL(href, currentUrl).href;
                    pageLinks.push({ page: pageNum, url: absoluteUrl });
                } catch (e) {
                    // Invalid URL, skip
                }
            }
        }
    });

    if (pageLinks.length > 0) {
        // Return the smallest page number > currentPage
        pageLinks.sort((a, b) => a.page - b.page);
        return pageLinks[0].url;
    }

    // Strategy 3: Check pagination info FIRST to prevent infinite loops
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
        currentUrlObj.searchParams.set('page', nextPage.toString());
        const nextUrl = currentUrlObj.toString();
        
        // CRITICAL: Verify the constructed URL is different from current URL
        // This prevents re-enqueuing the same page (e.g., page 1006 -> page 1006)
        if (nextUrl !== currentUrl && nextUrl !== currentUrl.split('?')[0]) {
            // Also verify the page number actually increased
            const nextUrlObj = new URL(nextUrl);
            const nextPageParam = nextUrlObj.searchParams.get('page');
            if (nextPageParam && parseInt(nextPageParam) > currentPage) {
                return nextUrl;
            }
        }
    } catch (e) {
        // Invalid URL construction
    }

    return null;
}

/**
 * Validate specialist data structure
 */
function validateSpecialistData(specialist, index) {
    const errors = [];
    const warnings = [];

    // Required fields
    const requiredFields = ['nsrNo', 'name', 'profileUrl'];
    requiredFields.forEach(field => {
        if (!specialist[field]) {
            errors.push(`Missing required field: ${field}`);
        }
    });

    // Validate NSR number format (6+ digits)
    if (specialist.nsrNo && !/^\d{6,}$/.test(specialist.nsrNo)) {
        errors.push(`Invalid NSR number format: ${specialist.nsrNo}`);
    }

    // Validate profile URL
    if (specialist.profileUrl && !specialist.profileUrl.includes('nsr.org.my')) {
        warnings.push(`Suspicious profile URL: ${specialist.profileUrl}`);
    }

    // Check data quality
    if (!specialist.specialty) {
        warnings.push('Missing specialty');
    }
    if (!specialist.state) {
        warnings.push('Missing state');
    }

    return { errors, warnings };
}

/**
 * Main test function
 */
async function runTest() {
    console.log('[DEBUG] runTest() called');
    // #region agent log
    try {
        await fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:128',message:'runTest entry',data:{testStates:TEST_STATES},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})});
    } catch (e) {
        console.log('[DEBUG] Log fetch failed:', e.message);
    }
    // #endregion
    console.log('='.repeat(60));
    console.log('NSR Scraper Form POST Test');
    console.log('='.repeat(60));
    console.log(`Testing states: ${TEST_STATES.join(', ')}`);
    console.log('');

    const startTime = Date.now();
    const results = {
        states: {},
        summary: {
            totalSpecialists: 0,
            totalErrors: 0,
            totalWarnings: 0,
            testDuration: 0
        }
    };

    // Initialize Actor with timeout to detect hangs
    // #region agent log
    fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:154',message:'Before Actor.init',data:{storageDir:path.join(__dirname,'test-storage')},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'O'})}).catch(()=>{});
    // #endregion
    try {
        console.log('[DEBUG] Calling Actor.init()...');
        const initPromise = Actor.init({ storageDir: path.join(__dirname, 'test-storage') });
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Actor.init() timeout after 10 seconds')), 10000);
        });
        
        await Promise.race([initPromise, timeoutPromise]);
        console.log('[DEBUG] Actor.init() completed');
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:163',message:'After Actor.init success',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'O'})}).catch(()=>{});
        // #endregion
    } catch (error) {
        console.error('[DEBUG] Actor.init() error:', error.message);
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:167',message:'Actor.init failed or timed out',data:{error:error.message,name:error.name},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'O'})}).catch(()=>{});
        // #endregion
        // For local testing, we can continue without Actor.init if it fails
        if (error.message.includes('timeout')) {
            console.log('[DEBUG] Actor.init() timed out - continuing without it for local testing');
        } else {
            throw error;
        }
    }

    try {
        // Generate start URLs
        const urls = [];
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:147',message:'Before URL generation',data:{testStates:TEST_STATES,stateNameToIdKeys:Object.keys(STATE_NAME_TO_ID).slice(0,5)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        for (const stateName of TEST_STATES) {
            const stateId = STATE_NAME_TO_ID[stateName.toLowerCase()];
            // #region agent log
            fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:150',message:'State lookup',data:{stateName,stateId,lookupKey:stateName.toLowerCase()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            if (!stateId) {
                console.error(`Invalid state: ${stateName}`);
                // #region agent log
                fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:152',message:'Invalid state found',data:{stateName},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                // #endregion
                continue;
            }

            const stateInfo = getStateById(stateId);
            // #region agent log
            fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:156',message:'State info retrieved',data:{stateId,stateInfo:stateInfo?{displayName:stateInfo.displayName,category:stateInfo.category}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            
            // Generate GET URL directly - skip form extraction entirely
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

        console.log(`Generated ${urls.length} start URLs\n`);
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:167',message:'URLs generated',data:{urlCount:urls.length,firstUrl:urls[0]?{url:urls[0].url,stateId:urls[0].userData.stateId}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion

        // Create crawler
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:169',message:'Before crawler creation',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:208',message:'Creating CheerioCrawler',data:{urlCount:urls.length},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
        // Try without session pool first to see if that's causing the hang
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:211',message:'Creating crawler config',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'P'})}).catch(()=>{});
        // #endregion
        const crawler = new CheerioCrawler({
            maxConcurrency: 1, // Reduce to 1 for testing
            requestHandlerTimeoutSecs: 60,
            maxRequestRetries: 1, // Reduce retries for faster failure
            additionalMimeTypes: ['text/html', 'application/xhtml+xml'],
            // Enable session pool to maintain cookies between GET and POST
            useSessionPool: true,
            persistCookiesPerSession: true,
            sessionPoolOptions: {
                maxPoolSize: 1 // Use single session for testing
            },
            // Don't use proxy for local testing
            proxyConfiguration: undefined,
            
            preNavigationHooks: [
                async ({ request, session, log }, gotOptions) => {
                    console.log(`[PRE-NAV] About to fetch: ${request.url}`);
                    console.log(`[PRE-NAV] Method: ${request.method || 'GET'}`);
                    console.log(`[PRE-NAV] Session ID: ${session?.id || request.session?.id || 'none'}`);
                    
                    // Force session cookies into the Cookie header
                    if (session) {
                        try {
                            const cookieString = await session.getCookieString(request.url);
                            if (cookieString) {
                                gotOptions.headers = gotOptions.headers || {};
                                gotOptions.headers.cookie = cookieString;
                                console.log(`[PRE-NAV] Injected session cookies: ${cookieString.substring(0, 100)}...`);
                                log.info('Injected session cookies', { 
                                    cookieString: cookieString.substring(0, 100) + '...',
                                    url: request.url 
                                });
                            }
                        } catch (error) {
                            log.debug('Failed to get cookie string from session', { error: error.message });
                        }
                    }

                    // Ensure Referer and Origin headers (important for ASP.NET anti-forgery)
                    gotOptions.headers = gotOptions.headers || {};
                    
                    // Set Referer for requests to list1pview.asp (GET or POST)
                    if (request.url.includes('list1pview.asp')) {
                        gotOptions.headers.referer = NSR_SEARCH_URL;
                        gotOptions.headers.origin = NSR_BASE_URL;
                        console.log(`[PRE-NAV] Set Referer: ${NSR_SEARCH_URL}, Origin: ${NSR_BASE_URL}`);
                    }

                    // Add realistic User-Agent if not already present
                    if (!gotOptions.headers['user-agent']) {
                        gotOptions.headers['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
                    }

                    // Log request details
                    if (request.method === 'GET') {
                        console.log(`[PRE-NAV] GET URL: ${request.url}`);
                    } else if (request.method === 'POST') {
                        console.log(`[PRE-NAV] POST payload length: ${request.payload?.length || 0} bytes`);
                        console.log(`[PRE-NAV] POST payload preview: ${(request.payload || '').substring(0, 200)}`);
                    }
                }
            ],
            
            postNavigationHooks: [
                async ({ request, response, log }) => {
                    // #region agent log
                    const setCookieHeaders = response?.headers?.['set-cookie'] || response?.headers?.['Set-Cookie'] || [];
                    fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:279',message:'postNavigationHook response',data:{url:request.url,method:request.method,statusCode:response?.statusCode,redirectLocation:response?.headers?.location,setCookieCount:Array.isArray(setCookieHeaders)?setCookieHeaders.length:0,setCookieNames:Array.isArray(setCookieHeaders)?setCookieHeaders.map(c=>c.split('=')[0]).slice(0,5):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
                    // #endregion
                    if (request.method === 'POST') {
                        console.log(`[POST-NAV] POST response status: ${response?.statusCode || 'unknown'}`);
                        console.log(`[POST-NAV] POST response headers location: ${response?.headers?.location || 'none'}`);
                        // #region agent log
                        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:285',message:'postNavigationHook POST',data:{url:request.url,statusCode:response?.statusCode,redirectLocation:response?.headers?.location},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'Q'})}).catch(()=>{});
                        // #endregion
                    }
                }
            ],

            async requestHandler({ request, $, log, crawler, session }) {
                const { label, stateId, stateName, nsrNo } = request.userData;

                log.info(`Processing ${label}`, { url: request.url, stateId, stateName });
                // #region agent log
                fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:260',message:'Request handler entry',data:{label,stateId,stateName,url:request.url},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'J'})}).catch(()=>{});
                // #endregion

                try {
                    if (label === 'SEARCH') {
                        // #region agent log
                        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:204',message:'SEARCH handler entry (GET request)',data:{stateId,stateName,url:request.url,method:request.method || 'GET'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                        // #endregion
                        console.log(`[${stateName}] Processing GET search request: ${request.url}`);
                        const html = $.html();
                        // #region agent log
                        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:206',message:'HTML retrieved',data:{htmlLength:html.length,hasTable:html.includes('table'),hasSearchlist:html.includes('searchlist')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                        // #endregion

                        if (!hasResults(html)) {
                            // #region agent log
                            fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:209',message:'No results found',data:{stateName},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                            // #endregion
                            console.log(`[${stateName}] ⚠ No results found`);
                            results.states[stateName] = {
                                specialists: [],
                                errors: [],
                                warnings: ['No results found']
                            };
                            return;
                        }

                        // Parse listing page
                        const specialists = parseListingPage(html);
                        // #region agent log
                        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:222',message:'Specialists parsed',data:{specialistCount:specialists.length,firstSpecialist:specialists[0]?{nsrNo:specialists[0].nsrNo,name:specialists[0].name}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                        // #endregion
                        console.log(`[${stateName}] ✓ Found ${specialists.length} specialists on page ${request.userData.page}`);

                        // Validate and store results
                        if (!results.states[stateName]) {
                            results.states[stateName] = {
                                specialists: [],
                                errors: [],
                                warnings: []
                            };
                        }

                        for (const specialist of specialists) {
                            const validation = validateSpecialistData(specialist, results.states[stateName].specialists.length);
                            results.states[stateName].errors.push(...validation.errors);
                            results.states[stateName].warnings.push(...validation.warnings);
                            results.states[stateName].specialists.push(specialist);
                        }

                        // Enqueue first profile page for detailed testing
                        if (specialists.length > 0 && results.states[stateName].specialists.length === specialists.length) {
                            const firstSpecialist = specialists[0];
                            await crawler.addRequests([{
                                url: firstSpecialist.profileUrl,
                                userData: {
                                    label: 'PROFILE',
                                    nsrNo: firstSpecialist.nsrNo,
                                    stateId,
                                    stateName
                                }
                            }]);
                            console.log(`[${stateName}] ✓ Enqueued profile page for: ${firstSpecialist.name} (${firstSpecialist.nsrNo})`);
                        }

                        // Check for pagination - enqueue next page if exists
                        try {
                            const nextPageUrl = findNextPageUrl($, request.url, request.userData.page, html);
                            
                            if (nextPageUrl) {
                                const nextPage = request.userData.page + 1;
                                await crawler.addRequests([{
                                    url: nextPageUrl,
                                    uniqueKey: `SEARCH-${stateId}-${nextPage}`,
                                    userData: {
                                        label: 'SEARCH',
                                        stateId,
                                        stateName,
                                        page: nextPage
                                    }
                                }]);
                                console.log(`[${stateName}] ✓ Enqueued next page: ${nextPage} (${nextPageUrl})`);
                            } else {
                                console.log(`[${stateName}] ℹ Reached last page (page ${request.userData.page})`);
                            }
                        } catch (error) {
                            console.log(`[${stateName}] ⚠ Error checking pagination: ${error.message}`);
                        }

                    } else if (label === 'PROFILE') {
                        const html = $.html();
                        const specialist = parseProfilePage(html, nsrNo);

                        console.log(`[${stateName}] ✓ Parsed profile: ${specialist.name || nsrNo}`);
                        console.log(`[${stateName}]   - Specialty: ${specialist.specialty || 'N/A'}`);
                        console.log(`[${stateName}]   - State: ${specialist.state || 'N/A'}`);
                        console.log(`[${stateName}]   - Qualifications: ${specialist.qualifications.length}`);

                        // Validate profile data
                        const validation = validateSpecialistData(specialist, 0);
                        if (validation.errors.length > 0 || validation.warnings.length > 0) {
                            console.log(`[${stateName}]   ⚠ Validation: ${validation.errors.length} errors, ${validation.warnings.length} warnings`);
                        }
                    }
                } catch (error) {
                    // #region agent log
                    fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:266',message:'Request handler error',data:{error:error.message,stack:error.stack,label:request.userData.label},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
                    // #endregion
                    console.error(`[${stateName}] ✗ Error: ${error.message}`);
                    if (!results.states[stateName]) {
                        results.states[stateName] = { specialists: [], errors: [], warnings: [] };
                    }
                    results.states[stateName].errors.push(`Processing error: ${error.message}`);
                }
            },

            failedRequestHandler({ request, log, session }, error) {
                // #region agent log
                fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:275',message:'Request failed',data:{url:request.url,error:error.message,statusCode:error.statusCode,hasHeaders:!!request.headers,method:request.method,sessionId:session?.id || request.session?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'C'})}).catch(()=>{});
                // #endregion
                console.error(`✗ Request failed: ${request.url}`);
                console.error(`  Method: ${request.method || 'GET'}`);
                console.error(`  Error: ${error.message}`);
                console.error(`  Session ID: ${session?.id || request.session?.id || 'none'}`);
                if (error.message.includes('Redirected')) {
                    console.error(`  ⚠ Redirect loop detected - this usually means:`);
                    console.error(`    1. Invalid query parameters`);
                    console.error(`    2. Server rejecting the request`);
                    console.error(`    3. Missing required parameters`);
                    if (request.method === 'GET') {
                        console.error(`  GET URL: ${request.url}`);
                    } else if (request.method === 'POST') {
                        console.error(`  POST payload length: ${request.payload?.length || 0} bytes`);
                    }
                }
            }
        });
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:280',message:'Before crawler.run',data:{urlCount:urls.length},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'I'})}).catch(()=>{});
        // #endregion

        // Run crawler with progress tracking
        let requestCount = 0;
        try {
            console.log('Starting crawler...');
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:378',message:'About to call crawler.run',data:{urlCount:urls.length,urls:urls.map(u=>u.url)},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
        
        // Create RequestList explicitly
        const requestList = await RequestList.open(null, urls);
        
        // RequestList methods are async - need to await them
        const requestCount = requestList.length();
        const isEmpty = await requestList.isEmpty();
        const isFinished = await requestList.isFinished();
        
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:405',message:'RequestList created',data:{requestCount,isEmpty,isFinished},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
        
        // Verify request list state
        console.log(`RequestList: ${requestCount} requests, isEmpty: ${isEmpty}, isFinished: ${isFinished}`);
        
        if (isEmpty) {
            throw new Error('RequestList is empty - no requests to process');
        }
        
        console.log('Starting crawler.run()...');
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:390',message:'Starting crawler.run',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'M'})}).catch(()=>{});
        // #endregion
        
        // Use a configurable timeout (default 120 seconds for large states)
        const TEST_TIMEOUT_MS = process.env.TEST_TIMEOUT_MS ? parseInt(process.env.TEST_TIMEOUT_MS) : 120000;
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                console.error(`TIMEOUT: Crawler run exceeded ${TEST_TIMEOUT_MS / 1000} seconds`);
                // #region agent log
                fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:397',message:'Timeout triggered',data:{timeoutMs:TEST_TIMEOUT_MS},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'M'})}).catch(()=>{});
                // #endregion
                reject(new Error(`Crawler run timeout after ${TEST_TIMEOUT_MS / 1000} seconds`));
            }, TEST_TIMEOUT_MS);
        });
        
        const runPromise = crawler.run(requestList).finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
        });
        
        try {
            await Promise.race([runPromise, timeoutPromise]);
        } catch (error) {
            console.error('Crawler run error:', error.message);
            // #region agent log
            fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:410',message:'Promise.race error',data:{error:error.message,name:error.name},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'M'})}).catch(()=>{});
            // #endregion
            throw error;
        }
            
            // #region agent log
            fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:393',message:'After crawler.run success',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'I'})}).catch(()=>{});
            // #endregion
        } catch (crawlError) {
            // #region agent log
            fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:396',message:'crawler.run error',data:{error:crawlError.message,stack:crawlError.stack,name:crawlError.name},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'I'})}).catch(()=>{});
            // #endregion
            console.error('Crawler error:', crawlError);
            throw crawlError;
        }

        // Calculate summary
        Object.values(results.states).forEach(stateResult => {
            results.summary.totalSpecialists += stateResult.specialists.length;
            results.summary.totalErrors += stateResult.errors.length;
            results.summary.totalWarnings += stateResult.warnings.length;
        });

        results.summary.testDuration = ((Date.now() - startTime) / 1000).toFixed(2);

        // Save results
        const resultsFile = path.join(OUTPUT_DIR, `test-results-${Date.now()}.json`);
        fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));

        // Print summary
        console.log('\n' + '='.repeat(60));
        console.log('Test Summary');
        console.log('='.repeat(60));
        console.log(`Duration: ${results.summary.testDuration}s`);
        console.log(`Total Specialists Found: ${results.summary.totalSpecialists}`);
        console.log(`Total Errors: ${results.summary.totalErrors}`);
        console.log(`Total Warnings: ${results.summary.totalWarnings}`);
        console.log('');

        Object.entries(results.states).forEach(([stateName, stateResult]) => {
            console.log(`[${stateName}]`);
            console.log(`  Specialists: ${stateResult.specialists.length}`);
            console.log(`  Errors: ${stateResult.errors.length}`);
            console.log(`  Warnings: ${stateResult.warnings.length}`);
            if (stateResult.errors.length > 0) {
                console.log(`  Error details: ${stateResult.errors.slice(0, 3).join('; ')}`);
            }
        });

        console.log(`\nResults saved to: ${resultsFile}`);
        console.log('='.repeat(60));

        // Return success if no critical errors
        if (results.summary.totalErrors === 0 && results.summary.totalSpecialists > 0) {
            console.log('\n✓ Test PASSED: Form POST works correctly');
            process.exit(0);
        } else {
            console.log('\n✗ Test FAILED: Check errors above');
            process.exit(1);
        }

    } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:328',message:'Test failed with error',data:{error:error.message,stack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        console.error('Test failed with error:', error);
        process.exit(1);
    } finally {
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:332',message:'Before Actor.exit',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        await Actor.exit();
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/e20065fe-7e77-40c1-8b01-af52a2994cef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-form-post.js:334',message:'After Actor.exit',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
    }
}

// Run test
if (require.main === module) {
    runTest().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
}

module.exports = { runTest };


