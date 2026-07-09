console.log('Meesho Auto Lister: Content Script Loaded');

// --- Global State & Listeners ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'SCRAPE_FORM') {
        extractAllFormFields()
            .then(result => {
                sendResponse(result);
            })
            .catch(error => {
                console.error('Scrape Form Error:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }
    
    if (request.action === 'FILL_FORM') {
        fillAllDetectedFields(request.data, request.fields, request.images)
            .then(result => {
                sendResponse({ success: true, report: result });
            })
            .catch(error => {
                console.error('Fill Form Error:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }
});

// --- Field Extraction Logic ---

async function extractAllFormFields() {
    console.log('Starting field extraction...');
    const allFields = [];
    const processedElements = new Set();
    
    showPageIndicator('Scanning form fields...');
    
    try {
        // Scroll through page to ensure all fields are loaded
        await scrollToBottom();
        await sleep(500);
        scrollToTop();
        await sleep(500);
        
        const fieldElements = collectAllFieldElements();
        console.log('Found potential field elements:', fieldElements.length);
        
        let processedCount = 0;
        for (const element of fieldElements) {
            // Skip if already processed based on a simple heuristic
            const rect = element.getBoundingClientRect();
            const key = `${element.tagName}_${rect.top}_${rect.left}_${element.name || ''}`;
            if (processedElements.has(key)) continue;
            processedElements.add(key);
            
            // Skip hidden elements
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            
            const label = getFieldLabel(element);
            if (!label || label === 'Unknown Field') continue;
            
            const type = detectFieldType(element);
            const required = isFieldRequired(element);
            const placeholder = element.placeholder || element.getAttribute('placeholder') || '';
            const currentValue = element.value || '';
            const selector = generateUniqueSelector(element);
            
            let options = null;
            let optionsExtracted = false;
            
            // Extract options based on type
            if (type === 'dropdown') {
                updatePageIndicator(`Extracting options for: ${label}`);
                options = await extractDropdownOptions(element);
                optionsExtracted = options && options.length > 0;
                await sleep(300);
            } else if (type === 'multi_chip') {
                updatePageIndicator(`Extracting chips for: ${label}`);
                options = await extractChipOptions(element);
                optionsExtracted = options && options.length > 0;
                await sleep(300);
            } else if (type === 'radio') {
                options = extractRadioOptions(element);
                optionsExtracted = options && options.length > 0;
            }
            
            const fieldData = {
                fieldId: 'field_' + Date.now() + '_' + processedCount,
                label: label,
                type: type,
                required: required,
                placeholder: placeholder,
                currentValue: currentValue,
                selector: selector,
                options: options,
                optionsExtracted: optionsExtracted,
                optionLabels: options ? options.map(o => o.label) : null
            };
            
            allFields.push(fieldData);
            processedCount++;
            
            console.log('Extracted field:', label, '| Type:', type, '| Options:', options ? options.length : 0);
        }
        
        // Add image upload field if present
        const fileInputs = document.querySelectorAll('input[type="file"]');
        if (fileInputs.length > 0) {
            allFields.push({
                fieldId: 'field_file_upload',
                label: 'Product Images',
                type: 'file',
                required: true,
                selector: 'input[type="file"]',
                options: null,
                optionsExtracted: false
            });
        }
        
        hidePageIndicator();
        
        return {
            success: true,
            pageUrl: window.location.href,
            totalFields: allFields.length,
            fields: allFields
        };
        
    } catch (error) {
        hidePageIndicator();
        console.error('Extraction error:', error);
        return {
            success: false,
            error: error.message,
            fields: allFields
        };
    }
}

function collectAllFieldElements() {
    const selectors = [
        '.MuiFormControl-root',
        '[class*="FormControl"]',
        'input:not([type="hidden"]):not([type="file"])',
        'textarea',
        '[role="combobox"]',
        '[role="listbox"]',
        '[aria-haspopup="listbox"]',
        '[aria-haspopup="true"]',
        '.MuiSelect-root',
        '[class*="Select__control"]',
        '[class*="dropdown"]',
        '[class*="Dropdown"]',
        '[role="group"]',
        '[class*="chip" i]',
        '[role="radiogroup"]',
        '.MuiRadioGroup-root'
    ];
    
    const elements = [];
    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            if (!elements.includes(el)) elements.push(el);
        });
    });
    
    return elements;
}

function getFieldLabel(element) {
    // 1. Check aria-label
    if (element.getAttribute('aria-label')) return cleanLabel(element.getAttribute('aria-label'));
    
    // 2. Check linked label
    if (element.id) {
        const labelEl = document.querySelector(`label[for="${element.id}"]`);
        if (labelEl) return cleanLabel(labelEl.textContent);
    }
    
    // 3. Search parents/siblings
    let current = element;
    for (let i = 0; i < 5; i++) {
        if (!current) break;
        
        // Check MUI labels
        const muiLabel = current.querySelector('.MuiInputLabel-root, .MuiFormLabel-root, [class*="label"], [class*="Label"]');
        if (muiLabel && muiLabel !== element) return cleanLabel(muiLabel.textContent);
        
        // Check sibling labels
        const sib = current.previousElementSibling;
        if (sib && (sib.tagName === 'LABEL' || sib.classList.contains('label') || /label/i.test(sib.className))) {
            return cleanLabel(sib.textContent);
        }
        
        current = current.parentElement;
    }
    
    // 4. Placeholder as fallback
    if (element.placeholder) return cleanLabel(element.placeholder);
    
    return 'Unknown Field';
}

function cleanLabel(text) {
    if (!text) return '';
    return text.replace(/\*/g, '').replace(/(\r\n|\n|\r)/gm, " ").trim();
}

function detectFieldType(element) {
    const tagName = element.tagName;
    const typeAttr = element.getAttribute('type');
    const role = element.getAttribute('role');
    const className = element.className || '';
    
    if (tagName === 'TEXTAREA') return 'textarea';
    if (tagName === 'INPUT') {
        if (typeAttr === 'number' || element.inputmode === 'numeric') return 'number_input';
        if (typeAttr === 'radio') return 'radio';
        if (typeAttr === 'checkbox') return 'checkbox';
        if (typeAttr === 'file') return 'file';
        return 'text_input';
    }
    
    if (role === 'combobox' || role === 'listbox' || element.getAttribute('aria-haspopup') === 'true' || /select|dropdown/i.test(className)) {
        return 'dropdown';
    }
    
    if (role === 'radiogroup' || /RadioGroup/i.test(className)) return 'radio';
    
    if (/chip|tag/i.test(className) || element.querySelector('[class*="chip" i]')) return 'multi_chip';
    
    return 'text_input';
}

function isFieldRequired(element) {
    if (element.required) return true;
    if (element.getAttribute('aria-required') === 'true') return true;
    
    // Check for asterisk in label
    const label = getFieldLabel(element);
    // Note: getFieldLabel currently strips asterisks, but we could check the raw text here if needed.
    // For now, let's look at the label element again.
    let current = element;
    for (let i = 0; i < 3; i++) {
        if (!current) break;
        if (current.textContent.includes('*')) return true;
        current = current.parentElement;
    }
    
    return false;
}

async function extractDropdownOptions(element) {
    const options = [];
    try {
        if (element.tagName === 'SELECT') {
            Array.from(element.options).forEach(opt => {
                if (opt.value && opt.text && !/select/i.test(opt.text)) {
                    options.push({ value: opt.value, label: opt.text.trim() });
                }
            });
            return options;
        }
        
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        element.click();
        await sleep(800);
        
        // Find opened menu
        const menuSelectors = ['[role="listbox"]', '.MuiMenu-list', '.MuiList-root', '[class*="menu"]', '[class*="Menu"]'];
        let menuElement = null;
        for (const sel of menuSelectors) {
            menuElement = document.querySelector(sel);
            if (menuElement) break;
        }
        
        if (menuElement) {
            const optionSelectors = ['[role="option"]', 'li[class*="MuiMenuItem"]', 'li', 'div[class*="option"]'];
            let optionElements = [];
            for (const sel of optionSelectors) {
                optionElements = menuElement.querySelectorAll(sel);
                if (optionElements.length > 0) break;
            }
            
            optionElements.forEach(opt => {
                const text = opt.textContent.trim();
                if (text && text.length < 100) {
                    options.push({ value: opt.getAttribute('data-value') || text, label: text });
                }
            });
        }
        
        // Close
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        await sleep(300);
        document.body.click();
        await sleep(300);
        
    } catch (err) {
        console.warn('Dropdown extraction error:', err);
    }
    return options;
}

async function extractChipOptions(container) {
    const options = [];
    try {
        const chipSelectors = ['.MuiChip-root', '[class*="chip"]', '[class*="Chip"]', '[role="button"]'];
        let chips = [];
        for (const sel of chipSelectors) {
            chips = container.querySelectorAll(sel);
            if (chips.length > 1) break;
        }
        
        if (chips.length === 0) {
            container.click();
            await sleep(600);
            for (const sel of chipSelectors) {
                chips = document.querySelectorAll(sel);
                if (chips.length > 1) break;
            }
        }
        
        chips.forEach(chip => {
            const text = chip.textContent.replace(/[×x✕]/g, '').trim();
            if (text && text.length < 50) {
                options.push({ value: text, label: text });
            }
        });
        
        document.body.click();
    } catch (err) {
        console.warn('Chip extraction error:', err);
    }
    return options;
}

function extractRadioOptions(group) {
    const options = [];
    try {
        const labels = group.querySelectorAll('label, .MuiFormControlLabel-root');
        labels.forEach(l => {
            const text = l.textContent.trim();
            if (text) options.push({ value: text, label: text });
        });
    } catch (err) {
        console.warn('Radio extraction error:', err);
    }
    return options;
}

function generateUniqueSelector(element) {
    if (element.id) return `#${element.id}`;
    if (element.name) return `${element.tagName.toLowerCase()}[name="${element.name}"]`;
    
    const testId = element.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;
    
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return `[aria-label="${ariaLabel}"]`;
    
    // Path based
    let path = element.tagName.toLowerCase();
    if (element.className) {
        const classes = Array.from(element.classList).filter(c => !/Mui|active|hover|focus/i.test(c)).join('.');
        if (classes) path += `.${classes}`;
    }
    
    return path;
}

// --- Form Filling Logic ---

async function fillAllDetectedFields(fieldResults, fields, images) {
    const report = {
        totalFields: fields.length,
        filled: 0,
        failed: 0,
        skipped: 0,
        details: []
    };
    
    showPageIndicator('Starting to fill form...');
    
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const value = fieldResults[field.label];
        
        if (value === undefined || value === null || value === '') {
            report.skipped++;
            report.details.push({ label: field.label, status: 'skipped', reason: 'No value from AI' });
            continue;
        }
        
        updatePageIndicator(`Filling: ${field.label} (${i+1}/${fields.length})`);
        
        chrome.runtime.sendMessage({
            action: 'FILL_PROGRESS',
            current: i + 1,
            total: fields.length,
            fieldName: field.label
        });
        
        try {
            let success = false;
            const selector = field.selector;
            
            if (field.type === 'text_input') success = await fillTextInput(selector, value, field.label);
            else if (field.type === 'number_input') success = await fillNumberInput(selector, value, field.label);
            else if (field.type === 'textarea') success = await fillTextarea(selector, value, field.label);
            else if (field.type === 'dropdown') success = await fillDropdown(selector, value);
            else if (field.type === 'multi_chip') success = await fillMultiChips(selector, value);
            else if (field.type === 'radio') success = await fillRadio(selector, value);
            else if (field.type === 'checkbox') success = await fillCheckbox(selector, value);
            else if (field.type === 'file') success = await uploadImagesToPage(images);
            
            await sleep(300);
            
            if (success) {
                report.filled++;
                report.details.push({ label: field.label, status: 'filled', value: String(value).substring(0, 50) });
            } else {
                report.failed++;
                report.details.push({ label: field.label, status: 'failed', reason: 'Could not locate or fill field' });
            }
        } catch (err) {
            report.failed++;
            report.details.push({ label: field.label, status: 'error', reason: err.message });
        }
    }
    
    if (images && images.length > 0) {
        updatePageIndicator('Uploading product images...');
        await uploadImagesToPage(images);
    }
    
    hidePageIndicator();
    return report;
}

async function fillTextInput(selector, value, label) {
    let el = document.querySelector(selector);
    if (!el) el = findElementByLabelText(label, 'input');
    if (!el) return false;
    
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);
    el.focus();
    
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return true;
}

async function fillNumberInput(selector, value, label) {
    let el = document.querySelector(selector);
    if (!el) el = findElementByLabelText(label, 'input');
    if (!el) return false;
    
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);
    el.focus();
    
    const num = parseFloat(String(value).replace(/[^0-9.]/g, ''));
    if (isNaN(num)) return false;
    
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(num));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return true;
}

async function fillTextarea(selector, value, label) {
    let el = document.querySelector(selector);
    if (!el) el = findElementByLabelText(label, 'textarea');
    if (!el) return false;
    
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);
    el.focus();
    
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return true;
}

async function fillDropdown(selector, value) {
    const trigger = document.querySelector(selector);
    if (!trigger) return false;
    
    trigger.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(300);
    trigger.click();
    await sleep(800);
    
    const valueStr = String(value).toLowerCase().trim();
    const options = document.querySelectorAll('[role="option"], li, .MuiMenuItem-root');
    
    for (const opt of options) {
        const text = opt.textContent.trim().toLowerCase();
        if (text === valueStr || text.includes(valueStr) || valueStr.includes(text)) {
            opt.click();
            await sleep(300);
            return true;
        }
    }
    
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    return false;
}

async function fillMultiChips(selector, values) {
    const container = document.querySelector(selector);
    const vals = Array.isArray(values) ? values : [values];
    let any = false;
    
    for (const v of vals) {
        const vStr = String(v).toLowerCase().trim();
        const chips = (container || document).querySelectorAll('.MuiChip-root, [class*="chip"], [role="button"]');
        for (const chip of chips) {
            const text = chip.textContent.replace(/[×x✕]/g, '').trim().toLowerCase();
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

async function fillRadio(selector, value) {
    const container = document.querySelector(selector);
    if (!container) return false;
    const vStr = String(value).toLowerCase().trim();
    const labels = container.querySelectorAll('label, .MuiFormControlLabel-root');
    for (const l of labels) {
        if (l.textContent.toLowerCase().includes(vStr)) {
            l.click();
            return true;
        }
    }
    return false;
}

async function fillCheckbox(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return false;
    const should = value === true || value === 'true';
    if (el.checked !== should) el.click();
    return true;
}

async function uploadImagesToPage(base64Images) {
    const input = document.querySelector('input[type="file"]');
    if (!input) return false;
    const dt = new DataTransfer();
    for (let i = 0; i < base64Images.length; i++) {
        const res = await fetch(base64Images[i]);
        const blob = await res.blob();
        dt.items.add(new File([blob], `image-${i}.jpg`, { type: 'image/jpeg' }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

function findElementByLabelText(text, tag) {
    const labels = document.querySelectorAll('label, .MuiInputLabel-root, .MuiFormLabel-root');
    for (const l of labels) {
        if (l.textContent.toLowerCase().includes(text.toLowerCase())) {
            if (l.htmlFor) return document.getElementById(l.htmlFor);
            return l.parentElement.querySelector(tag) || l.parentElement.parentElement.querySelector(tag);
        }
    }
    return null;
}

// --- Utilities ---

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function scrollToBottom() {
    const h = document.body.scrollHeight;
    window.scrollTo({ top: h, behavior: 'smooth' });
}

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showPageIndicator(text) {
    let ind = document.getElementById('meeshoAutoListerIndicator');
    if (!ind) {
        ind = document.createElement('div');
        ind.id = 'meeshoAutoListerIndicator';
        document.body.appendChild(ind);
    }
    ind.className = '';
    ind.innerHTML = `<div class="mal-spinner"></div><span>${text}</span>`;
    ind.style.display = 'flex';
}

function updatePageIndicator(text) {
    const ind = document.getElementById('meeshoAutoListerIndicator');
    if (ind) ind.querySelector('span').innerText = text;
}

function hidePageIndicator() {
    const ind = document.getElementById('meeshoAutoListerIndicator');
    if (ind) ind.style.display = 'none';
}
