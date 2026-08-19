import { z } from 'zod';
import { parsePublishedAt } from '../normalization/date.js';
import { normalizeSource } from '../normalization/source.js';

const nullish = z.union([z.null(), z.undefined(), z.literal('')]);

const looseString = z.union([z.string(), z.number(), z.boolean()]).transform(String);

const optionalText = z
  .union([looseString, nullish])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : (value as string | null)));

const optionalDateLike = z
  .union([z.string(), z.number(), nullish])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : (value ?? null)));

const optionalCountLike = z
  .union([z.string(), z.number(), nullish])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : (value ?? null)));

export const postMentionRecordSchema = z
  .object({
    source: optionalText,
    source_name: optionalText,
    sourceName: optionalText,
    publisher: optionalText,

    title: optionalText,
    headline: optionalText,

    content: optionalText,
    body: optionalText,
    text: optionalText,
    description: optionalText,

    url: optionalText,
    link: optionalText,
    permalink: optionalText,

    published_at: optionalDateLike,
    publishedAt: optionalDateLike,
    published_date: optionalDateLike,
    date: optionalDateLike,
    created_at: optionalDateLike,

    author: optionalText,
    author_name: optionalText,

    engagement: optionalCountLike,
    engagement_count: optionalCountLike,
    reach: optionalCountLike,
    views: optionalCountLike,
  })
  .passthrough();

export type PostMentionRecord = z.infer<typeof postMentionRecordSchema>;

const MAX_BATCH_SIZE = 50_000;

export const postMentionsBulkSchema = z.union([
  z.array(z.unknown()).max(MAX_BATCH_SIZE, `A batch may contain at most ${MAX_BATCH_SIZE} records`),
  z
    .object({
      mentions: z
        .array(z.unknown())
        .max(MAX_BATCH_SIZE, `A batch may contain at most ${MAX_BATCH_SIZE} records`),
    })
    .transform((body) => body.mentions),
]);

export const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function dateBound(field: 'from' | 'to') {
  return z
    .string()
    .trim()
    .min(1)
    .transform((value, ctx) => {
      const parsed = parsePublishedAt(value);
      if (parsed === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} is not a recognised date (expected e.g. 2024-03-15 or 2024-03-15T08:30:00Z)`,
        });
        return z.NEVER;
      }
      if (field === 'to' && DATE_ONLY.test(value)) {
        return new Date(parsed.getTime() + 24 * 60 * 60 * 1000);
      }
      return parsed;
    });
}

const positiveInt = (field: string) =>
  z.string().regex(/^\d+$/, `${field} must be a positive integer`).transform(Number);

export const getMentionsSchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(1, 'q must not be blank')
      .max(200, 'q must be at most 200 characters')
      .optional(),

    source: z
      .string()
      .trim()
      .min(1, 'source must not be blank')
      .transform(normalizeSource)
      .refine((value) => value.length > 0, 'source must contain at least one alphanumeric character')
      .optional(),

    from: dateBound('from').optional(),
    to: dateBound('to').optional(),

    page: positiveInt('page').refine((value) => value >= 1, 'page must be 1 or greater').default('1'),

    page_size: positiveInt('page_size')
      .refine(
        (value) => value >= 1 && value <= MAX_PAGE_SIZE,
        `page_size must be between 1 and ${MAX_PAGE_SIZE}`,
      )
      .default(String(DEFAULT_PAGE_SIZE)),
  })
  .strict()
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: 'from must be earlier than or equal to to',
    path: ['from'],
  });

export type GetMentionsQuery = z.infer<typeof getMentionsSchema>;

export const getMentionStatsSchema = z
  .object({
    group_by: z.enum(['source', 'day'], {
      errorMap: () => ({ message: "group_by must be one of: 'source', 'day'" }),
    }),
  })
  .strict();

export type GetMentionStatsQuery = z.infer<typeof getMentionStatsSchema>;
