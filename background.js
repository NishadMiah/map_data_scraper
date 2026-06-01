// Enable the side panel to open on action button click
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error("Error setting panel behavior:", error));
  }
});

// Listener for runtime messages from the side panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'findEmails') {
    scrapeEmailsFromWebsite(request.url)
      .then(emails => sendResponse({ success: true, emails }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the messaging channel open for asynchronous reply
  }
});

/**
 * Fetches website homepage and optionally a contact page to extract emails.
 * Uses Fetch API within service worker to bypass page-level CORS limitations.
 * @param {string} url The target website URL
 */
async function scrapeEmailsFromWebsite(url) {
  if (!url || typeof url !== 'string') return [];
  
  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  const foundEmails = new Set();

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000); // 10-second timeout limit
    
    const response = await fetch(targetUrl, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    clearTimeout(id);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const htmlText = await response.text();
    
    // 1. Scan homepage HTML
    const homepageEmails = extractEmailsFromText(htmlText);
    homepageEmails.forEach(email => foundEmails.add(email));
    
    // 2. If homepage doesn't yield any emails, search for contact/about page and scan that
    if (foundEmails.size === 0) {
      const contactUrl = findContactPageUrl(htmlText, targetUrl);
      if (contactUrl && contactUrl !== targetUrl) {
        const contactController = new AbortController();
        const contactId = setTimeout(() => contactController.abort(), 8000); // 8-second timeout for contact page
        
        try {
          const contactRes = await fetch(contactUrl, {
            signal: contactController.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          clearTimeout(contactId);
          
          if (contactRes.ok) {
            const contactHtml = await contactRes.text();
            const contactEmails = extractEmailsFromText(contactHtml);
            contactEmails.forEach(email => foundEmails.add(email));
          }
        } catch (e) {
          console.log(`Failed to fetch contact page: ${contactUrl}`, e);
        }
      }
    }
  } catch (error) {
    console.error(`Error scraping emails from ${targetUrl}:`, error);
  }

  return Array.from(foundEmails);
}

/**
 * Extracts unique email strings using regex and filters assets.
 * @param {string} text HTML/Text content
 */
function extractEmailsFromText(text) {
  if (!text) return [];
  
  // Regex to extract typical email structures
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
  const matches = text.match(emailRegex) || [];
  
  // Avoid capturing static image extensions, fonts, or assets that might match regex
  const ignoredExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.css', '.js', '.woff', '.woff2', '.webp', '.ico'];
  
  return matches
    .map(email => email.toLowerCase().trim())
    .filter(email => {
      const isAsset = ignoredExtensions.some(ext => email.endsWith(ext));
      const hasDuplicateDot = email.includes('..');
      const hasInvalidStartOrEnd = email.startsWith('.') || email.endsWith('.');
      return !isAsset && !hasDuplicateDot && !hasInvalidStartOrEnd && email.length > 5 && email.length < 100;
    });
}

/**
 * Scans HTML text to locate a contact or about page.
 * @param {string} html Raw HTML response text
 * @param {string} baseUrl Root URL to resolve relative paths
 */
function findContactPageUrl(html, baseUrl) {
  // Regex to extract anchor tags and their href values
  const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const contactKeywords = ['contact', 'about', 'reach', 'support', 'info', 'write', 'email', 'touch'];
  
  while ((match = linkRegex.exec(html)) !== null) {
    const urlPath = match[1].trim();
    const linkText = match[2].toLowerCase();
    
    const matchesKeywords = contactKeywords.some(kw => 
      linkText.includes(kw) || urlPath.toLowerCase().includes(kw)
    );
    
    if (matchesKeywords && urlPath && !urlPath.startsWith('mailto:') && !urlPath.startsWith('tel:') && !urlPath.startsWith('javascript:')) {
      try {
        return new URL(urlPath, baseUrl).href;
      } catch (e) {
        // Fail silently and continue searching
      }
    }
  }
  return null;
}
