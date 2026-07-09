console.log('Meesho Auto Lister: Content Script Loaded');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'FILL_FORM') {
        fillAllFields(request.data, request.images)
            .then(result => {
                sendResponse({ success: true, filledFields: result.filledFields });
            })
            .catch(error => {
                console.error('Fill Form Error:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep message channel open for async response
    }
});

function setReactInputValue(element, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function setReactTextareaValue(element, value) {
    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeTextareaValueSetter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function findInputByLabel(labelText) {
    const labels = Array.from(document.querySelectorAll('label'));
    const targetLabel = labels.find(l => l.textContent.toLowerCase().includes(labelText.toLowerCase()));
    if (targetLabel) {
        if (targetLabel.getAttribute('for')) {
            return document.getElementById(targetLabel.getAttribute('for'));
        }
        return targetLabel.querySelector('input') || targetLabel.parentElement.querySelector('input');
    }
    return null;
}

function fillTextField(identifiers, value) {
    try {
        for (const selector of identifiers) {
            const element = document.querySelector(selector);
            if (element) {
                setReactInputValue(element, value);
                return true;
            }
        }
        // Try searching by label as fallback
        for (const label of identifiers) {
            const element = findInputByLabel(label);
            if (element) {
                setReactInputValue(element, value);
                return true;
            }
        }
    } catch (e) {
        console.warn(`Could not fill field with ${identifiers}`, e);
    }
    return false;
}

function fillTextareaField(identifiers, value) {
    try {
        for (const selector of identifiers) {
            const element = document.querySelector(selector);
            if (element) {
                setReactTextareaValue(element, value);
                return true;
            }
        }
    } catch (e) {
        console.warn(`Could not fill textarea with ${identifiers}`, e);
    }
    return false;
}

async function fillDropdown(triggerIdentifiers, optionText) {
    try {
        let trigger = null;
        for (const selector of triggerIdentifiers) {
            trigger = document.querySelector(selector);
            if (trigger) break;
        }

        if (!trigger) return false;

        trigger.click();
        await sleep(600);

        const options = Array.from(document.querySelectorAll('[role="option"], .ant-select-item, .dropdown-item, [class*="option"], [class*="menu-item"]'));
        const targetOption = options.find(opt => opt.textContent.toLowerCase().includes(optionText.toLowerCase()));
        
        if (targetOption) {
            targetOption.click();
            await sleep(300);
            return true;
        }
    } catch (e) {
        console.warn(`Could not fill dropdown ${triggerIdentifiers}`, e);
    }
    return false;
}

async function handleImageUpload(base64Images) {
    try {
        const fileInput = document.querySelector('input[type="file"]');
        if (!fileInput) return false;

        const dataTransfer = new DataTransfer();
        
        for (let i = 0; i < base64Images.length; i++) {
            const res = await fetch(base64Images[i]);
            const blob = await res.blob();
            const file = new File([blob], `product-image-${i}.jpg`, { type: 'image/jpeg' });
            dataTransfer.items.add(file);
        }

        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    } catch (e) {
        console.warn('Image upload automation failed', e);
        return false;
    }
}

async function fillAllFields(data, images) {
    const filledFields = [];

    const fieldConfigs = [
        { field: 'productName', selectors: ['input[name="name"]', 'input[name="productName"]', 'input[name="product_name"]', 'input[placeholder*="name" i]'], value: data.productName },
        { field: 'mrp', selectors: ['input[name="mrp"]', 'input[name="maxRetailPrice"]', 'input[name="max_retail_price"]', 'input[placeholder*="mrp" i]'], value: data.mrp },
        { field: 'sellingPrice', selectors: ['input[name="price"]', 'input[name="sellingPrice"]', 'input[name="selling_price"]', 'input[placeholder*="price" i]'], value: data.sellingPrice },
        { field: 'weight', selectors: ['input[name="weight"]', 'input[name="packageWeight"]', 'input[placeholder*="weight" i]'], value: data.weight },
        { field: 'brand', selectors: ['input[name="brand"]', 'input[name="brandName"]', 'input[placeholder*="brand" i]'], value: data.brand },
        { field: 'color', selectors: ['input[name="color"]', 'input[placeholder*="color" i]'], value: data.color },
        { field: 'size', selectors: ['input[name="size"]', 'input[placeholder*="size" i]'], value: data.size },
        { field: 'material', selectors: ['input[name="material"]', 'input[placeholder*="material" i]'], value: data.material },
        { field: 'keywords', selectors: ['input[name="keywords"]', 'input[placeholder*="keywords" i]'], value: data.keywords }
    ];

    for (const config of fieldConfigs) {
        if (fillTextField(config.selectors, config.value)) {
            filledFields.push(config.field);
        }
        await sleep(200);
    }

    if (fillTextareaField(['textarea[name="description"]', 'textarea[placeholder*="description" i]'], data.description)) {
        filledFields.push('description');
    }

    await sleep(200);
    
    // Attempt image upload
    if (images && images.length > 0) {
        if (await handleImageUpload(images)) {
            filledFields.push('images');
        }
    }

    return { success: true, filledFields };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
