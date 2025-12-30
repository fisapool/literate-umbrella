const { CheerioCrawler, Configuration } = require('crawlee');
const path = require('path');

// Initialize storage for local development
const storageDir = path.join(__dirname, 'storage');
Configuration.getGlobalConfig().set('storageClientOptions', {
    localDataDirectory: storageDir
});
console.log('Initialized local storage at:', storageDir);

// Create a simple test URL
const testUrl = {
    url: 'https://nsr.org.my/list1pview.asp?state_ForSearch=4',
    uniqueKey: 'SEARCH-4-1',
    userData: {
        label: 'SEARCH',
        stateId: 4,
        stateName: 'Melaka',
        page: 1
    }
};

// Create crawler
const crawler = new CheerioCrawler({
    maxConcurrency: 5,
    requestHandlerTimeoutSecs: 60,
    maxRequestRetries: 5,
    async requestHandler({ request, $, log }) {
        log.info(`Processing request: ${request.url}`);
        log.info(`HTML length: ${$.html().length}`);
        log.info(`Title: ${$('title').text()}`);
    },
    failedRequestHandler({ request, log }, error) {
        log.error(`Request failed: ${request.url}`, { error: error.message });
    }
});

// Run the crawler
console.log('Starting crawler with URL:', testUrl.url);
crawler.run([testUrl])
    .then(() => {
        console.log('Crawler finished successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Crawler error:', error);
        process.exit(1);
    });

