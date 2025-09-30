// popup.js — UI glue for popup.html (start/stop, progress, download)
(() => {
  // DOM refs
  const websiteEl = document.getElementById('website');
  const queryEl = document.getElementById('searchQuery');
  const startPageEl = document.getElementById('startPage');
  const endPageEl = document.getElementById('endPage');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusEl = document.getElementById('status');
  const phaseIndicator = document.getElementById('phaseIndicator');
  const phaseText = document.getElementById('phaseText');
  const progressSection = document.getElementById('progressSection');
  const progressBar = document.getElementById('progressBar');
  const urlsCollectedEl = document.getElementById('urlsCollected');
  const pagesScrapedEl = document.getElementById('pagesScraped');
  const productsFoundEl = document.getElementById('productsFound');
  const errorCountEl = document.getElementById('errorCount');
  const avgParametersEl = document.getElementById('avgParameters');
  const ratingsFoundEl = document.getElementById('ratingsFound');
  const colorsFoundEl = document.getElementById('colorsFound');
  const deliveryFoundEl = document.getElementById('deliveryFound');
  const paymentFoundEl = document.getElementById('paymentFound');
  const specificationsFoundEl = document.getElementById('specificationsFound');

  // helpers
  function setStatus(text, cls = 'idle') {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = `status ${cls}`;
  }
  function setPhase(phase, text) {
    if (!phaseIndicator) return;
    phaseIndicator.style.display = 'block';
    phaseIndicator.className = `phase-indicator ${phase}`;
    phaseText.textContent = text || `Phase: ${phase}`;
  }
  function hidePhase() {
    if (!phaseIndicator) return;
    phaseIndicator.style.display = 'none';
  }
  function updateProgress(percent, label) {
    progressSection.style.display = 'block';
    progressBar.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
    progressBar.textContent = `${Math.round(percent || 0)}%`;
    if (label) document.getElementById('progressLabel').textContent = label;
  }

  function resetStats() {
    urlsCollectedEl.textContent = '0';
    pagesScrapedEl.textContent = '0';
    productsFoundEl.textContent = '0';
    errorCountEl.textContent = '0';
    avgParametersEl.textContent = '0';
    ratingsFoundEl.textContent = '0';
    colorsFoundEl.textContent = '0';
    deliveryFoundEl.textContent = '0';
    paymentFoundEl.textContent = '0';
    specificationsFoundEl.textContent = '0';
    progressBar.style.width = '0%';
    progressBar.textContent = '0%';
    progressSection.style.display = 'none';
    hidePhase();
  }

  // Validate inputs
  function readConfig() {
    const website = websiteEl.value;
    const searchQuery = (queryEl.value || '').trim();
    const startPage = parseInt(startPageEl.value || '1', 10);
    const endPage = parseInt(endPageEl.value || '1', 10);
    if (!searchQuery || searchQuery.length < 2) throw new Error('Search query must be at least 2 characters');
    if (!['flipkart','amazon'].includes(website)) throw new Error('Unsupported website');
    if (isNaN(startPage) || isNaN(endPage) || startPage < 1 || endPage < startPage) throw new Error('Invalid page range');
    return { website, searchQuery, startPage, endPage };
  }

  // Start
  startBtn.addEventListener('click', async () => {
    try {
      const config = readConfig();
      setStatus('Starting scraping — initializing...', 'running');
      resetStats();
      chrome.runtime.sendMessage({ action: 'start_scraping', config }, (resp) => {
        if (resp && resp.error) {
          setStatus('Start failed: ' + resp.error, 'error');
        } else {
          setStatus('Scraping started', 'running');
          startBtn.disabled = true;
          stopBtn.style.display = 'inline-block';
          stopBtn.disabled = false;
        }
      });
    } catch (err) {
      setStatus(err.message || 'Invalid config', 'warning');
    }
  });

  // Stop
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stop_scraping' }, (resp) => {
      setStatus('Stopping scraping...', 'warning');
      startBtn.disabled = false;
      stopBtn.style.display = 'none';
      downloadBtn.style.display = 'inline-block';
    });
  });

  // Clear stored results
  clearBtn.addEventListener('click', async () => {
    try {
      // remove latest_results and any scraping_results_ keys
      const store = await chrome.storage.local.get();
      const keys = Object.keys(store).filter(k => k.startsWith('scraping_results_') || k === 'latest_results');
      if (keys.length) await chrome.storage.local.remove(keys);
      setStatus('Cleared stored results', 'idle');
      resetStats();
      downloadBtn.style.display = 'none';
    } catch (e) {
      setStatus('Clear failed', 'error');
    }
  });

  // Download CSV
  downloadBtn.addEventListener('click', async () => {
    try {
      const all = await chrome.storage.local.get();
      const latest = all['latest_results'];
      if (!latest || !latest.products || latest.products.length === 0) {
        setStatus('No results to download', 'warning');
        return;
      }
      const csv = convertResultsToCSV(latest.products);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scrape_results_${new Date().toISOString().replace(/[:.]/g,'-')}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus('CSV download initiated', 'idle');
    } catch (e) {
      setStatus('Download failed', 'error');
    }
  });

  // Convert products array to CSV (basic)
  function convertResultsToCSV(products) {
    if (!Array.isArray(products) || products.length === 0) return '';
    const headers = Object.keys(products[0]);
    const escape = v => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;
    const rows = products.map(p => headers.map(h => escape(p[h])).join(','));
    return headers.join(',') + '\n' + rows.join('\n');
  }

  // Listen to messages from background for progress/status updates
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      const action = message.action;
      if (!action) return;
      switch (action) {
        case 'enhanced_phase_started':
          setPhase(message.phase, message.phase === 'collecting_urls' ? `Collecting URLs (${message.startPage}-${message.endPage})` : 'Scraping product details');
          setStatus('Phase started: ' + message.phase, 'running');
          break;

        case 'enhanced_scraping_progress': {
          const d = message.data || {};
          urlsCollectedEl.textContent = d.urlsCollected || urlsCollectedEl.textContent;
          pagesScrapedEl.textContent = d.pagesScraped || pagesScrapedEl.textContent;
          productsFoundEl.textContent = d.productsScraped || productsFoundEl.textContent;
          errorCountEl.textContent = d.errors || errorCountEl.textContent;
          avgParametersEl.textContent = (d.detailedStats && d.detailedStats.totalParameters) || avgParametersEl.textContent;
          ratingsFoundEl.textContent = (d.detailedStats && d.detailedStats.ratingsBreakdown) || ratingsFoundEl.textContent;
          colorsFoundEl.textContent = (d.detailedStats && d.detailedStats.colorsFound) || colorsFoundEl.textContent;
          deliveryFoundEl.textContent = (d.detailedStats && d.detailedStats.deliveryTypesFound) || deliveryFoundEl.textContent;
          paymentFoundEl.textContent = (d.detailedStats && d.detailedStats.paymentMethodsFound) || paymentFoundEl.textContent;
          specificationsFoundEl.textContent = (d.detailedStats && d.detailedStats.specificationsFound) || specificationsFoundEl.textContent;

          updateProgress(d.progress || 0, `Progress: ${Math.round(d.progress||0)}%`);
          setStatus('Scraping in progress', 'running');
          break;
        }

        case 'enhanced_scraping_complete':
          setStatus('Scraping complete — results saved', 'complete');
          startBtn.disabled = false;
          stopBtn.style.display = 'none';
          downloadBtn.style.display = 'inline-block';
          updateProgress(100, 'Complete');
          break;

        case 'enhanced_scraping_stopped':
          setStatus('Scraping stopped by user', 'warning');
          startBtn.disabled = false;
          stopBtn.style.display = 'none';
          downloadBtn.style.display = 'inline-block';
          break;

        case 'enhanced_scraping_error':
          setStatus('Error: ' + (message.error || 'Unknown'), 'error');
          startBtn.disabled = false;
          stopBtn.style.display = 'none';
          break;

        case 'page_error':
          setStatus('Page error: ' + (message.error || ''), 'error');
          break;

        default:
          // ignore
      }
    } catch (e) { console.error('popup message handler error', e); }
  });

  // On popup open: check for latest results
  (async () => {
    try {
      const store = await chrome.storage.local.get();
      if (store && store.latest_results && store.latest_results.products && store.latest_results.products.length > 0) {
        downloadBtn.style.display = 'inline-block';
      } else {
        downloadBtn.style.display = 'none';
      }
    } catch (e) { /* ignore */ }
  })();

  // Small UI setup
  stopBtn.style.display = 'none';
  downloadBtn.style.display = 'none';

})(); // IIFE end
