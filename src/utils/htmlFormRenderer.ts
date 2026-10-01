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
    `<header class="intro">
      <p class="eyebrow">${escapeHtml(formEyebrow(definition.type))}</p>
      <h1>${renderAccentTitle(definition.title)}</h1>
      <p>${escapeHtml(definition.description)}</p>
    </header>
    <section class="form-card" aria-labelledby="form-heading">
      <h2 id="form-heading" class="visually-hidden">${escapeHtml(definition.title)} form</h2>
      ${renderLogo()}
      ${errorSummary}
      <form method="post" action="${escapeHtml(action)}" novalidate>
        <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
        <div class="fields">${fields}</div>
        <div class="form-actions">
          <button type="submit">${escapeHtml(definition.submitLabel)}</button>
          <p class="privacy">Your details are used only to personalise and fulfil your requests.</p>
        </div>
      </form>
    </section>`
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
    `<section class="success">${renderLogo()}<div class="check" aria-hidden="true">&#10003;</div><h1>${escapeHtml(
      title
    )}</h1><p>${escapeHtml(message)}</p>${returnButton}<p class="hint">${escapeHtml(
      hint
    )}</p></section>`
  );
}

export function renderExpiredPage(): string {
  return renderDocument(
    'Link unavailable',
    `<section class="success">${renderLogo()}<h1>Link unavailable</h1><p>This secure form link has expired or has already been used. Please request a new link in WhatsApp.</p></section>`
  );
}

function renderLogo(): string {
  return '<img class="form-logo" src="/assets/yana-logo.png" alt="YANA — You are not alone">';
}

function formEyebrow(type: FormType): string {
  const labels: Record<FormType, string> = {
    profile: 'Personally yours',
    hotel: 'Your perfect stay',
    restaurant: 'Your table awaits',
    itinerary: 'Designed around you',
    excursion: 'Your next experience',
    excursion_booking: 'Complete your experience',
    logistics: 'Travel with ease',
    logistics_booking: 'Confirm your journey',
  };
  return labels[type];
}

function renderAccentTitle(title: string): string {
  const words = title.trim().split(/\s+/);
  const accent = words.pop() ?? title;
  const prefix = words.length ? `${escapeHtml(words.join(' '))} ` : '';
  return `${prefix}<em>${escapeHtml(accent)}.</em>`;
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
  <meta name="theme-color" content="#062f32">
  <title>${escapeHtml(title)} | YANA</title>
  <style>
    :root { --teal:#062f32; --teal-soft:#0c5c5e; --gold:#c9983c; --gold-light:#e7bd69; --ivory:#f8f6f2; --paper:#fffdfa; --ink:#17272b; --muted:#667270; --line:#d9d0c3; --error:#a33a32; --shadow:0 22px 65px rgba(6,47,50,.10); }
    * { box-sizing:border-box; }
    html { color-scheme:light; }
    body { margin:0; min-height:100vh; background:radial-gradient(circle at 88% 4%,rgba(201,152,60,.15),transparent 30rem),radial-gradient(circle at 8% 88%,rgba(12,92,94,.55),transparent 34rem),var(--teal); color:var(--ink); font:15px/1.55 Inter,Arial,sans-serif; }
    body::before { content:""; display:block; height:5px; background:var(--gold); }
    button,input,select,textarea { font:inherit; }
    main { width:min(920px,calc(100% - 40px)); margin:0 auto; min-height:100vh; padding:62px 0 calc(72px + env(safe-area-inset-bottom)); }
    .intro { margin-bottom:34px; }
    .eyebrow { margin:0 0 12px; color:var(--gold-light); font-size:10px; font-weight:800; letter-spacing:.18em; text-transform:uppercase; }
    .intro h1 { margin:0; color:#fff; font:400 clamp(42px,7vw,68px)/1.02 Georgia,"Times New Roman",serif; letter-spacing:-.045em; }
    .intro h1 em { color:var(--gold); font-weight:400; }
    .intro > p:last-child { max-width:610px; margin:17px 0 0; color:#c5d4d1; font-size:16px; }
    .form-card,.success { position:relative; overflow:hidden; border:1px solid var(--line); border-radius:24px; padding:clamp(28px,5vw,52px); background:rgba(255,253,250,.96); box-shadow:var(--shadow); }
    .form-card::before,.success::before { content:""; position:absolute; top:0; left:clamp(28px,5vw,52px); width:72px; height:3px; background:var(--gold); }
    .form-logo { display:block; width:min(300px,76%); height:auto; margin:0 auto 40px; object-fit:contain; }
    .fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:22px 20px; }
    .field label:not(.check-row),legend { display:block; color:var(--teal); font-size:11px; font-weight:700; margin:0 0 8px; }
    .required { color:var(--gold); }
    input:not([type=checkbox]),textarea,select { appearance:none; width:100%; min-height:52px; border:1px solid var(--line); border-radius:10px; outline:none; padding:0 15px; background:#fff; color:var(--ink); transition:border-color .18s ease,box-shadow .18s ease; }
    textarea { min-height:104px; padding:14px 15px; resize:vertical; }
    select { padding-right:45px; background-image:linear-gradient(45deg,transparent 50%,var(--teal) 50%),linear-gradient(135deg,var(--teal) 50%,transparent 50%); background-position:calc(100% - 19px) 23px,calc(100% - 14px) 23px; background-size:5px 5px,5px 5px; background-repeat:no-repeat; }
    input:hover,textarea:hover,select:hover { border-color:#b7ab9a; }
    input:focus,textarea:focus,select:focus { border-color:var(--gold); box-shadow:0 0 0 3px rgba(201,152,60,.16); }
    input[aria-invalid=true], textarea[aria-invalid=true], select[aria-invalid=true] { border-color:var(--error); }
    fieldset { border:0; padding:0; margin:0; }
    .field.checkbox,.field.choice-field,.field:has(textarea) { grid-column:1 / -1; }
    .check-row { display:flex; align-items:flex-start; gap:11px; color:var(--ink); line-height:1.5; font-size:13px; }
    .check-row input { flex:none; width:18px; height:18px; accent-color:var(--teal); margin-top:2px; }
    .chip-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .chip-option { position:relative; display:flex; align-items:center; justify-content:center; min-height:46px; border:1px solid var(--line); border-radius:10px; padding:10px 9px; text-align:center; font-size:12px; font-weight:700; color:var(--ink); background:#fff; }
    .chip-option input { position:absolute; opacity:0; inset:0; cursor:pointer; }
    .chip-option:has(input:checked) { border-color:var(--gold); background:#f8f0df; box-shadow:inset 0 0 0 1px rgba(201,152,60,.3); }
    .helper,.field-error { display:block; font-size:11px; margin-top:6px; color:var(--muted); }
    .field-error { color:var(--error); }
    .error-summary { border:1px solid rgba(163,58,50,.2); border-radius:10px; padding:13px 15px; margin:0 0 22px; color:var(--error); background:#fff1ed; font-size:12px; font-weight:700; }
    .form-actions { display:grid; gap:12px; margin-top:26px; }
    button,.return-button { display:block; border:0; width:100%; min-height:54px; border-radius:999px; padding:15px; background:var(--teal); color:#fff; font-size:12px; font-weight:800; letter-spacing:.02em; text-align:center; text-decoration:none; cursor:pointer; transition:transform .18s ease,background .18s ease; }
    button:hover,.return-button:hover { transform:translateY(-2px); background:var(--teal-soft); }
    button:focus-visible,.return-button:focus-visible { outline:3px solid var(--gold-light); outline-offset:3px; }
    button:disabled { cursor:wait; opacity:.72; }
    .return-button { margin-top:22px; }
    .privacy { text-align:center; margin:0; color:var(--muted); font-size:10px; line-height:1.45; }
    .success { max-width:700px; margin:8vh auto 0; text-align:center; }
    .success .form-logo { margin-bottom:30px; }
    .success h1 { margin:0 0 12px; color:var(--teal); font:400 clamp(34px,6vw,52px)/1.08 Georgia,"Times New Roman",serif; letter-spacing:-.035em; }
    .success p { max-width:540px; margin:0 auto; color:var(--muted); }
    .check { color:var(--gold); font-size:2rem; margin-bottom:14px; }
    .success .hint { margin:18px 0 0; font-size:.9rem; }
    .page-footer { display:flex; justify-content:space-between; gap:20px; margin-top:22px; color:#a9bfba; font-size:10px; }
    .visually-hidden { position:absolute!important; width:1px!important; height:1px!important; padding:0!important; margin:-1px!important; overflow:hidden!important; clip:rect(0,0,0,0)!important; white-space:nowrap!important; border:0!important; }
    @media (min-width:700px) { .chip-grid { grid-template-columns:repeat(3,1fr); } }
    @media (max-width:640px) { main { width:min(100% - 28px,920px); padding:38px 0 44px; } .intro { margin-bottom:26px; } .intro h1 { font-size:43px; } .intro > p:last-child { font-size:14px; } .form-card,.success { border-radius:18px; padding:29px 20px; } .form-card::before,.success::before { left:20px; } .form-logo { width:min(260px,82%); margin-bottom:30px; } .fields { grid-template-columns:1fr; gap:18px; } .field.checkbox,.field.choice-field,.field:has(textarea) { grid-column:auto; } .chip-grid { grid-template-columns:1fr 1fr; } .page-footer { flex-direction:column; gap:4px; } }
    @media (prefers-reduced-motion:reduce) { *,*::before,*::after { scroll-behavior:auto!important; transition:none!important; } }
  </style>
</head>
<body><main>${body}<footer class="page-footer"><span>YANA — Your AI Navigation Agent</span><span>You are not alone.</span></footer></main><script>
document.addEventListener('submit', function (event) {
  var form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!form.checkValidity()) {
    event.preventDefault();
    form.reportValidity();
    return;
  }
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
