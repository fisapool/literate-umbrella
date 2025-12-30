const { MALAYSIAN_STATES, STATE_NAME_TO_ID, PATTERNS } = require('./constants');

/**
 * Get state ID from state name
 * @param {string} stateName - State name (case-insensitive)
 * @returns {number|null} State ID or null if not found
 */
function getStateIdByName(stateName) {
    if (!stateName) return null;

    const normalized = stateName.toLowerCase().trim();
    return STATE_NAME_TO_ID[normalized] || null;
}

/**
 * Get state information by ID
 * @param {number} stateId - State ID
 * @returns {Object|null} State object or null
 */
function getStateById(stateId) {
    return MALAYSIAN_STATES[stateId] || null;
}

/**
 * Extract state from address string
 * @param {string} address - Full address
 * @returns {Object} { stateId, stateName, stateCategory }
 */
function extractStateFromAddress(address) {
    if (!address) {
        return {
            stateId: 9999,
            stateName: 'Missing',
            stateCategory: 'special'
        };
    }

    const match = address.match(PATTERNS.state);
    if (match) {
        const stateName = match[1].toLowerCase().trim();
        const stateId = getStateIdByName(stateName);

        if (stateId) {
            const stateInfo = getStateById(stateId);
            return {
                stateId,
                stateName: stateInfo.displayName,
                stateCategory: stateInfo.category
            };
        }
    }

    return {
        stateId: 9999,
        stateName: 'Missing',
        stateCategory: 'special'
    };
}

/**
 * Extract city from address
 * @param {string} address - Full address
 * @returns {string|null} City name or null
 */
function extractCityFromAddress(address) {
    if (!address) return null;

    // Remove postal codes
    const cleaned = address.replace(/\d{5,}/g, '');

    // Split by common delimiters
    const parts = cleaned.split(/[,\n]+/).map(p => p.trim()).filter(Boolean);

    // City is usually after street address, before state
    if (parts.length >= 2) {
        // Check if second-to-last part is not a state
        const potentialCity = parts[parts.length - 2];
        if (!PATTERNS.state.test(potentialCity)) {
            return potentialCity;
        }
    }

    return null;
}

/**
 * Validate NSR number (must be 6+ digits)
 * @param {string} nsrNo - NSR number
 * @returns {boolean} Valid or not
 */
function isValidNsrNumber(nsrNo) {
    if (!nsrNo) return false;
    const cleaned = nsrNo.replace(/\D/g, '');
    return cleaned.length >= 6;
}

/**
 * Parse qualifications string into structured data
 * @param {string} qualificationsText - Raw qualifications text
 * @returns {Array} Array of qualification objects
 */
function parseQualifications(qualificationsText) {
    if (!qualificationsText) return [];

    const qualifications = [];
    const lines = qualificationsText.split(/[,;\n]+/).map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
        const match = line.match(PATTERNS.qualification);
        if (match) {
            qualifications.push({
                degree: match[1].trim(),
                awardingBody: match[2].trim()
            });
        } else {
            qualifications.push({
                degree: line,
                awardingBody: null
            });
        }
    }

    return qualifications;
}

/**
 * Clean and normalize text
 * @param {string} text - Text to clean
 * @returns {string} Cleaned text
 */
function cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Extract gender from text
 * @param {string} text - Text containing gender information
 * @returns {string|null} 'Male', 'Female', or null
 */
function extractGender(text) {
    if (!text) return null;

    const match = text.match(PATTERNS.gender);
    if (match) {
        return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    }

    return null;
}

/**
 * Parse date string to ISO format
 * @param {string} dateStr - Date string
 * @returns {string|null} ISO date string or null
 */
function parseDate(dateStr) {
    if (!dateStr) return null;

    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return null;
        return date.toISOString().split('T')[0];
    } catch (e) {
        return null;
    }
}

/**
 * Build specialist profile URL
 * @param {string} nsrNo - NSR number
 * @returns {string} Full profile URL
 */
function buildProfileUrl(nsrNo) {
    return `https://nsr.org.my/nsr/ViewSpecialistProfile.jsp?nsrNo=${nsrNo}`;
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    getStateIdByName,
    getStateById,
    extractStateFromAddress,
    extractCityFromAddress,
    isValidNsrNumber,
    parseQualifications,
    cleanText,
    extractGender,
    parseDate,
    buildProfileUrl,
    sleep
};
