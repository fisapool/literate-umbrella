# Testing Guide

This document describes how to test the NSR scraper after migrating from Playwright to CheerioCrawler.

## Quick Start

### 1. Test Form POST with Small Input (1-2 States)

```bash
# Use the test input file
cp input.test.json input.json

# Run the form POST test
npm test

# Or run the scraper directly with test input
npm run test:small
```

The test script (`test-form-post.js`) will:
- Extract form fields from the search page
- Submit POST requests for each test state
- Validate the data structure matches expected format
- Check for required fields and data quality
- Save results to `test-output/test-results-*.json`

### 2. Verify Data Matches Old Playwright Version

After running the test, compare the output structure:

```bash
# View test results
cat test-output/test-results-*.json | jq '.states'
```

Key fields to verify:
- `nsrNo` - Should be 6+ digits
- `name` - Full specialist name
- `profileUrl` - Valid NSR URL
- `specialty` - Medical specialty
- `state` - Malaysian state name
- `qualifications` - Array of qualifications

### 3. Time Full Crawl for Speed Comparison

```bash
# Make sure input.json is configured for full crawl
# (or leave states empty to scrape all)

# Run timing test
npm run test:timing
```

The timing script will:
- Measure total execution time
- Track records collected per second
- Compare with previous runs
- Save results to `test-output/timing-results.json`

## Test Files

- `input.test.json` - Test configuration with 1-2 states (Melaka, Johor)
- `test-form-post.js` - Form POST validation test
- `test-timing.js` - Performance timing test

## Expected Results

### Form POST Test
- ✓ Form fields extracted successfully
- ✓ POST request enqueued
- ✓ Search results page loaded
- ✓ Specialists found and parsed
- ✓ Profile pages accessible
- ✓ No critical errors

### Performance Test
- Records collected should match or exceed Playwright version
- Speed should be significantly faster (Cheerio is much lighter than Playwright)
- No timeout errors
- All states processed successfully

## Troubleshooting

### Form POST Fails
- Check network connectivity
- Verify NSR website is accessible
- Check form field selectors in `src/main.js`
- Review error logs in test output

### Data Mismatch
- Compare field names with old Playwright output
- Check parser functions in `src/parser.js`
- Verify selectors in `src/constants.js`

### Performance Issues
- Reduce `maxConcurrency` if getting rate limited
- Check network latency
- Review crawler statistics in timing output

## Comparison Checklist

When comparing with old Playwright version:

- [ ] Same number of specialists found per state
- [ ] All required fields present (nsrNo, name, profileUrl)
- [ ] Data quality matches (no missing specialties, states, etc.)
- [ ] Profile pages parse correctly
- [ ] Qualifications structured properly
- [ ] Speed improvement confirmed (should be 2-5x faster)
- [ ] No new errors introduced

