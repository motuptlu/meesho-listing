chrome.runtime.onInstalled.addListener(() => {
    console.log('Meesho Auto Lister: Extension Installed');
    chrome.storage.local.set({ extensionEnabled: true });
});

chrome.runtime.onStartup.addListener(() => {
    console.log('Meesho Auto Lister: Extension Started');
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('supplier.meesho.com')) {
        chrome.action.setBadgeText({
            text: 'ON',
            tabId: tabId
        });
        chrome.action.setBadgeBackgroundColor({
            color: '#9C27B0',
            tabId: tabId
        });
    }
});
