/**
 * MEESHO AUTO LISTER - BACKGROUND SERVICE WORKER
 * Orchestrates Auth, State, and Automation
 */

// --- STATE ---
let appState = {
    user: null,
    history: [],
    currentListing: {
        images: [],
        scrapedFields: [],
        analysisResults: null,
        fillProgress: 0,
        isFilling: false
    }
};

// --- INITIALIZATION ---
chrome.runtime.onInstalled.addListener(() => {
    console.log('Meesho Auto Lister: Installed');
    loadState();
});

chrome.runtime.onStartup.addListener(() => {
    loadState();
});

// --- MESSAGE HANDLING ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'GET_STATE':
            sendResponse(appState);
            break;
        
        case 'UPDATE_STATE':
            appState = { ...appState, ...message.data };
            saveState();
            sendResponse({ success: true });
            break;

        case 'SAVE_LISTING':
            appState.currentListing = { ...appState.currentListing, ...message.data };
            saveState();
            sendResponse({ success: true });
            break;

        case 'CLEAR_STATE':
            appState.currentListing = {
                images: [],
                scrapedFields: [],
                analysisResults: null,
                fillProgress: 0,
                isFilling: false
            };
            saveState();
            sendResponse({ success: true });
            break;

        case 'FILL_PROGRESS':
            appState.currentListing.fillProgress = Math.round((message.current / message.total) * 100);
            appState.currentListing.currentField = message.fieldName;
            saveState();
            // Forward to popup if it's open
            chrome.runtime.sendMessage(message).catch(() => {}); 
            break;

        case 'AUTH_LOGIN':
            sendResponse({ success: true, user: { name: 'Guest', email: 'guest@meesho.com' } });
            return true;

        case 'AUTH_LOGOUT':
            appState.user = null;
            saveState();
            sendResponse({ success: true });
            break;
    }
    return true;
});

// --- PERSISTENCE ---
function saveState() {
    chrome.storage.local.set({ appState });
}

function loadState() {
    chrome.storage.local.get(['appState'], (result) => {
        if (result.appState) {
            appState = result.appState;
        }
    });
}
