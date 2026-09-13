import { describe, expect, it } from 'vitest'

import {
  assertChaptersFitVideo,
  parseCatalog,
  parseChapterFile,
  parseSourceCatalog,
  type Catalog,
  type Chapter,
  type ChapterFile,
  type SourceCatalog,
} from './catalog'

const validChapters: Chapter[] = [
  { startSeconds: 0, title: 'Ouverture et présentation' },
  { startSeconds: 300, title: 'Premier thème abordé' },
  { startSeconds: 720, title: 'Deuxième thème abordé' },
]

const validChapterFile: ChapterFile = {
  schemaVersion: 1,
  videoId: 'aaaaaaaaaaa',
  source: 'ai-transcript',
  generatedAt: '2026-01-01T00:00:00Z',
  generator: {
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
    promptVersion: 1,
  },
  transcriptLanguage: 'fr',
  chapters: validChapters,
}

const validCatalog: Catalog = {
  schemaVersion: 1,
  channel: {
    id: 'UCQgWpmt02UtJkyO32HGUASQ',
    handle: '@thinkerview',
    title: 'Thinkerview',
    url: 'https://www.youtube.com/@thinkerview',
  },
  syncedAt: '2026-01-01T00:00:00Z',
  playlistItemCount: 1,
  unavailableVideoIds: [],
  videos: [
    {
      id: 'aaaaaaaaaaa',
      title: 'Énergie et souveraineté',
      publishedAt: '2025-01-01T00:00:00Z',
      durationSeconds: 3_600,
      thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg',
      embeddable: true,
      kind: 'video',
      liveStatus: 'none',
      descriptionExcerpt: 'Présentation de la vidéo',
      chapterStatus: 'ready',
      chapterSource: 'ai-transcript',
      chapters: validChapters,
    },
  ],
}

const validSourceCatalog: SourceCatalog = {
  schemaVersion: 1,
  channel: {
    id: 'UCQgWpmt02UtJkyO32HGUASQ',
    handle: '@thinkerview',
    title: 'Thinkerview',
    url: 'https://www.youtube.com/@thinkerview',
    uploadsPlaylistId: 'UUQgWpmt02UtJkyO32HGUASQ',
  },
  syncedAt: '2026-01-01T00:00:00Z',
  playlistItemCount: 1,
  unavailableVideoIds: [],
  videos: [
    {
      id: 'aaaaaaaaaaa',
      title: 'Énergie et souveraineté',
      description: 'Présentation complète de la vidéo',
      publishedAt: '2025-01-01T00:00:00Z',
      durationSeconds: 3_600,
      thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg',
      embeddable: true,
      kind: 'video',
      liveStatus: 'none',
    },
  ],
}

const invalidRfc3339Timestamps = [
  '2026-02-30T00:00:00Z',
  '2026-01-01T00:00:00',
  '2026-01-01',
  '2026-01-01 00:00:00Z',
  'January 1, 2026 00:00:00 UTC',
  '2026-01-01T00:00:00+24:00',
] as const

const invalidSafeIntegers = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
  1.5,
] as const

function catalogWithVideo(overrides: Record<string, unknown>): unknown {
  return {
    ...validCatalog,
    videos: [{ ...validCatalog.videos[0], ...overrides }],
  }
}

function sourceCatalogWithVideo(overrides: Record<string, unknown>): unknown {
  return {
    ...validSourceCatalog,
    videos: [{ ...validSourceCatalog.videos[0], ...overrides }],
  }
}

function chaptersOfLength(length: number): Chapter[] {
  return Array.from({ length }, (_, index) => ({
    startSeconds: index * 10,
    title: `Chapitre numéro ${index}`,
  }))
}

describe('chapter file contract', () => {
  it('accepts a complete valid AI chapter document', () => {
    expect(parseChapterFile(validChapterFile)).toEqual(validChapterFile)
  })

  it('accepts a real RFC3339 timestamp with an offset and leap date', () => {
    const input = { ...validChapterFile, generatedAt: '2024-02-29T23:59:59.123+01:30' }
    expect(parseChapterFile(input).generatedAt).toBe(input.generatedAt)
  })

  it.each([
    '1990-12-31T23:59:60Z',
    '1991-01-01T00:59:60+01:00',
  ] as const)('accepts real RFC3339 leap second %s', (generatedAt) => {
    const input = { ...validChapterFile, generatedAt }
    expect(parseChapterFile(input).generatedAt).toBe(generatedAt)
  })

  it('rejects second 60 outside a real RFC3339 leap second', () => {
    expect(() => parseChapterFile({
      ...validChapterFile,
      generatedAt: '1990-12-30T23:59:60Z',
    })).toThrow(/Horodatage/)
  })

  it.each(invalidRfc3339Timestamps)('rejects generatedAt %s', (generatedAt) => {
    expect(() => parseChapterFile({ ...validChapterFile, generatedAt })).toThrow(/Horodatage/)
  })

  it('rejects a malformed YouTube video id', () => {
    expect(() => parseChapterFile({ ...validChapterFile, videoId: 'short' })).toThrow(/ID vidéo/)
  })

  it('requires the first chapter to start at zero', () => {
    expect(() => parseChapterFile({
      ...validChapterFile,
      chapters: [
        { startSeconds: 1, title: 'Ouverture retardée' },
        validChapters[1],
        validChapters[2],
      ],
    })).toThrow(/commencer à 0/)
  })

  it('rejects timestamps that are not strictly increasing', () => {
    expect(() => parseChapterFile({
      ...validChapterFile,
      chapters: [
        validChapters[0],
        { startSeconds: 300, title: 'Premier thème abordé' },
        { startSeconds: 300, title: 'Timestamp dupliqué' },
      ],
    })).toThrow(/strictement croissants/)
  })

  it.each([2, 61])('rejects a chapter count of %s', (length) => {
    expect(() => parseChapterFile({
      ...validChapterFile,
      chapters: chaptersOfLength(length),
    })).toThrow()
  })

  it('requires the generator model for AI chapters', () => {
    const withoutModel = structuredClone(validChapterFile) as unknown as Record<string, unknown>
    ;(withoutModel.generator as Record<string, unknown>).model = undefined
    expect(() => parseChapterFile(withoutModel)).toThrow()
  })

  it.each(invalidSafeIntegers)('rejects chapter startSeconds %s', (startSeconds) => {
    expect(() => parseChapterFile({
      ...validChapterFile,
      chapters: [
        validChapters[0],
        validChapters[1],
        { ...validChapters[2], startSeconds },
      ],
    })).toThrow(/entier sûr/)
  })

  it.each(invalidSafeIntegers)('rejects generator promptVersion %s', (promptVersion) => {
    expect(() => parseChapterFile({
      ...validChapterFile,
      generator: { ...validChapterFile.generator, promptVersion },
    })).toThrow(/entier sûr/)
  })

  it('accepts MAX_SAFE_INTEGER as a chapter timestamp', () => {
    const parsed = parseChapterFile({
      ...validChapterFile,
      chapters: [
        validChapters[0],
        validChapters[1],
        { ...validChapters[2], startSeconds: Number.MAX_SAFE_INTEGER },
      ],
    })
    expect(parsed.chapters[2].startSeconds).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('rejects a timestamp equal to the video duration', () => {
    expect(() => assertChaptersFitVideo(validChapterFile, 720)).toThrow(/hors durée/)
  })

  it.each([...invalidSafeIntegers, -1])('rejects invalid video duration %s', (durationSeconds) => {
    expect(() => assertChaptersFitVideo(validChapterFile, durationSeconds)).toThrow(/Durée vidéo invalide/)
  })
})

describe('public catalog contract', () => {
  it('accepts a complete catalog', () => {
    expect(parseCatalog(validCatalog)).toEqual(validCatalog)
  })

  it('accepts RFC3339 offsets for catalog timestamps', () => {
    const input = {
      ...validCatalog,
      syncedAt: '2026-01-01T01:00:00+01:00',
      videos: [{ ...validCatalog.videos[0], publishedAt: '2024-02-29T23:59:59-05:00' }],
    }
    expect(parseCatalog(input)).toEqual(input)
  })

  it.each(invalidRfc3339Timestamps)('rejects syncedAt %s', (syncedAt) => {
    expect(() => parseCatalog({ ...validCatalog, syncedAt })).toThrow(/Horodatage/)
  })

  it.each(invalidRfc3339Timestamps)('rejects publishedAt %s', (publishedAt) => {
    expect(() => parseCatalog(catalogWithVideo({ publishedAt }))).toThrow(/Horodatage/)
  })

  it('rejects duplicate public video ids', () => {
    expect(() => parseCatalog({
      ...validCatalog,
      playlistItemCount: 2,
      videos: [...validCatalog.videos, validCatalog.videos[0]],
    })).toThrow(/dupliqué/)
  })

  it('accepts a distinct unavailable video id', () => {
    const input = {
      ...validCatalog,
      playlistItemCount: 2,
      unavailableVideoIds: ['bbbbbbbbbbb'],
    }
    expect(parseCatalog(input)).toEqual(input)
  })

  it('rejects a malformed unavailable video id', () => {
    expect(() => parseCatalog({
      ...validCatalog,
      playlistItemCount: 2,
      unavailableVideoIds: ['short'],
    })).toThrow(/ID vidéo/)
  })

  it('rejects duplicate unavailable video ids', () => {
    expect(() => parseCatalog({
      ...validCatalog,
      playlistItemCount: 3,
      unavailableVideoIds: ['bbbbbbbbbbb', 'bbbbbbbbbbb'],
    })).toThrow(/indisponible dupliqué/)
  })

  it('rejects an id present in public and unavailable videos', () => {
    expect(() => parseCatalog({
      ...validCatalog,
      playlistItemCount: 2,
      unavailableVideoIds: ['aaaaaaaaaaa'],
    })).toThrow(/publique et indisponible/)
  })

  it('requires the playlist count to include public and unavailable videos', () => {
    expect(() => parseCatalog({ ...validCatalog, playlistItemCount: 2 })).toThrow(/compte de playlist/)
  })

  it.each(invalidSafeIntegers)('rejects playlistItemCount %s', (playlistItemCount) => {
    expect(() => parseCatalog({ ...validCatalog, playlistItemCount })).toThrow(/entier sûr/)
  })

  it.each(invalidSafeIntegers)('rejects durationSeconds %s', (durationSeconds) => {
    expect(() => parseCatalog(catalogWithVideo({ durationSeconds }))).toThrow(/entier sûr/)
  })

  it('accepts MAX_SAFE_INTEGER as a duration', () => {
    expect(parseCatalog(catalogWithVideo({ durationSeconds: Number.MAX_SAFE_INTEGER })).videos[0].durationSeconds)
      .toBe(Number.MAX_SAFE_INTEGER)
  })

  it('requires ready chapters to start at zero', () => {
    expect(() => parseCatalog(catalogWithVideo({
      chapters: [
        { startSeconds: 1, title: 'Ouverture retardée' },
        validChapters[1],
        validChapters[2],
      ],
    }))).toThrow(/commencer à 0/)
  })

  it('requires ready chapter timestamps to be strictly increasing', () => {
    expect(() => parseCatalog(catalogWithVideo({
      chapters: [
        validChapters[0],
        { startSeconds: 300, title: 'Premier thème abordé' },
        { startSeconds: 300, title: 'Timestamp dupliqué' },
      ],
    }))).toThrow(/strictement croissants/)
  })

  it.each([0, 1, 2, 61])('rejects %s chapters for a ready video', (length) => {
    expect(() => parseCatalog(catalogWithVideo({ chapters: chaptersOfLength(length) })))
      .toThrow(/entre 3 et 60/)
  })

  it('accepts sixty ordered chapters for a ready video', () => {
    expect(parseCatalog(catalogWithVideo({ chapters: chaptersOfLength(60) })).videos[0].chapters)
      .toHaveLength(60)
  })

  it.each([3_600, 3_601])('rejects a chapter at or beyond the video duration (%s)', (startSeconds) => {
    expect(() => parseCatalog(catalogWithVideo({
      chapters: [
        validChapters[0],
        validChapters[1],
        { ...validChapters[2], startSeconds },
      ],
    }))).toThrow(/hors durée/)
  })

  it('requires a chapter source for a ready video', () => {
    expect(() => parseCatalog(catalogWithVideo({ chapterSource: null })))
      .toThrow(/source de chapitres est requise/)
  })

  it.each(['pending', 'retry', 'unavailable'] as const)('accepts an empty %s video', (chapterStatus) => {
    expect(() => parseCatalog(catalogWithVideo({
      chapterStatus,
      chapterSource: null,
      chapters: [],
    }))).not.toThrow()
  })

  it.each([
    ['pending', 'video', 'none'],
    ['retry', 'video', 'none'],
    ['unavailable', 'video', 'none'],
    ['live', 'live', 'live'],
    ['upcoming', 'live', 'upcoming'],
  ] as const)('requires a null source for %s', (chapterStatus, kind, liveStatus) => {
    expect(() => parseCatalog(catalogWithVideo({
      chapterStatus,
      kind,
      liveStatus,
      chapterSource: 'ai-transcript',
      chapters: [],
    }))).toThrow(/source de chapitres doit être nulle/)
  })

  it.each([
    ['pending', 'video', 'none'],
    ['retry', 'video', 'none'],
    ['unavailable', 'video', 'none'],
    ['live', 'live', 'live'],
    ['upcoming', 'live', 'upcoming'],
  ] as const)('requires empty chapters for %s', (chapterStatus, kind, liveStatus) => {
    expect(() => parseCatalog(catalogWithVideo({
      chapterStatus,
      kind,
      liveStatus,
      chapterSource: null,
      chapters: validChapters,
    }))).toThrow(/chapitres doivent être vides/)
  })

  it.each([
    ['live', 'live'],
    ['upcoming', 'upcoming'],
  ] as const)('accepts the coherent active %s state', (chapterStatus, liveStatus) => {
    expect(() => parseCatalog(catalogWithVideo({
      kind: 'live',
      liveStatus,
      chapterStatus,
      chapterSource: null,
      chapters: [],
    }))).not.toThrow()
  })

  it.each(['live', 'upcoming'] as const)('rejects chapter status %s on a standard video', (chapterStatus) => {
    expect(() => parseCatalog(catalogWithVideo({
      chapterStatus,
      chapterSource: null,
      chapters: [],
    }))).toThrow(/incohérent/)
  })

  it.each([
    ['live', 'upcoming'],
    ['upcoming', 'live'],
  ] as const)('rejects chapter status %s with live status %s', (chapterStatus, liveStatus) => {
    expect(() => parseCatalog(catalogWithVideo({
      kind: 'live',
      liveStatus,
      chapterStatus,
      chapterSource: null,
      chapters: [],
    }))).toThrow(/incohérent/)
  })

  it.each([
    ['live', 'pending'],
    ['upcoming', 'retry'],
  ] as const)('rejects active live status %s with chapter status %s', (liveStatus, chapterStatus) => {
    expect(() => parseCatalog(catalogWithVideo({
      kind: 'live',
      liveStatus,
      chapterStatus,
      chapterSource: null,
      chapters: [],
    }))).toThrow(/incohérent/)
  })

  it.each([
    ['ready', 'ai-transcript', validChapters],
    ['pending', null, []],
    ['retry', null, []],
    ['unavailable', null, []],
  ] as const)('accepts a replay in chapter state %s', (chapterStatus, chapterSource, chapters) => {
    expect(() => parseCatalog(catalogWithVideo({
      kind: 'live',
      liveStatus: 'none',
      chapterStatus,
      chapterSource,
      chapters,
    }))).not.toThrow()
  })

  it.each(['live', 'upcoming'] as const)('rejects liveStatus %s for kind video', (liveStatus) => {
    expect(() => parseCatalog(catalogWithVideo({ liveStatus }))).toThrow(/vidéo standard/)
  })
})

describe('source catalog contract', () => {
  it('accepts a complete source catalog', () => {
    expect(parseSourceCatalog(validSourceCatalog)).toEqual(validSourceCatalog)
  })

  it('accepts RFC3339 offsets for source timestamps', () => {
    const input = {
      ...validSourceCatalog,
      syncedAt: '2026-01-01T01:00:00+01:00',
      videos: [{ ...validSourceCatalog.videos[0], publishedAt: '2024-02-29T23:59:59.123-05:00' }],
    }
    expect(parseSourceCatalog(input)).toEqual(input)
  })

  it.each(invalidRfc3339Timestamps)('rejects source syncedAt %s', (syncedAt) => {
    expect(() => parseSourceCatalog({ ...validSourceCatalog, syncedAt })).toThrow(/Horodatage/)
  })

  it.each(invalidRfc3339Timestamps)('rejects source publishedAt %s', (publishedAt) => {
    expect(() => parseSourceCatalog(sourceCatalogWithVideo({ publishedAt }))).toThrow(/Horodatage/)
  })

  it('rejects duplicate source video ids', () => {
    expect(() => parseSourceCatalog({
      ...validSourceCatalog,
      playlistItemCount: 2,
      videos: [...validSourceCatalog.videos, validSourceCatalog.videos[0]],
    })).toThrow(/dupliqué/)
  })

  it('accepts a distinct unavailable source video id', () => {
    const input = {
      ...validSourceCatalog,
      playlistItemCount: 2,
      unavailableVideoIds: ['bbbbbbbbbbb'],
    }
    expect(parseSourceCatalog(input)).toEqual(input)
  })

  it('rejects a malformed unavailable source video id', () => {
    expect(() => parseSourceCatalog({
      ...validSourceCatalog,
      playlistItemCount: 2,
      unavailableVideoIds: ['short'],
    })).toThrow(/ID vidéo/)
  })

  it('rejects duplicate unavailable source video ids', () => {
    expect(() => parseSourceCatalog({
      ...validSourceCatalog,
      playlistItemCount: 3,
      unavailableVideoIds: ['bbbbbbbbbbb', 'bbbbbbbbbbb'],
    })).toThrow(/indisponible dupliqué/)
  })

  it('rejects an id present in source and unavailable videos', () => {
    expect(() => parseSourceCatalog({
      ...validSourceCatalog,
      playlistItemCount: 2,
      unavailableVideoIds: ['aaaaaaaaaaa'],
    })).toThrow(/publique et indisponible/)
  })

  it('requires an exact source playlist count', () => {
    expect(() => parseSourceCatalog({ ...validSourceCatalog, playlistItemCount: 2 }))
      .toThrow(/compte de playlist/)
  })

  it.each(invalidSafeIntegers)('rejects source playlistItemCount %s', (playlistItemCount) => {
    expect(() => parseSourceCatalog({ ...validSourceCatalog, playlistItemCount })).toThrow(/entier sûr/)
  })

  it.each(invalidSafeIntegers)('rejects source durationSeconds %s', (durationSeconds) => {
    expect(() => parseSourceCatalog(sourceCatalogWithVideo({ durationSeconds }))).toThrow(/entier sûr/)
  })

  it('accepts MAX_SAFE_INTEGER as a source duration', () => {
    expect(parseSourceCatalog(sourceCatalogWithVideo({
      durationSeconds: Number.MAX_SAFE_INTEGER,
    })).videos[0].durationSeconds).toBe(Number.MAX_SAFE_INTEGER)
  })

  it.each(['live', 'upcoming'] as const)('rejects source liveStatus %s for kind video', (liveStatus) => {
    expect(() => parseSourceCatalog(sourceCatalogWithVideo({ liveStatus }))).toThrow(/vidéo standard/)
  })

  it.each(['none', 'live', 'upcoming'] as const)('accepts source kind live with status %s', (liveStatus) => {
    expect(() => parseSourceCatalog(sourceCatalogWithVideo({
      kind: 'live',
      liveStatus,
    }))).not.toThrow()
  })
})
