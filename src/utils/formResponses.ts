export function buildProfileFormLink(token: string): string {
  return buildFormLink('profile', token);
}

export function buildHotelFormLink(token: string): string {
  return buildFormLink('hotel', token);
}

export function buildRestaurantFormLink(token: string): string {
  return buildFormLink('restaurant', token);
}

export function buildItineraryFormLink(token: string): string {
  return buildFormLink('itinerary', token);
}

export function buildExcursionFormLink(token: string): string {
  return buildFormLink('excursion', token);
}

export function buildExcursionBookingFormLink(token: string): string {
  return buildFormLink('excursion_booking', token);
}

export function buildLogisticsFormLink(token: string): string {
  return buildFormLink('logistics', token);
}

export function buildLogisticsBookingFormLink(token: string): string {
  return buildFormLink('logistics_booking', token);
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
    'Welcome to YANA, your personal Travel & Tour Concierge, to personalize your experience and provide the best recommendations, please complete this quick profile:',
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
    "Once submitted, I'll continue here automatically.",
  ].join('\n');
}

export function buildRestaurantCollectionResponse(formLink: string): string {
  return [
    'Great, I can help with restaurants. Please complete this quick dining request form so I can search with the right details:',
    '',
    formLink,
    '',
    "Once submitted, I'll continue here automatically.",
  ].join('\n');
}

export function buildItineraryCollectionResponse(formLink: string): string {
  return [
    'Wonderful, I can help plan the full trip. Please complete this quick itinerary form so I can build the route around your dates, interests, transport, and pace:',
    '',
    formLink,
    '',
    "Once submitted, I'll continue here automatically.",
  ].join('\n');
}

export function buildExcursionCollectionResponse(formLink: string): string {
  return [
    'Great, I can help with experiences and excursions. Please complete this quick excursion request form so I can search with the right details:',
    '',
    formLink,
    '',
    "Once submitted, I'll continue here automatically.",
  ].join('\n');
}

export function buildExcursionBookingCollectionResponse(formLink: string): string {
  return [
    'Perfect. Please complete this short booking request form so I can prepare the availability check:',
    '',
    formLink,
    '',
    "Once submitted, I'll continue here automatically.",
  ].join('\n');
}

export function buildLogisticsCollectionResponse(formLink: string): string {
  return [
    'Great, I can help with transport. Please complete this quick transport request form so I can search with the right details:',
    '',
    formLink,
    '',
    "Once submitted, I'll continue here automatically.",
  ].join('\n');
}

export function buildLogisticsBookingCollectionResponse(formLink: string): string {
  return [
    'Perfect. Please complete this short transport booking form so I can prepare the provider availability check:',
    '',
    formLink,
    '',
    "Once submitted, I'll continue here automatically.",
  ].join('\n');
}
