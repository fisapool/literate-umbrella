---
name: NSR Scraper Optimization and Database Cache
overview: Migrate from PlaywrightCrawler to CheerioCrawler for 3-5x speed improvement, then set up Supabase database cache with scheduled crawls and API layer to eliminate live scraping timeouts.
todos:
  - id: phase1-deps
    content: "Update package.json: remove playwright dependency, verify cheerio and crawlee versions"
    status: completed
  - id: phase1-main
    content: Replace PlaywrightCrawler with CheerioCrawler in src/main.js, update crawler configuration
    status: completed
    dependencies:
      - phase1-deps
  - id: phase1-form
    content: "Implement form submission using Approach B: GET search page → extract hidden fields (viewstate, etc.) → POST to results URL"
    status: completed
    dependencies:
      - phase1-main
  - id: phase1-handlers
    content: Rewrite handleSearchPage and handleProfilePage to use Cheerio instead of Playwright page object
    status: completed
    dependencies:
      - phase1-main
  - id: phase1-config
    content: "Update input.json: enable Apify proxy, set maxConcurrency to 30"
    status: completed
  - id: phase1-cleanup
    content: Remove unused Playwright code, sleep calls, and browser-specific error handling
    status: completed
    dependencies:
      - phase1-handlers
  - id: phase2-schema
    content: Create Supabase database schema (supabase/schema.sql) with specialists table, indexes, and last_scraped field for future delta crawls
    status: completed
  - id: phase2-export
    content: Create export script (src/export-to-db.js) to push Apify dataset to Supabase
    status: completed
    dependencies:
      - phase2-schema
  - id: phase2-webhook
    content: Create webhook endpoint (api/webhook.js) to receive Apify run events and trigger export, with row count validation
    status: completed
    dependencies:
      - phase2-export
  - id: phase2-integration
    content: Document Apify webhook setup in console (preferred over in-crawler export for separation of concerns)
    status: completed
    dependencies:
      - phase2-webhook
  - id: phase2-api
    content: Build Express.js API server (api/server.js) with endpoints, API key authentication, and rate limiting
    status: completed
    dependencies:
      - phase2-schema
  - id: phase2-env
    content: Create .env.example with Supabase credentials and API configuration
    status: completed
    dependencies:
      - phase2-api
  - id: phase2-monitoring
    content: ""
    status: completed
    dependencies:
      - phase2-webhook
  - id: phase2-docs
    content: Write documentation (docs/DATABASE_SETUP.md) for Supabase setup, webhook configuration, API security, monitoring, and scheduling
    status: completed
    dependencies:
      - phase2-integration
      - phase2-api
      - phase2-monitoring
---

# NSR Scraper: CheerioCrawler Migration +

Database Cache Setup

## Architecture Overview

The migration transforms the scraper from live-browser scraping to a pre-scraped database cache model:

```javascript
┌─────────────────┐
│  Apify Crawler  │ (CheerioCrawler, 30x concurrency)
│  (Scheduled)    │
└────────┬────────┘
         │
         │ Export data
         ▼
┌─────────────────┐
│   Supabase DB   │ (PostgreSQL cache)
└────────┬────────┘
         │
         │ Query API
         ▼
┌─────────────────┐
│   API Layer     │ (<1s response time)
│  (Express/Next) │
└─────────────────┘
```



## Phase 1: CheerioCrawler Migration

### 1.1 Update Dependencies

- **File**: `package.json`
- Remove `playwright` dependency (no longer needed)
- Keep `cheerio` and `crawlee` (CheerioCrawler is part of crawlee)

### 1.2 Rewrite Main Crawler (`src/main.js`)

- **Replace**: `PlaywrightCrawler` → `CheerioCrawler`
- **Remove**: All Playwright imports and browser launch options
- **Update configuration**:
- `maxConcurrency: 30` (safe with Apify proxy)
- `requestHandlerTimeoutSecs: 60`
- `maxRequestRetries: 5`
- `minConcurrencyDelaySecs: 0.5`
- **Rewrite `handleSearchPage` function**:
- Remove `page.waitForLoadState()`, `page.selectOption()`, `page.click()`, `sleep()`
- Implement direct HTTP POST to search results URL
- Test both approaches:
    - **Approach A**: Reconstruct POST URL with form parameters (state, specialty, etc.)
    - **Approach B**: If form requires session/cookies, use Cheerio to extract hidden form fields first, then POST
- **Rewrite `handleProfilePage` function**:
- Remove `page.waitForLoadState()`
- Use Cheerio directly on HTML (already parsed in parser.js)
- **Update request handler**: Replace `page` parameter with `$` (Cheerio instance)

### 1.3 Form Submission Strategy

The NSR site uses a form that submits to `list1pview.asp`. **Use Approach B for reliability** (NSR forms often have viewstate-like tokens):

1. **First request**: GET the search page to extract hidden form fields (viewstate, session tokens, etc.)
2. **Second request**: POST directly to the results URL with all form parameters including extracted hidden fields

**Implementation**:

- Add helper function `extractFormFields($)` to parse all hidden inputs from initial search page (including viewstate, event validation, etc.)
- Create `buildSearchPostRequest(stateId, formData)` to construct POST request with all extracted fields
- Enqueue POST request directly instead of form interaction
- Handle cookies/session if needed (CheerioCrawler maintains session automatically)

### 1.4 Update Input Configuration (`input.json`)

- Enable Apify proxy: `"useApifyProxy": true`
- Increase concurrency: `"maxConcurrency": 30`
- Keep `maxRequestsPerCrawl: 0` for full crawls

### 1.5 Remove Unused Code

- Remove `sleep()` calls from `src/main.js` (keep utility in `utils.js` if needed elsewhere)
- Remove all Playwright-specific error handling
- Simplify error messages (no browser context)

## Phase 2: Database Cache + API Layer

### 2.1 Supabase Database Setup

- **Create table schema** (`supabase/schema.sql`):
  ```sql
      CREATE TABLE specialists (
        nsr_no VARCHAR(20) PRIMARY KEY,
        name TEXT,
        title TEXT,
        gender VARCHAR(10),
        specialty TEXT,
        state TEXT,
        state_id INTEGER,
        state_category TEXT,
        city TEXT,
        address TEXT,
        establishment TEXT,
        sector TEXT,
        last_renewal_date DATE,
        profile_url TEXT,
        qualifications JSONB,
        qualifications_structured JSONB,
        scraped_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        last_scraped TIMESTAMP DEFAULT NOW()  -- For future delta crawls
      );
      
      CREATE INDEX idx_specialists_state ON specialists(state);
      CREATE INDEX idx_specialists_specialty ON specialists(specialty);
      CREATE INDEX idx_specialists_state_specialty ON specialists(state, specialty);
      CREATE INDEX idx_specialists_last_scraped ON specialists(last_scraped);  -- For delta crawl queries
  ```




### 2.2 Export Script (`src/export-to-db.js`)

- **Function**: `exportDatasetToSupabase(dataset, supabaseConfig)`
- Fetch all items from Apify Dataset
- Transform data to match Supabase schema
- Use `upsert` with `nsr_no` as unique key (replaces old records)
- Handle errors and retries
- Log export statistics

### 2.3 Integration with Crawler (Webhook Approach - Preferred)

- **Primary approach: Apify Webhook** (cleaner separation of concerns)
  - Crawler focuses solely on scraping
  - Webhook handles database push reliably with retries
  - Setup in Apify console → Actor → Integrations → Webhook
  - Event: "Succeeded run"
  - POST to webhook endpoint (e.g., Vercel/Netlify function or Express endpoint)
  
- **Webhook endpoint** (`api/webhook.js` or separate service):
  - Receives Apify run completion event
  - Fetches dataset via Apify API using run ID
  - Calls `exportDatasetToSupabase()` function
  - Validates export success (row count check)
  - Sends confirmation/error notification




- Use environment variables for Supabase credentials (via Apify secrets or webhook service env)

### 2.4 API Layer (`api/` directory)

Create Express.js API server:

- **File**: `api/server.js`
- **Endpoints**:
  - `GET /api/specialists?state=&specialty=&page=&limit=`
  - `GET /api/specialists/:nsrNo`
  - `GET /api/stats` (counts by state/specialty)
- **Features**:
  - Pagination (limit/offset)
  - Filtering (state, specialty, name search)
  - Fast responses (<300ms target)
  - Error handling
- **Security**:
  - API key authentication middleware (simple header check: `X-API-Key`)
  - Rate limiting (e.g., `express-rate-limit` or Supabase Edge Functions)
  - Optional: Supabase Row Level Security (RLS) policies for additional protection

### 2.5 Environment Configuration

- **File**: `.env.example`
- Document required variables:
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `API_PORT` (optional, default 3000)

### 2.6 Monitoring & Notifications

- **Apify Run Notifications**:
  - Configure in Apify console → Actor → Integrations → Notifications
  - Email/Slack alerts on:
    - Run failure
    - Run timeout
    - Export/webhook failure (if detectable)
  
- **Post-Export Validation**:
  - Webhook endpoint performs row count check after export
  - Compares expected count (from Apify dataset) vs actual (Supabase query)
  - Logs discrepancy warnings
  - Optional: Alert if row count mismatch exceeds threshold

- **File**: `api/monitoring.js` (optional helper)
  - Function to check Supabase row counts
  - Function to validate data freshness (last export time)

### 2.7 Documentation

- **File**: `docs/DATABASE_SETUP.md`
- Instructions for:
  - Creating Supabase project
  - Running schema migration
  - Setting up Apify webhook/schedule
  - Configuring API server with security
  - Setting up monitoring/notifications
  - Testing the pipeline

## Implementation Order

1. **Phase 1.1-1.2**: Replace PlaywrightCrawler with CheerioCrawler
2. **Phase 1.3**: Implement form submission using Approach B (GET → extract fields → POST)
3. **Phase 1.4-1.5**: Update config and clean up
4. **Phase 2.1**: Create Supabase schema (including last_scraped field)
5. **Phase 2.2**: Build export script
6. **Phase 2.3**: Create webhook endpoint (preferred over in-crawler export)
7. **Phase 2.4**: Build API layer with security (API key + rate limiting)
8. **Phase 2.5**: Set up monitoring (notifications + row count validation)
9. **Phase 2.6**: Configuration and documentation

## Testing Strategy

- **Phase 1**: Test with single state first, verify form submission works, then scale to full crawl
- **Phase 2**: Test export with small dataset, verify API queries, then schedule full crawl
- **Performance**: Measure crawl time improvement (target: 3-5x faster)
- **API**: Load test API endpoints to ensure <1s response times

## Future Enhancements (Incremental)

- **Delta Crawls**: Use `last_scraped` field to only crawl profiles updated since last run
  - Query: `SELECT nsr_no FROM specialists WHERE last_scraped < NOW() - INTERVAL '7 days'`
  - Reduces crawl time and load on NSR site
  - Implement after initial full crawl is stable

## Expected Outcomes

- **Phase 1**: Crawl time reduced from hours to ~30-60 minutes for full dataset
- **Phase 2**: API responses in <1s, zero timeouts, data freshness via scheduled crawls