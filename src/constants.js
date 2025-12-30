/**
 * Malaysian states mapping with IDs and categories
 */
const MALAYSIAN_STATES = {
    1: { name: 'johor', displayName: 'Johor', category: 'regular' },
    2: { name: 'kedah', displayName: 'Kedah', category: 'regular' },
    3: { name: 'kelantan', displayName: 'Kelantan', category: 'regular' },
    4: { name: 'melaka', displayName: 'Melaka', category: 'regular' },
    5: { name: 'negeri sembilan', displayName: 'Negeri Sembilan', category: 'regular' },
    6: { name: 'pahang', displayName: 'Pahang', category: 'regular' },
    7: { name: 'perak', displayName: 'Perak', category: 'regular' },
    8: { name: 'perlis', displayName: 'Perlis', category: 'regular' },
    9: { name: 'pulau pinang', displayName: 'Pulau Pinang', category: 'regular', aliases: ['penang'] },
    10: { name: 'sabah', displayName: 'Sabah', category: 'regular' },
    11: { name: 'sarawak', displayName: 'Sarawak', category: 'regular' },
    12: { name: 'selangor', displayName: 'Selangor', category: 'regular' },
    13: { name: 'terengganu', displayName: 'Terengganu', category: 'regular' },
    14: { name: 'kuala lumpur', displayName: 'Kuala Lumpur', category: 'federal_territory' },
    15: { name: 'labuan', displayName: 'Labuan', category: 'federal_territory' },
    16: { name: 'putrajaya', displayName: 'Putrajaya', category: 'federal_territory' },
    20: { name: 'foreign', displayName: 'Foreign, specify', category: 'special' },
    9999: { name: 'missing', displayName: 'Missing', category: 'special' }
};

/**
 * Reverse mapping: state name to ID
 */
const STATE_NAME_TO_ID = {};
Object.entries(MALAYSIAN_STATES).forEach(([id, data]) => {
    STATE_NAME_TO_ID[data.name.toLowerCase()] = parseInt(id);

    // Add aliases
    if (data.aliases) {
        data.aliases.forEach(alias => {
            STATE_NAME_TO_ID[alias.toLowerCase()] = parseInt(id);
        });
    }
});

/**
 * Base URL for NSR website
 */
const NSR_BASE_URL = 'https://nsr.org.my';

/**
 * NSR search URL pattern
 */
const NSR_SEARCH_URL = `${NSR_BASE_URL}/list11.asp`;

/**
 * Selectors for scraping
 */
const SELECTORS = {
    searchForm: 'form[action="list1pview.asp"]',
    stateSelect: 'select[name="state_ForSearch"]',
    submitButton: 'input[name="buttonSearch"]',
    resultsTable: 'table.table',
    specialistRow: 'tr[onclick*="ViewSpecialistProfile"]',
    pagination: '.pagination',
    profileContainer: '.container',
    detailsTable: 'table.table-bordered'
};

/**
 * Regular expressions for data extraction
 */
const PATTERNS = {
    nsrNumber: /NSR\s*No\s*[:\-]?\s*(\d{6,})/i,
    qualification: /^([A-Z][A-Za-z\s\.]+)\s*\(([^)]+)\)$/,
    gender: /(male|female)/i,
    state: /\b(johor|kedah|kelantan|melaka|negeri\s+sembilan|pahang|perak|perlis|pulau\s+pinang|penang|sabah|sarawak|selangor|terengganu|kuala\s+lumpur|labuan|putrajaya)\b/i
};

module.exports = {
    MALAYSIAN_STATES,
    STATE_NAME_TO_ID,
    NSR_BASE_URL,
    NSR_SEARCH_URL,
    SELECTORS,
    PATTERNS
};
