// Complete Background.js - Enhanced Product Scraping with Duplicate Prevention (Manifest V3 Compliant)
let scrapingState = {
  active: false,
  config: null,
  phase: 'idle',

  // URL Collection Phase
  currentPage: 0,
  totalPages: 0,
  allProductUrls: new Set(),
  pagesProcessed: 0,
  pageProcessingTimeout: null,

  // Detail Scraping Phase
  urlsToScrape: [],
  currentUrlIndex: 0,
  scrapedProducts: [],
  scrapedProductUrls: new Set(),
  productProcessingTimeout: null,

  // Statistics
  errors: [],
  startTime: null,
  phaseStartTime: null,
  lastProcessedPage: null,
  lastProcessedUrl: null,

  detailedStats: {
    totalParameters: 0,
    ratingsBreakdown: 0,
    colorsFound: 0,
    deliveryTypesFound: 0,
    paymentMethodsFound: 0,
    specificationsFound: 0
  }
};

const CONSTANTS = {
  PAGE_PROCESSING_TIMEOUT: 25000,
  PRODUCT_PROCESSING_TIMEOUT: 30000,
  PAGE_NAVIGATION_DELAY: 5000,
  PRODUCT_NAVIGATION_DELAY: 6000,
  MAX_RETRIES: 3,
  MAX_URLS_PER_SESSION: 500,
  BATCH_SIZE: 10,
  MIN_PROCESSING_INTERVAL: 3000
};

const activeTimeouts = new Set();
const activeIntervals = new Set();

function debugLog(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] BG: ${message}`, data || '');
}

function setManagedTimeout(callback, delay) {
  const timeoutId = setTimeout(() => {
    activeTimeouts.delete(timeoutId);
    callback();
  }, delay);
  activeTimeouts.add(timeoutId);
  return timeoutId;
}

function setManagedInterval(callback, delay) {
  const intervalId = setInterval(callback, delay);
  activeIntervals.add(intervalId);
  return intervalId;
}

function clearManagedTimeout(timeoutId) {
  if (timeoutId) {
    clearTimeout(timeoutId);
    activeTimeouts.delete(timeoutId);
  }
}
function clearManagedInterval(intervalId) {
  if (intervalId) {
    clearInterval(intervalId);
    activeIntervals.delete(intervalId);
  }
}
function cleanupAllTimers() {
  activeTimeouts.forEach(clearTimeout);
  activeIntervals.forEach(clearInterval);
  activeTimeouts.clear();
  activeIntervals.clear();
}

// LIFECYCLE
chrome.runtime.onSuspend.addListener(() => {
  debugLog('Extension suspending - cleaning up');
  cleanupOnExit();
});
chrome.runtime.onSuspendCanceled.addListener(() => {
  debugLog('Extension suspend canceled');
});
chrome.tabs.onRemoved.addListener(() => {
  if (scrapingState.active) {
    debugLog('Active tab removed during scraping');
    handleTabClosure();
  }
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && scrapingState.active) {
    debugLog('Tab navigation detected during scraping');
  }
});

function cleanupOnExit() {
  debugLog('Performing cleanup on exit');
  scrapingState.active = false;
  cleanupAllTimers();
  clearExistingTimeouts();
}
function handleTabClosure() {
  if (!scrapingState.active) return;
  debugLog('Handling unexpected tab closure');
  if (scrapingState.phase === 'collecting_urls') moveToNextPage();
  else if (scrapingState.phase === 'scraping_details') moveToNextProduct();
}

// MESSAGE HANDLING
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debugLog('Received message:', request.action);
  handleMessage(request, sender)
    .then(result => sendResponse(result))
    .catch(error => {
      debugLog('Error handling message:', error.message);
      sendResponse({ error: error.message });
    });
  return true;
});

async function handleMessage(request) {
  switch (request.action) {
    case 'start_scraping':
      await startScrapingProcess(request.config);
      return { success: true };
    case 'stop_scraping':
      stopScrapingProcess();
      return { success: true };
    case 'urls_collected_from_page':
      handleUrlsCollectedFromPage(request.data);
      return { success: true };
    case 'product_details_scraped':
      handleProductDetailsScraped(request.data);
      return { success: true };
    case 'page_error':
      handlePageError(request.error);
      return { success: true };
    case 'get_scraping_status':
      return getStatus();
    default:
      debugLog('Unknown action:', request.action);
      return { error: 'Unknown action' };
  }
}

// PHASE 1: URL COLLECTION
async function startScrapingProcess(config) {
  debugLog('Starting enhanced scraping with duplicate prevention:', config);
  if (!validateConfig(config)) {
    broadcastError('Invalid scraping configuration provided');
    return;
  }

  clearExistingTimeouts();
  cleanupAllTimers();

  scrapingState = {
    active: true,
    config,
    phase: 'collecting_urls',

    currentPage: config.startPage,
    totalPages: config.endPage - config.startPage + 1,
    allProductUrls: new Set(),
    pagesProcessed: 0,
    pageProcessingTimeout: null,

    urlsToScrape: [],
    currentUrlIndex: 0,
    scrapedProducts: [],
    scrapedProductUrls: new Set(),
    productProcessingTimeout: null,

    errors: [],
    startTime: Date.now(),
    phaseStartTime: Date.now(),
    lastProcessedPage: null,
    lastProcessedUrl: null,

    detailedStats: {
      totalParameters: 0,
      ratingsBreakdown: 0,
      colorsFound: 0,
      deliveryTypesFound: 0,
      paymentMethodsFound: 0,
      specificationsFound: 0
    }
  };

  await broadcastPhaseStart('collecting_urls', {
    totalPages: scrapingState.totalPages,
    startPage: config.startPage,
    endPage: config.endPage
  });

  await collectUrlsFromNextPage();
}

async function collectUrlsFromNextPage() {
  if (!scrapingState.active || scrapingState.phase !== 'collecting_urls') return;

  if (scrapingState.currentPage > scrapingState.config.endPage) {
    debugLog('Page range complete; starting product detail phase');
    await startProductDetailPhase();
    return;
  }

  try {
    const searchUrl = buildSearchUrl(
      scrapingState.config.searchQuery,
      scrapingState.currentPage,
      scrapingState.config.website
    );

    debugLog(
      `Processing page ${scrapingState.currentPage}/${scrapingState.config.endPage}:`,
      searchUrl.substring(0, 100) + '...'
    );

    scrapingState.lastProcessedPage = scrapingState.currentPage;
    scrapingState.phaseStartTime = Date.now();

    const tab = await navigateToUrl(searchUrl);
    if (!tab) throw new Error('Failed to navigate to search page');

    await injectContentScript(tab.id);

    // ask content script to start URL collection
    await chrome.tabs.sendMessage(tab.id, { action: 'start_url_collection' }).catch(async () => {
      debugLog('Message failed; retrying after short delay');
      await new Promise(r => setTimeout(r, 1200));
      await chrome.tabs.sendMessage(tab.id, { action: 'start_url_collection' });
    });

    scrapingState.pageProcessingTimeout = setManagedTimeout(() => {
      debugLog('Page processing timeout, moving to next page');
      handlePageTimeout('URL collection');
    }, CONSTANTS.PAGE_PROCESSING_TIMEOUT);

    await broadcastProgress({
      phase: 'collecting_urls',
      currentPage: scrapingState.currentPage,
      totalPages: scrapingState.config.endPage,
      urlsCollected: scrapingState.allProductUrls.size,
      progress:
        (scrapingState.totalPages > 0
          ? (scrapingState.currentPage - scrapingState.config.startPage) / scrapingState.totalPages
          : 0) * 100
    });
  } catch (error) {
    debugLog('Error in collectUrlsFromNextPage:', error.message);
    scrapingState.errors.push({
      phase: 'collecting_urls',
      page: scrapingState.currentPage,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    await moveToNextPage();
  }
}

function handleUrlsCollectedFromPage(data) {
  if (scrapingState.pageProcessingTimeout) {
    clearManagedTimeout(scrapingState.pageProcessingTimeout);
    scrapingState.pageProcessingTimeout = null;
  }
  if (!scrapingState.active || scrapingState.phase !== 'collecting_urls') return;

  if (data.urls && Array.isArray(data.urls)) {
    const before = scrapingState.allProductUrls.size;
    data.urls.forEach(url => {
      if (!url || typeof url !== 'string') return;
      const normalized = normalizeProductUrl(url);
      if (normalized && !scrapingState.allProductUrls.has(normalized)) {
        scrapingState.allProductUrls.add(normalized);
      }
    });
    const added = scrapingState.allProductUrls.size - before;
    debugLog(`Added ${added} new unique URLs (total: ${scrapingState.allProductUrls.size})`);
  }

  scrapingState.pagesProcessed++;

  broadcastProgress({
    phase: 'collecting_urls',
    currentPage: scrapingState.currentPage,
    totalPages: scrapingState.config.endPage,
    urlsCollected: scrapingState.allProductUrls.size,
    pagesScraped: scrapingState.pagesProcessed,
    progress:
      (scrapingState.totalPages > 0
        ? (scrapingState.currentPage - scrapingState.config.startPage + 1) / scrapingState.totalPages
        : 0) * 100
  });

  setManagedTimeout(moveToNextPage, CONSTANTS.PAGE_NAVIGATION_DELAY);
}

async function moveToNextPage() {
  if (!scrapingState.active) return;

  scrapingState.currentPage++;

  if (scrapingState.currentPage > scrapingState.config.endPage ||
      scrapingState.allProductUrls.size >= CONSTANTS.MAX_URLS_PER_SESSION) {
    debugLog('Starting product detail phase');
    await startProductDetailPhase();
    return;
  }

  await collectUrlsFromNextPage();
}

// PHASE 2: PRODUCT SCRAPING
async function startProductDetailPhase() {
  if (!scrapingState.active) return;

  scrapingState.phase = 'scraping_details';
  scrapingState.phaseStartTime = Date.now();
  scrapingState.urlsToScrape = Array.from(scrapingState.allProductUrls);
  scrapingState.currentUrlIndex = 0;
  scrapingState.scrapedProductUrls = new Set();

  await broadcastPhaseStart('scraping_details', {
    totalUrls: scrapingState.urlsToScrape.length,
    urlsCollected: scrapingState.allProductUrls.size,
    pagesProcessed: scrapingState.pagesProcessed
  });

  await scrapeNextProduct();
}

async function scrapeNextProduct() {
  if (!scrapingState.active || scrapingState.phase !== 'scraping_details') return;

  if (scrapingState.currentUrlIndex >= scrapingState.urlsToScrape.length) {
    await completeScrapingProcess();
    return;
  }

  try {
    const currentUrl = scrapingState.urlsToScrape[scrapingState.currentUrlIndex];
    scrapingState.lastProcessedUrl = currentUrl;

    const normalizedCurrentUrl = normalizeProductUrl(currentUrl);
    if (scrapingState.scrapedProductUrls.has(normalizedCurrentUrl)) {
      scrapingState.currentUrlIndex++;
      await scrapeNextProduct();
      return;
    }

    const tab = await navigateToUrl(currentUrl);
    if (!tab) throw new Error('Failed to navigate to product page');

    await injectContentScript(tab.id);

    await chrome.tabs.sendMessage(tab.id, { action: 'start_product_scraping' }).catch(async () => {
      debugLog('Message failed; retrying after short delay');
      await new Promise(r => setTimeout(r, 1200));
      await chrome.tabs.sendMessage(tab.id, { action: 'start_product_scraping' });
    });

    scrapingState.productProcessingTimeout = setManagedTimeout(() => {
      debugLog('Product processing timeout, moving to next product');
      handlePageTimeout('Product scraping');
    }, CONSTANTS.PRODUCT_PROCESSING_TIMEOUT);

    await broadcastProgress({
      phase: 'scraping_details',
      currentProduct: scrapingState.currentUrlIndex + 1,
      totalProducts: scrapingState.urlsToScrape.length,
      productsScraped: scrapingState.scrapedProducts.length,
      progress:
        (scrapingState.urlsToScrape.length > 0
          ? scrapingState.currentUrlIndex / scrapingState.urlsToScrape.length
          : 0) * 100,
      detailedStats: scrapingState.detailedStats
    });
  } catch (error) {
    debugLog('Error in scrapeNextProduct:', error.message);
    scrapingState.errors.push({
      phase: 'scraping_details',
      url: scrapingState.urlsToScrape[scrapingState.currentUrlIndex],
      error: error.message,
      timestamp: new Date().toISOString()
    });
    await moveToNextProduct();
  }
}

async function injectContentScript(tabId) {
  // ping first; if content.js is already present, skip reinjection
  const injected = await chrome.tabs.sendMessage(tabId, { action: 'ping' })
    .then(() => true)
    .catch(() => false);

  if (injected) {
    debugLog('Content script already present, skipping injection');
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    debugLog('Content script injected successfully');
  } catch (error) {
    debugLog('Content script injection failed:', error.message);
  }
}

function handleProductDetailsScraped(data) {
  if (scrapingState.productProcessingTimeout) {
    clearManagedTimeout(scrapingState.productProcessingTimeout);
    scrapingState.productProcessingTimeout = null;
  }
  if (!scrapingState.active || scrapingState.phase !== 'scraping_details') return;

  if (data.product) {
    const normalizedUrl = normalizeProductUrl(data.productUrl);
    if (!scrapingState.scrapedProductUrls.has(normalizedUrl)) {
      const enrichedProduct = {
        ...data.product,
        scrapedIndex: scrapingState.currentUrlIndex,
        totalInBatch: scrapingState.urlsToScrape.length,
        scrapingSession: scrapingState.startTime,
        extractionTimestamp: new Date().toISOString()
      };
      updateDetailedStats(data.product);
      scrapingState.scrapedProducts.push(enrichedProduct);
      scrapingState.scrapedProductUrls.add(normalizedUrl);
    }
  }

  broadcastProgress({
    phase: 'scraping_details',
    currentProduct: scrapingState.currentUrlIndex + 1,
    totalProducts: scrapingState.urlsToScrape.length,
    productsScraped: scrapingState.scrapedProducts.length,
    progress:
      (scrapingState.urlsToScrape.length > 0
        ? (scrapingState.currentUrlIndex + 1) / scrapingState.urlsToScrape.length
        : 0) * 100,
    detailedStats: scrapingState.detailedStats,
    errors: scrapingState.errors.length
  });

  setManagedTimeout(moveToNextProduct, CONSTANTS.PRODUCT_NAVIGATION_DELAY);
}

function updateDetailedStats(product) {
  scrapingState.detailedStats.totalParameters += Object.keys(product).length;
  if (product['how much overall 5 rating']) scrapingState.detailedStats.ratingsBreakdown++;
  if (product['available colors'] && product['available colors'].length > 1) scrapingState.detailedStats.colorsFound++;
  if (product['delivery types']) scrapingState.detailedStats.deliveryTypesFound++;
  if (product['payment methods'] && product['payment methods'].length > 0) scrapingState.detailedStats.paymentMethodsFound++;
  if (product['product highlights'] && product['product highlights'].length > 0) scrapingState.detailedStats.specificationsFound++;
}

async function moveToNextProduct() {
  if (!scrapingState.active) return;
  scrapingState.currentUrlIndex++;
  await scrapeNextProduct();
}

// URL NORMALIZATION
function normalizeProductUrl(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    const paramsToKeep = ['pid', 'dp'];
    const newSearch = new URLSearchParams();
    for (const param of paramsToKeep) {
      if (urlObj.searchParams.has(param)) {
        newSearch.set(param, urlObj.searchParams.get(param));
      }
    }
    urlObj.search = newSearch.toString();
    urlObj.hash = '';
    if (urlObj.hostname.includes('flipkart.com')) urlObj.hostname = 'www.flipkart.com';
    else if (urlObj.hostname.includes('amazon')) urlObj.hostname = 'www.amazon.in';
    return urlObj.toString();
  } catch (e) {
    debugLog('Error normalizing URL:', e.message);
    return url;
  }
}

// COMPLETION & STOP
async function completeScrapingProcess() {
  debugLog('Completing enhanced scraping process');

  const completionTime = Date.now();
  const totalTime = completionTime - scrapingState.startTime;
  const results = {
    summary: {
      totalTime,
      totalTimeFormatted: formatDuration(totalTime),
      pagesProcessed: scrapingState.pagesProcessed,
      urlsCollected: scrapingState.allProductUrls.size,
      productsScraped: scrapingState.scrapedProducts.length,
      duplicatesSkipped:
        scrapingState.urlsToScrape.length - scrapingState.scrapedProducts.length,
      successRate:
        scrapingState.urlsToScrape.length > 0
          ? ((scrapingState.scrapedProducts.length / scrapingState.urlsToScrape.length) * 100).toFixed(1) + '%'
          : '0%',
      errors: scrapingState.errors.length,
      startTime: new Date(scrapingState.startTime).toISOString(),
      endTime: new Date(completionTime).toISOString(),
      averageParametersPerProduct:
        scrapingState.scrapedProducts.length > 0
          ? (scrapingState.detailedStats.totalParameters / scrapingState.scrapedProducts.length).toFixed(1)
          : 0,
      detailedStats: scrapingState.detailedStats
    },
    products: scrapingState.scrapedProducts,
    errors: scrapingState.errors,
    config: scrapingState.config
  };

  scrapingState.phase = 'complete';
  scrapingState.active = false;

  await saveResultsToStorage(results);
  await broadcastScrapingComplete(results);
  clearExistingTimeouts();
  cleanupAllTimers();
}

function stopScrapingProcess() {
  debugLog('Stopping enhanced scraping process');
  if (!scrapingState.active) return;

  scrapingState.active = false;
  clearExistingTimeouts();
  cleanupAllTimers();

  const partialResults = {
    summary: {
      status: 'stopped',
      pagesProcessed: scrapingState.pagesProcessed,
      urlsCollected: scrapingState.allProductUrls.size,
      productsScraped: scrapingState.scrapedProducts.length,
      duplicatesSkipped:
        scrapingState.scrapedProductUrls
          ? scrapingState.urlsToScrape.length - scrapingState.scrapedProducts.length
          : 0,
      errors: scrapingState.errors.length,
      stoppedAt: new Date().toISOString(),
      phase: scrapingState.phase,
      detailedStats: scrapingState.detailedStats
    },
    products: scrapingState.scrapedProducts,
    errors: scrapingState.errors
  };

  broadcastScrapingStopped(partialResults);
}

// UTIL
function clearExistingTimeouts() {
  if (scrapingState.pageProcessingTimeout) {
    clearManagedTimeout(scrapingState.pageProcessingTimeout);
    scrapingState.pageProcessingTimeout = null;
  }
  if (scrapingState.productProcessingTimeout) {
    clearManagedTimeout(scrapingState.productProcessingTimeout);
    scrapingState.productProcessingTimeout = null;
  }
}

function validateConfig(config) {
  return config &&
    typeof config.searchQuery === 'string' &&
    config.searchQuery.trim().length >= 2 &&
    config.website &&
    ['flipkart', 'amazon'].includes(config.website) &&
    Number.isInteger(config.startPage) &&
    Number.isInteger(config.endPage) &&
    config.startPage >= 1 &&
    config.endPage >= config.startPage &&
    config.endPage <= 50;
}

function buildSearchUrl(query, page, website) {
  const encodedQuery = encodeURIComponent(query.trim());
  switch (website) {
    case 'flipkart':
      return `https://www.flipkart.com/search?q=${encodedQuery}&page=${page}`;
    case 'amazon':
      return `https://www.amazon.in/s?k=${encodedQuery}&page=${page}`;
    default:
      throw new Error(`Unsupported website: ${website}`);
  }
}

async function navigateToUrl(url) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.tabs.update(tab.id, { url });
      return await waitForTabNavigation(tab.id);
    } else {
      const newTab = await chrome.tabs.create({ url });
      return await waitForTabNavigation(newTab.id);
    }
  } catch (error) {
    debugLog('Error navigating to URL:', error.message);
    throw error;
  }
}

async function waitForTabNavigation(tabId, maxWaitTime = 30000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let resolved = false;

    const check = async () => {
      if (resolved) return;
      try {
        const tab = await chrome.tabs.get(tabId);
        const elapsed = Date.now() - startTime;
        if (tab.status === 'complete') {
          resolved = true;
          debugLog('Tab navigation completed');
          setTimeout(() => resolve(tab), 3000);
        } else if (elapsed > maxWaitTime) {
          resolved = true;
          debugLog('Tab navigation timeout, proceeding anyway');
          resolve(tab);
        } else {
          setTimeout(check, 800);
        }
      } catch (e) {
        if (!resolved) {
          resolved = true;
          reject(e);
        }
      }
    };
    check();
  });
}

function handlePageTimeout(operation) {
  scrapingState.errors.push({
    phase: scrapingState.phase,
    operation,
    page: scrapingState.lastProcessedPage,
    url: scrapingState.lastProcessedUrl,
    error: 'Processing timeout',
    timestamp: new Date().toISOString()
  });

  if (scrapingState.phase === 'collecting_urls') moveToNextPage();
  else if (scrapingState.phase === 'scraping_details') moveToNextProduct();
}

function handlePageError(error) {
  if (
    error &&
    (error.includes('sonic.fdp.api') ||
      error.includes('406') ||
      error.includes('facebook.com/tr') ||
      error.includes('ERR_BLOCKED_BY_CLIENT') ||
      error.includes('net::ERR_ABORTED'))
  ) {
    debugLog('Ignoring non-critical page error:', error);
    return;
  }

  scrapingState.errors.push({
    phase: scrapingState.phase,
    page: scrapingState.lastProcessedPage,
    url: scrapingState.lastProcessedUrl,
    error,
    timestamp: new Date().toISOString()
  });
}

async function saveResultsToStorage(results) {
  try {
    const storageKey = `scraping_results_${scrapingState.startTime}`;
    await chrome.storage.local.set({
      [storageKey]: results,
      latest_results: results
    });
    debugLog('Enhanced results saved to storage');
  } catch (error) {
    debugLog('Error saving results:', error.message);
  }
}

function getStatus() {
  return {
    active: scrapingState.active,
    phase: scrapingState.phase,
    currentPage: scrapingState.currentPage,
    totalPages: scrapingState.totalPages,
    urlsCollected: scrapingState.allProductUrls.size,
    currentUrlIndex: scrapingState.currentUrlIndex,
    totalUrls: scrapingState.urlsToScrape.length,
    productsScraped: scrapingState.scrapedProducts.length,
    duplicatesSkipped: scrapingState.scrapedProductUrls
      ? scrapingState.urlsToScrape.length - scrapingState.scrapedProducts.length
      : 0,
    errors: scrapingState.errors.length,
    config: scrapingState.config,
    detailedStats: scrapingState.detailedStats
  };
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// BROADCAST
async function broadcastPhaseStart(phase, data) {
  try {
    await chrome.runtime.sendMessage({ action: 'enhanced_phase_started', phase, ...data });
  } catch (e) {
    debugLog('Error broadcasting phase start:', e.message);
  }
}
async function broadcastProgress(data) {
  try {
    await chrome.runtime.sendMessage({ action: 'enhanced_scraping_progress', data });
  } catch (e) {
    debugLog('Error broadcasting progress:', e.message);
  }
}
async function broadcastScrapingComplete(results) {
  try {
    await chrome.runtime.sendMessage({ action: 'enhanced_scraping_complete', data: results });
  } catch (e) {
    debugLog('Error broadcasting completion:', e.message);
  }
}
async function broadcastScrapingStopped(results) {
  try {
    await chrome.runtime.sendMessage({ action: 'enhanced_scraping_stopped', data: results });
  } catch (e) {
    debugLog('Error broadcasting stop:', e.message);
  }
}
async function broadcastError(error) {
  try {
    await chrome.runtime.sendMessage({ action: 'enhanced_scraping_error', error });
  } catch (e) {
    debugLog('Error broadcasting error:', e.message);
  }
}

// STARTUP / INSTALL
chrome.runtime.onStartup.addListener(() => {
  debugLog('Extension startup - initializing enhanced background script');
  cleanupAllTimers();
});
chrome.runtime.onInstalled.addListener(async (details) => {
  debugLog('Extension installed/updated:', details.reason);
  await setupNetworkBlocking();
});

async function setupNetworkBlocking() {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const ids = existing.map(r => r.id);
    if (ids.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
    }
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: 100,
          priority: 1,
          action: { type: "block" },
          condition: {
            urlFilter: "*://sonic.fdp.api.flipkart.com/*",
            resourceTypes: ["xmlhttprequest", "script", "image"]
          }
        },
        {
          id: 101,
          priority: 1,
          action: { type: "block" },
          condition: {
            urlFilter: "*://www.facebook.com/tr*",
            resourceTypes: ["image", "script", "xmlhttprequest"]
          }
        },
        {
          id: 102,
          priority: 1,
          action: { type: "block" },
          condition: {
            urlFilter: "*://connect.facebook.net/*",
            resourceTypes: ["script", "xmlhttprequest"]
          }
        }
      ]
    });
    debugLog('Network blocking rules successfully configured');
  } catch (e) {
    debugLog('Error setting up network blocking:', e.message);
  }
}

// Global error handlers (service worker)
self.addEventListener('error', (event) => {
  debugLog('Global error in background script:', event.error?.message || event.message);
});
self.addEventListener('unhandledrejection', (event) => {
  debugLog('Unhandled promise rejection in background script:', event.reason);
});

debugLog('Enhanced background script loaded with Manifest V3 compliance and network blocking');
