import type { FormType } from '../types/forms.js';

export type FormFieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'date'
  | 'time'
  | 'number'
  | 'select'
  | 'textarea'
  | 'checkbox'
  | 'checkboxGroup';

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormFieldDefinition {
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  placeholder?: string;
  autocomplete?: string;
  min?: string;
  max?: string;
  options?: FormFieldOption[];
  helperText?: string;
}

export interface FormPageDefinition {
  type: FormType;
  title: string;
  description: string;
  fields: FormFieldDefinition[];
  submitLabel: string;
}

export interface SuccessPageOptions {
  whatsappReturnUrl?: string;
  whatsappReturnLabel?: string;
  outboundSent?: boolean;
}

export function renderFormPage(
  definition: FormPageDefinition,
  action: string,
  csrfToken: string,
  values: Record<string, unknown> = {},
  errors: Record<string, string> = {}
): string {
  const errorSummary = Object.keys(errors).length
    ? '<div class="error-summary" role="alert">Please check the highlighted fields.</div>'
    : '';
  const fields = definition.fields
    .map((field) => renderField(field, values[field.name], errors[field.name]))
    .join('');

  return renderDocument(
    definition.title,
    `<header><span class="brand">YANA</span><h1>${escapeHtml(definition.title)}</h1><p>${escapeHtml(
      definition.description
    )}</p></header>
    ${errorSummary}
    <form method="post" action="${escapeHtml(action)}" novalidate>
      <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
      <div class="fields">${fields}</div>
      <button type="submit">${escapeHtml(definition.submitLabel)}</button>
      <p class="privacy">Your details are used only to personalize and fulfill your requests.</p>
    </form>`
  );
}

export function renderSuccessPage(
  title: string,
  message: string,
  options: SuccessPageOptions = {}
): string {
  const returnButton = options.whatsappReturnUrl
    ? `<a class="return-button" href="${escapeHtml(options.whatsappReturnUrl)}">${escapeHtml(
        options.whatsappReturnLabel ?? 'Return to WhatsApp'
      )}</a>`
    : '';
  const hint = options.outboundSent
    ? 'I have also sent the next message to your WhatsApp chat.'
    : options.whatsappReturnUrl
      ? 'Tap below to return to WhatsApp and continue the same conversation.'
      : 'You can now return to WhatsApp.';

  return renderDocument(
    title,
    `<section class="success"><span class="brand">YANA</span><div class="check">&#10003;</div><h1>${escapeHtml(
      title
    )}</h1><p>${escapeHtml(message)}</p>${returnButton}<p class="hint">${escapeHtml(
      hint
    )}</p></section>`
  );
}

export function renderExpiredPage(): string {
  return renderDocument(
    'Link unavailable',
    '<section class="success"><span class="brand">YANA</span><h1>Link unavailable</h1><p>This secure form link has expired or has already been used. Please request a new link in WhatsApp.</p></section>'
  );
}

function renderField(field: FormFieldDefinition, rawValue: unknown, error?: string): string {
  const value =
    typeof rawValue === 'string' || typeof rawValue === 'number' ? String(rawValue) : '';
  const values = Array.isArray(rawValue)
    ? rawValue.map(String)
    : typeof rawValue === 'string'
      ? [rawValue]
      : [];
  const fieldId = `field-${field.name}`;
  const required = field.required ? ' required' : '';
  const invalid = error ? ' aria-invalid="true"' : '';
  const common = `id="${fieldId}" name="${escapeHtml(field.name)}"${required}${invalid}`;
  let control: string;

  if (field.type === 'checkbox') {
    const checked = rawValue === true || rawValue === 'on' ? ' checked' : '';
    control = `<label class="check-row"><input type="checkbox" ${common}${checked}> <span>${escapeHtml(
      field.label
    )}</span></label>`;
  } else if (field.type === 'checkboxGroup') {
    const options = (field.options ?? [])
      .map((option, index) => {
        const optionId = `${fieldId}-${index}`;
        const checked = values.includes(option.value) ? ' checked' : '';
        return `<label class="chip-option" for="${optionId}"><input type="checkbox" id="${optionId}" name="${escapeHtml(
          field.name
        )}" value="${escapeHtml(option.value)}"${checked}${invalid}> <span>${escapeHtml(
          option.label
        )}</span></label>`;
      })
      .join('');
    control = `<fieldset class="choice-group"${error ? ' aria-invalid="true"' : ''}><legend>${escapeHtml(
      field.label
    )}${requiredMark(field)}</legend><div class="chip-grid">${options}</div></fieldset>`;
  } else if (field.type === 'textarea') {
    control = `<label for="${fieldId}">${escapeHtml(field.label)}${requiredMark(field)}</label><textarea ${common}${placeholder(
      field
    )}>${escapeHtml(value)}</textarea>`;
  } else if (field.type === 'select') {
    const options = (field.options ?? [])
      .map(
        (option) =>
          `<option value="${escapeHtml(option.value)}"${
            option.value === value ? ' selected' : ''
          }>${escapeHtml(option.label)}</option>`
      )
      .join('');
    control = `<label for="${fieldId}">${escapeHtml(field.label)}${requiredMark(
      field
    )}</label><select ${common}><option value="">Select one</option>${options}</select>`;
  } else {
    const constraints = [
      field.min ? ` min="${escapeHtml(field.min)}"` : '',
      field.max ? ` max="${escapeHtml(field.max)}"` : '',
      field.autocomplete ? ` autocomplete="${escapeHtml(field.autocomplete)}"` : '',
    ].join('');
    control = `<label for="${fieldId}">${escapeHtml(field.label)}${requiredMark(
      field
    )}</label><input type="${field.type}" ${common} value="${escapeHtml(
      value
    )}"${placeholder(field)}${constraints}>`;
  }

  const helper = field.helperText
    ? `<span class="helper">${escapeHtml(field.helperText)}</span>`
    : '';
  const errorMessage = error ? `<span class="field-error">${escapeHtml(error)}</span>` : '';
  return `<div class="field${field.type === 'checkbox' ? ' checkbox' : ''}${
    field.type === 'checkboxGroup' ? ' choice-field' : ''
  }">${control}${helper}${errorMessage}</div>`;
}

function requiredMark(field: FormFieldDefinition): string {
  return field.required ? '<span class="required"> *</span>' : '';
}

function placeholder(field: FormFieldDefinition): string {
  return field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
}

function renderDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(title)} | YANA</title>
  <style>
    :root { --ink:#18241f; --muted:#63716b; --gold:#ae8a52; --cream:#faf8f3; --paper:#fff; --line:#e5dfd3; --error:#a23d35; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--cream); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { width:min(100%, 620px); margin:0 auto; min-height:100vh; padding:28px 18px calc(32px + env(safe-area-inset-bottom)); }
    .brand { display:block; color:var(--gold); font-size:.75rem; font-weight:700; letter-spacing:.32em; margin-bottom:22px; }
    header h1, .success h1 { font-family:Georgia,serif; font-size:clamp(1.75rem,7vw,2.25rem); font-weight:500; line-height:1.15; margin:0 0 10px; }
    header p, .success p { color:var(--muted); line-height:1.55; margin:0 0 28px; }
    form, .success { background:var(--paper); border:1px solid var(--line); border-radius:22px; padding:22px 18px; box-shadow:0 8px 28px rgba(33,30,23,.04); }
    .fields { display:grid; gap:18px; }
    .field label:not(.check-row) { display:block; font-size:.92rem; font-weight:600; margin:0 0 7px; }
    .required { color:var(--gold); }
    input:not([type=checkbox]), textarea, select { appearance:none; width:100%; border:1px solid var(--line); border-radius:12px; padding:13px 12px; background:#fff; color:var(--ink); font:inherit; min-height:48px; }
    textarea { min-height:86px; resize:vertical; }
    input:focus, textarea:focus, select:focus { outline:2px solid rgba(174,138,82,.3); border-color:var(--gold); }
    input[aria-invalid=true], textarea[aria-invalid=true], select[aria-invalid=true] { border-color:var(--error); }
    fieldset { border:0; padding:0; margin:0; }
    legend { display:block; font-size:.92rem; font-weight:600; margin:0 0 10px; padding:0; }
    .check-row { display:flex; align-items:flex-start; gap:11px; line-height:1.45; font-size:.94rem; }
    .check-row input { flex:none; width:20px; height:20px; accent-color:var(--gold); margin-top:1px; }
    .chip-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .chip-option { position:relative; display:flex; align-items:center; justify-content:center; min-height:44px; border:1px solid var(--line); border-radius:12px; padding:10px 9px; text-align:center; font-size:.88rem; font-weight:650; color:var(--ink); background:#fff; }
    .chip-option input { position:absolute; opacity:0; inset:0; cursor:pointer; }
    .chip-option:has(input:checked) { border-color:var(--gold); background:#f6efe3; box-shadow:inset 0 0 0 1px rgba(174,138,82,.35); }
    .helper, .field-error { display:block; font-size:.82rem; margin-top:6px; color:var(--muted); }
    .field-error { color:var(--error); }
    .error-summary { border-radius:12px; padding:12px; margin:0 0 16px; color:var(--error); background:#fff1ed; font-size:.92rem; }
    button { border:0; width:100%; min-height:52px; border-radius:14px; margin-top:25px; padding:14px; background:var(--ink); color:#fff; font-size:1rem; font-weight:600; cursor:pointer; }
    button:active { transform:translateY(1px); }
    .return-button { display:block; width:100%; min-height:52px; border-radius:14px; margin:22px 0 0; padding:15px 14px; background:#25d366; color:#092319; font-size:1rem; font-weight:700; text-decoration:none; }
    .return-button:active { transform:translateY(1px); }
    .privacy { text-align:center; margin:17px 4px 0; color:var(--muted); font-size:.79rem; line-height:1.45; }
    .success { text-align:center; margin-top:12vh; padding:36px 22px; }
    .success .brand { margin-bottom:18px; }
    .check { color:var(--gold); font-size:2rem; margin-bottom:14px; }
    .success .hint { margin:18px 0 0; font-size:.9rem; }
    @media (min-width:560px) { main { padding-top:48px; } form { padding:30px; } .fields { grid-template-columns:1fr 1fr; } .field.checkbox, .field.choice-field, .field:has(textarea) { grid-column:1 / -1; } .chip-grid { grid-template-columns:repeat(3, 1fr); } }
  </style>
</head>
<body><main>${body}</main><script>
document.addEventListener('submit', function (event) {
  var form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  var button = form.querySelector('button[type="submit"]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Submitting...';
  }
});
</script></body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
