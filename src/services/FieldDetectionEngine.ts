/**
 * FieldDetectionEngine
 * Robust scanner for identifying and classifying input fields on Meesho
 */

export type FieldType = 'text' | 'number' | 'dropdown' | 'textarea' | 'date';

export interface ScrapedField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  selector: string;
  optionLabels: string[];
}

export class FieldDetectionEngine {
  private fields: Map<string, ScrapedField> = new Map();
  private observer: MutationObserver | null = null;
  private scanTimeout: any = null;

  constructor() {
    this.initObserver();
  }

  private initObserver() {
    if (typeof window === 'undefined') return;

    this.observer = new MutationObserver(() => {
      if (this.scanTimeout) clearTimeout(this.scanTimeout);
      this.scanTimeout = setTimeout(() => this.backgroundScan(), 1000);
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'aria-haspopup', 'class']
    });
  }

  private async backgroundScan() {
    const inputs = this.findAllInputs();
    for (const input of inputs) {
      const field = await this.analyzeField(input);
      if (field) {
        this.fields.set(field.label, field);
      }
    }
  }

  public async scan(): Promise<ScrapedField[]> {
    await this.backgroundScan();
    return Array.from(this.fields.values());
  }

  private findAllInputs(): HTMLElement[] {
    const selectors = [
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
    ];

    return Array.from(document.querySelectorAll(selectors.join(','))) as HTMLElement[];
  }

  private async analyzeField(el: HTMLElement): Promise<ScrapedField | null> {
    const label = this.findLabel(el);
    if (!label || label.length < 2) return null;

    const type = this.detectType(el);
    const selector = this.generateSelector(el);
    let optionLabels: string[] = [];

    if (type === 'dropdown') {
      optionLabels = await this.extractOptions(el);
    }

    return {
      id: Math.random().toString(36).substring(2, 11),
      label,
      type,
      required: this.isRequired(el),
      selector,
      optionLabels
    };
  }

  private findLabel(el: HTMLElement): string {
    // 1. Standard Label
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return this.cleanLabel(label.textContent || '');
    }

    // 2. ARIA
    const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    if (ariaLabel) {
      const labelEl = document.getElementById(ariaLabel);
      if (labelEl) return this.cleanLabel(labelEl.textContent || '');
      return this.cleanLabel(ariaLabel);
    }

    // 3. Parent MUI Container
    const container = el.closest('.MuiFormControl-root, [class*="FormControl"]');
    if (container) {
      const labelEl = container.querySelector('label, .MuiFormLabel-root');
      if (labelEl) return this.cleanLabel(labelEl.textContent || '');
    }

    // 4. Recursive Upward Sibling Search
    let curr: HTMLElement | null = el;
    for (let i = 0; i < 3; i++) {
      if (!curr) break;
      let prev = curr.previousElementSibling as HTMLElement;
      while (prev) {
        const text = prev.innerText.trim();
        if (text.length > 2 && text.length < 50) return this.cleanLabel(text);
        prev = prev.previousElementSibling as HTMLElement;
      }
      curr = curr.parentElement;
    }

    return this.cleanLabel((el as any).placeholder || (el as any).name || '');
  }

  private cleanLabel(text: string): string {
    return text.replace(/\*/g, '').replace(/:$/, '').trim();
  }

  private detectType(el: HTMLElement): FieldType {
    const role = el.getAttribute('role');
    const ariaPopup = el.getAttribute('aria-haspopup');
    const className = el.className || '';
    const typeAttr = el.getAttribute('type') || '';

    if (role === 'combobox' || ariaPopup === 'true' || ariaPopup === 'listbox' || 
        el.tagName === 'SELECT' || className.includes('Select-select')) {
      return 'dropdown';
    }

    if (typeAttr === 'number' || el.id.toLowerCase().includes('price') || el.id.toLowerCase().includes('weight')) {
      return 'number';
    }

    if (el.tagName === 'TEXTAREA') return 'textarea';

    return 'text';
  }

  private async extractOptions(el: HTMLElement): Promise<string[]> {
    // 1. Native Select
    if (el instanceof HTMLSelectElement) {
      return Array.from(el.options).map(o => o.text.trim()).filter(Boolean);
    }

    // 2. Portal Search (MUI common pattern)
    // When a dropdown is clicked, MUI renders a portal at body end
    const listboxes = document.querySelectorAll('[role="listbox"], .MuiMenu-list, .MuiAutocomplete-listbox');
    for (const list of Array.from(listboxes)) {
      const options = Array.from(list.querySelectorAll('[role="option"], li, .MuiMenuItem-root'))
        .map(o => (o as HTMLElement).innerText.trim())
        .filter(Boolean);
      if (options.length > 0) return [...new Set(options)];
    }

    return [];
  }

  private isRequired(el: HTMLElement): boolean {
    return (el as any).required || 
           el.getAttribute('aria-required') === 'true' || 
           el.closest('.Mui-required') !== null ||
           el.innerText.includes('*');
  }

  private generateSelector(el: HTMLElement): string {
    const path: string[] = [];
    let curr: HTMLElement | null = el;
    while (curr && curr.nodeType === Node.ELEMENT_NODE && path.length < 10) {
      let selector = curr.nodeName.toLowerCase();
      if (curr.id) {
        selector += `#${CSS.escape(curr.id)}`;
        path.unshift(selector);
        break;
      }
      const index = Array.from(curr.parentNode?.children || []).indexOf(curr) + 1;
      selector += `:nth-child(${index})`;
      path.unshift(selector);
      curr = curr.parentElement;
    }
    return path.join(' > ');
  }

  public destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
    }
  }
}
