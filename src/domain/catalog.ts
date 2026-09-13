import { z } from 'zod'

export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

const RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/

const RFC3339_LEAP_SECOND_UTC_MINUTES = new Set([
  '1972-06-30T23:59',
  '1972-12-31T23:59',
  '1973-12-31T23:59',
  '1974-12-31T23:59',
  '1975-12-31T23:59',
  '1976-12-31T23:59',
  '1977-12-31T23:59',
  '1978-12-31T23:59',
  '1979-12-31T23:59',
  '1981-06-30T23:59',
  '1982-06-30T23:59',
  '1983-06-30T23:59',
  '1985-06-30T23:59',
  '1987-12-31T23:59',
  '1989-12-31T23:59',
  '1990-12-31T23:59',
  '1992-06-30T23:59',
  '1993-06-30T23:59',
  '1994-06-30T23:59',
  '1995-12-31T23:59',
  '1997-06-30T23:59',
  '1998-12-31T23:59',
  '2005-12-31T23:59',
  '2008-12-31T23:59',
  '2012-06-30T23:59',
  '2015-06-30T23:59',
  '2016-12-31T23:59',
])

function isRfc3339Timestamp(value: string): boolean {
  const match = RFC3339_TIMESTAMP.exec(value)
  if (!match) {
    return false
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetSign, offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = Number(offsetHourText ?? 0)
  const offsetMinute = Number(offsetMinuteText ?? 0)

  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 60) {
    return false
  }
  if (offsetHour > 23 || offsetMinute > 59) {
    return false
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (day < 1 || day > daysInMonth[month - 1]) {
    return false
  }
  if (second < 60) {
    return true
  }

  const localMinute = new Date(0)
  localMinute.setUTCFullYear(year, month - 1, day)
  localMinute.setUTCHours(hour, minute, 0, 0)
  const offsetMinutes = (offsetHour * 60 + offsetMinute) * (offsetSign === '-' ? -1 : 1)
  const utcMinute = new Date(localMinute.getTime() - offsetMinutes * 60_000)
  return RFC3339_LEAP_SECOND_UTC_MINUTES.has(utcMinute.toISOString().slice(0, 16))
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

const isoDateSchema = z.custom<string>(
  (value) => typeof value === 'string' && isRfc3339Timestamp(value),
  'Horodatage ISO invalide',
)

const videoIdSchema = z.string({ error: 'ID vidéo YouTube invalide' })
  .regex(VIDEO_ID_PATTERN, 'ID vidéo YouTube invalide')

const safeNonnegativeIntegerSchema = z.custom<number>(
  isSafeNonnegativeInteger,
  'Un entier sûr, fini et positif ou nul est requis',
)

const safePositiveIntegerSchema = z.custom<number>(
  (value) => isSafeNonnegativeInteger(value) && value > 0,
  'Un entier sûr, fini et strictement positif est requis',
)

export const chapterSchema = z.object({
  startSeconds: safeNonnegativeIntegerSchema,
  title: z.string().trim().min(3).max(100),
}).strict()

type ChapterPosition = { startSeconds: number }

function addChapterTimelineIssues(
  chapters: ChapterPosition[],
  context: z.RefinementCtx,
): void {
  if (chapters.length > 0 && chapters[0].startSeconds !== 0) {
    context.addIssue({
      code: 'custom',
      path: ['chapters', 0, 'startSeconds'],
      message: 'Le premier chapitre doit commencer à 0',
    })
  }

  for (let index = 1; index < chapters.length; index += 1) {
    if (chapters[index].startSeconds <= chapters[index - 1].startSeconds) {
      context.addIssue({
        code: 'custom',
        path: ['chapters', index, 'startSeconds'],
        message: 'Les chapitres doivent être strictement croissants',
      })
    }
  }
}

export const chapterFileSchema = z.object({
  schemaVersion: z.literal(1),
  videoId: videoIdSchema,
  source: z.enum(['youtube-description', 'ai-transcript']),
  generatedAt: isoDateSchema,
  generator: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    promptVersion: safePositiveIntegerSchema,
  }).strict().optional(),
  transcriptLanguage: z.string().min(2).max(16).optional(),
  chapters: z.array(chapterSchema)
    .min(3, 'Le fichier doit contenir entre 3 et 60 chapitres')
    .max(60, 'Le fichier doit contenir entre 3 et 60 chapitres'),
}).strict().superRefine((value, context) => {
  addChapterTimelineIssues(value.chapters, context)

  if (value.source === 'ai-transcript' && !value.generator) {
    context.addIssue({
      code: 'custom',
      path: ['generator'],
      message: 'Le générateur est requis pour une source IA',
    })
  }
})

export type Chapter = z.infer<typeof chapterSchema>
export type ChapterFile = z.infer<typeof chapterFileSchema>
export type ChapterStatus = 'ready' | 'pending' | 'retry' | 'unavailable' | 'live' | 'upcoming'
export type VideoKind = 'video' | 'live'

type VideoState = {
  kind: VideoKind
  liveStatus: 'none' | 'live' | 'upcoming'
}

function addVideoKindIssues(value: VideoState, context: z.RefinementCtx): void {
  if (value.kind === 'video' && value.liveStatus !== 'none') {
    context.addIssue({
      code: 'custom',
      path: ['liveStatus'],
      message: 'Une vidéo standard doit avoir le statut live "none"',
    })
  }
}

const sourceVideoBaseSchema = z.object({
  id: videoIdSchema,
  title: z.string().min(1),
  description: z.string(),
  publishedAt: isoDateSchema,
  durationSeconds: safeNonnegativeIntegerSchema,
  thumbnailUrl: z.string().url(),
  embeddable: z.boolean(),
  kind: z.enum(['video', 'live']),
  liveStatus: z.enum(['none', 'live', 'upcoming']),
}).strict()

export const sourceVideoSchema = sourceVideoBaseSchema.superRefine(addVideoKindIssues)

export interface SourceVideo extends z.infer<typeof sourceVideoSchema> {}

const sourceChannelSchema = z.object({
  id: z.literal('UCQgWpmt02UtJkyO32HGUASQ'),
  handle: z.literal('@thinkerview'),
  title: z.literal('Thinkerview'),
  url: z.literal('https://www.youtube.com/@thinkerview'),
  uploadsPlaylistId: z.string().min(1),
}).strict()

function addCollectionIssues(
  value: { playlistItemCount: number; unavailableVideoIds: string[]; videos: Array<{ id: string }> },
  context: z.RefinementCtx,
): void {
  const ids = value.videos.map((video) => video.id)
  const publicIds = new Set(ids)
  if (publicIds.size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['videos'], message: 'ID vidéo dupliqué' })
  }
  if (new Set(value.unavailableVideoIds).size !== value.unavailableVideoIds.length) {
    context.addIssue({ code: 'custom', path: ['unavailableVideoIds'], message: 'ID indisponible dupliqué' })
  }

  value.unavailableVideoIds.forEach((id, index) => {
    if (publicIds.has(id)) {
      context.addIssue({
        code: 'custom',
        path: ['unavailableVideoIds', index],
        message: `La vidéo ${id} est à la fois publique et indisponible`,
      })
    }
  })

  if (value.playlistItemCount !== ids.length + value.unavailableVideoIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['playlistItemCount'],
      message: 'Le compte de playlist doit couvrir toutes les vidéos',
    })
  }
}

export const sourceCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  channel: sourceChannelSchema,
  syncedAt: isoDateSchema,
  playlistItemCount: safeNonnegativeIntegerSchema,
  unavailableVideoIds: z.array(videoIdSchema).default([]),
  videos: z.array(sourceVideoSchema),
}).strict().superRefine(addCollectionIssues)

export type SourceCatalog = z.infer<typeof sourceCatalogSchema>

const catalogVideoBaseSchema = sourceVideoBaseSchema.omit({ description: true }).extend({
  descriptionExcerpt: z.string().max(280),
  chapterStatus: z.enum(['ready', 'pending', 'retry', 'unavailable', 'live', 'upcoming']),
  chapterSource: z.enum(['youtube-description', 'ai-transcript']).nullable(),
  chapters: z.array(chapterSchema),
}).strict()

export const catalogVideoSchema = catalogVideoBaseSchema.superRefine((value, context) => {
  addVideoKindIssues(value, context)
  addChapterTimelineIssues(value.chapters, context)

  value.chapters.forEach((chapter, index) => {
    if (chapter.startSeconds >= value.durationSeconds) {
      context.addIssue({
        code: 'custom',
        path: ['chapters', index, 'startSeconds'],
        message: `Chapitre hors durée: ${chapter.startSeconds} >= ${value.durationSeconds}`,
      })
    }
  })

  if (value.chapterStatus === 'ready') {
    if (value.chapterSource === null) {
      context.addIssue({
        code: 'custom',
        path: ['chapterSource'],
        message: 'Une source de chapitres est requise pour une vidéo prête',
      })
    }
    if (value.chapters.length < 3 || value.chapters.length > 60) {
      context.addIssue({
        code: 'custom',
        path: ['chapters'],
        message: 'Une vidéo prête doit contenir entre 3 et 60 chapitres',
      })
    }
  } else {
    if (value.chapterSource !== null) {
      context.addIssue({
        code: 'custom',
        path: ['chapterSource'],
        message: 'La source de chapitres doit être nulle tant que la vidéo n’est pas prête',
      })
    }
    if (value.chapters.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['chapters'],
        message: 'Les chapitres doivent être vides tant que la vidéo n’est pas prête',
      })
    }
  }

  if (
    (value.chapterStatus === 'live' || value.chapterStatus === 'upcoming')
    && (value.kind !== 'live' || value.liveStatus !== value.chapterStatus)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['chapterStatus'],
      message: 'État de diffusion et de chapitrage incohérent',
    })
  }

  if (
    value.kind === 'live'
    && (value.liveStatus === 'live' || value.liveStatus === 'upcoming')
    && value.chapterStatus !== value.liveStatus
  ) {
    context.addIssue({
      code: 'custom',
      path: ['chapterStatus'],
      message: 'État de diffusion et de chapitrage incohérent',
    })
  }
})

export const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  channel: sourceChannelSchema.omit({ uploadsPlaylistId: true }).strict(),
  syncedAt: isoDateSchema,
  playlistItemCount: safeNonnegativeIntegerSchema,
  unavailableVideoIds: z.array(videoIdSchema).default([]),
  videos: z.array(catalogVideoSchema),
}).strict().superRefine(addCollectionIssues)

export type CatalogVideo = z.infer<typeof catalogVideoSchema>
export type Catalog = z.infer<typeof catalogSchema>

export function parseChapterFile(input: unknown): ChapterFile {
  return chapterFileSchema.parse(input)
}

export function parseSourceCatalog(input: unknown): SourceCatalog {
  return sourceCatalogSchema.parse(input)
}

export function parseCatalog(input: unknown): Catalog {
  return catalogSchema.parse(input)
}

export function assertChaptersFitVideo(file: ChapterFile, durationSeconds: number): void {
  if (!isSafeNonnegativeInteger(durationSeconds)) {
    throw new Error(`Durée vidéo invalide: ${durationSeconds}`)
  }

  for (const chapter of file.chapters) {
    if (!isSafeNonnegativeInteger(chapter.startSeconds)) {
      throw new Error(`Timestamp de chapitre invalide: ${chapter.startSeconds}`)
    }
    if (chapter.startSeconds >= durationSeconds) {
      throw new Error(`Chapitre hors durée: ${chapter.startSeconds} >= ${durationSeconds}`)
    }
  }
}
