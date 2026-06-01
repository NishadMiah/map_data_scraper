/**
 * Google Apps Script for G-Maps Scraper Webhook
 * 
 * Instructions:
 * 1. Open a new or existing Google Sheet.
 * 2. Click "Extensions" > "Apps Script" in the top menu.
 * 3. Delete any code in the editor, and paste this entire script.
 * 4. Click the "Save" icon (or Ctrl+S / Cmd+S).
 * 5. Click "Deploy" (top right) > "New deployment".
 * 6. Select type "Web app" (click gear icon next to "Select type").
 * 7. Configure:
 *    - Description: G-Maps Scraper Webhook
 *    - Execute as: "Me (your-email@gmail.com)"
 *    - Who has access: "Anyone" (This is crucial, otherwise the extension cannot submit to it)
 * 8. Click "Deploy".
 * 9. Copy the "Web app URL" provided in the confirmation dialog.
 * 10. Paste this URL into the "Google Sheets Configuration" input inside the extension side panel.
 */

function doPost(e) {
  try {
    // Parse the JSON payload sent by the extension
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    // Set headers if the sheet is brand new (check cell A1)
    if (sheet.getRange(1, 1).getValue() === "") {
      sheet.appendRow(["Name", "Phone", "Website", "Emails", "Maps Link"]);
      
      // Style headers (Bold, background color, frozen row)
      const headerRange = sheet.getRange(1, 1, 1, 5);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#e2e8f0");
      sheet.setFrozenRows(1);
    }
    
    // Map data to rows and append them
    data.forEach(function(lead) {
      const emailsList = Array.isArray(lead.emails) ? lead.emails.join(", ") : "";
      
      sheet.appendRow([
        lead.name || "",
        lead.phone || "N/A",
        lead.website || "N/A",
        emailsList || "N/A",
        lead.mapsUrl || ""
      ]);
    });
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success", count: data.length }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader("Access-Control-Allow-Origin", "*");
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader("Access-Control-Allow-Origin", "*");
  }
}

// Support preflight OPTIONS requests for CORS (if browsers check it, though no-cors mode is used)
function doOptions(e) {
  return ContentService.createTextOutput("")
    .setHeader("Access-Control-Allow-Origin", "*")
    .setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
    .setHeader("Access-Control-Allow-Headers", "Content-Type");
}
