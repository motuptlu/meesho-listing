console.log('✅ Meesho Auto Lister: Content Script Loaded');

// --- Global State & Listeners ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Content script received:', message.action);
    
    if (message.action === 'SCRAPE_FORM') {
        (async () => {
            try {
                showPageIndicator('Scanning form fields...');
                const result = await collectAllFields();
                showPageSuccess(`Found ${result.totalFields} fields!`);
                sendResponse(result);
            } catch (err) {
                hidePageIndicator();
                console.error('Scrape error:', err);
                sendResponse({ success: false, error: err.message, fields: [] });
            }
        })();
        return true; // Keep channel open for async
    }
    
    if (message.action === 'FILL_FORM') {
        (async () => {
            try {
                showPageIndicator('Filling form...');
                const report = await fillAllDetectedFields(
                    message.data, message.fields, message.images
                );
                showPageSuccess(`Filled ${report.filled}/${report.totalFields} fields!`);
                sendResponse({ success: true, report });
            } catch (err) {
                hidePageIndicator();
                console.error('Fill error:', err);
                sendResponse({ 
                    success: false, error: err.message, 
                    filled: 0, failed: 0, totalFields: 0, details: [] 
                });
            }
        })();
        return true;
    }
    
    if (message.action === 'CHECK_PAGE') {
        sendResponse({ 
            connected: true, 
            url: window.location.href,
            isListingPage: window.location.href.includes('supplier.meesho.com')
        });
        return true;
    }
});

// --- Master Field Collection ---

async function collectAllFields() {
    const fields = [];
    const processedLabels = new Set();
    
    // Scroll to load lazy content
    await autoScroll();
    
    // Find all potential field containers
    const containers = findFieldContainers();
    console.log(`Found ${containers.length} potential containers`);
    
    for (const container of containers) {
        try {
            const interactiveEl = findInteractiveElement(container);
            if (!interactiveEl) continue;
            
            const label = getSmartLabel(interactiveEl, container);
            if (!label || label === 'Unknown Field' || processedLabels.has(label.toLowerCase())) continue;
            
            const type = detectFieldType(interactiveEl, container);
            const required = isRequired(container, interactiveEl);
            const selector = generateSelector(interactiveEl);
            
            let options = null;
            let optionLabels = null;
            
            if (type === 'dropdown') {
                updatePageIndicator(`Extracting: ${label}...`);
                options = await extractDropdownOptions(interactiveEl, label);
                optionLabels = options.map(o => o.label);
                await sleep(400);
            } else if (type === 'multi_chip') {
                options = await extractChipOptions(container);
                optionLabels = options.map(o => o.label);
            } else if (type === 'radio') {
                options = extractRadioOptions(container);
                optionLabels = options.map(o => o.label);
            }
            
            fields.push({
                fieldId: 'field_' + fields.length + '_' + Date.now(),
                label: label,
                type: type,
                required: required,
                placeholder: interactiveEl.placeholder || interactiveEl.getAttribute('placeholder') || '',
                currentValue: interactiveEl.value || interactiveEl.textContent?.trim() || '',
                selector: selector,
                options: options,
                optionLabels: optionLabels,
                optionCount: options ? options.length : 0
            });
            
            processedLabels.add(label.toLowerCase());
            console.log(`Scanned: ${label} (${type})`);
        } catch (err) {
            console.warn('Field processing error:', err);
        }
    }
    
    // Sort by vertical position
    fields.sort((a, b) => {
        const elA = document.querySelector(a.selector);
        const elB = document.querySelector(b.selector);
        if (!elA || !elB) return 0;
        return elA.getBoundingClientRect().top - elB.getBoundingClientRect().top;
    });

    return {
        success: true,
        totalFields: fields.length,
        dropdownCount: fields.filter(f => f.type === 'dropdown').length,
        chipCount: fields.filter(f => f.type === 'multi_chip').length,
        requiredCount: fields.filter(f => f.required).length,
        fields: fields
    };
}

function findFieldContainers() {
    const containers = [];
    const allDivs = document.querySelectorAll('div');
    
    for (const div of allDivs) {
        // Skip very large containers or hidden ones
        const rect = div.getBoundingClientRect();
        if (rect.height < 15 || rect.height > 300 || rect.width < 50) continue;
        
        const hasInteractive = !!div.querySelector('input:not([type="hidden"]), textarea, select, [role="combobox"], [aria-haspopup="true"]');
        if (!hasInteractive) continue;
        
        // Check for label-like text
        const text = div.innerText || '';
        if (text.length > 2 && text.length < 500) {
            containers.push(div);
        }
    }
    
    // Filter to keep only innermost containers
    return containers.filter(c => {
        return !containers.some(other => c !== other && c.contains(other));
    });
}

function findInteractiveElement(container) {
    return container.querySelector('input:not([type="hidden"]), textarea, select, [role="combobox"], [aria-haspopup="true"]') || 
           container.querySelector('div[class*="select" i], div[class*="Select" i], [role="button"]');
}

// --- Smart Label Extraction ---

function getSmartLabel(element, container) {
    // 1. Check aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return cleanLabel(ariaLabel);
    
    // 2. Check linked label
    if (element.id) {
        const labelEl = document.querySelector(`label[for="${element.id}"]`);
        if (labelEl) return cleanLabel(labelEl.textContent);
    }
    
    // 3. Search in container for text elements before the input
    const textElements = container.querySelectorAll('span, label, p, div');
    for (const el of textElements) {
        if (el === element || element.contains(el)) continue;
        const text = el.innerText.trim();
        if (text.length > 2 && text.length < 50 && !/select|enter|optional/i.test(text)) {
            return cleanLabel(text);
        }
    }
    
    // 4. Check siblings of parent
    let parent = element.parentElement;
    for (let i = 0; i < 3; i++) {
        if (!parent) break;
        const prev = parent.previousElementSibling;
        if (prev) {
            const text = prev.innerText.trim();
            if (text.length > 2 && text.length < 60) return cleanLabel(text);
        }
        parent = parent.parentElement;
    }
    
    // 5. Placeholder
    if (element.placeholder) return cleanLabel(element.placeholder.replace(/^enter\s+/i, ''));
    
    return 'Unknown Field';
}

function cleanLabel(text) {
    if (!text) return '';
    // Remove *, (i) info icon text, extra spaces
    return text.replace(/\*/g, '')
               .replace(/\(i\)/g, '')
               .replace(/\s+/g, ' ')
               .replace(/optional/i, '')
               .trim();
}

// --- Field Type Detection ---

function detectFieldType(element, container) {
    const tagName = element.tagName;
    const typeAttr = element.getAttribute('type');
    const role = element.getAttribute('role');
    const ariaHasPopup = element.getAttribute('aria-haspopup');
    const className = (element.className || '').toString();
    
    if (tagName === 'TEXTAREA') return 'textarea';
    if (tagName === 'SELECT') return 'dropdown';
    
    if (tagName === 'INPUT') {
        if (typeAttr === 'number' || element.inputmode === 'numeric') return 'number_input';
        if (typeAttr === 'radio') return 'radio';
        if (typeAttr === 'checkbox') return 'checkbox';
        if (typeAttr === 'file') return 'file_upload';
        
        // Detect number by label context
        const label = getSmartLabel(element, container).toLowerCase();
        if (/weight|price|mrp|stock|quantity|pincode|gms|kg|cm/i.test(label)) return 'number_input';
        
        return 'text_input';
    }
    
    if (role === 'combobox' || role === 'listbox' || ariaHasPopup === 'true' || ariaHasPopup === 'listbox' || /select|dropdown/i.test(className)) {
        return 'dropdown';
    }
    
    if (container.querySelector('input[type="radio"]')) return 'radio';
    if (/chip|tag/i.test(className) || container.querySelector('[class*="chip" i]')) return 'multi_chip';
    
    return 'text_input';
}

function isRequired(container, element) {
    if (element.required || element.getAttribute('aria-required') === 'true') return true;
    if (container.innerText.includes('*')) return true;
    return false;
}

// --- Dropdown Options Extraction ---

async function extractDropdownOptions(element, label) {
    const options = [];
    const trigger = element.querySelector('[role="button"], button, [class*="indicator" i]') || element;
    
    try {
        element.scrollIntoView({ behavior: 'instant', block: 'center' });
        await sleep(300);
        
        trigger.click();
        await sleep(1000); // Wait for menu
        
        const menuSelectors = [
            '[role="listbox"]', '.MuiMenu-paper', '.MuiList-root', 
            '[class*="menu" i]:not(nav)', '[class*="Options" i]', 'div[class*="portal" i]'
        ];
        
        let menu = null;
        for (const sel of menuSelectors) {
            const found = document.querySelectorAll(sel);
            for (const f of found) {
                const r = f.getBoundingClientRect();
                if (r.height > 10) { menu = f; break; }
            }
            if (menu) break;
        }
        
        if (menu) {
            const items = menu.querySelectorAll('[role="option"], .MuiMenuItem-root, li, [class*="option" i]');
            items.forEach(item => {
                const text = item.innerText.trim();
                if (text && text.length < 100 && !/select/i.test(text)) {
                    if (!options.find(o => o.label === text)) {
                        options.push({ value: item.getAttribute('data-value') || text, label: text });
                    }
                }
            });
        }
        
        // Close
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        await sleep(300);
        document.body.click();
        await sleep(300);
        
    } catch (err) {
        console.warn(`Dropdown error for ${label}:`, err);
    }
    return options;
}

async function extractChipOptions(container) {
    const options = [];
    const chips = container.querySelectorAll('.MuiChip-root, [class*="chip" i], [role="button"]');
    chips.forEach(c => {
        const text = c.innerText.replace(/[×x✕]/g, '').trim();
        if (text) options.push({ value: text, label: text });
    });
    return options;
}

function extractRadioOptions(container) {
    const options = [];
    const labels = container.querySelectorAll('label, .MuiFormControlLabel-root');
    labels.forEach(l => {
        const text = l.innerText.trim();
        if (text) options.push({ value: text, label: text });
    });
    return options;
}

// --- Selector Generation ---

function generateSelector(element) {
    if (element.id) return '#' + CSS.escape(element.id);
    if (element.name) return `[name="${element.name}"]`;
    
    const testId = element.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;
    
    // Build path
    const path = [];
    let curr = element;
    while (curr && curr !== document.body) {
        let sel = curr.tagName.toLowerCase();
        if (curr.className && typeof curr.className === 'string') {
            const cls = curr.className.split(/\s+/).filter(c => c.length > 0 && !/Mui|active|focus/i.test(c)).slice(0, 1);
            if (cls.length) sel += '.' + CSS.escape(cls[0]);
        }
        path.unshift(sel);
        curr = curr.parentElement;
        if (path.length > 5) break;
    }
    return path.join(' > ');
}

// --- Form Filling Logic ---

async function fillAllDetectedFields(results, fields, images) {
    const report = { totalFields: fields.length, filled: 0, failed: 0, skipped: 0, details: [] };
    
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const value = results[field.label];
        
        if (value === undefined || value === null || value === '') {
            report.skipped++;
            continue;
        }
        
        updatePageIndicator(`Filling: ${field.label}...`);
        chrome.runtime.sendMessage({ action: 'FILL_PROGRESS', current: i + 1, total: fields.length, fieldName: field.label });
        
        try {
            let success = false;
            if (field.type === 'dropdown') success = await fillDropdown(field.selector, value);
            else if (field.type === 'multi_chip') success = await fillMultiChips(field.selector, value);
            else if (field.type === 'textarea') success = await fillTextarea(field.selector, value);
            else if (field.type === 'number_input') success = await fillNumberInput(field.selector, value);
            else success = await fillTextInput(field.selector, value);
            
            if (success) {
                report.filled++;
                report.details.push({ label: field.label, status: 'filled', value });
            } else {
                report.failed++;
                report.details.push({ label: field.label, status: 'failed', reason: 'Element not found' });
            }
        } catch (err) {
            report.failed++;
            report.details.push({ label: field.label, status: 'error', reason: err.message });
        }
        await sleep(400);
    }
    
    if (images && images.length > 0) {
        updatePageIndicator('Uploading images...');
        await uploadImages(images);
    }
    
    return report;
}

async function fillTextInput(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

async function fillNumberInput(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);
    const num = parseFloat(String(value).replace(/[^0-9.]/g, ''));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, isNaN(num) ? '' : String(num));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

async function fillTextarea(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

async function fillDropdown(selector, value) {
    const trigger = document.querySelector(selector);
    if (!trigger) return false;
    trigger.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(300);
    trigger.click();
    await sleep(1000);
    
    const valueStr = String(value).toLowerCase().trim();
    const options = document.querySelectorAll('[role="option"], li, .MuiMenuItem-root');
    for (const opt of options) {
        const text = opt.innerText.trim().toLowerCase();
        if (text === valueStr || text.includes(valueStr) || valueStr.includes(text)) {
            opt.click();
            return true;
        }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    return false;
}

async function fillMultiChips(selector, values) {
    const container = document.querySelector(selector);
    if (!container) return false;
    const vals = Array.isArray(values) ? values : [values];
    let any = false;
    for (const v of vals) {
        const vStr = String(v).toLowerCase().trim();
        const chips = container.querySelectorAll('.MuiChip-root, [class*="chip" i], [role="button"]');
        for (const chip of chips) {
            const text = chip.innerText.replace(/[×x✕]/g, '').trim().toLowerCase();
            if (text === vStr || text.includes(vStr)) {
                chip.click();
                any = true;
                await sleep(200);
                break;
            }
        }
    }
    return any;
}

async function uploadImages(base64Images) {
    const input = document.querySelector('input[type="file"]');
    if (!input) return false;
    const dt = new DataTransfer();
    for (let i = 0; i < base64Images.length; i++) {
        const res = await fetch(base64Images[i]);
        const blob = await res.blob();
        dt.items.add(new File([blob], `product-${i}.jpg`, { type: 'image/jpeg' }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

// --- Helpers ---

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function autoScroll() {
    const h = document.documentElement.scrollHeight;
    for (let i = 0; i < h; i += 500) {
        window.scrollTo(0, i);
        await sleep(150);
    }
    window.scrollTo(0, 0);
    await sleep(300);
}

function showPageIndicator(text) {
    let el = document.getElementById('malIndicator');
    if (!el) {
        el = document.createElement('div');
        el.id = 'malIndicator';
        document.body.appendChild(el);
    }
    el.style.display = 'flex';
    el.innerHTML = `<div class="mal-spinner"></div><span>${text}</span>`;
}

function updatePageIndicator(text) {
    const el = document.getElementById('malIndicator');
    if (el) el.querySelector('span').innerText = text;
}

function showPageSuccess(text) {
    const el = document.getElementById('malIndicator');
    if (el) {
        el.innerHTML = `<span>✅ ${text}</span>`;
        setTimeout(() => el.style.display = 'none', 3000);
    }
}

function hidePageIndicator() {
    const el = document.getElementById('malIndicator');
    if (el) el.style.display = 'none';
}
