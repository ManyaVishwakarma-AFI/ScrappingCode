// Content.js - Scrapes data from the page when instructed by Background.js

(() => {
  const SELECTORS = {
    flipkart: {
      // From the search page
      productUrl: 'a.CGtC98, a._1fQZEK',

      // From the product page
      productName: 'span.VU-ZEz',
      currentPrice: 'div.Nx9bqj.CxhGGd',
      previousPrice: 'div.yRaY8j.A6-E6v',
      discount: 'div.UkUFwK.WW8yVX span',
      deliveryDetails: 'div.yiggsN',
      warrantyInfo: 'div.Rq-gIF div.zIL-eP',
      description: 'div.cPHDOP.col-12-12 div.Xbd0Sd',
      highlights: 'div.xFVion li._7eSDEz',
      paymentMethods: 'div.cPHDOP.col-6-12 li.g11wDd',
      seller: '#sellerName span',
      overallRating: 'div.XQDdHH',
      totalRatingsAndReviews: 'span.Wphh3N',
      starRatings: 'ul.-psZUR li.fQ-FC1', // This will get all 5 star ratings
      availableColors: 'ul.hSEbzK li.aJWdJI a',
    },
    amazon: {
      // Add Amazon selectors here if needed in the future
      productUrl: 'a.a-link-normal.s-underline-text.s-underline-link-text.s-link-style.a-text-normal',
    },
  };

  const site = window.location.hostname.includes('flipkart') ? 'flipkart' :
               window.location.hostname.includes('amazon') ? 'amazon' : null;

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'start_url_collection') {
      const urls = scrapeProductUrls();
      chrome.runtime.sendMessage({ action: 'urls_collected_from_page', data: { urls } });
    } else if (request.action === 'start_product_scraping') {
      const product = scrapeProductDetails();
      chrome.runtime.sendMessage({ action: 'product_details_scraped', data: { product, productUrl: window.location.href, website: site } });
    }
  });

  function scrapeProductUrls() {
    if (!site) return [];
    const urls = new Set();
    document.querySelectorAll(SELECTORS[site].productUrl).forEach(el => {
      if (el.href) urls.add(el.href);
    });
    return Array.from(urls);
  }

  function scrapeProductDetails() {
    if (!site) return null;

    const s = SELECTORS.flipkart; // Assuming flipkart for now

    const getText = (selector) => {
      const el = document.querySelector(selector);
      return el ? el.innerText.trim() : null;
    };

    const getList = (selector) => {
      return Array.from(document.querySelectorAll(selector)).map(el => el.innerText.trim());
    };

    const getStarRatings = (selector) => {
        const ratings = {};
        const ratingElements = document.querySelectorAll(selector);
        ratingElements.forEach((li, index) => {
            const star = 5 - index; // 5 star, 4 star, etc.
            const count = li.querySelector('div.BArk-j')?.innerText.trim() || '0';
            ratings[`${star}_star_ratings`] = count;
        });
        return ratings;
    };

    const getAvailableColors = (selector) => {
        const colors = new Set();
        document.querySelectorAll(selector).forEach(el => {
            const colorName = el.querySelector('div.V3Zflw')?.innerText.trim();
            if (colorName) colors.add(colorName);
        });
        return Array.from(colors);
    }

    const product = {
      product_name: getText(s.productName),
      current_price: getText(s.currentPrice),
      previous_price: getText(s.previousPrice),
      discount: getText(s.discount),
      delivery_details: getText(s.deliveryDetails),
      warranty_info: getText(s.warrantyInfo),
      description: getText(s.description),
      highlights: getList(s.highlights),
      payment_methods: getList(s.paymentMethods),
      seller: getText(s.seller),
      overall_rating: getText(s.overallRating),
      total_ratings_and_reviews: getText(s.totalRatingsAndReviews),
      ...getStarRatings(s.starRatings),
      available_colors: getAvailableColors(s.availableColors),
      url: window.location.href,
    };

    return product;
  }
})();