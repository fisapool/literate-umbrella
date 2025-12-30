# NSR Malaysia Specialist Scraper

Web scraping system that extracts healthcare specialist data from Malaysia's National Specialist Register (NSR) at [nsr.org.my](https://nsr.org.my). It's packaged as an Apify Actor for deployment and scaling.

## Primary Purpose

Build a structured dataset of Malaysian healthcare specialists (doctors, consultants, specialists) for:
- Healthcare market research
- Business intelligence and competitor analysis
- Medical directory services
- Healthcare administration and workforce planning
- Geographic distribution analysis

## Features

### Data Extraction

Extracts 20+ fields per specialist:

#### Core Identification
- `nsrNo` - National Specialist Register number (validated, 6+ digits)
- `name` - Full name
- `profileUrl` - Source URL

#### Professional Information
- `jobTitle` - Title (Dr., Prof., etc.)
- `gender` - Male/Female
- `specialty` - Primary medical specialty
- `qualifications` - Array of qualifications
- `qualificationsStructured` - Detailed qualification data with awarding bodies

#### Location & Practice
- `state` - Malaysian state (corrected from address when available)
- `city` - Extracted from address
- `address` - Full practice address
- `establishment` - Healthcare facility name
- `sector` - Public/Private

#### Metadata
- `stateId` - Internal state ID
- `state_category` - Regular/Special classification
- `lastRenewalDate` - Registration renewal date

### Malaysian States Coverage

Supports all 16 Malaysian states + special categories:
- 13 regular states: Johor, Kedah, Kelantan, Melaka, Negeri Sembilan, Pahang, Perak, Perlis, Pulau Pinang, Sabah, Sarawak, Selangor, Terengganu
- 3 Federal Territories: Kuala Lumpur, Labuan, Putrajaya
- Special categories: "Foreign, specify" (ID: 20), "Missing" (ID: 9999)

State name aliases are handled (e.g., "penang" = "pulau pinang").

## Installation

### Local Development

```bash
# Install dependencies
npm install

# Run locally
npm start
```

### Deploy to Apify Platform

1. Sign up at [apify.com](https://apify.com)
2. Install Apify CLI:
   ```bash
   npm install -g apify-cli
   ```
3. Login:
   ```bash
   apify login
   ```
4. Deploy:
   ```bash
   apify push
   ```

## Usage

### Input Configuration

The actor accepts the following input parameters:

```json
{
  "startUrls": [],
  "states": ["johor", "selangor", "kuala lumpur"],
  "maxConcurrency": 5,
  "maxRequestsPerCrawl": 0,
  "proxyConfiguration": {
    "useApifyProxy": true
  }
}
```

#### Parameters

- **startUrls** (array, optional): Custom URLs to start scraping from. Leave empty to scrape all states.
- **states** (array, optional): List of Malaysian states to scrape. Leave empty to scrape all states.
- **maxConcurrency** (integer, default: 5): Maximum number of pages to scrape concurrently.
- **maxRequestsPerCrawl** (integer, default: 0): Maximum number of pages to scrape (0 = unlimited).
- **proxyConfiguration** (object): Proxy settings for the scraper.

### Example Configurations

#### Scrape All States
```json
{
  "maxConcurrency": 5
}
```

#### Scrape Specific States
```json
{
  "states": ["johor", "selangor", "kuala lumpur"],
  "maxConcurrency": 10
}
```

#### Limited Scraping (Testing)
```json
{
  "states": ["melaka"],
  "maxRequestsPerCrawl": 50,
  "maxConcurrency": 3
}
```

### Running Locally

Create a file `input.json` in the project root:

```json
{
  "states": ["johor"],
  "maxConcurrency": 3
}
```

Then run:

```bash
npm start
```

Results will be saved to `./apify_storage/datasets/default/`

## Output Format

Each specialist record contains:

```json
{
  "nsrNo": "123456",
  "name": "Dr. Ahmad bin Abdullah",
  "profileUrl": "https://nsr.org.my/nsr/ViewSpecialistProfile.jsp?nsrNo=123456",
  "jobTitle": "Dr.",
  "gender": "Male",
  "specialty": "Cardiology",
  "qualifications": [
    "MBBS (Malaya)",
    "MD (Cardiology) (UKM)"
  ],
  "qualificationsStructured": [
    {
      "degree": "MBBS",
      "awardingBody": "Malaya"
    },
    {
      "degree": "MD (Cardiology)",
      "awardingBody": "UKM"
    }
  ],
  "state": "Johor",
  "stateId": 1,
  "state_category": "regular",
  "city": "Johor Bahru",
  "address": "Hospital Sultanah Aminah, Jalan Persiaran Abu Bakar Sultan, 80100 Johor Bahru, Johor",
  "establishment": "Hospital Sultanah Aminah",
  "sector": "Public",
  "lastRenewalDate": "2024-01-15"
}
```

## Architecture

### Project Structure

```
nsrapify/
├── .actor/
│   ├── actor.json           # Apify Actor configuration
│   └── input_schema.json    # Input parameter schema
├── src/
│   ├── main.js              # Main crawler logic
│   ├── parser.js            # HTML parsing functions
│   ├── utils.js             # Utility functions
│   └── constants.js         # Constants and mappings
├── Dockerfile               # Docker configuration
├── package.json             # Node.js dependencies
└── README.md                # Documentation
```

### Key Components

1. **main.js**: Orchestrates the crawling process using Playwright
2. **parser.js**: Extracts structured data from HTML using Cheerio
3. **utils.js**: Helper functions for data cleaning and validation
4. **constants.js**: Malaysian state mappings and configuration

### Scraping Flow

1. Generate search URLs for each state
2. Submit search form and extract specialist listings
3. Follow pagination to get all results
4. Visit each specialist profile page
5. Extract and structure detailed information
6. Validate and save to dataset

## Technical Details

### Technologies Used

- **Apify SDK**: Actor framework and dataset management
- **Playwright**: Browser automation for JavaScript-heavy pages
- **Cheerio**: Fast HTML parsing
- **Node.js**: Runtime environment

### Data Quality

- NSR numbers validated (minimum 6 digits)
- State names normalized using official mappings
- Qualifications parsed into structured format
- Addresses cleaned and city/state extracted
- Dates converted to ISO format

### Scalability

- Concurrent crawling with configurable limits
- Proxy rotation support via Apify
- Efficient memory usage with streaming
- Graceful error handling and retries

## Best Practices

### Rate Limiting

Be respectful of the NSR website:
- Use reasonable `maxConcurrency` values (5-10 recommended)
- Add delays between requests if needed
- Use proxies to distribute load

### Error Handling

The scraper includes:
- Request retry logic
- Failed request logging
- Graceful degradation for missing data
- Validation for required fields

### Data Storage

- Results automatically saved to Apify dataset
- Export to JSON, CSV, Excel, or XML
- API access for programmatic retrieval
- Direct database integration available

## Limitations

- Requires stable internet connection
- Website structure changes may break scraper
- Some profiles may have incomplete data
- Rate limiting may affect scraping speed

## Troubleshooting

### No Results Found

Check that:
- State names are spelled correctly
- Website is accessible
- Search form selectors are still valid

### Incomplete Data

Some specialists may have:
- Missing addresses or contact information
- Incomplete qualification details
- Outdated registration status

### Performance Issues

To improve performance:
- Increase `maxConcurrency` (if proxies are available)
- Reduce `maxRequestsPerCrawl` for testing
- Use faster proxy providers

## License

ISC

## Support

For issues or questions:
- Check the Apify documentation: [docs.apify.com](https://docs.apify.com)
- Review the NSR website: [nsr.org.my](https://nsr.org.my)
- Open an issue in the repository

## Disclaimer

This scraper is for educational and research purposes. Ensure compliance with:
- Website terms of service
- Malaysian data protection laws
- Healthcare data regulations
- Ethical web scraping practices

Always respect robots.txt and rate limits.
