/**
 * MEESHO ENTERPRISE AUTOMATION ENGINE v2.0
 * High-Reliability DOM Automation for React/MUI/Portal Environments
 */

console.log('%c🚀 Meesho Automation Engine Initialized', 'color: #9C27B0; font-weight: bold; font-size: 16px;');

// --- CONFIGURATION ---
const CONFIG = {
    RETRY_ATTEMPTS: 3,
    POPUP_WAIT_MS: 1200,
    ACTION_DELAY_MS: 500,
    SCROLL_TIMEOUT_MS: 400,
    MIN_LABEL_LENGTH: 2,
    FUZZY_MATCH_THRESHOLD: 0.8,
    SELECTORS: {
        POPUP_MENU: [
            '[role="listbox"]',
            '[role="menu"]',
            '.MuiMenu-paper',
            '.MuiAutocomplete-popper',
            '[class*="menu" i]',
            '[class*="dropdown" i]',
            '[class*="popup" i]',
            '[class*="Select-menu" i]'
        ],
        OPTIONS: [
            '[role="option"]',
            '[role="menuitem"]',
            'li',
            '[class*="option" i]',
            '[class*="MenuItem" i]',
            '[class*="select-option" i]'
        ],
        INPUTS: 'input, textarea, [role="combobox"], [aria-haspopup="true"], [contenteditable="true"]'
    }
};

// --- STATE MANAGEMENT ---
let automationRunning = false;
let fieldCache = new Map();

// --- MESSAGE ROUTING ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SCRAPE_FORM') {
        runScrape(sendResponse);
        return true;
    }
    if (message.action === 'FILL_FORM') {
        runFill(message, sendResponse);
        return true;
    }
});

// --- CORE ACTIONS ---

async function runScrape(sendResponse) {
    try {
        showStatus('🔍 Scanning Meesho Form...');
        await autoScrollToBottom();
        const scanner = new MeeshoScanner();
        const fields = await scanner.scan();
        
        // Group fields for reporting
        const stats = {
            total: fields.length,
            dropdowns: fields.filter(f => f.type === 'dropdown').length,
            text: fields.filter(f => f.type === 'text').length,
            required: fields.filter(f => f.required).length
        };

        showStatus(`✅ Found ${fields.length} fields`, 'success');
        sendResponse({ success: true, fields, stats });
    } catch (err) {
        console.error('[Automation] Scrape Failed:', err);
        showStatus('❌ Scan Failed', 'error');
        sendResponse({ success: false, error: err.message });
    }
}

async function runFill(message, sendResponse) {
    if (automationRunning) return sendResponse({ success: false, error: 'Already running' });
    
    try {
        automationRunning = true;
        const engine = new AutomationEngine();
        const report = await engine.execute(message.data, message.fields, message.images);
        automationRunning = false;
        sendResponse({ success: true, report });
    } catch (err) {
        automationRunning = false;
        console.error('[Automation] Fill Failed:', err);
        sendResponse({ success: false, error: err.message });
    }
}

// --- AUTOMATION ENGINE ---

class AutomationEngine {
    constructor() {
        this.report = { total: 0, filled: 0, failed: 0, details: [] };
    }

    async execute(aiData, fieldDefs, images) {
        this.report.total = fieldDefs.length;
        
        for (let i = 0; i < fieldDefs.length; i++) {
            const field = fieldDefs[i];
            const value = aiData[field.label];

            if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
                console.log(`[Automation] Skipping empty field: ${field.label}`);
                continue;
            }

            this.updateFillProgress(i + 1, fieldDefs.length, field.label);
            
            const success = await this.retry(() => this.processField(field, value), CONFIG.RETRY_ATTEMPTS);
            
            if (success) {
                this.report.filled++;
                this.report.details.push({ label: field.label, status: 'filled', value });
            } else {
                this.report.failed++;
                this.report.details.push({ label: field.label, status: 'failed', reason: 'Field interaction failed' });
            }
            
            await sleep(CONFIG.ACTION_DELAY_MS);
        }

        if (images && images.length > 0) {
            await this.handleImageUploads(images);
        }

        hideStatus();
        return this.report;
    }

    async processField(field, value) {
        const el = this.findElement(field);
        if (!el) {
            console.warn(`[Automation] Could not find element for: ${field.label}`);
            return false;
        }

        // Scroll into view with offset for headers
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(CONFIG.SCROLL_TIMEOUT_MS);

        this.highlightElement(el);

        const type = this.classifyElement(el);
        console.log(`[Automation] Processing [${type}] ${field.label} -> "${value}"`);

        try {
            if (type === 'dropdown' || type === 'combobox') {
                return await this.automateDropdown(el, value, field.label);
            } else if (type === 'textarea') {
                return await this.automateText(el, value, true);
            } else {
                return await this.automateText(el, value, false);
            }
        } catch (err) {
            console.error(`[Automation] Error processing ${field.label}:`, err);
            return false;
        } finally {
            this.unhighlightElement(el);
        }
    }

    async automateDropdown(trigger, targetValue, label) {
        console.log(`[Automation] Attempting dropdown selection for ${label}`);
        
        // 1. Click to open
        trigger.click();
        await sleep(CONFIG.POPUP_WAIT_MS);

        // 2. Locate Popup (Handling Portals outside container)
        let menu = this.findActiveMenu();
        
        if (!menu) {
            // Try clicking icon/button inside if direct click didn't work
            const btn = trigger.querySelector('button, svg, [role="button"]');
            if (btn) btn.click();
            await sleep(CONFIG.POPUP_WAIT_MS);
            menu = this.findActiveMenu();
        }

        if (!menu) {
            console.warn(`[Automation] Menu not found for ${label}`);
            return false;
        }

        // 3. Handle Searchable Dropdowns
        const searchInput = menu.querySelector('input[type="text"]') || (trigger.tagName === 'INPUT' ? trigger : null);
        if (searchInput && this.isElementVisible(searchInput)) {
            await this.automateText(searchInput, targetValue, false);
            await sleep(800); // Wait for filtering
        }

        // 4. Find Best Option
        const options = this.getMenuOptions(menu);
        if (options.length === 0) {
            console.warn(`[Automation] No options found in menu for ${label}`);
            return false;
        }

        const match = this.matchOption(targetValue, options);
        if (match) {
            console.log(`[Automation] Matched option: "${match.text}"`);
            match.el.scrollIntoView({ block: 'nearest' });
            await sleep(100);
            match.el.click();
            
            // Verify
            await sleep(400);
            const verified = await this.verifySelection(trigger, match.text);
            if (verified) return true;
        }

        // Fallback: If menu is still open, try to close it by clicking body
        document.body.click();
        return false;
    }

    async automateText(el, value, isTextarea) {
        el.focus();
        await sleep(100);

        // React Value Setter Hack
        const nativeSetter = isTextarea 
            ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
            : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        
        nativeSetter.call(el, value);
        
        // Dispatch sequence for React reconciliation
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
        
        await sleep(100);
        el.blur();
        return true;
    }

    async handleImageUploads(images) {
        showStatus('📸 Uploading Images...');
        const input = document.querySelector('input[type="file"]');
        if (!input) return;

        try {
            const dataTransfer = new DataTransfer();
            for (let i = 0; i < images.length; i++) {
                const res = await fetch(images[i]);
                const blob = await res.blob();
                const file = new File([blob], `product_${i}.jpg`, { type: 'image/jpeg' });
                dataTransfer.items.add(file);
            }
            input.files = dataTransfer.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(2000);
        } catch (e) {
            console.error('[Automation] Upload Failed:', e);
        }
    }

    // --- HELPERS ---

    findElement(field) {
        // 1. Try Selector
        let el = document.querySelector(field.selector);
        if (this.isValidTarget(el)) return el;

        // 2. Try by Label Text
        const candidates = Array.from(document.querySelectorAll(CONFIG.SELECTORS.INPUTS));
        for (const cand of candidates) {
            const label = this.getLabelFor(cand);
            if (label.toLowerCase().includes(field.label.toLowerCase()) || 
                field.label.toLowerCase().includes(label.toLowerCase())) {
                return cand;
            }
        }
        return null;
    }

    isValidTarget(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return el.offsetParent !== null && style.display !== 'none' && style.visibility !== 'hidden';
    }

    classifyElement(el) {
        const role = el.getAttribute('role');
        const ariaPopup = el.getAttribute('aria-haspopup');
        if (el.tagName === 'TEXTAREA') return 'textarea';
        if (role === 'combobox' || ariaPopup === 'true' || ariaPopup === 'listbox') return 'dropdown';
        if (el.classList.contains('MuiSelect-select')) return 'dropdown';
        return 'text';
    }

    getLabelFor(el) {
        // Search upward for parent container that might have label
        let current = el;
        for (let i = 0; i < 5; i++) {
            if (!current) break;
            const labelEl = current.querySelector('label, span, p, h6');
            if (labelEl && labelEl.innerText.trim().length > CONFIG.MIN_LABEL_LENGTH) {
                return labelEl.innerText.trim();
            }
            // Check preceding sibling
            if (current.previousElementSibling) {
                const sibText = current.previousElementSibling.innerText.trim();
                if (sibText.length > CONFIG.MIN_LABEL_LENGTH) return sibText;
            }
            current = current.parentElement;
        }
        return el.placeholder || el.getAttribute('aria-label') || '';
    }

    findActiveMenu() {
        for (const selector of CONFIG.SELECTORS.POPUP_MENU) {
            const menus = Array.from(document.querySelectorAll(selector));
            const active = menus.find(m => this.isElementVisible(m));
            if (active) return active;
        }
        return null;
    }

    getMenuOptions(menu) {
        const options = [];
        for (const selector of CONFIG.SELECTORS.OPTIONS) {
            const items = menu.querySelectorAll(selector);
            if (items.length > 0) {
                items.forEach(item => {
                    const text = item.innerText.trim();
                    if (text) options.push({ el: item, text });
                });
                break;
            }
        }
        return options;
    }

    matchOption(target, options) {
        const t = target.toLowerCase().trim();
        // 1. Exact
        let match = options.find(o => o.text.toLowerCase() === t);
        if (match) return match;
        
        // 2. Contains
        match = options.find(o => o.text.toLowerCase().includes(t) || t.includes(o.text.toLowerCase()));
        if (match) return match;

        // 3. Normalized (remove special chars)
        const normalize = s => s.replace(/[^a-z0-9]/g, '');
        const nt = normalize(t);
        match = options.find(o => normalize(o.text.toLowerCase()) === nt);
        
        return match || options[0]; // Default to first if all fails? Or null?
    }

    async verifySelection(trigger, expectedText) {
        const currentText = (trigger.innerText || trigger.value || '').toLowerCase();
        const expected = expectedText.toLowerCase();
        return currentText.includes(expected) || expected.includes(currentText);
    }

    async retry(fn, attempts) {
        for (let i = 0; i < attempts; i++) {
            if (await fn()) return true;
            console.log(`[Automation] Retrying... (${i + 1}/${attempts})`);
            await sleep(800);
        }
        return false;
    }

    isElementVisible(el) {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';
    }

    highlightElement(el) {
        el.style.outline = '3px solid #9C27B0';
        el.style.outlineOffset = '2px';
        el.style.transition = 'outline 0.2s ease-in-out';
    }

    unhighlightElement(el) {
        el.style.outline = '';
    }

    updateFillProgress(current, total, fieldName) {
        chrome.runtime.sendMessage({
            action: 'FILL_PROGRESS',
            current,
            total,
            fieldName
        });
    }
}

// --- SCANNING ENGINE ---

class FieldDetectionEngine {
    constructor() {
        this.config = CONFIG;
        this.fields = new Map();
        this.observer = null;
        this.initObserver();
    }

    initObserver() {
        this.observer = new MutationObserver((mutations) => {
            // Check if mutations contain relevant changes
            const hasRelevantChange = mutations.some(m => 
                m.type === 'childList' || 
                (m.type === 'attributes' && ['role', 'aria-haspopup', 'class'].includes(m.attributeName))
            );

            if (hasRelevantChange) {
                if (this.scanTimeout) clearTimeout(this.scanTimeout);
                this.scanTimeout = setTimeout(() => this.backgroundScan(), 1000);
            }
        });
        this.observer.observe(document.body, { 
            childList: true, 
            subtree: true,
            attributes: true,
            attributeFilter: ['role', 'aria-haspopup', 'class']
        });
    }

    async backgroundScan() {
        const inputs = this.findAllInputs();
        for (const input of inputs) {
            const field = await this.analyzeField(input);
            if (field) this.fields.set(field.label, field);
        }
    }

    async scan() {
        await this.backgroundScan(); // Ensure latest
        return Array.from(this.fields.values());
    }

    findAllInputs() {
        // Expanded selector for Meesho's complex components
        const selector = [
            'input:not([type="hidden"])',
            'textarea',
            'select',
            '[role="combobox"]',
            '[role="textbox"]',
            '[aria-haspopup="true"]',
            '[aria-haspopup="listbox"]',
            '.MuiSelect-select',
            '[class*="Select-select"]',
            '[class*="dropdown" i]',
            '[contenteditable="true"]'
        ].join(',');

        return Array.from(document.querySelectorAll(selector)).filter(el => {
            const style = window.getComputedStyle(el);
            const isVisible = el.offsetParent !== null && style.display !== 'none' && style.visibility !== 'hidden';
            const isNotButton = el.tagName !== 'BUTTON' || el.getAttribute('role') === 'combobox';
            return isVisible && isNotButton;
        });
    }

    async analyzeField(el) {
        const label = this.findLabel(el);
        if (!label || label.length < this.config.MIN_LABEL_LENGTH) return null;

        const type = this.detectType(el);
        const selector = this.generateSelector(el);
        let optionLabels = [];

        if (type === 'dropdown') {
            optionLabels = await this.extractOptions(el);
        }

        return {
            label,
            type,
            required: this.isRequired(el),
            selector,
            optionLabels,
            id: Math.random().toString(36).substr(2, 9)
        };
    }

    findLabel(el) {
        // 1. Standard HTML labels
        if (el.id) {
            const label = document.querySelector(`label[for="${el.id}"]`);
            if (label) return this.cleanLabel(label.innerText);
        }

        // 2. Aria Labels
        const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
        if (ariaLabel) {
            if (ariaLabel.startsWith('Mui')) { // Handle ID-based labelledby
                const labelEl = document.getElementById(ariaLabel);
                if (labelEl) return this.cleanLabel(labelEl.innerText);
            } else {
                return this.cleanLabel(ariaLabel);
            }
        }

        // 3. Parent-based label search (Material UI common pattern)
        const formControl = el.closest('.MuiFormControl-root, [class*="FormControl"]');
        if (formControl) {
            const labelEl = formControl.querySelector('label, .MuiFormLabel-root, .MuiInputLabel-root');
            if (labelEl) return this.cleanLabel(labelEl.innerText);
        }

        // 4. Recursive Upward Search
        let current = el;
        for (let i = 0; i < 4; i++) {
            if (!current || current === document.body) break;
            
            // Check siblings
            let prev = current.previousElementSibling;
            while (prev) {
                const text = prev.innerText.trim();
                if (text.length > 2 && text.length < 50) return this.cleanLabel(text);
                prev = prev.previousElementSibling;
            }

            // Check parent's text (if it's a small container)
            const parentText = Array.from(current.parentElement.childNodes)
                .filter(n => n.nodeType === Node.TEXT_NODE)
                .map(n => n.textContent.trim())
                .join('');
            if (parentText.length > 2 && parentText.length < 50) return this.cleanLabel(parentText);

            current = current.parentElement;
        }

        return this.cleanLabel(el.placeholder || el.name || '');
    }

    cleanLabel(text) {
        if (!text) return '';
        return text.replace(/\*/g, '').replace(/:$/, '').trim();
    }

    detectType(el) {
        if (el.tagName === 'TEXTAREA') return 'textarea';
        
        const role = el.getAttribute('role');
        const ariaPopup = el.getAttribute('aria-haspopup');
        const className = el.className || '';
        const typeAttr = el.getAttribute('type') || '';
        
        if (role === 'combobox' || 
            ariaPopup === 'true' || 
            ariaPopup === 'listbox' || 
            className.includes('Select-select') || 
            el.tagName === 'SELECT') {
            return 'dropdown';
        }
        
        if (typeAttr === 'number' || 
            el.inputMode === 'numeric' || 
            el.id.toLowerCase().includes('price') || 
            el.id.toLowerCase().includes('weight') ||
            el.id.toLowerCase().includes('gst')) {
            return 'number';
        }
        
        return 'text';
    }

    async extractOptions(el) {
        // 1. Native Select
        if (el.tagName === 'SELECT') {
            return Array.from(el.options).map(o => o.text.trim()).filter(Boolean);
        }

        // 2. Aria Owns/Controls
        const ariaOwns = el.getAttribute('aria-owns') || el.getAttribute('aria-controls');
        if (ariaOwns) {
            const menu = document.getElementById(ariaOwns);
            if (menu) return this.collectOptionsFromMenu(menu);
        }

        // 3. Search for open listboxes (Portals)
        const listboxes = document.querySelectorAll('[role="listbox"], .MuiMenu-list, .MuiAutocomplete-listbox, ul.MuiList-root');
        for (const listbox of listboxes) {
            const opts = this.collectOptionsFromMenu(listbox);
            if (opts.length > 0) return opts;
        }

        // 4. DataList fallback
        if (el.list) {
            return Array.from(el.list.options).map(o => o.value.trim()).filter(Boolean);
        }
        
        return [];
    }

    collectOptionsFromMenu(menu) {
        return [...new Set(Array.from(menu.querySelectorAll('[role="option"], li, .MuiMenuItem-root'))
            .map(o => o.innerText.trim())
            .filter(Boolean))];
    }

    isRequired(el) {
        return el.required || 
               el.getAttribute('aria-required') === 'true' || 
               el.closest('.Mui-required') !== null ||
               el.closest('.required') !== null;
    }

    generateSelector(el) {
        if (el.id) return `#${CSS.escape(el.id)}`;
        
        // Path-based selector is more reliable for dynamic React apps than name/class
        const path = [];
        let curr = el;
        while (curr && curr.nodeType === Node.ELEMENT_NODE && path.length < 8) {
            let selector = curr.nodeName.toLowerCase();
            if (curr.id) {
                selector += `#${CSS.escape(curr.id)}`;
                path.unshift(selector);
                break;
            }
            const index = Array.from(curr.parentNode.children).indexOf(curr) + 1;
            selector += `:nth-child(${index})`;
            path.unshift(selector);
            curr = curr.parentNode;
        }
        return path.join(' > ');
    }
}

class MeeshoScanner {
    constructor() {
        this.engine = new FieldDetectionEngine();
    }

    async scan() {
        showStatus('🔍 Scanning Form Layout...');
        const fields = await this.engine.scan();
        return fields;
    }
}

// --- UI UTILS ---

function showStatus(text, type = 'info') {
    let toast = document.getElementById('meesho-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'meesho-toast';
        document.body.appendChild(toast);
    }
    
    const colors = {
        info: '#9C27B0',
        success: '#4CAF50',
        error: '#F44336'
    };

    toast.style.cssText = `
        position: fixed; bottom: 30px; right: 30px;
        background: ${colors[type]}; color: white;
        padding: 14px 28px; border-radius: 50px;
        font-family: 'Inter', sans-serif; font-size: 14px;
        font-weight: 500; z-index: 1000000;
        box-shadow: 0 10px 40px rgba(0,0,0,0.4);
        display: flex; align-items: center; gap: 12px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        transform: translateY(0); opacity: 1;
    `;
    
    toast.innerHTML = `
        <div class="loader-spinner"></div>
        <span>${text}</span>
    `;

    if (!document.getElementById('toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
            @keyframes spin { to { transform: rotate(360deg); } }
            .loader-spinner {
                width: 18px; height: 18px;
                border: 3px solid rgba(255,255,255,0.3);
                border-top-color: white;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
        `;
        document.head.appendChild(style);
    }
}

function hideStatus() {
    const toast = document.getElementById('meesho-toast');
    if (toast) {
        toast.style.transform = 'translateY(100px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function autoScrollToBottom() {
    const height = document.body.scrollHeight;
    for (let i = 0; i < height; i += 400) {
        window.scrollTo(0, i);
        await sleep(100);
    }
    window.scrollTo(0, 0);
    await sleep(200);
}
