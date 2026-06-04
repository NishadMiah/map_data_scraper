let activeTabId = null;
let scrapedLeads = [];
let scrapingActive = false;

// Campaign States
let campaignActive = false;
let campaignCountry = '';
let campaignQueue = [];
let currentCampaignIndex = -1;
let currentCategory = 'General';

// UI Elements
const connectionStatus = document.getElementById('connectionStatus');
const connectionText = document.getElementById('connectionText');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnExport = document.getElementById('btnExport');
const btnExportExcel = document.getElementById('btnExportExcel');
const btnExportSheets = document.getElementById('btnExportSheets');
const btnReset = document.getElementById('btnReset');
const statLeads = document.getElementById('statLeads');
const statEmails = document.getElementById('statEmails');
const terminalLog = document.getElementById('terminalLog');
const logStatus = document.getElementById('logStatus');
const previewList = document.getElementById('previewList');
const previewPlaceholder = document.getElementById('previewPlaceholder');

// Campaign UI Elements
const txtCampaignCountry = document.getElementById('txtCampaignCountry');
const categoryChecklist = document.getElementById('categoryChecklist');
const txtCustomCategory = document.getElementById('txtCustomCategory');
const btnCustomCategoryAdd = document.getElementById('btnCustomCategoryAdd');
const btnLaunchCampaign = document.getElementById('btnLaunchCampaign');
const btnStopCampaign = document.getElementById('btnStopCampaign');
const campaignStatusContainer = document.getElementById('campaignStatusContainer');
const campaignProgressList = document.getElementById('campaignProgressList');
const filterCategory = document.getElementById('filterCategory');

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
    if (!scrapingActive && !campaignActive) {
      btnStart.disabled = false;
      btnLaunchCampaign.disabled = false;
    }
  } else {
    connectionStatus.className = 'connection-status disconnected';
    connectionText.textContent = message;
    btnStart.disabled = true;
    btnLaunchCampaign.disabled = true;
    if (scrapingActive) {
      forceStopScraping();
    }
    if (campaignActive) {
      stopCampaign();
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

// Add Custom Category to Checklist
btnCustomCategoryAdd.addEventListener('click', () => {
  const customVal = txtCustomCategory.value.trim();
  if (!customVal) return;
  
  // Check if already exists in checklist
  const existingValues = Array.from(categoryChecklist.querySelectorAll('input')).map(el => el.value.toLowerCase());
  if (existingValues.includes(customVal.toLowerCase())) {
    log(`Category "${customVal}" is already in the list.`, 'warn');
    txtCustomCategory.value = '';
    return;
  }
  
  const label = document.createElement('label');
  label.className = 'category-item';
  label.innerHTML = `<input type="checkbox" value="${customVal}" checked> 📁 ${customVal}`;
  categoryChecklist.appendChild(label);
  
  log(`Added custom category: ${customVal}`, 'success');
  txtCustomCategory.value = '';
});

// Enable/Disable Campaign inputs during campaign
function toggleCampaignInputs(enabled) {
  txtCampaignCountry.disabled = !enabled;
  txtCustomCategory.disabled = !enabled;
  btnCustomCategoryAdd.disabled = !enabled;
  categoryChecklist.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.disabled = !enabled;
  });
  btnStart.disabled = !enabled && !scrapingActive;
}

// Run Campaign Step
async function runCampaignStep() {
  if (!campaignActive) return;
  
  currentCategory = campaignQueue[currentCampaignIndex];
  updateCampaignProgressItem(currentCategory, 'active', 'Scraping... 🔄');
  
  log(`[Campaign] Starting category (${currentCampaignIndex + 1}/${campaignQueue.length}): ${currentCategory}`, 'info');
  
  const query = `${currentCategory} in ${campaignCountry}`;
  const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}/`;
  
  log(`[Campaign] Navigating to query: "${query}"`, 'info');
  
  // Set up temporary listener to wait for navigation completion
  const navigationListener = async (tabId, changeInfo, tab) => {
    if (tabId === activeTabId && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(navigationListener);
      
      log(`[Campaign] Page loaded. Waiting 3 seconds for container rendering...`, 'info');
      setTimeout(async () => {
        if (!campaignActive) return;
        
        const isAlive = await pingContentScript(activeTabId);
        if (!isAlive) {
          log('[Campaign] Script not loaded. Injecting content script...', 'info');
          const injected = await injectContentScript(activeTabId);
          if (!injected) {
            log(`[Campaign] Failed to inject scraper. Skipping category ${currentCategory}`, 'error');
            campaignStepFailed();
            return;
          }
        }
        
        chrome.tabs.sendMessage(activeTabId, { action: 'startScraping' }, (response) => {
          if (chrome.runtime.lastError) {
            log(`[Campaign] Communication error starting scraper: ${chrome.runtime.lastError.message}`, 'error');
            campaignStepFailed();
          } else {
            log(`[Campaign] Scraper active for ${currentCategory}.`, 'success');
          }
        });
      }, 3000);
    }
  };
  
  chrome.tabs.onUpdated.addListener(navigationListener);
  chrome.tabs.update(activeTabId, { url: url });
}

function campaignStepFailed() {
  updateCampaignProgressItem(currentCategory, 'pending', 'Failed ❌');
  nextCampaignStep();
}

function nextCampaignStep() {
  currentCampaignIndex++;
  if (currentCampaignIndex < campaignQueue.length) {
    runCampaignStep();
  } else {
    finishCampaign();
  }
}

function finishCampaign() {
  campaignActive = false;
  btnStopCampaign.style.display = 'none';
  btnLaunchCampaign.style.display = 'inline-flex';
  toggleCampaignInputs(true);
  
  const totalScraped = scrapedLeads.length;
  log(`[Campaign] Completed! Successfully scraped a total of ${totalScraped} leads.`, 'success');
  logStatus.textContent = 'Campaign Done';
  logStatus.style.color = 'var(--success)';
  
  updateFilterDropdown();
  alert(`Campaign Completed!\nScraped a total of ${totalScraped} leads.`);
}

function stopCampaign() {
  if (!campaignActive) return;
  campaignActive = false;
  btnStopCampaign.style.display = 'none';
  btnLaunchCampaign.style.display = 'inline-flex';
  toggleCampaignInputs(true);
  
  log('Campaign stopped by user.', 'warn');
  logStatus.textContent = 'Campaign Stopped';
  logStatus.style.color = 'var(--warning)';
  
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { action: 'stopScraping' });
  }
  
  // Mark remaining items in progress list
  const progressItems = campaignProgressList.children;
  for (const item of progressItems) {
    if (item.classList.contains('active') || item.classList.contains('pending')) {
      item.className = 'campaign-progress-item pending';
      item.querySelector('.status-label').textContent = 'Stopped ⏹';
    }
  }
}

function updateCampaignProgressItem(category, statusClass, statusText) {
  // Clean category name for valid ID selector
  const safeId = `campaign-prog-${category.replace(/[^a-zA-Z0-9]/g, '-')}`;
  const item = document.getElementById(safeId);
  if (item) {
    item.className = `campaign-progress-item ${statusClass}`;
    item.querySelector('.status-label').textContent = statusText;
  }
}

// Launch Campaign Button Click
btnLaunchCampaign.addEventListener('click', async () => {
  if (!activeTabId) {
    log('No active tab connected. Connect to Google Maps first.', 'error');
    return;
  }
  
  const countryVal = txtCampaignCountry.value.trim();
  if (!countryVal) {
    log('Please specify a target country or city.', 'warn');
    alert('Please enter a country or target city.');
    return;
  }
  
  const selectedCbs = Array.from(categoryChecklist.querySelectorAll('input:checked'));
  if (selectedCbs.length === 0) {
    log('Please select at least one category to search.', 'warn');
    alert('Please select at least one category.');
    return;
  }
  
  // Initialize campaign state
  campaignActive = true;
  campaignCountry = countryVal;
  campaignQueue = selectedCbs.map(cb => cb.value);
  currentCampaignIndex = 0;
  
  log(`Initializing campaign for "${campaignCountry}" with ${campaignQueue.length} categories...`, 'info');
  
  btnLaunchCampaign.style.display = 'none';
  btnStopCampaign.style.display = 'inline-flex';
  toggleCampaignInputs(false);
  
  // Setup campaign progress list in UI
  campaignProgressList.innerHTML = '';
  campaignStatusContainer.style.display = 'block';
  
  for (const cat of campaignQueue) {
    const safeId = `campaign-prog-${cat.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const progressItem = document.createElement('div');
    progressItem.className = 'campaign-progress-item pending';
    progressItem.id = safeId;
    progressItem.innerHTML = `
      <span>${cat}</span>
      <span class="status-label">Pending ⏳</span>
    `;
    campaignProgressList.appendChild(progressItem);
  }
  
  // Start first step
  runCampaignStep();
});

// Stop Campaign Button Click
btnStopCampaign.addEventListener('click', () => {
  stopCampaign();
});

// Start scraping (Manual Single Scrape)
btnStart.addEventListener('click', async () => {
  if (!activeTabId) return;
  
  currentCategory = 'General'; // default category for manual scrape
  scrapingActive = true;
  btnStart.style.display = 'none';
  btnStop.style.display = 'inline-flex';
  logStatus.textContent = 'Scraping...';
  logStatus.style.color = 'var(--success)';
  log('Initializing Google Maps Scraper (Manual)...', 'info');

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

// Stop scraping (Manual Single Scrape)
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
  if (campaignActive) {
    stopCampaign();
  }
  scrapedLeads = [];
  statLeads.textContent = '0';
  statEmails.textContent = '0';
  previewList.innerHTML = '';
  previewPlaceholder.style.display = 'block';
  previewList.appendChild(previewPlaceholder);
  btnExport.disabled = true;
  btnExportExcel.disabled = true;
  btnExportSheets.disabled = true;
  terminalLog.innerHTML = '';
  campaignStatusContainer.style.display = 'none';
  campaignProgressList.innerHTML = '';
  filterCategory.innerHTML = '<option value="all">All Categories</option>';
  filterCategory.value = 'all';
  log("Dashboard reset complete. Ready to scrape.", "info");
});

// Export leads to CSV file
btnExport.addEventListener('click', () => {
  if (scrapedLeads.length === 0) return;
  
  const headers = ['Category', 'Name', 'Phone', 'Website', 'Emails', 'Address', 'Maps Link'];
  const csvRows = [headers.join(',')];
  
  for (const lead of scrapedLeads) {
    const row = [
      escapeCSVValue(lead.category || 'General'),
      escapeCSVValue(escapeForSpreadsheet(lead.name)),
      escapeCSVValue(escapeForSpreadsheet(lead.phone) || 'N/A'),
      escapeCSVValue(escapeForSpreadsheet(lead.website)),
      escapeCSVValue(lead.emails.join('; ')),
      escapeCSVValue(escapeForSpreadsheet(lead.address)),
      escapeCSVValue(escapeForSpreadsheet(lead.mapsUrl))
    ];
    csvRows.push(row.join(','));
  }
  
  // Prepend \ufeff for Excel to recognize UTF-8 encoding immediately
  const csvContent = '\ufeff' + csvRows.join('\n');
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

// Helper to escape values that can be interpreted as formulas in spreadsheets
function escapeForSpreadsheet(val) {
  if (val == null) return '';
  const str = String(val);
  // Prefix with a single quote if starts with =, +, -, or @
  if (/^[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return str;
}

// Export leads to offline Excel file (.xls) using XML Spreadsheet 2003 for multi-sheets
btnExportExcel.addEventListener('click', () => {
  if (scrapedLeads.length === 0) return;
  
  // Group leads by category
  const categories = {};
  for (const lead of scrapedLeads) {
    const cat = lead.category || 'General';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(lead);
  }
  
  let xml = `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n`;
  xml += `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n`;
  xml += ` xmlns:o="urn:schemas-microsoft-com:office:office"\n`;
  xml += ` xmlns:x="urn:schemas-microsoft-com:office:excel"\n`;
  xml += ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"\n`;
  xml += ` xmlns:html="http://www.w3.org/TR/REC-html40">\n`;
  
  // Styles for headers
  xml += ` <Styles>\n`;
  xml += `  <Style ss:ID="HeaderStyle">\n`;
  xml += `   <Font ss:Bold="1" ss:Color="#FFFFFF"/>\n`;
  xml += `   <Interior ss:Color="#6366F1" ss:Pattern="Solid"/>\n`;
  xml += `  </Style>\n`;
  xml += ` </Styles>\n`;
  
  for (const [catName, catLeads] of Object.entries(categories)) {
    // Sheet names must be <= 31 chars and cannot contain certain chars like :, ?, /, *, [ or ]
    const safeSheetName = catName.replace(/[:\?\/\*\[\]]/g, '').substring(0, 31) || 'Leads';
    xml += ` <Worksheet ss:Name="${escapeXmlAttr(safeSheetName)}">\n`;
    xml += `  <Table>\n`;
    
    // Columns specification for width
    xml += `   <Column ss:Width="180"/>\n`; // Name
    xml += `   <Column ss:Width="100"/>\n`; // Phone
    xml += `   <Column ss:Width="150"/>\n`; // Website
    xml += `   <Column ss:Width="180"/>\n`; // Emails
    xml += `   <Column ss:Width="200"/>\n`; // Address
    xml += `   <Column ss:Width="250"/>\n`; // Maps Link
    
    // Header Row
    xml += `   <Row>\n`;
    const headers = ['Name', 'Phone', 'Website', 'Emails', 'Address', 'Maps Link'];
    for (const h of headers) {
      xml += `    <Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">${escapeXmlValue(h)}</Data></Cell>\n`;
    }
    xml += `   </Row>\n`;
    
    // Data Rows
    for (const lead of catLeads) {
      xml += `   <Row>\n`;
      xml += `    <Cell><Data ss:Type="String">${escapeXmlValue(lead.name)}</Data></Cell>\n`;
      xml += `    <Cell><Data ss:Type="String">${escapeXmlValue(lead.phone || 'N/A')}</Data></Cell>\n`;
      xml += `    <Cell><Data ss:Type="String">${escapeXmlValue(lead.website || 'N/A')}</Data></Cell>\n`;
      xml += `    <Cell><Data ss:Type="String">${escapeXmlValue(lead.emails.join(', ') || 'N/A')}</Data></Cell>\n`;
      xml += `    <Cell><Data ss:Type="String">${escapeXmlValue(lead.address || 'N/A')}</Data></Cell>\n`;
      xml += `    <Cell><Data ss:Type="String">${escapeXmlValue(lead.mapsUrl || '')}</Data></Cell>\n`;
      xml += `   </Row>\n`;
    }
    
    xml += `  </Table>\n`;
    xml += ` </Worksheet>\n`;
  }
  
  xml += `</Workbook>\n`;
  
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'gmaps_leads_categorized.xls');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  log(`Successfully exported ${scrapedLeads.length} leads to gmaps_leads_categorized.xls`, 'success');
});

// XML escaping helper for values
function escapeXmlValue(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// XML escaping helper for attributes
function escapeXmlAttr(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// HTML escaping helper
function escapeHtml(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Export leads to Google Sheets (Clipboard-copy & Launch sheets.new)
btnExportSheets.addEventListener('click', async () => {
  if (scrapedLeads.length === 0) return;

  btnExportSheets.disabled = true;
  btnExportSheets.innerHTML = '<span>⏳</span> Copying...';
  log('Formatting data and copying to clipboard...', 'info');

  try {
    // 1. Format the data as Tab-Separated Values (TSV)
    const headers = ['Category', 'Name', 'Phone', 'Website', 'Emails', 'Address', 'Maps Link'];
    const rows = [headers.join('\t')];

    // Helper to escape values that could be interpreted as formulas in Sheets
    const escapeForSheets = (val) => {
      let str = String(val);
      // Prefix with a single quote if starts with =, +, -, or @
      if (/^[=+\-@]/.test(str)) {
        str = "'" + str;
      }
      // Replace any tabs or newlines to keep TSV structure intact
      return str.replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
    };

    for (const lead of scrapedLeads) {
      const row = [
        escapeForSheets(lead.category || 'General'),
        escapeForSheets(lead.name || ''),
        escapeForSheets(lead.phone || ''),
        escapeForSheets(lead.website || ''),
        escapeForSheets(Array.isArray(lead.emails) ? lead.emails.join('; ') : ''),
        escapeForSheets(lead.address || ''),
        escapeForSheets(lead.mapsUrl || '')
      ];
      rows.push(row.join('\t'));
    }

    const tsvContent = rows.join('\n');

    // 2. Write to System Clipboard
    await navigator.clipboard.writeText(tsvContent);
    log('Leads successfully copied to clipboard in Excel/Sheets format!', 'success');
    log('Opening a new Google Sheet tab...', 'info');
    log('👉 Click on cell A1 and press CMD+V (Mac) or CTRL+V (Windows/Linux) to paste.', 'warn');

    // 3. Open a new Google Sheet tab (sheets.new)
    chrome.tabs.create({ url: 'https://sheets.new' });

  } catch (err) {
    log(`Failed to copy to clipboard: ${err.message}`, 'error');
    console.error(err);
  } finally {
    resetExportSheetsButton();
  }
});

function resetExportSheetsButton() {
  btnExportSheets.disabled = false;
  btnExportSheets.innerHTML = '<span>📊</span> Copy to Sheets';
}

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
    category: currentCategory,
    emails: []
  };
  scrapedLeads.push(newLead);
  
  // Update leads count
  statLeads.textContent = scrapedLeads.length;
  btnExport.disabled = false;
  btnExportExcel.disabled = false;
  btnExportSheets.disabled = false;
  
  // Refresh filter dropdown category list & counts
  updateFilterDropdown();
  
  // Render card conditionally based on active filter selection
  const activeFilter = filterCategory.value;
  if (activeFilter === 'all' || activeFilter === newLead.category) {
    // Hide preview placeholder
    previewPlaceholder.style.display = 'none';
    
    // Create card DOM element
    const card = document.createElement('div');
    card.className = 'lead-card';
    card.id = `lead-card-${leadId}`;
    card.innerHTML = `
      <div class="lead-header" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
        <span class="lead-name" style="font-size: 0.82rem; font-weight: 600; color: #fff; line-height: 1.2;">${newLead.name}</span>
        <span class="category-badge">${newLead.category}</span>
      </div>
      <div class="lead-body" style="display: flex; flex-direction: column; gap: 4px; font-size: 0.72rem; margin-top: 6px;">
        <div class="lead-item" style="display: flex; align-items: center; gap: 6px; color: var(--text-secondary);">
          <span class="lead-icon" style="font-size: 0.8rem; color: var(--primary); width: 12px; text-align: center;">📍</span>
          <span class="lead-address" style="word-break: break-word;">${newLead.address || 'N/A'}</span>
        </div>
        <div class="lead-item" style="display: flex; align-items: center; gap: 6px; color: var(--text-secondary);">
          <span class="lead-icon" style="font-size: 0.8rem; color: var(--primary); width: 12px; text-align: center;">📞</span>
          <span class="lead-phone" style="color: #f3f4f6;">${newLead.phone || 'N/A'}</span>
        </div>
        <div class="lead-item" style="display: flex; align-items: center; gap: 6px; color: var(--text-secondary);">
          <span class="lead-icon" style="font-size: 0.8rem; color: var(--primary); width: 12px; text-align: center;">🌐</span>
          ${newLead.website && newLead.website !== 'N/A' 
            ? `<a href="${newLead.website}" class="lead-link" target="_blank" style="color: #818cf8; text-decoration: none; word-break: break-all;">${newLead.website}</a>`
            : `<span class="lead-text" style="color: var(--text-muted);">N/A</span>`
          }
        </div>
        <div class="lead-item" style="display: flex; align-items: center; gap: 6px; color: var(--text-secondary);">
          <span class="lead-icon" style="font-size: 0.8rem; color: var(--primary); width: 12px; text-align: center;">✉️</span>
          <span class="lead-email" id="email-${leadId}" style="color: var(--success); font-weight: 500;">
            ${newLead.website && newLead.website !== 'N/A' ? 'Searching...' : 'N/A'}
          </span>
        </div>
      </div>
    `;
    
    previewList.insertBefore(card, previewList.firstChild);
  }
  
  log(`Scraped: ${newLead.name} [${newLead.category}]`, 'info');
  
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

// Category Filter Change listener
filterCategory.addEventListener('change', () => {
  renderLeadsList();
});

// Render the leads preview list based on active filter
function renderLeadsList() {
  const selectedCat = filterCategory.value;
  previewList.innerHTML = '';
  
  const filtered = selectedCat === 'all' 
    ? scrapedLeads 
    : scrapedLeads.filter(l => l.category === selectedCat);
    
  if (filtered.length === 0) {
    previewPlaceholder.style.display = 'block';
    previewList.appendChild(previewPlaceholder);
    return;
  }
  
  previewPlaceholder.style.display = 'none';
  
  // Render in reverse chronological order (newest first)
  for (let i = filtered.length - 1; i >= 0; i--) {
    const newLead = filtered[i];
    const card = document.createElement('div');
    card.className = 'lead-card';
    card.id = `lead-card-${newLead.id}`;
    card.innerHTML = `
      <div class="lead-header" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
        <span class="lead-name" style="font-size: 0.82rem; font-weight: 600; color: #fff; line-height: 1.2;">${newLead.name}</span>
        <span class="category-badge">${newLead.category || 'General'}</span>
      </div>
      <div class="lead-body" style="display: flex; flex-direction: column; gap: 4px; font-size: 0.72rem; margin-top: 6px;">
        <div class="lead-item" style="display: flex; align-items: center; gap: 6px; color: var(--text-secondary);">
          <span class="lead-icon" style="font-size: 0.8rem; color: var(--primary); width: 12px; text-align: center;">📍</span>
          <span class="lead-address" style="word-break: break-word;">${newLead.address || 'N/A'}</span>
        </div>
        <div class="lead-item" style="display: flex; align-items: center; gap: 6px; color: var(--text-secondary);">
          <span class="lead-icon" style="font-size: 0.8rem; color: var(--primary); width: 12px; text-align: center;">📞</span>
          <span class="lead-phone" style="color: #f3f4f6;">${newLead.phone || 'N/A'}</span>
        </div>
        <div class="lead-item" style="display: flex; align-items: center; gap: 6px; color: var(--text-secondary);">
          <span class="lead-icon" style="font-size: 0.8rem; color: var(--primary); width: 12px; text-align: center;">🌐</span>
          ${newLead.website && newLead.website !== 'N/A' 
            ? `<a href="${newLead.website}" class="lead-link" target="_blank" style="color: #818cf8; text-decoration: none; word-break: break-all;">${newLead.website}</a>`
            : `<span class="lead-text" style="color: var(--text-muted);">N/A</span>`
          }
        </div>
        <div class="lead-item" style="display: flex; align-items: center; gap: 6px; color: var(--text-secondary);">
          <span class="lead-icon" style="font-size: 0.8rem; color: var(--primary); width: 12px; text-align: center;">✉️</span>
          <span class="lead-email" id="email-${newLead.id}" style="color: var(--success); font-weight: 500;">
            ${newLead.emails && newLead.emails.length > 0 
              ? newLead.emails.join(', ') 
              : (newLead.website && newLead.website !== 'N/A' ? 'Searching...' : 'N/A')}
          </span>
        </div>
      </div>
    `;
    previewList.appendChild(card);
  }
}

// Update filter dropdown options and option counts
function updateFilterDropdown() {
  const categories = new Set(scrapedLeads.map(l => l.category || 'General'));
  const currentValue = filterCategory.value;
  
  filterCategory.innerHTML = '<option value="all">All Categories</option>';
  
  for (const cat of Array.from(categories).sort()) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = `${cat} (${scrapedLeads.filter(l => l.category === cat).length})`;
    filterCategory.appendChild(opt);
  }
  
  if (Array.from(categories).includes(currentValue)) {
    filterCategory.value = currentValue;
  } else {
    filterCategory.value = 'all';
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
      
      // Campaign progression logic
      if (campaignActive) {
        const count = scrapedLeads.filter(l => l.category === currentCategory).length;
        updateCampaignProgressItem(currentCategory, 'success', `Done ✅ (${count} leads)`);
        nextCampaignStep();
      }
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
