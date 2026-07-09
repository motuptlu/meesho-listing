const BACKEND_URL = 'http://localhost:3000';
let uploadedImages = [];
let scrapedFields = null;
let analysisResults = null;
let currentStep = 1;

document.addEventListener('DOMContentLoaded', () => {
    init();
});

function init() {
    const scanBtn = document.getElementById('scanBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const fillBtn = document.getElementById('fillBtn');
    const imageInput = document.getElementById('imageInput');
    const uploadZone = document.getElementById('uploadZone');

    // Tab Logic
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

    // Step Logic
    scanBtn.addEventListener('click', onScanClick);
    analyzeBtn.addEventListener('click', onAnalyzeClick);
    fillBtn.addEventListener('click', onFillClick);
    
    document.getElementById('backBtn2').addEventListener('click', () => goToStep(1));
    document.getElementById('backBtn3').addEventListener('click', () => goToStep(2));
    document.getElementById('startOverBtn').addEventListener('click', () => location.reload());
    document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);

    // Upload Logic
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
            dot.title = 'Open Meesho Listing Page';
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
    uploadedImages.forEach((img, idx) => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        div.innerHTML = `<img src="${img.base64}"><button class="remove-btn">×</button>`;
        div.querySelector('.remove-btn').onclick = () => {
            uploadedImages.splice(idx, 1);
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
        else if (i + 1 < n) s.classList.add('complete');
    });
}

async function onScanClick() {
    goToStep(2);
    document.getElementById('scanStatus').style.display = 'flex';
    document.getElementById('fieldsSummary').style.display = 'none';
    document.getElementById('fieldsList').innerHTML = '';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'SCRAPE_FORM' }, (response) => {
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
    
    document.getElementById('totalFieldsCount').innerText = data.totalFields;
    document.getElementById('dropdownCount').innerText = data.dropdownCount;
    document.getElementById('chipsCount').innerText = data.chipCount;
    document.getElementById('requiredCount').innerText = data.requiredCount;
    
    const list = document.getElementById('fieldsList');
    list.innerHTML = '';
    data.fields.forEach(f => {
        const item = document.createElement('div');
        item.className = 'field-item';
        
        let typeBadge = `<span class="badge badge-text">${f.type}</span>`;
        if (f.type === 'dropdown') typeBadge = '<span class="badge badge-dropdown">Dropdown</span>';
        else if (f.type === 'multi_chip') typeBadge = '<span class="badge badge-chip">Multi-Select</span>';
        
        let optionsHtml = '';
        if (f.optionLabels && f.optionLabels.length > 0) {
            const preview = f.optionLabels.slice(0, 3).join(', ');
            const more = f.optionLabels.length > 3 ? ` +${f.optionLabels.length - 3} more` : '';
            optionsHtml = `<div class="field-options-preview">📋 ${f.optionLabels.length} options: ${preview}${more}</div>`;
        }

        item.innerHTML = `
            <div class="field-item-header">
                ${f.required ? '<span class="required-star">*</span>' : ''}
                <span class="field-name">${f.label}</span>
                ${typeBadge}
            </div>
            ${optionsHtml}
        `;
        list.appendChild(item);
    });
    document.getElementById('analyzeBtn').disabled = false;
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
    form.innerHTML = '';
    form.style.display = 'block';
    document.getElementById('step3Buttons').style.display = 'flex';

    fields.forEach(f => {
        if (f.type === 'file_upload') return;
        const val = results[f.label];
        const group = document.createElement('div');
        group.className = 'result-group';
        
        const label = document.createElement('label');
        label.className = 'result-label';
        label.textContent = f.label + (f.required ? ' *' : '');
        group.appendChild(label);
        
        if (f.type === 'dropdown' && f.optionLabels?.length > 0) {
            const select = document.createElement('select');
            select.className = 'result-select';
            select.dataset.label = f.label;
            f.optionLabels.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt;
                o.text = opt;
                if (opt === val) o.selected = true;
                select.appendChild(o);
            });
            group.appendChild(select);
        } else if (f.type === 'multi_chip' && f.optionLabels?.length > 0) {
            const chipsDiv = document.createElement('div');
            chipsDiv.className = 'result-chips';
            chipsDiv.dataset.label = f.label;
            const selected = Array.isArray(val) ? val : [val];
            f.optionLabels.forEach(opt => {
                const l = document.createElement('label');
                l.className = 'chip-option';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = opt;
                cb.checked = selected.includes(opt);
                l.appendChild(cb);
                l.appendChild(document.createTextNode(' ' + opt));
                chipsDiv.appendChild(l);
            });
            group.appendChild(chipsDiv);
        } else if (f.type === 'textarea') {
            const ta = document.createElement('textarea');
            ta.className = 'result-textarea';
            ta.dataset.label = f.label;
            ta.value = val || '';
            ta.rows = 3;
            group.appendChild(ta);
        } else {
            const input = document.createElement('input');
            input.className = 'result-input';
            input.type = f.type === 'number_input' ? 'number' : 'text';
            input.dataset.label = f.label;
            input.value = val || '';
            group.appendChild(input);
        }
        form.appendChild(group);
    });
}

function collectEditedResults() {
    const results = {};
    const form = document.getElementById('resultsForm');
    form.querySelectorAll('input:not([type="checkbox"]), select, textarea').forEach(el => {
        if (el.dataset.label) results[el.dataset.label] = el.value;
    });
    form.querySelectorAll('.result-chips').forEach(container => {
        const label = container.dataset.label;
        results[label] = Array.from(container.querySelectorAll('input:checked')).map(cb => cb.value);
    });
    return results;
}

async function onFillClick() {
    const data = collectEditedResults();
    goToStep(4);
    document.getElementById('fillReport').style.display = 'none';
    document.getElementById('fillProgress').style.display = 'block';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {
            action: 'FILL_FORM',
            data,
            fields: scrapedFields,
            images: uploadedImages.map(img => img.base64)
        }, (response) => {
            if (chrome.runtime.lastError || !response || !response.success) {
                showToast('Fill failed', 'error');
                goToStep(3);
                return;
            }
            showFillReport(response.report);
        });
    });
}

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'FILL_PROGRESS') {
        const percent = Math.round((request.current / request.total) * 100);
        document.getElementById('progressPercent').innerText = `${percent}%`;
        document.getElementById('progressBar').style.width = `${percent}%`;
        document.getElementById('progressFieldName').innerText = request.fieldName || '';
    }
});

function showFillReport(report) {
    document.getElementById('fillProgress').style.display = 'none';
    const reportDiv = document.getElementById('fillReport');
    reportDiv.style.display = 'block';
    document.getElementById('startOverBtn').style.display = 'block';
    
    reportDiv.innerHTML = `<div class="section-title">Summary: ${report.filled}/${report.totalFields} Filled</div>`;
    report.details.forEach(d => {
        const item = document.createElement('div');
        item.className = 'report-item';
        const icon = d.status === 'filled' ? '✅' : '❌';
        item.innerHTML = `<span>${icon}</span><div class="report-info"><div class="report-label">${d.label}</div><div class="report-status">${d.reason || d.status}</div></div>`;
        reportDiv.appendChild(item);
    });
}

function saveToHistory(results, thumb) {
    chrome.storage.local.get({ history: [] }, (data) => {
        const history = [{ id: Date.now(), results, thumb, date: new Date().toLocaleString() }, ...data.history].slice(0, 20);
        chrome.storage.local.set({ history });
    });
}

function loadHistory() {
    chrome.storage.local.get({ history: [] }, (data) => {
        const list = document.getElementById('historyList');
        if (data.history.length === 0) { list.innerHTML = '<p class="empty-text">No history.</p>'; return; }
        list.innerHTML = '';
        data.history.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `<img src="${item.thumb || ''}" class="history-thumb"><div class="history-info"><div class="history-name">${item.results[Object.keys(item.results)[0]] || 'Listing'}</div><div class="history-meta">${item.date}</div></div>`;
            div.onclick = () => { analysisResults = item.results; goToStep(3); displayResults(item.results, scrapedFields || []); };
            list.appendChild(div);
        });
    });
}

function clearHistory() { if (confirm('Clear history?')) chrome.storage.local.set({ history: [] }, loadHistory); }

function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.style.background = type === 'error' ? '#F44336' : '#333';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}
