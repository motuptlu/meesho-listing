/**
 * MEESHO AUTO LISTER - ENTERPRISE AUTOMATION ENGINE
 * High-Reliability DOM Automation for React/MUI/Portal Environments
 */

console.log('%c🚀 Meesho Enterprise Automation Engine Active', 'color: #9C27B0; font-weight: bold; font-size: 14px;');

// --- GLOBAL CONFIGURATION ---
const ENGINE_CONFIG = {
    RETRY_ATTEMPTS: 3,
    POPUP_WAIT: 1000,
    INTERACTION_DELAY: 400,
    FUZZY_THRESHOLD: 0.7
};

// --- MESSAGE ROUTING ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SCRAPE_FORM') {
        executeScrape(sendResponse);
        return true;
    }
    if (message.action === 'FILL_FORM') {
        executeFill(message.data, message.fields, message.images, sendResponse);
        return true;
    }
});

// --- CORE HANDLERS ---

async function executeScrape(sendResponse) {
    try {
        showStatus('🔍 Intelligent Scan in Progress...');
        await autoScroll();
        const scanner = new MeeshoScanner();
        const fields = await scanner.performDeepScan();
        showStatus(`✅ Found ${fields.length} fields`, 'success');
        sendResponse({ success: true, totalFields: fields.length, fields });
    } catch (err) {
        console.error('[Engine] Scrape Error:', err);
        hideStatus();
        sendResponse({ success: false, error: err.message });
    }
}

async function executeFill(data, fields, images, sendResponse) {
    try {
        const engine = new MeeshoAutomationEngine();
        const report = await engine.run(data, fields, images);
        sendResponse({ success: true, report });
    } catch (err) {
        console.error('[Engine] Fill Error:', err);
        hideStatus();
        sendResponse({ success: false, error: err.message });
    }
}

// --- AUTOMATION ENGINE ---

class MeeshoAutomationEngine {
    constructor() {
        this.report = { totalFields: 0, filled: 0, failed: 0, details: [] };
    }

    async run(aiData, fieldDefs, images) {
        this.report.totalFields = fieldDefs.length;
        
        for (let i = 0; i < fieldDefs.length; i++) {
            const field = fieldDefs[i];
            const targetValue = aiData[field.label];

            if (targetValue === undefined || targetValue === null || targetValue === '') continue;

            updateStatus(`🤖 Filling: ${field.label}...`);
            chrome.runtime.sendMessage({ 
                action: 'FILL_PROGRESS', 
                current: i + 1, 
                total: fieldDefs.length, 
                fieldName: field.label 
            });

            const success = await this.retryOperation(async () => {
                return await this.processField(field, targetValue);
            }, ENGINE_CONFIG.RETRY_ATTEMPTS);

            if (success) {
                this.report.filled++;
                this.report.details.push({ label: field.label, status: 'filled', value: targetValue });
            } else {
                this.report.failed++;
                this.report.details.push({ label: field.label, status: 'failed', reason: 'Automation failed after retries' });
            }
            await sleep(ENGINE_CONFIG.INTERACTION_DELAY);
        }

        if (images?.length) {
            updateStatus('📸 Uploading Assets...');
            await this.uploadImages(images);
        }

        hideStatus();
        return this.report;
    }

    async processField(field, value) {
        const el = this.resolveElement(field);
        if (!el) return false;

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);

        const type = this.identifyType(el);
        console.log(`[Engine] Automating [${type}] "${field.label}" -> "${value}"`);

        if (type === 'dropdown' || type === 'autocomplete') {
            return await this.fillDropdown(el, value, field.label);
        } else if (type === 'textarea') {
            return await this.fillText(el, value, 'textarea');
        } else if (type === 'number') {
            return await this.fillText(el, value, 'number');
        }
        return await this.fillText(el, value, 'input');
    }

    async fillDropdown(trigger, targetValue, label) {
        try {
            // 1. Click to trigger menu
            trigger.click();
            await sleep(800);

            // 2. Locate Menu (Search Body and Portals)
            let menu = this.findVisibleMenu();
            if (!menu) {
                // Try clicking children (SVG or Buttons)
                trigger.querySelector('svg, button, [role="button"]')?.click();
                await sleep(800);
                menu = this.findVisibleMenu();
            }

            if (!menu) {
                console.warn(`[Engine] Menu not found for ${label}`);
                return false;
            }

            // 3. Handle Searchable Inputs inside Dropdowns
            const searchInput = trigger.tagName === 'INPUT' ? trigger : menu.querySelector('input[type="text"]');
            if (searchInput && this.isElementVisible(searchInput)) {
                await this.fillText(searchInput, targetValue);
                await sleep(1000); // Wait for filtered results
            }

            // 4. Collect Options
            const options = Array.from(menu.querySelectorAll('[role="option"], li, [class*="option" i], [class*="MenuItem" i]'))
                .map(opt => ({ el: opt, text: opt.innerText.trim() }))
                .filter(o => o.text.length > 0);

            if (options.length === 0) {
                console.warn(`[Engine] No selectable options for ${label}`);
                return false;
            }

            // 5. Match & Click
            const match = this.findBestMatch(targetValue, options);
            if (match) {
                console.log(`[Engine] Match Found: "${match.text}"`);
                match.el.scrollIntoView({ block: 'nearest' });
                await sleep(100);
                match.el.click();
                await sleep(400);
                
                // Verification
                const currentText = trigger.innerText || trigger.value || '';
                if (currentText.toLowerCase().includes(match.text.toLowerCase())) return true;
                
                // Final fallback: click again
                match.el.click();
                return true;
            }

            // Close if no match
            document.body.click();
            return false;
        } catch (err) {
            console.error(`[Engine] Dropdown Error (${label}):`, err);
            return false;
        }
    }

    async fillText(el, value, type) {
        el.focus();
        await sleep(100);

        const setter = type === 'textarea' 
            ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
            : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        
        const cleanValue = type === 'number' ? value.toString().replace(/[^0-9.]/g, '') : value;
        
        setter.call(el, cleanValue);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        
        await sleep(100);
        el.blur();
        return true;
    }

    async uploadImages(images) {
        const input = document.querySelector('input[type="file"]');
        if (!input) return false;

        try {
            const dt = new DataTransfer();
            for (let i = 0; i < images.length; i++) {
                const res = await fetch(images[i]);
                const blob = await res.blob();
                dt.items.add(new File([blob], `image_${i}.jpg`, { type: 'image/jpeg' }));
            }
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        } catch (e) {
            console.error('[Engine] Upload Error:', e);
            return false;
        }
    }

    // --- LOGIC HELPERS ---

    resolveElement(field) {
        // Try precise selector
        let el = document.querySelector(field.selector);
        if (this.isElementVisible(el)) return el;

        // Semantic Search
        const candidates = Array.from(document.querySelectorAll('input, textarea, [role="combobox"], [aria-haspopup="true"]'));
        for (const c of candidates) {
            const label = this.getLabelFor(c);
            if (label.toLowerCase() === field.label.toLowerCase()) return c;
        }
        return null;
    }

    getLabelFor(el) {
        const container = el.closest('div');
        if (!container) return '';
        const texts = Array.from(container.querySelectorAll('span, p, label, div'))
            .filter(n => n.children.length === 0)
            .map(n => n.innerText.trim())
            .filter(t => t.length > 2 && t.length < 50 && !/select|enter/i.test(t));
        return texts[0] || el.placeholder || el.getAttribute('aria-label') || '';
    }

    identifyType(el) {
        if (el.tagName === 'TEXTAREA') return 'textarea';
        if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'true') return 'dropdown';
        if (el.getAttribute('type') === 'number') return 'number';
        return 'input';
    }

    findVisibleMenu() {
        const selectors = ['[role="listbox"]', '[role="menu"]', '.MuiMenu-paper', '[class*="menu" i]', '[class*="Popup" i]'];
        for (const s of selectors) {
            const menus = Array.from(document.querySelectorAll(s));
            const visible = menus.find(m => this.isElementVisible(m));
            if (visible) return visible;
        }
        return null;
    }

    findBestMatch(target, options) {
        const t = target.toLowerCase();
        return options.find(o => o.text.toLowerCase() === t) ||
               options.find(o => o.text.toLowerCase().includes(t) || t.includes(o.text.toLowerCase())) ||
               options[0];
    }

    async retryOperation(fn, retries) {
        for (let i = 0; i < retries; i++) {
            const result = await fn();
            if (result) return true;
            await sleep(1000);
        }
        return false;
    }

    isElementVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';
    }
}

// --- SCANNING ENGINE ---

class MeeshoScanner {
    async performDeepScan() {
        const fields = [];
        const containers = Array.from(document.querySelectorAll('div'))
            .filter(div => {
                const r = div.getBoundingClientRect();
                return r.height > 20 && r.height < 400 && div.querySelector('input, textarea, [role="combobox"]');
            })
            .filter(c => !Array.from(c.querySelectorAll('div')).some(child => child.querySelector('input, textarea')));

        for (const c of containers) {
            const input = c.querySelector('input, textarea, [role="combobox"], [aria-haspopup="true"]');
            if (!input) continue;

            const label = this.extractLabel(input, c);
            if (!label || label === 'Unknown') continue;

            fields.push({
                label,
                type: this.detectType(input),
                required: c.innerText.includes('*'),
                selector: this.getUniqueSelector(input),
                fieldId: `sc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
            });
        }
        return fields;
    }

    extractLabel(el, container) {
        const texts = Array.from(container.querySelectorAll('span, p, label, div'))
            .filter(n => n.children.length === 0)
            .map(n => n.innerText.trim())
            .filter(t => t.length > 2 && t.length < 60 && !/select|enter/i.test(t));
        return texts[0] || el.placeholder || el.getAttribute('aria-label') || 'Unknown';
    }

    detectType(el) {
        if (el.tagName === 'TEXTAREA') return 'textarea';
        if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'true') return 'dropdown';
        if (el.getAttribute('type') === 'number') return 'number';
        return 'input';
    }

    getUniqueSelector(el) {
        if (el.id) return `#${CSS.escape(el.id)}`;
        if (el.name) return `[name="${CSS.escape(el.name)}"]`;
        const testId = el.getAttribute('data-testid');
        if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
        
        let path = el.tagName.toLowerCase();
        if (el.className && typeof el.className === 'string') {
            const cls = el.className.split(/\s+/).filter(c => c.length > 0 && !/Mui|active/i.test(c)).slice(0, 1);
            if (cls.length) path += `.${CSS.escape(cls[0])}`;
        }
        return path;
    }
}

// --- UTILITIES ---

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function autoScroll() {
    const h = document.documentElement.scrollHeight;
    for (let i = 0; i < h; i += 500) {
        window.scrollTo(0, i);
        await sleep(150);
    }
    window.scrollTo(0, 0);
    await sleep(400);
}

function showStatus(text, type = '') {
    let el = document.getElementById('mal-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'mal-toast';
        el.style.cssText = `position:fixed;bottom:24px;right:24px;background:#9C27B0;color:white;padding:12px 24px;border-radius:40px;z-index:999999;font-family:sans-serif;box-shadow:0 8px 30px rgba(0,0,0,0.3);display:flex;align-items:center;gap:12px;font-size:14px;font-weight:500;transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1);`;
        document.body.appendChild(el);
    }
    el.style.background = type === 'success' ? '#4CAF50' : '#9C27B0';
    el.innerHTML = `<div style="width:16px;height:16px;border:2.5px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:mal-spin 0.8s linear infinite;"></div><span>${text}</span>`;
    
    if (!document.getElementById('mal-key')) {
        const s = document.createElement('style');
        s.id = 'mal-key';
        s.textContent = `@keyframes mal-spin { to { transform: rotate(360deg); } }`;
        document.head.appendChild(s);
    }
}

function updateStatus(text) {
    const el = document.getElementById('mal-toast');
    if (el) el.querySelector('span').innerText = text;
}

function hideStatus() {
    const el = document.getElementById('mal-toast');
    if (el) setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}
