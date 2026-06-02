let scrapeInterval = null;
let lastCount = 0;
let noNewItemsTicks = 0;
const MAX_NO_NEW_TICKS = 8; // Number of consecutive checks without changes before declaring finished (approx 20 seconds)

// Message listener to interact with sidepanel.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ status: 'alive' });
    return true;
  }
  
  if (request.action === 'startScraping') {
    startScraping();
    sendResponse({ status: 'started' });
    return true;
  }
  
  if (request.action === 'stopScraping') {
    stopScraping();
    sendResponse({ status: 'stopped' });
    return true;
  }
});

/**
 * Initializes scrolling and scanning loop
 */
function startScraping() {
  // Clear any existing active scraper intervals
  if (scrapeInterval) clearInterval(scrapeInterval);
  
  lastCount = 0;
  noNewItemsTicks = 0;
  
  chrome.runtime.sendMessage({ 
    type: 'SCRAPE_STATUS', 
    status: 'scrolling', 
    message: 'Scraping engine initialized. Locating feed container...' 
  });
  
  // Run initial extraction
  const initialCount = scrapeCurrentPage();
  lastCount = initialCount;
  
  // Run periodic scroll and parse loop
  scrapeInterval = setInterval(() => {
    const feed = document.querySelector('div[role="feed"]');
    
    if (!feed) {
      chrome.runtime.sendMessage({ 
        type: 'SCRAPE_STATUS', 
        status: 'error', 
        message: 'Google Maps feed container not found. Perform a search first.' 
      });
      stopScraping();
      return;
    }
    
    // Scroll the feed container down to trigger lazy loading of more elements
    feed.scrollBy(0, 800);
    
    // Scrape listings visible in DOM
    const currentCount = scrapeCurrentPage();
    
    // Check if new listings were discovered
    if (currentCount === lastCount) {
      noNewItemsTicks++;
      
      const isEnd = checkEndOfListText();
      if (isEnd || noNewItemsTicks >= MAX_NO_NEW_TICKS) {
        chrome.runtime.sendMessage({ 
          type: 'SCRAPE_STATUS', 
          status: 'finished', 
          message: `Scrape complete! Extracted ${currentCount} business listings.` 
        });
        stopScraping();
      }
    } else {
      noNewItemsTicks = 0;
      lastCount = currentCount;
    }
  }, 2500); // 2.5-second scan-and-scroll cycle
}

/**
 * Stops scanning loop
 */
function stopScraping() {
  if (scrapeInterval) {
    clearInterval(scrapeInterval);
    scrapeInterval = null;
  }
}

/**
 * Scans for standard 'end of results' texts to terminate scrape
 */
function checkEndOfListText() {
  const elements = document.querySelectorAll('span, div');
  for (const el of elements) {
    const text = el.textContent || '';
    if (text.includes("You've reached the end of the list") || 
        text.includes("No more results") ||
        text.includes("results matching")) {
      return true;
    }
  }
  return false;
}

/**
 * Searches the DOM for business listings and parses metadata
 */
function scrapeCurrentPage() {
  // Google Maps listing cards always contain links with a URL structure matching '/maps/place/'
  const placeLinks = document.querySelectorAll('a[href*="/maps/place/"]');
  let parsedCount = 0;
  
  placeLinks.forEach(link => {
    try {
      const mapsUrl = link.href;
      
      // Locate the parent container of the business card
      const cardContainer = link.closest('div[role="feed"] > div') || 
                            link.closest('.Nv2y1d') || 
                            link.closest('.Uaetw') ||
                            link.parentElement.parentElement;
                            
      if (!cardContainer) return;
      
      // Extract Business Name
      let name = link.getAttribute('aria-label');
      if (!name) {
        const headline = cardContainer.querySelector('.fontHeadlineSmall');
        name = headline ? headline.textContent.trim() : '';
      }
      if (!name) {
        name = link.textContent.trim();
      }
      
      // Clean Google Maps names (often includes ratings/categories separated by middot)
      if (name) {
        name = name.split('·')[0].trim();
      }
      
      if (!name) return;
      
      parsedCount++;
      
      // Extract Phone Number
      let phone = 'N/A';
      
      // Priority 1: Check for explicit phone attribute in button
      const phoneButton = cardContainer.querySelector('[data-item-id^="phone:tel:"]');
      if (phoneButton) {
        const itemId = phoneButton.getAttribute('data-item-id');
        phone = itemId.replace('phone:tel:', '').replace(/\s+/g, '').trim();
      } else {
        // Priority 2: Check aria-label containing phone tags
        const phoneIcon = cardContainer.querySelector('button[aria-label*="Phone:"]');
        if (phoneIcon) {
          phone = phoneIcon.getAttribute('aria-label').replace('Phone:', '').trim();
        } else {
          // Priority 3: Fallback to scanning text patterns
          const text = cardContainer.textContent || '';
          const phoneMatch = text.match(/(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,6}/);
          if (phoneMatch && phoneMatch[0].length >= 8) {
            phone = phoneMatch[0].trim();
          }
        }
      }
      
      // Extract Website URL
      let website = 'N/A';
      
      // Priority 1: Check for authority tag attribute
      const websiteLink = cardContainer.querySelector('a[data-item-id="authority"]');
      if (websiteLink && websiteLink.href) {
        website = websiteLink.href;
      } else {
        // Priority 2: Check aria-label containing Website tags
        const websiteIcon = cardContainer.querySelector('a[aria-label*="Website"]');
        if (websiteIcon && websiteIcon.href) {
          website = websiteIcon.href;
        } else {
          // Priority 3: Check for any links to domains outside Google
          const links = cardContainer.querySelectorAll('a[href^="http"]');
          for (const l of links) {
            const href = l.href;
            if (!href.includes('google.com') && !href.includes('google.ad') && !href.includes('ggpht.com')) {
              website = href;
              break;
            }
          }
        }
      }
      
      // Clean redirects (Google Maps redirects external links through google.com/url?q=...)
      if (website && website !== 'N/A') {
        try {
          const urlObj = new URL(website);
          if (urlObj.hostname.includes('google.com') && urlObj.pathname.includes('/url')) {
            const q = urlObj.searchParams.get('q');
            if (q) website = q;
          }
        } catch (e) {
          // Fail silently and keep original URL
        }
      }
      
      // Extract Address
      let address = 'N/A';
      const details = cardContainer.querySelectorAll('.W4Efsd');
      const serviceKeywords = ['dine-in', 'takeout', 'delivery', 'in-store', 'pickup', 'no-contact', 'drive-through', 'same-day'];
      for (let i = 1; i < details.length; i++) {
        const spans = details[i].querySelectorAll('span');
        let potentialAddress = '';
        for (const span of spans) {
          const text = span.textContent.trim();
          const lowerText = text.toLowerCase();
          const isServiceOption = serviceKeywords.some(keyword => lowerText.includes(keyword));
          
          if (text && 
              text !== '·' && 
              !isServiceOption &&
              !text.startsWith('Open') && 
              !text.startsWith('Closed') && 
              !text.startsWith('Closes') && 
              !text.startsWith('Opens') &&
              !text.includes('opens at') &&
              !text.includes('closes at') &&
              !text.match(/\(?\d{2,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,6}/)) {
            if (text.length > 5) {
              potentialAddress = text;
              break;
            }
          }
        }
        if (potentialAddress) {
          address = potentialAddress;
          break;
        }
      }
      
      // Relay extracted lead details back to sidepanel.js
      chrome.runtime.sendMessage({
        type: 'LEAD_FOUND',
        lead: {
          name,
          phone,
          website,
          address,
          mapsUrl
        }
      });
      
    } catch (err) {
      console.error("Error parsing Google Maps business card:", err);
    }
  });
  
  return parsedCount;
}
