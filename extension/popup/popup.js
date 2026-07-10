/**
 * MEESHO AUTO LISTER - POPUP CONTROLLER
 * Manages UI, Auth, and Automation Workflow
 */

const BACKEND_URL = 'https://ais-dev-clrnti3bzhacw6tpz7qw6w-47165258965.asia-east1.run.app'; // Replace with production URL if deployed

class PopupController {
    constructor() {
        this.state = null;
        this.uploadedImages = [];
        this.scrapedFields = [];
        this.analysisResults = null;
        this.currentStep = 1;
        
        this.init();
    }

    async init() {
        await this.loadStateFromBackground();
        this.setupEventListeners();
        
        // Restore UI State
        if (this.uploadedImages.length > 0) {
            this.renderImagePreviews();
            document.getElementById('scanBtn').disabled = false;
        }
        if (this.analysisResults) {
            this.renderAnalysisForm();
        }

        this.checkAuth();
        this.checkMeeshoPage();
    }

    async loadStateFromBackground() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'GET_STATE' }, (response) => {
                this.state = response;
                if (this.state?.currentListing) {
                    const cl = this.state.currentListing;
                    this.uploadedImages = cl.images || [];
                    this.scrapedFields = cl.scrapedFields || [];
                    this.analysisResults = cl.analysisResults || null;
                }
                resolve();
            });
        });
    }

    saveStateToBackground() {
        chrome.runtime.sendMessage({
            action: 'SAVE_LISTING',
            data: {
                images: this.uploadedImages,
                scrapedFields: this.scrapedFields,
                analysisResults: this.analysisResults
            }
        });
    }

    setupEventListeners() {
        // Auth
        document.getElementById('loginBtn').addEventListener('click', () => this.handleLogin());
        document.getElementById('logoutBtn').addEventListener('click', () => this.handleLogout());

        // Navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        // Step 1
        document.getElementById('dropZone').addEventListener('click', () => document.getElementById('fileInput').click());
        document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileSelect(e));
        document.getElementById('scanBtn').addEventListener('click', () => this.handleScanAndAnalyze());

        // Step 2
        document.getElementById('backTo1').addEventListener('click', () => this.goToStep(1));
        document.getElementById('startFillBtn').addEventListener('click', () => this.handleStartFill());

        // Step 3
        document.getElementById('cancelFillBtn').addEventListener('click', () => this.handleCancelFill());
        document.getElementById('finishBtn').addEventListener('click', () => this.handleFinish());

        // Listen for progress from background
        chrome.runtime.onMessage.addListener((message) => {
            if (message.action === 'FILL_PROGRESS') {
                this.updateProgress(message);
            }
        });
    }

    // --- AUTH ---

    async checkAuth() {
        if (this.state?.user) {
            this.showView('mainView');
            this.updateUserUI();
        } else {
            this.showView('authView');
        }
    }

    async handleLogin() {
        chrome.runtime.sendMessage({ action: 'AUTH_LOGIN' }, async (response) => {
            if (response.success) {
                this.state.user = response.user;
                
                // Sync with Backend
                try {
                    const syncRes = await fetch(`${BACKEND_URL}/api/auth/sync`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.state.user.token}`
                        }
                    });
                    const syncData = await syncRes.json();
                    if (syncData.success) {
                        this.state.user = { ...this.state.user, ...syncData.user };
                    }
                } catch (e) {
                    console.warn('Profile sync failed:', e);
                }

                this.showView('mainView');
                this.updateUserUI();
                this.showToast('Logged in successfully', 'success');
            } else {
                this.showToast('Login failed: ' + response.error, 'error');
            }
        });
    }

    handleLogout() {
        chrome.runtime.sendMessage({ action: 'AUTH_LOGOUT' }, () => {
            this.state.user = null;
            this.showView('authView');
        });
    }

    updateUserUI() {
        const user = this.state.user;
        if (!user) return;
        document.getElementById('userName').innerText = user.name || user.email;
        document.getElementById('userAvatar').src = user.picture || 'https://www.gravatar.com/avatar/?d=mp';
    }

    // --- WORKFLOW ---

    handleFileSelect(e) {
        const files = Array.from(e.target.files);
        this.processFiles(files);
    }

    processFiles(files) {
        files.forEach(file => {
            if (!file.type.startsWith('image/')) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                this.uploadedImages.push(e.target.result);
                this.renderImagePreviews();
                this.saveStateToBackground();
                document.getElementById('scanBtn').disabled = false;
            };
            reader.readAsDataURL(file);
        });
    }

    renderImagePreviews() {
        const grid = document.getElementById('imagePreviewGrid');
        grid.innerHTML = '';
        this.uploadedImages.forEach((img, idx) => {
            const div = document.createElement('div');
            div.className = 'preview-item';
            div.innerHTML = `
                <img src="${img}">
                <button class="remove-btn" data-idx="${idx}">×</button>
            `;
            div.querySelector('.remove-btn').onclick = () => {
                this.uploadedImages.splice(idx, 1);
                this.renderImagePreviews();
                this.saveStateToBackground();
                if (this.uploadedImages.length === 0) document.getElementById('scanBtn').disabled = true;
            };
            grid.appendChild(div);
        });
    }

    async handleScanAndAnalyze() {
        this.goToStep(2);
        this.showLoadingForm();

        try {
            // 1. Scan Form on Page
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const response = await this.sendMessageToTab(tabs[0].id, { action: 'SCRAPE_FORM' });
            
            if (!response.success) throw new Error(response.error || 'Failed to scan form');
            this.scrapedFields = response.fields;

            // 2. Send to Backend for AI Analysis
            const aiResults = await this.callAnalyzeAPI();
            this.analysisResults = aiResults;
            
            this.renderAnalysisForm();
            this.saveStateToBackground();
        } catch (err) {
            this.showToast(err.message, 'error');
            this.goToStep(1);
        }
    }

    async callAnalyzeAPI() {
        const formData = new FormData();
        
        // Convert base64 to blobs
        for (let i = 0; i < this.uploadedImages.length; i++) {
            const blob = await (await fetch(this.uploadedImages[i])).blob();
            formData.append('images', blob, `img_${i}.jpg`);
        }
        
        formData.append('formFields', JSON.stringify({ fields: this.scrapedFields }));

        const res = await fetch(`${BACKEND_URL}/api/analyze`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.state.user.token}`
            },
            body: formData
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Server Analysis Failed');
        }

        const data = await res.json();
        return data.results;
    }

    renderAnalysisForm() {
        const form = document.getElementById('analysisForm');
        form.innerHTML = '';
        document.getElementById('fieldsCount').innerText = `${this.scrapedFields.length} Fields`;

        this.scrapedFields.forEach(field => {
            const val = this.analysisResults[field.label] || '';
            const div = document.createElement('div');
            div.className = 'field-group';
            div.innerHTML = `
                <label>${field.label}</label>
                ${field.type === 'textarea' 
                    ? `<textarea data-label="${field.label}">${val}</textarea>`
                    : `<input type="text" data-label="${field.label}" value="${val}">`
                }
            `;
            form.appendChild(div);
        });
    }

    async handleStartFill() {
        // Collect edited values
        const editedResults = {};
        document.querySelectorAll('#analysisForm [data-label]').forEach(el => {
            editedResults[el.dataset.label] = el.value;
        });
        this.analysisResults = editedResults;
        this.saveStateToBackground();

        this.goToStep(3);
        this.addLog('🚀 Starting Automation Engine...', 'info');

        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            chrome.tabs.sendMessage(tabs[0].id, {
                action: 'FILL_FORM',
                data: this.analysisResults,
                fields: this.scrapedFields,
                images: this.uploadedImages
            }, (response) => {
                if (chrome.runtime.lastError || !response || !response.success) {
                    this.addLog('❌ Error: Content script disconnected or failed', 'error');
                } else {
                    this.addLog('✨ Automation Complete!', 'success');
                    document.getElementById('finishBtn').classList.remove('hidden');
                }
            });
        } catch (err) {
            this.addLog(`❌ Error: ${err.message}`, 'error');
        }
    }

    // --- UI HELPERS ---

    goToStep(n) {
        this.currentStep = n;
        document.querySelectorAll('.step-view').forEach(v => v.classList.remove('active'));
        document.getElementById(`step${n}`).classList.add('active');
        
        document.querySelectorAll('.step').forEach(s => {
            const sNum = parseInt(s.dataset.step);
            s.classList.remove('active', 'complete');
            if (sNum === n) s.classList.add('active');
            else if (sNum < n) s.classList.add('complete');
        });
    }

    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        
        document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
        document.getElementById(`${tab}Tab`).classList.add('active');
        
        if (tab === 'history') this.loadHistory();
    }

    async loadHistory() {
        const list = document.getElementById('historyList');
        list.innerHTML = '<div class="loading">Loading history...</div>';

        try {
            const res = await fetch(`${BACKEND_URL}/api/history`, {
                headers: { 'Authorization': `Bearer ${this.state.user.token}` }
            });
            const data = await res.json();
            
            if (data.success && data.history.length > 0) {
                list.innerHTML = '';
                data.history.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'history-item';
                    div.innerHTML = `
                        <img src="data:image/jpeg;base64,${item.thumbnail}" class="history-thumb">
                        <div class="history-info">
                            <div class="history-name">${item.productName}</div>
                            <div class="history-meta">${new Date(item.timestamp).toLocaleDateString()}</div>
                        </div>
                    `;
                    div.onclick = () => {
                        this.analysisResults = item.results;
                        this.goToStep(2);
                        this.renderAnalysisForm();
                        this.switchTab('create');
                    };
                    list.appendChild(div);
                });
            } else {
                list.innerHTML = '<div class="empty-text">No history found.</div>';
            }
        } catch (err) {
            list.innerHTML = `<div class="error-text">Failed to load: ${err.message}</div>`;
        }
    }

    updateProgress(data) {
        const bar = document.getElementById('progressBarFill');
        const percent = document.getElementById('progressPercent');
        const field = document.getElementById('currentField');
        
        bar.style.width = `${data.current}%`;
        percent.innerText = `${data.current}%`;
        field.innerText = `Filling: ${data.fieldName}`;
        
        this.addLog(`Processing field: ${data.fieldName}`, 'success');
    }

    addLog(msg, type) {
        const log = document.getElementById('fillLog');
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    showView(id) {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        document.getElementById(id).classList.remove('hidden');
    }

    showLoadingForm() {
        const form = document.getElementById('analysisForm');
        form.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Gemini 2.5 is analyzing your images...</p>
            </div>
        `;
    }

    showToast(msg, type) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.style.background = type === 'success' ? '#4CAF50' : '#F44336';
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }

    async checkMeeshoPage() {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const dot = document.getElementById('statusDot');
        if (tabs[0]?.url?.includes('supplier.meesho.com')) {
            dot.classList.add('connected');
        } else {
            dot.classList.remove('connected');
        }
    }

    async sendMessageToTab(tabId, message) {
        return new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                if (chrome.runtime.lastError) resolve({ success: false, error: 'Extension not loaded on this page' });
                else resolve(response);
            });
        });
    }

    handleFinish() {
        chrome.runtime.sendMessage({ action: 'CLEAR_STATE' }, () => {
            window.location.reload();
        });
    }
}

// Instantiate Controller
document.addEventListener('DOMContentLoaded', () => {
    window.controller = new PopupController();
});
