/**
 * MEESHO AUTO LISTER - ADVANCED SCANNING & FILLING ENGINE
 */

console.log('🛍️ Meesho Automation Engine: Advanced Mode Active');

// --- MESSAGE LISTENER ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SCRAPE_FORM') {
        runSmartScan(sendResponse);
        return true;
    }
    if (message.action === 'FILL_FORM') {
        runSmartFill(message.data, message.fields, message.images, sendResponse);
        return true;
    }
});

// --- SCANNING LOGIC ---

async function runSmartScan(sendResponse) {
    try {
        showStatus('Scanning Meesho Page...');
        await autoScroll();
        
        const fields = [];
        const processedLabels = new Set();
        
        // Find field containers
        const containers = findFieldContainers();
        
        for (const container of containers) {
            const input = findInteractiveElement(container);
            if (!input) continue;

            const label = getSmartLabel(input, container);
            if (!label || label === 'Unknown Field' || processedLabels.has(label.toLowerCase())) continue;
            
            const type = detectFieldType(input);
            const selector = generateSelector(input);
            
            let options = null;
            
            // CRITICAL: Extract options for dropdowns during scan
            if (type === 'dropdown') {
                updateStatus(`Extracting options: ${label}...`);
                options = await extractOptions(input, label);
                await sleep(300);
            }

            fields.push({
                label,
                type,
                required: container.innerText.includes('*'),
                selector,
                options: options || [],
                optionLabels: options ? options.map(o => o.label) : [],
                fieldId: `f_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
            });
            
            processedLabels.add(label.toLowerCase());
        }

        hideStatus();
        sendResponse({ 
            success: true, 
            totalFields: fields.length, 
            fields,
            dropdownCount: fields.filter(f => f.type === 'dropdown').length
        });
    } catch (err) {
        console.error('Scan Error:', err);
        hideStatus();
        sendResponse({ success: false, error: err.message });
    }
}

// --- DROPDOWN OPTION EXTRACTION ---

async function extractOptions(el, label) {
    const options = [];
    try {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        await sleep(200);
        
        // Click to open
        el.click();
        await sleep(800);

        // Find Menu
        const menu = findVisibleMenu();
        if (menu) {
            const items = menu.querySelectorAll('[role="option"], li, [class*="option" i]');
            items.forEach(item => {
                const text = item.innerText.trim();
                if (text && text.length < 100 && !/select/i.test(text)) {
                    if (!options.find(o => o.label === text)) {
                        options.push({ value: text, label: text });
                    }
                }
            });
        }

        // Close
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        document.body.click();
        await sleep(200);
    } catch (e) {
        console.warn(`Option extraction failed for ${label}`, e);
    }
    return options;
}

function findVisibleMenu() {
    const selectors = ['[role="listbox"]', '.MuiMenu-paper', '[class*="menu" i]', '[class*="popup" i]'];
    for (const s of selectors) {
        const menus = Array.from(document.querySelectorAll(s));
        const visible = menus.find(m => {
            const r = m.getBoundingClientRect();
            return r.height > 10 && r.width > 10;
        });
        if (visible) return visible;
    }
    return null;
}

// --- FILLING LOGIC ---

async function runSmartFill(data, fields, images, sendResponse) {
    const report = { totalFields: fields.length, filled: 0, failed: 0, details: [] };
    
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const val = data[field.label];
        if (!val) continue;

        updateStatus(`Filling: ${field.label}...`);
        chrome.runtime.sendMessage({ action: 'FILL_PROGRESS', current: i + 1, total: fields.length, fieldName: field.label });

        const el = document.querySelector(field.selector) || findFieldByLabel(field.label);
        if (!el) {
            report.failed++;
            continue;
        }

        try {
            let success = false;
            if (field.type === 'dropdown') {
                success = await fillDropdown(el, val, field.label);
            } else {
                success = await fillSimpleInput(el, val);
            }

            if (success) {
                report.filled++;
                report.details.push({ label: field.label, status: 'filled' });
            } else {
                report.failed++;
            }
        } catch (e) {
            report.failed++;
        }
        await sleep(300);
    }

    if (images?.length) await uploadImages(images);
    
    hideStatus();
    sendResponse({ success: true, report });
}

async function fillDropdown(el, targetValue, label) {
    el.click();
    await sleep(800);
    
    const menu = findVisibleMenu();
    if (!menu) return false;

    const options = Array.from(menu.querySelectorAll('[role="option"], li, [class*="option" i]'))
        .map(opt => ({ el: opt, text: opt.innerText.trim() }));

    const match = options.find(o => o.text.toLowerCase().includes(targetValue.toLowerCase()) || targetValue.toLowerCase().includes(o.text.toLowerCase()));
    
    if (match) {
        match.el.click();
        await sleep(300);
        return true;
    }
    
    document.body.click();
    return false;
}

async function fillSimpleInput(el, val) {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

async function uploadImages(images) {
    const input = document.querySelector('input[type="file"]');
    if (!input) return;
    const dt = new DataTransfer();
    for (const base64 of images) {
        const res = await fetch(base64);
        const blob = await res.blob();
        dt.items.add(new File([blob], 'prod.jpg', { type: 'image/jpeg' }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

// --- UTILS ---

function findFieldContainers() {
    return Array.from(document.querySelectorAll('div'))
        .filter(div => {
            const r = div.getBoundingClientRect();
            return r.height > 20 && r.height < 400 && div.querySelector('input, textarea, [role="combobox"], [aria-haspopup="true"]');
        })
        .filter(c => !Array.from(c.querySelectorAll('div')).some(child => child.querySelector('input, textarea')));
}

function findInteractiveElement(container) {
    return container.querySelector('input:not([type="hidden"]), textarea, [role="combobox"], [aria-haspopup="true"]');
}

function getSmartLabel(el, container) {
    const texts = Array.from(container.querySelectorAll('span, p, label, div'))
        .filter(n => n.children.length === 0)
        .map(n => n.innerText.trim())
        .filter(t => t.length > 2 && t.length < 50 && !/select|enter/i.test(t));
    return texts[0] || el.placeholder || 'Unknown Field';
}

function detectFieldType(el) {
    if (el.tagName === 'TEXTAREA') return 'textarea';
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'true') return 'dropdown';
    return 'input';
}

function generateSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `[name="${CSS.escape(el.name)}"]`;
    return el.tagName.toLowerCase();
}

function findFieldByLabel(label) {
    return Array.from(document.querySelectorAll('input, textarea, [role="combobox"]'))
        .find(el => el.placeholder?.includes(label) || el.getAttribute('aria-label')?.includes(label));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function autoScroll() {
    const h = document.documentElement.scrollHeight;
    for (let i = 0; i < h; i += 500) {
        window.scrollTo(0, i);
        await sleep(100);
    }
    window.scrollTo(0, 0);
}

function showStatus(text) {
    let el = document.getElementById('mal-indicator');
    if (!el) {
        el = document.createElement('div');
        el.id = 'mal-indicator';
        el.style.cssText = `position:fixed;bottom:20px;right:20px;background:#9C27B0;color:white;padding:12px 20px;border-radius:30px;z-index:999999;font-family:sans-serif;box-shadow:0 4px 15px rgba(0,0,0,0.3);display:flex;align-items:center;gap:10px;font-size:13px;`;
        document.body.appendChild(el);
    }
    el.innerHTML = `<div style="width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:mal-spin 0.8s linear infinite;"></div><span>${text}</span>`;
    if (!document.getElementById('mal-anim')) {
        const s = document.createElement('style');
        s.id = 'mal-anim';
        s.textContent = `@keyframes mal-spin { to { transform: rotate(360deg); } }`;
        document.head.appendChild(s);
    }
}

function updateStatus(text) {
    const el = document.getElementById('mal-indicator');
    if (el) el.querySelector('span').innerText = text;
}

function hideStatus() {
    const el = document.getElementById('mal-indicator');
    if (el) setTimeout(() => el.remove(), 2000);
}
