// Content.js - Scrapes data from the page when instructed by Background.js

(() => {
  const SELECTORS = {
    flipkart: {
      url: 'a[href*="/p/"]',
      productName: 'h1 span',
      price: 'div._30jeq3._16Jk6d',
      rating: 'div._3_L3jD',
      numRatings: 'span._2_R_DZ span span:last-child',
      highlights: 'div._2418kt ul li',
      specs: 'div._1UhVsV',
    },
    amazon: {
      url: 'a.a-link-normal.s-underline-text.s-underline-link-text.s-link-style.a-text-normal',
      productName: '#productTitle',
      price: '.a-price-whole',
      rating: '#acrPopover .a-icon-alt',
      numRatings: '#acrCustomerReviewText',
      highlights: '#feature-bullets ul li .a-list-item',
      specs: '#productDetails_techSpec_section_1',
    },
  };

  let site;
  if (window.location.hostname.includes('flipkart')) {
    site = 'flipkart';
  } else if (window.location.hostname.includes('amazon')) {
    site = 'amazon';
  }

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'start_url_collection') {
      const urls = scrapeProductUrls();
      chrome.runtime.sendMessage({
        action: 'urls_collected_from_page',
        data: { urls },
      });
    }

    if (request.action === 'start_product_scraping') {
      const product = scrapeProductDetails();
      chrome.runtime.sendMessage({
        action: 'product_details_scraped',
        data: { product, productUrl: window.location.href, website: site },
      });
    }
  });

  function scrapeProductUrls() {
    if (!site) return [];
    const urls = new Set();
    document.querySelectorAll(SELECTORS[site].url).forEach((el) => {
      if (el.href) {
        urls.add(el.href);
      }
    });
    return Array.from(urls);
  }

  function scrapeProductDetails() {
    if (!site) return null;

    const getText = (selector) => {
      const el = document.querySelector(selector);
      return el ? el.innerText.trim() : null;
    };

    const getList = (selector) => {
      return Array.from(document.querySelectorAll(selector)).map(el => el.innerText.trim());
    };

    const product = {
      name: getText(SELECTORS[site].productName),
      price: getText(SELECTORS[site].price),
      rating: getText(SELECTORS[site].rating),
      numRatings: getText(SELECTORS[site].numRatings),
      highlights: getList(SELECTORS[site].highlights),
      specs: getText(SELECTORS[site].specs),
      url: window.location.href,
    };

    return product;
  }
})();