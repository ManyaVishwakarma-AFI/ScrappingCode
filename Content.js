// Content.js - Scrapes data from the page when instructed by Background.js

(() => {
  const SELECTORS = {
    flipkart: {
      productUrl: 'a.CGtC98, a._1fQZEK',
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
      starRatings: 'ul.-psZUR li.fQ-FC1',
      availableColors: 'ul.hSEbzK li.aJWdJI a',
    },
    amazon: {
      productUrl: 'a.a-link-normal.s-underline-text.s-underline-link-text.s-link-style.a-text-normal',
      productName: '#productTitle',
      currentPrice: '.a-price-whole',
      previousPrice: '.a-text-price .a-offscreen',
      discount: '.savingsPercentage',
      deliveryDetails: '#delivery-message, #mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE',
      warrantyInfo: '#warranty-nodal', // This is a guess, may need refinement
      description: '#productDescription',
      highlights: '#feature-bullets .a-list-item',
      paymentMethods: null, // Amazon doesn't typically list these on the page
      seller: '#merchant-info, #bylineInfo',
      overallRating: '#acrPopover .a-icon-alt',
      totalRatingsAndReviews: '#acrCustomerReviewText',
      starRatings: '#histogramTable .a-histogram-row',
      availableColors: '#variation_color_name .selection',
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

    const s = SELECTORS[site];

    const getText = (selector) => {
      if (!selector) return null;
      const el = document.querySelector(selector);
      return el ? el.innerText.trim() : null;
    };

    const getList = (selector) => {
      if (!selector) return [];
      return Array.from(document.querySelectorAll(selector)).map(el => el.innerText.trim());
    };

    const getStarRatings = (selector) => {
        if (!selector) return {};
        const ratings = {};
        const ratingElements = document.querySelectorAll(selector);

        if (site === 'flipkart') {
            ratingElements.forEach((li, index) => {
                const star = 5 - index;
                const count = li.querySelector('div.BArk-j')?.innerText.trim() || '0';
                ratings[`${star}_star_ratings`] = count;
            });
        } else if (site === 'amazon') {
            ratingElements.forEach((row) => {
                const starText = row.querySelector('.a-histogram-star-count a')?.innerText.trim();
                const percentageText = row.querySelector('.a-histogram-bar a')?.innerText.trim();
                if(starText && percentageText) {
                    const star = starText.match(/\d/)[0];
                    ratings[`${star}_star_ratings`] = percentageText;
                }
            });
        }
        return ratings;
    };

    const getAvailableColors = (selector) => {
        if (!selector) return [];
        const colors = new Set();
        if (site === 'flipkart') {
            document.querySelectorAll(selector).forEach(el => {
                const colorName = el.querySelector('div.V3Zflw')?.innerText.trim();
                if (colorName) colors.add(colorName);
            });
        } else if (site === 'amazon') {
            const colorEl = document.querySelector(selector);
            if (colorEl) colors.add(colorEl.innerText.trim());
        }
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