const BACKEND_URL = 'http://localhost:3000';
let uploadedImages = [];
let analysisResults = null;

document.addEventListener('DOMContentLoaded', () => {
    const analyzeBtn = document.getElementById('analyzeBtn');
    const fillBtn = document.getElementById('fillBtn');
    const uploadZone = document.getElementById('uploadZone');
    const imageInput = document.getElementById('imageInput');
    const imageGrid = document.getElementById('imageGrid');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const resultsSection = document.getElementById('resultsSection');
    const historyList = document.getElementById('historyList');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabViews = document.querySelectorAll('.tab-view');

    checkMeeshoPage();
    setupUploadZone();
    loadHistory();
    setupTabs();

    analyzeBtn.addEventListener('click', analyzeImages);
    fillBtn.addEventListener('click', fillMeeshoForm);
    clearHistoryBtn.addEventListener('click', clearHistory);

    function setupTabs() {
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.tab;
                
                tabBtns.forEach(b => b.classList.remove('active'));
                tabViews.forEach(v => v.classList.remove('active'));
                
                btn.classList.add('active');
                document.getElementById(`${target}View`).classList.add('active');
                
                if (target === 'history') {
                    loadHistory();
                }
            });
        });
    }

    function checkMeeshoPage() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            const statusIcon = document.getElementById('statusIcon');
            const statusText = document.getElementById('statusText');

            if (tab && tab.url.includes('supplier.meesho.com')) {
                statusIcon.className = 'status-icon status-connected';
                statusText.innerText = 'Connected to Meesho Supplier Panel';
            } else {
                statusIcon.className = 'status-icon status-disconnected';
                statusText.innerText = 'Please open supplier.meesho.com';
            }
        });
    }

    function setupUploadZone() {
        uploadZone.addEventListener('click', () => imageInput.click());

        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('drag-over');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('drag-over');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('drag-over');
            handleFiles(e.dataTransfer.files);
        });

        imageInput.addEventListener('change', (e) => {
            handleFiles(e.target.files);
        });
    }

    function handleFiles(files) {
        const fileList = Array.from(files);
        if (uploadedImages.length + fileList.length > 5) {
            showNotification('Maximum 5 images allowed', 'error');
            return;
        }

        fileList.forEach(file => {
            if (!file.type.startsWith('image/')) {
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                uploadedImages.push({
                    file: file,
                    base64: e.target.result,
                    name: file.name
                });
                renderPreviews();
                updateAnalyzeButton();
            };
            reader.readAsDataURL(file);
        });
    }

    function renderPreviews() {
        imageGrid.innerHTML = '';
        uploadedImages.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'preview-item';
            
            const img = document.createElement('img');
            img.src = item.base64;
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.innerHTML = '×';
            removeBtn.dataset.index = index;
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                uploadedImages.splice(index, 1);
                renderPreviews();
                updateAnalyzeButton();
            };

            div.appendChild(img);
            div.appendChild(removeBtn);
            imageGrid.appendChild(div);
        });
    }

    function updateAnalyzeButton() {
        analyzeBtn.disabled = uploadedImages.length === 0;
    }

    async function analyzeImages() {
        loadingOverlay.style.display = 'flex';
        const loadingText = loadingOverlay.querySelector('p');
        const originalText = loadingText.innerText;
        
        const formData = new FormData();
        uploadedImages.forEach(item => {
            formData.append('images', item.file);
        });

        const maxRetries = 3;
        let attempt = 0;

        async function attemptAnalysis() {
            try {
                const response = await fetch(`${BACKEND_URL}/api/analyze`, {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    // Retry on rate limits (429) or server errors (5xx)
                    if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
                         throw { status: response.status, message: `Server busy (${response.status}). Retrying...` };
                    }
                    const errorData = await response.json();
                    throw new Error(errorData.error || `Error: ${response.status}`);
                }

                const data = await response.json();
                if (data.success) {
                    displayResults(data.results);
                    saveToHistory(data.results, uploadedImages[0]?.base64);
                    showNotification('AI Analysis Complete!', 'success');
                    return true;
                } else {
                    throw new Error(data.error || 'Analysis failed');
                }
            } catch (error) {
                attempt++;
                // Check if we should retry: only for rate limits, server errors, or network failures
                const isRetryable = error.status === 429 || (error.status >= 500 && error.status < 600) || !error.status;
                
                if (attempt < maxRetries && isRetryable) {
                    const delay = Math.pow(2, attempt) * 1000;
                    loadingText.innerText = `Retry attempt ${attempt}/${maxRetries}...`;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return attemptAnalysis();
                }
                throw error;
            }
        }

        try {
            await attemptAnalysis();
        } catch (error) {
            console.error('Analysis Error:', error);
            showNotification(error.message || 'Analysis failed after retries', 'error');
        } finally {
            loadingOverlay.style.display = 'none';
            loadingText.innerText = originalText;
        }
    }

    function displayResults(results) {
        if (!results) return;
        analysisResults = results;
        resultsSection.style.display = 'block';

        const fields = [
            'productName', 'category', 'subCategory', 'description', 
            'mrp', 'sellingPrice', 'color', 'size', 'material', 
            'weight', 'brand', 'keywords', 'occasion', 'pattern', 'gender'
        ];

        fields.forEach(field => {
            const element = document.getElementById(`result-${field}`);
            if (element) {
                element.value = results[field] || '';
            }
        });

        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    function getFormData() {
        const fields = [
            'productName', 'category', 'subCategory', 'description', 
            'mrp', 'sellingPrice', 'color', 'size', 'material', 
            'weight', 'brand', 'keywords', 'occasion', 'pattern', 'gender'
        ];
        
        const data = {};
        fields.forEach(field => {
            data[field] = document.getElementById(`result-${field}`).value;
        });
        return data;
    }

    async function fillMeeshoForm() {
        const data = getFormData();
        const images = uploadedImages.map(img => img.base64);

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (!tab.url.includes('supplier.meesho.com')) {
                showNotification('Please navigate to Meesho Supplier Panel', 'error');
                return;
            }

            chrome.tabs.sendMessage(tab.id, {
                action: 'FILL_FORM',
                data: data,
                images: images
            }, (response) => {
                if (chrome.runtime.lastError) {
                    showNotification('Error communicating with page. Refresh Meesho tab.', 'error');
                } else if (response && response.success) {
                    showNotification(`Success! Filled ${response.filledFields.length} fields.`, 'success');
                } else {
                    showNotification(response?.error || 'Failed to fill form', 'error');
                }
            });
        });
    }

    function showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerText = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            notification.style.transition = 'all 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    function saveToHistory(results, thumbnail) {
        chrome.storage.local.get({ listingHistory: [] }, (data) => {
            const history = data.listingHistory;
            const newItem = {
                id: Date.now(),
                timestamp: new Date().toLocaleString(),
                results: results,
                thumbnail: thumbnail
            };
            
            // Keep only last 10 items
            history.unshift(newItem);
            if (history.length > 10) history.pop();
            
            chrome.storage.local.set({ listingHistory: history }, () => {
                loadHistory();
            });
        });
    }

    function loadHistory() {
        chrome.storage.local.get({ listingHistory: [] }, (data) => {
            const history = data.listingHistory;
            const historyList = document.getElementById('historyList');
            
            if (history.length === 0) {
                historyList.innerHTML = '<p class="empty-text">No previous listings found.</p>';
                return;
            }

            historyList.innerHTML = '';
            history.forEach(item => {
                const div = document.createElement('div');
                div.className = 'history-item';
                div.innerHTML = `
                    <img src="${item.thumbnail || 'icons/icon48.png'}" class="history-thumb">
                    <div class="history-info">
                        <div class="history-name">${item.results.productName}</div>
                        <div class="history-meta">${item.timestamp} • ₹${item.results.sellingPrice}</div>
                    </div>
                `;
                div.onclick = () => {
                    displayResults(item.results);
                    // Switch to listing tab
                    const listingTab = document.querySelector('[data-tab="listing"]');
                    listingTab.click();
                    
                    // Clear current uploaded images since we are looking at history
                    uploadedImages = [];
                    renderPreviews();
                    updateAnalyzeButton();
                    showNotification('Loaded from history', 'success');
                };
                historyList.appendChild(div);
            });
        });
    }

    function clearHistory() {
        if (confirm('Are you sure you want to clear your listing history?')) {
            chrome.storage.local.set({ listingHistory: [] }, () => {
                loadHistory();
                showNotification('History cleared', 'success');
            });
        }
    }
});
