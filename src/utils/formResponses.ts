export function buildProfileFormLink(token: string): string {
  return buildFormLink('profile', token);
}

export function buildHotelFormLink(token: string): string {
  return buildFormLink('hotel', token);
}

function buildFormLink(formType: string, token: string): string {
  const publicBaseUrl =
    process.env.FORM_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT || '3000'}`;

  return `${publicBaseUrl.replace(/\/$/, '')}/forms/${formType}/${encodeURIComponent(token)}`;
}

export function buildProfileCollectionResponse(formLink: string): string {
  return [
    'To personalize your experience and provide the best recommendations, please complete this quick profile:',
    '',
    formLink,
    '',
    "Once completed, I'll continue assisting you.",
  ].join('\n');
}

export function buildHotelCollectionResponse(formLink: string): string {
  return [
    'Great, I can help with hotels. Please complete this quick hotel request form so I can search with the right details:',
    '',
    formLink,
    '',
    "Once submitted, return here and type 'done' so I can continue the hotel search.",
  ].join('\n');
}
