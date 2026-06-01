let activeTabId = null;
let scrapedLeads = [];
let scrapingActive = false;

// UI Elements
const connectionStatus = document.getElementById('connectionStatus');
const connectionText = document.getElementById('connectionText');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnExport = document.getElementById('btnExport');
const btnExportSheets = document.getElementById('btnExportSheets');
const btnReset = document.getElementById('btnReset');
const statLeads = document.getElementById('statLeads');
const statEmails = document.getElementById('statEmails');
const terminalLog = document.getElementById('terminalLog');
const logStatus = document.getElementById('logStatus');
const previewList = document.getElementById('previewList');
const previewPlaceholder = document.getElementById('previewPlaceholder');
const sheetWebhookUrl = document.getElementById('sheetWebhookUrl');

// Load saved Webhook URL from local storage
chrome.storage.local.get(['webhookUrl'], (result) => {
  if (result.webhookUrl) {
    sheetWebhookUrl.value = result.webhookUrl;
  }
});

// Auto-save Webhook URL on modification
sheetWebhookUrl.addEventListener('input', () => {
  chrome.storage.local.set({ webhookUrl: sheetWebhookUrl.value });
});

// Helper: Append log line to terminal view
function log(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.textContent = `[${time}] ${msg}`;
  terminalLog.appendChild(line);
  terminalLog.scrollTop = terminalLog.scrollHeight;
}

// Update connection status
function updateConnectionStatus(isConnected, message) {
  if (isConnected) {
    connectionStatus.className = 'connection-status connected';
    connectionText.textContent = message;
    if (!scrapingActive) {
      btnStart.disabled = false;
    }
  } else {
    connectionStatus.className = 'connection-status disconnected';
    connectionText.textContent = message;
    btnStart.disabled = true;
    if (scrapingActive) {
      forceStopScraping();
    }
  }
}

// Check if the current tab is Google Maps
async function checkTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      updateConnectionStatus(false, "No active tab");
      return;
    }
    
    activeTabId = tab.id;
    const isGmaps = tab.url && tab.url.includes('google.com/maps');
    
    if (isGmaps) {
      updateConnectionStatus(true, "G-Maps Connected");
    } else {
      updateConnectionStatus(false, "Not on Google Maps");
    }
  } catch (error) {
    console.error("Tab check error:", error);
    updateConnectionStatus(false, "Status Check Failed");
  }
}

// Ping the content script to verify if it is alive
function pingContentScript(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(false);
      } else {
        resolve(response && response.status === 'alive');
      }
    });
  });
}

// Inject content.js into the current active tab
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    log("Injected scraper script successfully.", "info");
    return true;
  } catch (e) {
    log(`Script injection failed: ${e.message}`, "error");
    return false;
  }
}

// Start scraping
btnStart.addEventListener('click', async () => {
  if (!activeTabId) return;
  
  scrapingActive = true;
  btnStart.style.display = 'none';
  btnStop.style.display = 'inline-flex';
  logStatus.textContent = 'Scraping...';
  logStatus.style.color = 'var(--success)';
  log('Initializing Google Maps Scraper...', 'info');

  const isAlive = await pingContentScript(activeTabId);
  if (!isAlive) {
    log('Content script not loaded. Injecting...', 'info');
    const injected = await injectContentScript(activeTabId);
    if (!injected) {
      forceStopScraping();
      return;
    }
  }
  
  chrome.tabs.sendMessage(activeTabId, { action: 'startScraping' }, (response) => {
    if (chrome.runtime.lastError) {
      log(`Communication error: ${chrome.runtime.lastError.message}`, 'error');
      forceStopScraping();
    } else {
      log('Scraping engine started.', 'success');
    }
  });
});

// Stop scraping
btnStop.addEventListener('click', () => {
  stopScraping();
});

function stopScraping() {
  scrapingActive = false;
  btnStop.style.display = 'none';
  btnStart.style.display = 'inline-flex';
  logStatus.textContent = 'Stopped';
  logStatus.style.color = 'var(--warning)';
  log('Scraping stopped by user.', 'warn');
  
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { action: 'stopScraping' });
  }
}

function forceStopScraping() {
  scrapingActive = false;
  btnStop.style.display = 'none';
  btnStart.style.display = 'inline-flex';
  logStatus.textContent = 'Disconnected';
  logStatus.style.color = 'var(--danger)';
}

// Reset/Clear Leads
btnReset.addEventListener('click', () => {
  if (scrapingActive) {
    stopScraping();
  }
  scrapedLeads = [];
  statLeads.textContent = '0';
  statEmails.textContent = '0';
  previewList.innerHTML = '';
  previewPlaceholder.style.display = 'block';
  previewList.appendChild(previewPlaceholder);
  btnExport.disabled = true;
  btnExportSheets.disabled = true;
  terminalLog.innerHTML = '';
  log("Dashboard reset complete. Ready to scrape.", "info");
});

// Export leads to CSV file
btnExport.addEventListener('click', () => {
  if (scrapedLeads.length === 0) return;
  
  const headers = ['Name', 'Phone', 'Website', 'Emails', 'Maps Link'];
  const csvRows = [headers.join(',')];
  
  for (const lead of scrapedLeads) {
    const row = [
      escapeCSVValue(lead.name),
      escapeCSVValue(lead.phone),
      escapeCSVValue(lead.website),
      escapeCSVValue(lead.emails.join('; ')),
      escapeCSVValue(lead.mapsUrl)
    ];
    csvRows.push(row.join(','));
  }
  
  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'gmaps_leads.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  log(`Successfully exported ${scrapedLeads.length} leads to gmaps_leads.csv`, 'success');
});

// Escaping helper for CSV
function escapeCSVValue(val) {
  if (val === undefined || val === null) return '""';
  let str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

// Export leads to Google Sheets via Apps Script Webhook
btnExportSheets.addEventListener('click', () => {
  const url = sheetWebhookUrl.value.trim();
  if (!url) {
    log('Please configure a Google Sheets Webhook URL first.', 'warn');
    return;
  }
  if (!url.startsWith('https://script.google.com/')) {
    log('Invalid Webhook URL. Must start with https://script.google.com/', 'error');
    return;
  }
  if (scrapedLeads.length === 0) return;

  btnExportSheets.disabled = true;
  btnExportSheets.innerHTML = '<span>⏳</span> Exporting...';
  log('Exporting data to Google Sheets...', 'info');

  fetch(url, {
    method: 'POST',
    mode: 'no-cors', // Bypasses CORS headers requirements on Apps Script redirects
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(scrapedLeads)
  })
  .then(() => {
    // Under mode: 'no-cors', response body is opaque, but completing indicates success
    log(`Pushed ${scrapedLeads.length} leads to Google Sheets successfully!`, 'success');
  })
  .catch(error => {
    log(`Google Sheets export failed: ${error.message}`, 'error');
  })
  .finally(() => {
    btnExportSheets.disabled = false;
    btnExportSheets.innerHTML = '<span>📊</span> Export to Google Sheets';
  });
});

// Add new lead and initiate email scraper
function handleNewLead(lead) {
  // Prevent duplicate items
  const isDuplicate = scrapedLeads.some(l => 
    (l.mapsUrl && l.mapsUrl === lead.mapsUrl) || 
    (l.name && l.name.toLowerCase() === lead.name.toLowerCase() && l.phone === lead.phone)
  );
  
  if (isDuplicate) return;
  
  const leadId = scrapedLeads.length;
  const newLead = {
    ...lead,
    id: leadId,
    emails: []
  };
  scrapedLeads.push(newLead);
  
  // Update leads count
  statLeads.textContent = scrapedLeads.length;
  btnExport.disabled = false;
  btnExportSheets.disabled = false;
  
  // Hide preview placeholder
  previewPlaceholder.style.display = 'none';
  
  // Create card DOM element
  const card = document.createElement('div');
  card.className = 'lead-card';
  card.id = `lead-card-${leadId}`;
  card.innerHTML = `
    <div class="lead-header">
      <span class="lead-name">${newLead.name}</span>
    </div>
    <div class="lead-body">
      <div class="lead-item">
        <span class="lead-icon">📞</span>
        <span class="lead-phone">${newLead.phone || 'N/A'}</span>
      </div>
      <div class="lead-item">
        <span class="lead-icon">🌐</span>
        ${newLead.website && newLead.website !== 'N/A' 
          ? `<a href="${newLead.website}" class="lead-link" target="_blank">${newLead.website}</a>`
          : `<span class="lead-text" style="color: var(--text-muted);">N/A</span>`
        }
      </div>
      <div class="lead-item">
        <span class="lead-icon">✉️</span>
        <span class="lead-email" id="email-${leadId}">
          ${newLead.website && newLead.website !== 'N/A' ? 'Searching...' : 'N/A'}
        </span>
      </div>
    </div>
  `;
  
  previewList.insertBefore(card, previewList.firstChild);
  log(`Scraped: ${newLead.name}`, 'info');
  
  // Fetch emails from background script if website is present
  if (newLead.website && newLead.website !== 'N/A') {
    chrome.runtime.sendMessage({ action: 'findEmails', url: newLead.website }, (response) => {
      const emailElem = document.getElementById(`email-${leadId}`);
      if (!emailElem) return;
      
      if (response && response.success) {
        if (response.emails && response.emails.length > 0) {
          newLead.emails = response.emails;
          emailElem.textContent = response.emails.join(', ');
          emailElem.className = 'lead-email';
          
          // Increment total email count
          const currentEmailsCount = parseInt(statEmails.textContent) || 0;
          statEmails.textContent = currentEmailsCount + response.emails.length;
          log(`Found email(s) for "${newLead.name}": ${response.emails.join(', ')}`, 'success');
        } else {
          emailElem.textContent = 'None found';
          emailElem.style.color = 'var(--text-muted)';
        }
      } else {
        emailElem.textContent = 'Fetch failed';
        emailElem.style.color = 'var(--danger)';
        const errMsg = response && response.error ? response.error : 'Network Error';
        log(`Failed to fetch website ${newLead.website} (${errMsg})`, 'warn');
      }
    });
  }
}

// Listen for messages from content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LEAD_FOUND') {
    handleNewLead(message.lead);
  } else if (message.type === 'SCRAPE_STATUS') {
    log(`[Scraper] ${message.message}`, message.status === 'finished' ? 'success' : 'info');
    if (message.status === 'finished') {
      scrapingActive = false;
      btnStop.style.display = 'none';
      btnStart.style.display = 'inline-flex';
      logStatus.textContent = 'Finished';
      logStatus.style.color = 'var(--success)';
    }
  }
});

// Setup listeners for Tab changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === activeTabId && changeInfo.status === 'complete') {
    checkTab();
  }
});

chrome.tabs.onActivated.addListener(() => {
  checkTab();
});

// Initial tab connection check
checkTab();
