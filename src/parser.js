const cheerio = require('cheerio');
const {
    cleanText,
    extractGender,
    extractStateFromAddress,
    extractCityFromAddress,
    parseQualifications,
    parseDate,
    isValidNsrNumber,
    buildProfileUrl
} = require('./utils');

/**
 * Parse specialist listing page to extract NSR numbers and basic info
 * @param {string} html - HTML content of listing page
 * @returns {Array} Array of specialist objects with basic info
 */
function parseListingPage(html) {
    const $ = cheerio.load(html);
    const specialists = [];

    // New structure: Find rows in the table body (not header rows)
    $('table.searchlist tbody tr').each((index, element) => {
        const $row = $(element);

        // Skip header rows
        if ($row.hasClass('table-heading')) return;

        // Extract row data
        const cells = $row.find('td').toArray();
        if (cells.length < 6) return;

        // Structure: NSR No | Title | Name (with link) | Gender | Location | Specialty | ...
        const nsrNo = cleanText($(cells[0]).text());
        if (!isValidNsrNumber(nsrNo)) return;

        const title = cleanText($(cells[1]).text());

        // Extract name and profile URL from link
        const nameCell = $(cells[2]);
        const nameLink = nameCell.find('a');
        const name = cleanText(nameLink.text() || nameCell.text());
        const profileUrl = nameLink.attr('href') ?
            `https://www.nsr.org.my/${nameLink.attr('href')}` :
            buildProfileUrl(nsrNo);

        const gender = cleanText($(cells[3]).text());
        const location = cleanText($(cells[4]).text());
        const specialty = cleanText($(cells[5]).text());

        specialists.push({
            nsrNo,
            title,
            name,
            gender,
            location,
            specialty,
            profileUrl
        });
    });

    return specialists;
}

/**
 * Parse specialist profile page to extract detailed information
 * @param {string} html - HTML content of profile page
 * @param {string} nsrNo - NSR number
 * @returns {Object} Specialist object with all details
 */
function parseProfilePage(html, nsrNo) {
    const $ = cheerio.load(html);
    const specialist = {
        nsrNo,
        profileUrl: buildProfileUrl(nsrNo),
        name: null,
        jobTitle: null,
        title: null,
        gender: null,
        specialty: null,
        qualifications: [],
        qualificationsStructured: [],
        state: null,
        stateId: null,
        state_category: null,
        city: null,
        address: null,
        establishment: null,
        sector: null,
        lastRenewalDate: null
    };

    // Track which section we're in to distinguish between specialist name and establishment name
    let inPersonalData = false;
    let inClinicalPractice = false;
    let inQualifications = false;

    // Parse all tables
    $('table.table-bordered').each((tableIndex, tableElement) => {
        const $table = $(tableElement);

        // Check if this is the Personal Data, Clinical Practice, or Qualifications table
        const tableText = $table.text();
        if (tableText.includes('Personal Data')) {
            inPersonalData = true;
            inClinicalPractice = false;
            inQualifications = false;
        } else if (tableText.includes('Clinical Practice')) {
            inPersonalData = false;
            inClinicalPractice = true;
            inQualifications = false;
        } else if (tableText.includes('Qualifications') || tableText.includes('Degree/Membership/Fellowship')) {
            inPersonalData = false;
            inClinicalPractice = false;
            inQualifications = true;
        }

        // Parse rows in this table
        $table.find('tr').each((rowIndex, rowElement) => {
            const $row = $(rowElement);
            const cells = $row.find('td').toArray();

            if (inQualifications && cells.length === 3) {
                // Qualifications table: Degree | Awarding Body | Year
                const degree = cleanText($(cells[0]).text());
                const awardingBody = cleanText($(cells[1]).text());
                const year = cleanText($(cells[2]).text());

                // Skip header rows and section labels
                if (degree &&
                    !degree.toLowerCase().includes('degree/membership') &&
                    !degree.toLowerCase().includes('basic degree') &&
                    !degree.toLowerCase().includes('specialist degree') &&
                    awardingBody &&
                    !awardingBody.toLowerCase().includes('awarding body')) {

                    specialist.qualifications.push(`${degree} (${awardingBody}, ${year})`);
                    specialist.qualificationsStructured.push({
                        degree,
                        awardingBody,
                        year: year ? parseInt(year) : null
                    });
                }
            } else if (cells.length >= 2) {
                const labelCell = cells[cells.length - 2]; // Second to last cell is usually the label
                const valueCell = cells[cells.length - 1]; // Last cell is usually the value

                const label = cleanText($(labelCell).text()).toLowerCase();
                const value = cleanText($(valueCell).text());

                // Handle different fields based on context
                if (label.includes('nsr no')) {
                    specialist.nsrNo = value || nsrNo;
                } else if (label === 'title' && inPersonalData) {
                    specialist.title = value;
                } else if (label === 'name' && inPersonalData) {
                    specialist.name = value;
                } else if (label === 'name' && inClinicalPractice) {
                    specialist.establishment = value;
                } else if (label.includes('gender')) {
                    specialist.gender = extractGender(value) || value;
                } else if (label.includes('field') && label.includes('practice')) {
                    specialist.specialty = value;
                } else if (label.includes('address')) {
                    specialist.address = value;

                    // Extract state and city from address
                    const stateInfo = extractStateFromAddress(value);
                    specialist.state = stateInfo.stateName;
                    specialist.stateId = stateInfo.stateId;
                    specialist.state_category = stateInfo.stateCategory;
                    specialist.city = extractCityFromAddress(value);
                } else if (label.includes('sector')) {
                    specialist.sector = value;
                } else if (label.includes('renewal') || label.includes('last renewed')) {
                    specialist.lastRenewalDate = parseDate(value);
                }
            }
        });
    });

    // Alternative parsing: look for specific IDs or classes
    const nameElement = $('#specialistName, .specialist-name, [data-field="name"]');
    if (nameElement.length && !specialist.name) {
        specialist.name = cleanText(nameElement.text());
    }

    const specialtyElement = $('#specialty, .specialty, [data-field="specialty"]');
    if (specialtyElement.length && !specialist.specialty) {
        specialist.specialty = cleanText(specialtyElement.text());
    }

    // Parse any definition lists
    $('dl').each((index, element) => {
        const $dl = $(element);
        const labels = $dl.find('dt').toArray();
        const values = $dl.find('dd').toArray();

        labels.forEach((label, idx) => {
            if (idx >= values.length) return;

            const labelText = cleanText($(label).text()).toLowerCase();
            const valueText = cleanText($(values[idx]).text());

            if (labelText.includes('name') && !specialist.name) {
                specialist.name = valueText;
            } else if (labelText.includes('specialty') && !specialist.specialty) {
                specialist.specialty = valueText;
            } else if (labelText.includes('address') && !specialist.address) {
                specialist.address = valueText;

                const stateInfo = extractStateFromAddress(valueText);
                specialist.state = stateInfo.stateName;
                specialist.stateId = stateInfo.stateId;
                specialist.state_category = stateInfo.stateCategory;
                specialist.city = extractCityFromAddress(valueText);
            }
        });
    });

    // If state is still missing and we have an address, try to extract it
    if (!specialist.state && specialist.address) {
        const stateInfo = extractStateFromAddress(specialist.address);
        specialist.state = stateInfo.stateName;
        specialist.stateId = stateInfo.stateId;
        specialist.state_category = stateInfo.stateCategory;
    }

    return specialist;
}

/**
 * Extract pagination info from listing page
 * @param {string} html - HTML content
 * @returns {Object} { currentPage, totalPages, hasNext }
 */
function parsePaginationInfo(html) {
    const $ = cheerio.load(html);
    const paginationInfo = {
        currentPage: 1,
        totalPages: 1,
        hasNext: false
    };

    // Look for pagination elements
    const $pagination = $('.pagination, .paging, [class*="page"]');

    if ($pagination.length) {
        // Find active page
        const $active = $pagination.find('.active, .current, [class*="active"]');
        if ($active.length) {
            const pageText = cleanText($active.text());
            const pageNum = parseInt(pageText);
            if (!isNaN(pageNum)) {
                paginationInfo.currentPage = pageNum;
            }
        }

        // Find all page links
        const pageNumbers = [];
        $pagination.find('a, button, [data-page]').each((index, element) => {
            const $el = $(element);
            const text = cleanText($el.text());
            const pageNum = parseInt(text);

            if (!isNaN(pageNum)) {
                pageNumbers.push(pageNum);
            }
        });

        if (pageNumbers.length) {
            paginationInfo.totalPages = Math.max(...pageNumbers);
        }

        // Check for next button
        const $next = $pagination.find('a:contains("Next"), a:contains("›"), a:contains(">>"), [data-action="next"]');
        paginationInfo.hasNext = $next.length > 0 && !$next.hasClass('disabled');
    }

    return paginationInfo;
}

/**
 * Check if the page has results
 * @param {string} html - HTML content
 * @returns {boolean} True if page has results
 */
function hasResults(html) {
    const $ = cheerio.load(html);

    // Check for specialist rows in the new structure
    const specialistRows = $('table.searchlist tbody tr').not('.table-heading');
    if (specialistRows.length > 0) return true;

    // Check for "no results" messages
    const noResultsTexts = [
        'no records found',
        'no results',
        'no specialist found',
        'tidak ada rekod',
        'no data available'
    ];

    const bodyText = $('body').text().toLowerCase();
    for (const text of noResultsTexts) {
        if (bodyText.includes(text)) return false;
    }

    return false;
}

module.exports = {
    parseListingPage,
    parseProfilePage,
    parsePaginationInfo,
    hasResults
};
