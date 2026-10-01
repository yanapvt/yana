import { describe, expect, it } from 'vitest';
import {
  renderExpiredPage,
  renderFormPage,
  renderSuccessPage,
  type FormPageDefinition,
} from './htmlFormRenderer.js';

const hotelForm: FormPageDefinition = {
  type: 'hotel',
  title: 'Hotel request',
  description: 'Tell us what your ideal stay looks like.',
  submitLabel: 'Submit hotel request',
  fields: [
    { name: 'destination', label: 'Destination', type: 'text', required: true },
    { name: 'facilities', label: 'Facilities', type: 'textarea' },
  ],
};

describe('htmlFormRenderer YANA theme', () => {
  it('renders the unified brand shell, logo, and secure form data', () => {
    const html = renderFormPage(
      hotelForm,
      '/forms/hotel/token',
      'csrf-value',
      { destination: 'Galle' },
      { facilities: 'Please check this field.' }
    );

    expect(html).toContain('Your perfect stay');
    expect(html).toContain('Hotel <em>request.</em>');
    expect(html).toContain('src="/assets/yana-logo.png"');
    expect(html).toContain('alt="YANA — You are not alone"');
    expect(html).toContain('name="_csrf" value="csrf-value"');
    expect(html).toContain('value="Galle"');
    expect(html).toContain('Please check this field.');
    expect(html).toContain('YANA — Your AI Navigation Agent');
  });

  it('uses the same branded card for success and expired states', () => {
    const success = renderSuccessPage('Profile saved', 'Continue in WhatsApp.', {
      whatsappReturnUrl: 'https://wa.me/123',
    });
    const expired = renderExpiredPage();

    for (const html of [success, expired]) {
      expect(html).toContain('src="/assets/yana-logo.png"');
      expect(html).toContain('class="success"');
      expect(html).toContain('You are not alone.');
    }
    expect(success).toContain('href="https://wa.me/123"');
  });

  it('escapes user-visible dynamic content', () => {
    const html = renderFormPage(
      { ...hotelForm, title: '<script>alert(1)</script>' },
      '/forms/hotel/&token',
      '"csrf"'
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;.');
    expect(html).toContain('/forms/hotel/&amp;token');
    expect(html).toContain('&quot;csrf&quot;');
  });
});
