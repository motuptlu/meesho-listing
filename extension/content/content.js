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

class MeeshoScanner {
    async scan() {
        const fields = [];
        const seen = new Set();
        
        const inputs = Array.from(document.querySelectorAll(CONFIG.SELECTORS.INPUTS));
        
        for (const input of inputs) {
            const label = this.getLabel(input);
            if (!label || seen.has(label)) continue;
            
            const type = this.detectType(input);
            const selector = this.generateSelector(input);
            let optionLabels = [];

            if (type === 'dropdown') {
                optionLabels = await this.extractOptionLabels(input);
            }
            
            fields.push({
                label,
                type,
                required: this.checkRequired(input),
                selector,
                optionLabels,
                id: Math.random().toString(36).substr(2, 9)
            });
            
            seen.add(label);
        }
        
        return fields;
    }

    async extractOptionLabels(el) {
        try {
            // 1. Check if it's a native select
            if (el.tagName === 'SELECT') {
                return Array.from(el.options).map(o => o.text.trim()).filter(Boolean);
            }

            // 2. Look for associated poppers/menus that might be in the DOM
            // Sometimes React renders them hidden or we can find them by ARIA attributes
            const ariaOwns = el.getAttribute('aria-owns') || el.getAttribute('aria-controls');
            if (ariaOwns) {
                const menu = document.getElementById(ariaOwns);
                if (menu) {
                    const options = Array.from(menu.querySelectorAll(CONFIG.SELECTORS.OPTIONS))
                        .map(o => o.innerText.trim())
                        .filter(Boolean);
                    if (options.length > 0) return options;
                }
            }

            // 3. Look for data attributes or common patterns in Meesho's custom dropdowns
            const parent = el.closest('.MuiFormControl-root');
            if (parent) {
                // Some Meesho fields have helper text or descriptions that might list options, 
                // but usually they are in a separate portal.
            }

            return [];
        } catch (e) {
            return [];
        }
    }

    getLabel(el) {
        // 1. Label tag
        if (el.id) {
            const l = document.querySelector(`label[for="${el.id}"]`);
            if (l) return l.innerText.trim();
        }
        
        // 2. Parent-based search
        let parent = el.parentElement;
        for (let i = 0; i < 3; i++) {
            if (!parent) break;
            const textEl = parent.querySelector('span, p, label, h6');
            if (textEl && textEl.innerText.trim().length > CONFIG.MIN_LABEL_LENGTH) {
                return textEl.innerText.trim();
            }
            parent = parent.parentElement;
        }

        return el.placeholder || el.getAttribute('aria-label') || '';
    }

    detectType(el) {
        if (el.tagName === 'TEXTAREA') return 'textarea';
        const role = el.getAttribute('role');
        const ariaPopup = el.getAttribute('aria-haspopup');
        const className = el.className || '';
        
        if (role === 'combobox' || ariaPopup === 'true' || ariaPopup === 'listbox' || 
            className.includes('Select-select') || className.includes('dropdown')) {
            return 'dropdown';
        }
        
        if (el.type === 'number' || el.inputMode === 'numeric') return 'number';
        
        return 'text';
    }

    checkRequired(el) {
        if (el.required || el.getAttribute('aria-required') === 'true') return true;
        const container = el.closest('div');
        return container ? container.innerText.includes('*') : false;
    }

    generateSelector(el) {
        if (el.id) return `#${CSS.escape(el.id)}`;
        if (el.name) return `[name="${CSS.escape(el.name)}"]`;
        
        // Class-based fallback (filtering out MUI dynamic classes)
        const classes = Array.from(el.classList)
            .filter(c => !c.includes('Mui') && !c.includes('css-'))
            .map(c => `.${CSS.escape(c)}`)
            .join('');
        
        if (classes) return `${el.tagName.toLowerCase()}${classes}`;
        
        // Path fallback
        return this.getPathSelector(el);
    }

    getPathSelector(el) {
        const path = [];
        let curr = el;
        while (curr && curr.nodeType === Node.ELEMENT_NODE && path.length < 5) {
            let selector = curr.nodeName.toLowerCase();
            const index = Array.from(curr.parentNode.children).indexOf(curr) + 1;
            selector += `:nth-child(${index})`;
            path.unshift(selector);
            curr = curr.parentNode;
        }
        return path.join(' > ');
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
