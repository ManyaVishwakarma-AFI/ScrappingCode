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
  
  // Enhanced tracking
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

// Track active timeouts for proper cleanup
const activeTimeouts = new Set();
const activeIntervals = new Set();

function debugLog(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] BG: ${message}`, data || '');
}

// Enhanced timeout management
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
  activeTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
  activeIntervals.forEach(intervalId => clearInterval(intervalId));
  activeTimeouts.clear();
  activeIntervals.clear();
}

// ================================
// LIFECYCLE MANAGEMENT
// ================================

chrome.runtime.onSuspend.addListener(() => {
  debugLog('Extension suspending - cleaning up');
  cleanupOnExit();
});

chrome.runtime.onSuspendCanceled.addListener(() => {
  debugLog('Extension suspend canceled');
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (scrapingState.active) {
    debugLog('Active tab removed during scraping');
    handleTabClosure();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
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
  if (scrapingState.active) {
    debugLog('Handling unexpected tab closure');
    if (scrapingState.phase === 'collecting_urls') {
      moveToNextPage();
    } else if (scrapingState.phase === 'scraping_details') {
      moveToNextProduct();
    }
  }
}

// ================================
// MESSAGE HANDLING
// ================================

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

async function handleMessage(request, sender) {
  try {
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
  } catch (error) {
    debugLog('Error in handleMessage:', error.message);
    broadcastError(`Background error: ${error.message}`);
    throw error;
  }
}

// ================================
// PHASE 1: URL COLLECTION
// ================================

async function startScrapingProcess(config) {
  debugLog('Starting enhanced scraping with duplicate prevention:', config);
  
  if (!validateConfig(config)) {
    broadcastError('Invalid scraping configuration provided');
    return;
  }
  
  clearExistingTimeouts();
  cleanupAllTimers();
  
  // Initialize state
  scrapingState = {
    active: true,
    config: config,
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
  
  debugLog('Phase 1: Enhanced URL Collection initialized with duplicate prevention', {
    startPage: config.startPage,
    endPage: config.endPage,
    totalPages: scrapingState.totalPages,
    website: config.website
  });
  
  await broadcastPhaseStart('collecting_urls', {
    totalPages: scrapingState.totalPages,
    startPage: config.startPage,
    endPage: config.endPage
  });
  
  await collectUrlsFromNextPage();
}

async function collectUrlsFromNextPage() {
  if (!scrapingState.active || scrapingState.phase !== 'collecting_urls') {
    debugLog('URL collection stopped or invalid phase');
    return;
  }

  if (scrapingState.currentPage > scrapingState.config.endPage) {
    debugLog(`Page range completed (${scrapingState.config.startPage}-${scrapingState.config.endPage}), starting product detail phase`);
    await startProductDetailPhase();
    return;
  }

  try {
    const searchUrl = buildSearchUrl(
      scrapingState.config.searchQuery,
      scrapingState.currentPage,
      scrapingState.config.website
    );

    debugLog(`Processing page ${scrapingState.currentPage}/${scrapingState.config.endPage}:`, 
      searchUrl.substring(0, 100) + '...');

    scrapingState.lastProcessedPage = scrapingState.currentPage;
    scrapingState.phaseStartTime = Date.now();

    const tab = await navigateToUrl(searchUrl);
    if (!tab) {
      throw new Error('Failed to navigate to search page');
    }

    await injectContentScript(tab.id);
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'start_url_collection'
      });
    } catch (error) {
      debugLog('Failed to send message to content script, will retry:', error.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
      await chrome.tabs.sendMessage(tab.id, {
        action: 'start_url_collection'
      });
    }

    scrapingState.pageProcessingTimeout = setManagedTimeout(() => {
      debugLog('Page processing timeout, moving to next page');
      handlePageTimeout('URL collection');
    }, CONSTANTS.PAGE_PROCESSING_TIMEOUT);

    await broadcastProgress({
      phase: 'collecting_urls',
      currentPage: scrapingState.currentPage,
      totalPages: scrapingState.config.endPage,
      urlsCollected: scrapingState.allProductUrls.size,
      progress: ((scrapingState.currentPage - scrapingState.config.startPage) / scrapingState.totalPages) * 100
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
  debugLog(`Received ${data.urls?.length || 0} URLs from page ${data.attempt}`);

  if (scrapingState.pageProcessingTimeout) {
    clearManagedTimeout(scrapingState.pageProcessingTimeout);
    scrapingState.pageProcessingTimeout = null;
  }

  if (!scrapingState.active || scrapingState.phase !== 'collecting_urls') {
    debugLog('Ignoring URLs - scraping not active or wrong phase');
    return;
  }

  if (data.urls && Array.isArray(data.urls)) {
    const initialCount = scrapingState.allProductUrls.size;
    
    data.urls.forEach(url => {
      if (url && typeof url === 'string' && url.length > 10) {
        const normalizedUrl = normalizeProductUrl(url);
        if (normalizedUrl && !scrapingState.allProductUrls.has(normalizedUrl)) {
          scrapingState.allProductUrls.add(normalizedUrl);
        }
      }
    });

    const newUrls = scrapingState.allProductUrls.size - initialCount;
    debugLog(`Added ${newUrls} new unique URLs (total: ${scrapingState.allProductUrls.size})`);
  }

  scrapingState.pagesProcessed++;

  broadcastProgress({
    phase: 'collecting_urls',
    currentPage: scrapingState.currentPage,
    totalPages: scrapingState.config.endPage,
    urlsCollected: scrapingState.allProductUrls.size,
    pagesScraped: scrapingState.pagesProcessed,
    progress: ((scrapingState.currentPage - scrapingState.config.startPage + 1) / scrapingState.totalPages) * 100
  });

  setManagedTimeout(() => {
    moveToNextPage();
  }, CONSTANTS.PAGE_NAVIGATION_DELAY);
}

async function moveToNextPage() {
  if (!scrapingState.active) return;

  scrapingState.currentPage++;
  
  if (scrapingState.currentPage > scrapingState.config.endPage) {
    debugLog(`Reached configured end page (${scrapingState.config.endPage}), starting product phase`);
    await startProductDetailPhase();
    return;
  }
  
  if (scrapingState.allProductUrls.size >= CONSTANTS.MAX_URLS_PER_SESSION) {
    debugLog(`URL limit reached (${CONSTANTS.MAX_URLS_PER_SESSION}), starting product phase`);
    await startProductDetailPhase();
    return;
  }

  await collectUrlsFromNextPage();
}

// ================================
// PHASE 2: PRODUCT SCRAPING
// ================================

async function startProductDetailPhase() {
  if (!scrapingState.active) return;

  debugLog('Transitioning to enhanced product detail scraping phase');

  scrapingState.phase = 'scraping_details';
  scrapingState.phaseStartTime = Date.now();
  scrapingState.urlsToScrape = Array.from(scrapingState.allProductUrls);
  scrapingState.currentUrlIndex = 0;
  scrapingState.scrapedProductUrls = new Set();

  debugLog('Enhanced product detail phase initialized:', {
    totalUrls: scrapingState.urlsToScrape.length,
    estimatedTime: `${Math.ceil(scrapingState.urlsToScrape.length * 4 / 60)} minutes`
  });

  await broadcastPhaseStart('scraping_details', {
    totalUrls: scrapingState.urlsToScrape.length,
    urlsCollected: scrapingState.allProductUrls.size,
    pagesProcessed: scrapingState.pagesProcessed
  });

  await scrapeNextProduct();
}

async function scrapeNextProduct() {
  if (!scrapingState.active || scrapingState.phase !== 'scraping_details') {
    debugLog('Product scraping stopped or invalid phase');
    return;
  }

  if (scrapingState.currentUrlIndex >= scrapingState.urlsToScrape.length) {
    debugLog('All products scraped, completing process');
    await completeScrapingProcess();
    return;
  }

  try {
    const currentUrl = scrapingState.urlsToScrape[scrapingState.currentUrlIndex];
    scrapingState.lastProcessedUrl = currentUrl;

    const normalizedCurrentUrl = normalizeProductUrl(currentUrl);
    if (scrapingState.scrapedProductUrls.has(normalizedCurrentUrl)) {
      debugLog(`Skipping duplicate product: ${normalizedCurrentUrl.substring(0, 80)}...`);
      scrapingState.currentUrlIndex++;
      await scrapeNextProduct();
      return;
    }

    debugLog(`Scraping product ${scrapingState.currentUrlIndex + 1}/${scrapingState.urlsToScrape.length}:`,
      currentUrl.substring(0, 80) + '...');

    const tab = await navigateToUrl(currentUrl);
    if (!tab) {
      throw new Error('Failed to navigate to product page');
    }

    await injectContentScript(tab.id);
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'start_product_scraping'
      });
    } catch (error) {
      debugLog('Failed to send message to content script, will retry:', error.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
      await chrome.tabs.sendMessage(tab.id, {
        action: 'start_product_scraping'
      });
    }

    scrapingState.productProcessingTimeout = setManagedTimeout(() => {
      debugLog('Product processing timeout, moving to next product');
      handlePageTimeout('Product scraping');
    }, CONSTANTS.PRODUCT_PROCESSING_TIMEOUT);

    await broadcastProgress({
      phase: 'scraping_details',
      currentProduct: scrapingState.currentUrlIndex + 1,
      totalProducts: scrapingState.urlsToScrape.length,
      productsScraped: scrapingState.scrapedProducts.length,
      progress: (scrapingState.currentUrlIndex / scrapingState.urlsToScrape.length) * 100,
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
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
    debugLog('Content script injected successfully');
  } catch (error) {
    debugLog('Content script already injected or injection failed:', error.message);
  }
}

function handleProductDetailsScraped(data) {
  debugLog(`Received enhanced product details:`, {
    website: data.website,
    hasProduct: !!data.product,
    productName: data.product?.name?.substring(0, 50) + '...' || 'No name',
    url: data.productUrl?.substring(0, 80) + '...'
  });

  if (scrapingState.productProcessingTimeout) {
    clearManagedTimeout(scrapingState.productProcessingTimeout);
    scrapingState.productProcessingTimeout = null;
  }

  if (!scrapingState.active || scrapingState.phase !== 'scraping_details') {
    debugLog('Ignoring product data - scraping not active or wrong phase');
    return;
  }

  if (data.product) {
    const normalizedUrl = normalizeProductUrl(data.productUrl);
    
    if (scrapingState.scrapedProductUrls.has(normalizedUrl)) {
      debugLog('Duplicate product detected, skipping...');
    } else {
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
      debugLog(`Enhanced product stored (${scrapingState.scrapedProducts.length} total)`);
    }
  } else {
    debugLog('No product data received');
  }

  broadcastProgress({
    phase: 'scraping_details',
    currentProduct: scrapingState.currentUrlIndex + 1,
    totalProducts: scrapingState.urlsToScrape.length,
    productsScraped: scrapingState.scrapedProducts.length,
    progress: ((scrapingState.currentUrlIndex + 1) / scrapingState.urlsToScrape.length) * 100,
    detailedStats: scrapingState.detailedStats,
    errors: scrapingState.errors.length
  });

  setManagedTimeout(() => {
    moveToNextProduct();
  }, CONSTANTS.PRODUCT_NAVIGATION_DELAY);
}

function updateDetailedStats(product) {
  scrapingState.detailedStats.totalParameters += Object.keys(product).length;
  
  if (product['how much overall 5 rating']) {
    scrapingState.detailedStats.ratingsBreakdown++;
  }
  
  if (product['available colors'] && product['available colors'].length > 1) {
    scrapingState.detailedStats.colorsFound++;
  }
  
  if (product['delivery types']) {
    scrapingState.detailedStats.deliveryTypesFound++;
  }
  
  if (product['payment methods'] && product['payment methods'].length > 0) {
    scrapingState.detailedStats.paymentMethodsFound++;
  }
  
  if (product['product highlights'] && product['product highlights'].length > 0) {
    scrapingState.detailedStats.specificationsFound++;
  }
}

async function moveToNextProduct() {
  if (!scrapingState.active) return;
  scrapingState.currentUrlIndex++;
  await scrapeNextProduct();
}

// ================================
// URL NORMALIZATION FUNCTION
// ================================

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
    
    if (urlObj.hostname.includes('flipkart.com')) {
      urlObj.hostname = 'www.flipkart.com';
    } else if (urlObj.hostname.includes('amazon')) {
      urlObj.hostname = 'www.amazon.in';
    }
    
    return urlObj.toString();
  } catch (e) {
    debugLog('Error normalizing URL:', e.message);
    return url;
  }
}

// ================================
// COMPLETION
// ================================

async function completeScrapingProcess() {
  debugLog('Completing enhanced scraping process');

  const completionTime = Date.now();
  const totalTime = completionTime - scrapingState.startTime;
  const results = {
    summary: {
      totalTime: totalTime,
      totalTimeFormatted: formatDuration(totalTime),
      pagesProcessed: scrapingState.pagesProcessed,
      urlsCollected: scrapingState.allProductUrls.size,
      productsScraped: scrapingState.scrapedProducts.length,
      duplicatesSkipped: scrapingState.urlsToScrape.length - scrapingState.scrapedProducts.length,
      successRate: scrapingState.urlsToScrape.length > 0 ? 
        ((scrapingState.scrapedProducts.length / scrapingState.urlsToScrape.length) * 100).toFixed(1) + '%' : '0%',
      errors: scrapingState.errors.length,
      startTime: new Date(scrapingState.startTime).toISOString(),
      endTime: new Date(completionTime).toISOString(),
      averageParametersPerProduct: scrapingState.scrapedProducts.length > 0 ? 
        (scrapingState.detailedStats.totalParameters / scrapingState.scrapedProducts.length).toFixed(1) : 0,
      detailedStats: scrapingState.detailedStats
    },
    products: scrapingState.scrapedProducts,
    errors: scrapingState.errors,
    config: scrapingState.config
  };

  scrapingState.phase = 'complete';
  scrapingState.active = false;

  debugLog('Enhanced scraping results:', results.summary);

  await saveResultsToStorage(results);
  await broadcastScrapingComplete(results);
  clearExistingTimeouts();
  cleanupAllTimers();
}

function stopScrapingProcess() {
  debugLog('Stopping enhanced scraping process');
  
  if (!scrapingState.active) {
    debugLog('Scraping was not active');
    return;
  }

  scrapingState.active = false;
  clearExistingTimeouts();
  cleanupAllTimers();

  const partialResults = {
    summary: {
      status: 'stopped',
      pagesProcessed: scrapingState.pagesProcessed,
      urlsCollected: scrapingState.allProductUrls.size,
      productsScraped: scrapingState.scrapedProducts.length,
      duplicatesSkipped: scrapingState.scrapedProductUrls ? scrapingState.urlsToScrape.length - scrapingState.scrapedProducts.length : 0,
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

// ================================
// UTILITY FUNCTIONS
// ================================

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
         config.searchQuery && 
         config.searchQuery.trim().length >= 2 &&
         config.website && 
         ['flipkart', 'amazon'].includes(config.website) &&
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
      await chrome.tabs.update(tab.id, { url: url });
      return await waitForTabNavigation(tab.id);
    } else {
      const newTab = await chrome.tabs.create({ url: url });
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
    
    const checkTabStatus = async () => {
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
          setTimeout(checkTabStatus, 800);
        }
      } catch (error) {
        if (!resolved) {
          resolved = true;
          debugLog('Error checking tab status:', error.message);
          reject(error);
        }
      }
    };
    
    checkTabStatus();
  });
}

function handlePageTimeout(operation) {
  debugLog(`${operation} timeout occurred`);
  
  scrapingState.errors.push({
    phase: scrapingState.phase,
    operation: operation,
    page: scrapingState.lastProcessedPage,
    url: scrapingState.lastProcessedUrl,
    error: 'Processing timeout',
    timestamp: new Date().toISOString()
  });

  if (scrapingState.phase === 'collecting_urls') {
    moveToNextPage();
  } else if (scrapingState.phase === 'scraping_details') {
    moveToNextProduct();
  }
}

function handlePageError(error) {
  // Filter out non-critical errors to reduce noise
  if (error && (
    error.includes('sonic.fdp.api') || 
    error.includes('406') || 
    error.includes('facebook.com/tr') || 
    error.includes('ERR_BLOCKED_BY_CLIENT') ||
    error.includes('net::ERR_ABORTED')
  )) {
    debugLog('Ignoring non-critical page error:', error);
    return;
  }
  
  debugLog('Page error received:', error);
  
  scrapingState.errors.push({
    phase: scrapingState.phase,
    page: scrapingState.lastProcessedPage,
    url: scrapingState.lastProcessedUrl,
    error: error,
    timestamp: new Date().toISOString()
  });
}

async function saveResultsToStorage(results) {
  try {
    const storageKey = `scraping_results_${scrapingState.startTime}`;
    await chrome.storage.local.set({
      [storageKey]: results,
      'latest_results': results
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
    duplicatesSkipped: scrapingState.scrapedProductUrls ? scrapingState.urlsToScrape.length - scrapingState.scrapedProducts.length : 0,
    errors: scrapingState.errors.length,
    config: scrapingState.config,
    detailedStats: scrapingState.detailedStats
  };
}

function formatDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// ================================
// BROADCAST FUNCTIONS FOR POPUP COMMUNICATION
// ================================

async function broadcastPhaseStart(phase, data) {
  try {
    await chrome.runtime.sendMessage({
      action: 'enhanced_phase_started',
      phase: phase,
      ...data
    });
    debugLog(`Broadcast phase start: ${phase}`);
  } catch (error) {
    debugLog('Error broadcasting phase start:', error.message);
  }
}

async function broadcastProgress(data) {
  try {
    await chrome.runtime.sendMessage({
      action: 'enhanced_scraping_progress',
      data: data
    });
  } catch (error) {
    debugLog('Error broadcasting progress:', error.message);
  }
}

async function broadcastScrapingComplete(results) {
  try {
    await chrome.runtime.sendMessage({
      action: 'enhanced_scraping_complete',
      data: results
    });
    debugLog('Broadcast scraping complete');
  } catch (error) {
    debugLog('Error broadcasting completion:', error.message);
  }
}

async function broadcastScrapingStopped(results) {
  try {
    await chrome.runtime.sendMessage({
      action: 'enhanced_scraping_stopped',
      data: results
    });
    debugLog('Broadcast scraping stopped');
  } catch (error) {
    debugLog('Error broadcasting stop:', error.message);
  }
}

async function broadcastError(error) {
  try {
    await chrome.runtime.sendMessage({
      action: 'enhanced_scraping_error',
      error: error
    });
    debugLog('Broadcast error:', error);
  } catch (error) {
    debugLog('Error broadcasting error:', error.message);
  }
}

// ================================
// INITIALIZATION AND STARTUP
// ================================

chrome.runtime.onStartup.addListener(() => {
  debugLog('Extension startup - initializing enhanced background script');
  cleanupAllTimers();
});

chrome.runtime.onInstalled.addListener((details) => {
  debugLog('Extension installed/updated:', details.reason);
  
  // Initialize declarativeNetRequest rules
  setupNetworkBlocking();
  
  if (details.reason === 'install') {
    debugLog('First time installation - enhanced scraping system ready');
  } else if (details.reason === 'update') {
    debugLog('Extension updated - enhanced features available');
  }
});

// ================================
// NETWORK BLOCKING SETUP (Manifest V3 Compliant)
// ================================

async function setupNetworkBlocking() {
  try {
    // Clear existing dynamic rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map(rule => rule.id);
    
    if (existingRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingRuleIds
      });
    }

    // Add new blocking rules
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
    
  } catch (error) {
    debugLog('Error setting up network blocking:', error.message);
  }
}

// Global error handlers for service worker context
self.addEventListener('error', (event) => {
  debugLog('Global error in background script:', event.error?.message || event.message);
});

self.addEventListener('unhandledrejection', (event) => {
  debugLog('Unhandled promise rejection in background script:', event.reason);
});

debugLog('Enhanced background script loaded with Manifest V3 compliance and network blocking');