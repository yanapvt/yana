import { z } from 'zod';

type SanitizedTextSchema = z.ZodPipeline<z.ZodEffects<z.ZodString, string, string>, z.ZodString>;

function sanitizeText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join('')
    .trim();
}

const text = (label: string, max = 160): SanitizedTextSchema =>
  z
    .string({ required_error: `${label} is required.` })
    .transform(sanitizeText)
    .pipe(z.string().min(1, `${label} is required.`).max(max, `${label} is too long.`));

const optionalText = (
  max = 300
): z.ZodEffects<z.ZodOptional<SanitizedTextSchema>, string | undefined, unknown> =>
  z.preprocess(
    (value) => (typeof value === 'string' && sanitizeText(value) === '' ? undefined : value),
    z.string().transform(sanitizeText).pipe(z.string().max(max)).optional()
  );

const requiredDate = (label: string): z.ZodEffects<SanitizedTextSchema, string, string> =>
  text(label, 10).refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, `${label} must be a valid date.`);

const requiredTime = (label: string): z.ZodEffects<SanitizedTextSchema, string, string> =>
  text(label, 5).refine(
    (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
    `${label} must be a valid time.`
  );

const integerField = (
  label: string,
  min: number,
  max: number
): z.ZodEffects<z.ZodNumber, number, unknown> =>
  z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : Number(value)),
    z
      .number({ required_error: `${label} is required.` })
      .int()
      .min(min)
      .max(max)
  );

const checkbox = z.preprocess(
  (value) => value === true || value === 'true' || value === 'on' || value === 'yes',
  z.boolean()
);

export const basicProfileFormSchema = z.object({
  fullName: text('Full name'),
  preferredName: text('Preferred name'),
  email: z
    .string({ required_error: 'Email is required.' })
    .transform((value) => sanitizeText(value).toLowerCase())
    .pipe(z.string().email('Enter a valid email address.').max(254)),
  phone: text('Phone', 32).refine(
    (value) => /^\+?[0-9 ()-]{7,32}$/.test(value),
    'Enter a valid phone number.'
  ),
  preferredLanguage: text('Preferred language', 64),
  nationality: text('Nationality', 80),
  countryOfResidence: text('Country of residence', 80),
  city: text('City', 80),
  dateOfBirth: requiredDate('Date of birth'),
  preferredCurrency: text('Preferred currency', 3)
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code.')),
  travelStyle: text('Travel style', 80),
  dietaryRestrictions: optionalText(),
  accessibilityNeeds: optionalText(),
  consent: checkbox.refine((value) => value, 'Consent is required to continue.'),
});

export const hotelRequestFormSchema = z
  .object({
    destination: text('Destination'),
    checkIn: requiredDate('Check-in'),
    checkOut: requiredDate('Check-out'),
    adults: integerField('Adults', 1, 30),
    children: integerField('Children', 0, 20),
    childrenAges: optionalText(100),
    rooms: integerField('Rooms', 1, 20),
    budget: text('Budget', 80),
    starRating: optionalText(40),
    mealPlan: optionalText(80),
    hotelType: optionalText(80),
    facilities: optionalText(300),
    bedPreference: optionalText(80),
    specialOccasion: optionalText(160),
  })
  .superRefine(({ checkIn, checkOut }, ctx) => {
    if (checkOut <= checkIn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['checkOut'],
        message: 'Check-out must be after check-in.',
      });
    }
  });

export const restaurantRequestFormSchema = z.object({
  location: text('Location'),
  date: requiredDate('Date'),
  time: requiredTime('Time'),
  guests: integerField('Guests', 1, 50),
  cuisinePreference: optionalText(120),
  budget: text('Budget', 80),
  dietaryRestrictions: optionalText(),
  ambience: optionalText(100),
  indoorOutdoor: optionalText(40),
  occasion: optionalText(120),
});

export const logisticsRequestFormSchema = z.object({
  pickupLocation: text('Pickup location'),
  dropOffLocation: text('Drop-off location'),
  date: requiredDate('Date'),
  time: requiredTime('Time'),
  passengers: integerField('Passengers', 1, 30),
  luggageCount: integerField('Luggage count', 0, 50),
  vehicleType: optionalText(80),
  flightNumber: optionalText(32),
  childSeat: checkbox,
  budget: text('Budget', 80),
});

export type FormSchema =
  | typeof basicProfileFormSchema
  | typeof hotelRequestFormSchema
  | typeof restaurantRequestFormSchema
  | typeof logisticsRequestFormSchema;
