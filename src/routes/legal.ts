import { Router, type Request, type Response } from 'express';

const router = Router();
const updatedDate = 'August 7, 2026';

router.get('/privacy', (_req: Request, res: Response) => {
  res.type('html').send(renderLegalPage({
    title: 'Privacy Policy',
    intro:
      'Yana is a WhatsApp-first travel concierge that helps users plan trips, search hotels, restaurants, excursions, transport, and related travel services.',
    sections: [
      {
        heading: 'Information We Collect',
        body:
          'We may collect WhatsApp profile details, phone numbers, messages sent to Yana, form responses, travel preferences, search requests, itinerary details, booking requests, and support messages.',
      },
      {
        heading: 'How We Use Information',
        body:
          'We use this information to understand requests, generate travel recommendations, prepare itineraries, provide search results, remember user preferences, improve the service, and respond through WhatsApp or related communication channels.',
      },
      {
        heading: 'Service Providers',
        body:
          'We may process information through trusted providers such as Meta WhatsApp Cloud API, AI and transcription providers, maps and places providers, hosting infrastructure, databases, analytics, and operational tools required to deliver the service.',
      },
      {
        heading: 'Data Sharing',
        body:
          'We do not sell personal data. We share information only when needed to provide the requested service, comply with law, protect users and the platform, or work with service providers acting on our behalf.',
      },
      {
        heading: 'Data Retention',
        body:
          'We keep information only as long as reasonably needed for the travel concierge service, operational records, legal obligations, security, and service improvement.',
      },
      {
        heading: 'User Choices',
        body:
          'Users may request access, correction, or deletion of their information by contacting us. Users can also stop messaging Yana at any time.',
      },
      {
        heading: 'Contact',
        body:
          'For privacy questions or deletion requests, contact: privacy@yana.lk. Replace this email with the official company privacy email before public launch.',
      },
    ],
  }));
});

router.get('/privacy-policy', (_req: Request, res: Response) => {
  res.redirect(301, '/privacy');
});

router.get('/data-deletion', (_req: Request, res: Response) => {
  res.type('html').send(renderLegalPage({
    title: 'Data Deletion Instructions',
    intro:
      'Yana users can request deletion of personal information associated with their WhatsApp conversation and travel concierge profile.',
    sections: [
      {
        heading: 'How To Request Deletion',
        body:
          'Send an email to privacy@yana.lk with the WhatsApp phone number used to contact Yana and the subject line "Data Deletion Request". Replace this email with the official company privacy email before public launch.',
      },
      {
        heading: 'Verification',
        body:
          'We may ask for reasonable information to verify that the request comes from the account owner or an authorized representative.',
      },
      {
        heading: 'What We Delete',
        body:
          'After verification, we delete or anonymize personal profile details, saved preferences, conversation records, form submissions, and service request history unless retention is required by law, fraud prevention, security, or legitimate operational obligations.',
      },
      {
        heading: 'Timeline',
        body:
          'We aim to complete verified deletion requests within 30 days, unless a longer period is required by law or operational constraints.',
      },
    ],
  }));
});

function renderLegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: string;
  sections: Array<{ heading: string; body: string }>;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Yana</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #132235;
      --muted: #526173;
      --line: #dde7ef;
      --brand: #0f766e;
      --paper: #ffffff;
      --wash: #f4f8fb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--ink);
      background: var(--wash);
      line-height: 1.6;
    }
    main {
      width: min(920px, calc(100% - 32px));
      margin: 0 auto;
      padding: 56px 0 72px;
    }
    article {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 18px 48px rgba(19, 34, 53, 0.08);
    }
    .eyebrow {
      margin: 0 0 12px;
      color: var(--brand);
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
    }
    h1 {
      margin: 0 0 12px;
      font-size: 40px;
      line-height: 1.15;
    }
    .updated {
      margin: 0 0 28px;
      color: var(--muted);
      font-size: 15px;
    }
    .intro {
      margin: 0 0 32px;
      font-size: 19px;
      color: #27384a;
    }
    section {
      border-top: 1px solid var(--line);
      padding-top: 22px;
      margin-top: 22px;
    }
    h2 {
      margin: 0 0 8px;
      font-size: 22px;
    }
    p {
      margin: 0;
      color: var(--muted);
    }
    a {
      color: var(--brand);
    }
    @media (max-width: 640px) {
      main { padding: 24px 0 48px; }
      article { padding: 24px; }
      h1 { font-size: 32px; }
    }
  </style>
</head>
<body>
  <main>
    <article>
      <p class="eyebrow">Yana Travel Concierge</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="updated">Last updated: ${escapeHtml(updatedDate)}</p>
      <p class="intro">${escapeHtml(intro)}</p>
      ${sections
        .map(
          (section) => `<section>
        <h2>${escapeHtml(section.heading)}</h2>
        <p>${escapeHtml(section.body)}</p>
      </section>`
        )
        .join('')}
    </article>
  </main>
</body>
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

export default router;
