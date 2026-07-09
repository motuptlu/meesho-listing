const BACKEND_URL = 'http://localhost:3000';
let uploadedImages = [];
let scrapedFields = null;
let analysisResults = null;
let currentStep = 1;

document.addEventListener('DOMContentLoaded', () => {
    init();
});

function init() {
    // Elements
    const scanBtn = document.getElementById('scanBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const fillBtn = document.getElementById('fillBtn');
    const backBtn2 = document.getElementById('backBtn2');
    const backBtn3 = document.getElementById('backBtn3');
    const startOverBtn = document.getElementById('startOverBtn');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const uploadZone = document.getElementById('uploadZone');
    const imageInput = document.getElementById('imageInput');
    
    // Tab switching
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${btn.dataset.tab}View`).classList.add('active');
            if (btn.dataset.tab === 'history') loadHistory();
        });
    });

    // Step navigation
    scanBtn.addEventListener('click', onScanClick);
    analyzeBtn.addEventListener('click', onAnalyzeClick);
    fillBtn.addEventListener('click', onFillClick);
    backBtn2.addEventListener('click', () => goToStep(1));
    backBtn3.addEventListener('click', () => goToStep(2));
    startOverBtn.addEventListener('click', () => {
        uploadedImages = [];
        document.getElementById('imageGrid').innerHTML = '';
        scanBtn.disabled = true;
        goToStep(1);
    });
    
    clearHistoryBtn.addEventListener('click', clearHistory);

    // Upload handling
    uploadZone.addEventListener('click', () => imageInput.click());
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.style.borderColor = '#9C27B0'; });
    uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = ''; });
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = '';
        handleFiles(e.dataTransfer.files);
    });
    imageInput.addEventListener('change', (e) => handleFiles(e.target.files));

    checkPage();
    loadHistory();
    
    // Listen for progress updates from content script
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === 'FILL_PROGRESS') {
            updateProgress(request.current, request.total, request.fieldName);
        }
    });
}

function checkPage() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        const dot = document.getElementById('statusDot');
        if (tab && tab.url.includes('supplier.meesho.com')) {
            dot.className = 'status-dot connected';
            dot.title = 'Connected to Meesho';
        } else {
            dot.className = 'status-dot disconnected';
            dot.title = 'Not on Meesho Listing Page';
        }
    });
}

function handleFiles(files) {
    const fileList = Array.from(files);
    if (uploadedImages.length + fileList.length > 5) {
        showToast('Max 5 images allowed', 'error');
        return;
    }

    fileList.forEach(file => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            uploadedImages.push({ file: file, base64: e.target.result });
            renderPreviews();
            document.getElementById('scanBtn').disabled = false;
        };
        reader.readAsDataURL(file);
    });
}

function renderPreviews() {
    const grid = document.getElementById('imageGrid');
    grid.innerHTML = '';
    uploadedImages.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        div.innerHTML = `<img src="${item.base64}"><button class="remove-btn">×</button>`;
        div.querySelector('.remove-btn').onclick = () => {
            uploadedImages.splice(index, 1);
            renderPreviews();
            if (uploadedImages.length === 0) document.getElementById('scanBtn').disabled = true;
        };
        grid.appendChild(div);
    });
}

function goToStep(n) {
    currentStep = n;
    document.querySelectorAll('.step-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`step${n}`).classList.add('active');
    
    document.querySelectorAll('.step').forEach((s, i) => {
        s.classList.remove('active', 'complete');
        if (i + 1 === n) s.classList.add('active');
        if (i + 1 < n) s.classList.add('complete');
    });
}

async function onScanClick() {
    goToStep(2);
    document.getElementById('scanStatus').style.display = 'flex';
    document.getElementById('fieldsSummary').style.display = 'none';
    document.getElementById('fieldsList').innerHTML = '';
    document.getElementById('analyzeBtn').disabled = true;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.url.includes('supplier.meesho.com')) {
            showToast('Please open Meesho Listing Page', 'error');
            goToStep(1);
            return;
        }

        chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_FORM' }, (response) => {
            if (chrome.runtime.lastError || !response || !response.success) {
                showToast('Scan failed. Refresh Meesho tab.', 'error');
                goToStep(1);
                return;
            }
            displayScanResults(response);
        });
    });
}

function displayScanResults(data) {
    scrapedFields = data.fields;
    document.getElementById('scanStatus').style.display = 'none';
    document.getElementById('fieldsSummary').style.display = 'grid';
    
    const counts = {
        total: data.fields.length,
        dropdown: data.fields.filter(f => f.type === 'dropdown').length,
        chips: data.fields.filter(f => f.type === 'multi_chip').length,
        required: data.fields.filter(f => f.required).length
    };
    
    document.getElementById('totalFieldsCount').innerText = counts.total;
    document.getElementById('dropdownCount').innerText = counts.dropdown;
    document.getElementById('chipsCount').innerText = counts.chips;
    document.getElementById('requiredCount').innerText = counts.required;
    
    renderFieldsList(data.fields);
    document.getElementById('analyzeBtn').disabled = false;
}

function renderFieldsList(fields) {
    const list = document.getElementById('fieldsList');
    list.innerHTML = '';
    fields.forEach(f => {
        const item = document.createElement('div');
        item.className = 'field-item';
        
        let typeBadge = '';
        if (f.type === 'dropdown') typeBadge = '<span class="badge badge-dropdown">Dropdown</span>';
        else if (f.type === 'multi_chip') typeBadge = '<span class="badge badge-chip">Multi-Select</span>';
        else typeBadge = '<span class="badge badge-text">Text/Number</span>';
        
        const optionsBadge = (f.options && f.options.length > 0) 
            ? `<span class="badge badge-options">${f.options.length} options</span>` 
            : '';
            
        item.innerHTML = `
            <div class="field-label">${f.required ? '<span class="required-star">*</span>' : ''}${f.label}</div>
            <div class="field-badges">${typeBadge}${optionsBadge}</div>
        `;
        list.appendChild(item);
    });
}

async function onAnalyzeClick() {
    goToStep(3);
    document.getElementById('analyzeLoading').style.display = 'block';
    document.getElementById('resultsForm').style.display = 'none';
    document.getElementById('step3Buttons').style.display = 'none';

    const formData = new FormData();
    uploadedImages.forEach(img => formData.append('images', img.file));
    formData.append('formFields', JSON.stringify({ fields: scrapedFields }));

    try {
        const res = await fetch(`${BACKEND_URL}/api/analyze`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            analysisResults = data.results;
            displayResults(data.results, scrapedFields);
            saveToHistory(data.results, uploadedImages[0]?.base64);
        } else {
            throw new Error(data.error || 'Analysis failed');
        }
    } catch (err) {
        showToast(err.message, 'error');
        goToStep(2);
    }
}

function displayResults(results, fields) {
    document.getElementById('analyzeLoading').style.display = 'none';
    const form = document.getElementById('resultsForm');
    form.style.display = 'block';
    form.innerHTML = '';
    document.getElementById('step3Buttons').style.display = 'flex';

    fields.forEach(f => {
        if (f.type === 'file') return;
        
        const resValue = results[f.label];
        const div = document.createElement('div');
        div.className = 'result-field';
        div.innerHTML = `<label>${f.label}</label>`;
        
        if (f.type === 'dropdown' && f.options && f.options.length > 0) {
            const select = document.createElement('select');
            select.dataset.label = f.label;
            f.options.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt.label;
                o.text = opt.label;
                if (opt.label === resValue) o.selected = true;
                select.appendChild(o);
            });
            div.appendChild(select);
        } else if (f.type === 'multi_chip' && f.options && f.options.length > 0) {
            const chipsDiv = document.createElement('div');
            chipsDiv.className = 'chips-editor';
            const selected = Array.isArray(resValue) ? resValue : [resValue];
            f.options.forEach((opt, idx) => {
                const id = `chip_${f.fieldId}_${idx}`;
                const checked = selected.includes(opt.label) ? 'checked' : '';
                chipsDiv.innerHTML += `
                    <input type="checkbox" id="${id}" class="chip-checkbox" value="${opt.label}" ${checked} data-field="${f.label}">
                    <label for="${id}" class="chip-label">${opt.label}</label>
                `;
            });
            div.appendChild(chipsDiv);
        } else if (f.type === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.dataset.label = f.label;
            textarea.rows = 3;
            textarea.value = resValue || '';
            div.appendChild(textarea);
        } else {
            const input = document.createElement('input');
            input.type = f.type === 'number_input' ? 'number' : 'text';
            input.dataset.label = f.label;
            input.value = resValue || '';
            div.appendChild(input);
        }
        form.appendChild(div);
    });
}

function collectEditedResults() {
    const results = {};
    const form = document.getElementById('resultsForm');
    
    // Inputs, Selects, Textareas
    form.querySelectorAll('input:not(.chip-checkbox), select, textarea').forEach(el => {
        results[el.dataset.label] = el.value;
    });
    
    // Chips
    const chips = {};
    form.querySelectorAll('.chip-checkbox:checked').forEach(el => {
        const label = el.dataset.field;
        if (!chips[label]) chips[label] = [];
        chips[label].push(el.value);
    });
    
    Object.assign(results, chips);
    return results;
}

async function onFillClick() {
    const editedResults = collectEditedResults();
    goToStep(4);
    
    document.getElementById('fillReport').style.display = 'none';
    document.getElementById('fillProgress').style.display = 'block';
    document.getElementById('startOverBtn').style.display = 'none';
    updateProgress(0, scrapedFields.length, 'Starting...');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        chrome.tabs.sendMessage(tab.id, {
            action: 'FILL_FORM',
            data: editedResults,
            fields: scrapedFields,
            images: uploadedImages.map(img => img.base64)
        }, (response) => {
            if (chrome.runtime.lastError || !response || !response.success) {
                showToast('Filling failed', 'error');
                goToStep(3);
                return;
            }
            showFillReport(response.report);
        });
    });
}

function updateProgress(current, total, fieldName) {
    const percent = Math.round((current / total) * 100);
    document.getElementById('progressPercent').innerText = `${percent}%`;
    document.getElementById('progressBar').style.width = `${percent}%`;
    document.getElementById('progressFieldName').innerText = fieldName || '';
}

function showFillReport(report) {
    document.getElementById('fillProgress').style.display = 'none';
    const reportDiv = document.getElementById('fillReport');
    reportDiv.style.display = 'block';
    document.getElementById('startOverBtn').style.display = 'block';
    
    reportDiv.innerHTML = `
        <div class="section-title">Filling Summary</div>
        <div class="fields-summary">
            <div class="summary-card"><span class="summary-number">${report.filled}</span><span class="summary-label">Filled</span></div>
            <div class="summary-card"><span class="summary-number" style="color:var(--error)">${report.failed}</span><span class="summary-label">Failed</span></div>
            <div class="summary-card"><span class="summary-number" style="color:var(--text-light)">${report.skipped}</span><span class="summary-label">Skipped</span></div>
        </div>
    `;
    
    const detailsList = document.createElement('div');
    report.details.forEach(d => {
        const item = document.createElement('div');
        item.className = 'report-item';
        const icon = d.status === 'filled' ? '✅' : (d.status === 'failed' ? '❌' : '⏭️');
        item.innerHTML = `
            <div class="report-icon">${icon}</div>
            <div class="report-info">
                <div class="report-label">${d.label}</div>
                <div class="report-status">${d.status === 'failed' ? d.reason : (d.value || d.status)}</div>
            </div>
        `;
        detailsList.appendChild(item);
    });
    reportDiv.appendChild(detailsList);
}

function saveToHistory(results, thumb) {
    chrome.storage.local.get({ listingHistory: [] }, (data) => {
        const history = data.listingHistory;
        history.unshift({ id: Date.now(), results, thumb, timestamp: new Date().toLocaleString() });
        if (history.length > 15) history.pop();
        chrome.storage.local.set({ listingHistory: history });
    });
}

function loadHistory() {
    chrome.storage.local.get({ listingHistory: [] }, (data) => {
        const list = document.getElementById('historyList');
        if (data.listingHistory.length === 0) {
            list.innerHTML = '<p class="empty-text">No previous listings found.</p>';
            return;
        }
        list.innerHTML = '';
        data.listingHistory.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <img src="${item.thumb || 'icons/icon48.png'}" class="history-thumb">
                <div class="history-info">
                    <div class="history-name">${item.results[Object.keys(item.results)[0]] || 'Untitled Product'}</div>
                    <div class="history-meta">${item.timestamp}</div>
                </div>
            `;
            div.onclick = () => {
                analysisResults = item.results;
                scrapedFields = Object.keys(item.results).map(label => ({ label, type: 'text_input' })); // Basic fallback
                // Better history loading would store fields structure too, but for simplicity:
                showToast('Loading results from history...', 'info');
                document.querySelector('[data-tab="listing"]').click();
                goToStep(3);
                displayResults(item.results, scrapedFields);
            };
            list.appendChild(div);
        });
    });
}

function clearHistory() {
    if (confirm('Clear all history?')) {
        chrome.storage.local.set({ listingHistory: [] }, loadHistory);
    }
}

function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.style.background = type === 'error' ? '#F44336' : (type === 'success' ? '#4CAF50' : '#333');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}
