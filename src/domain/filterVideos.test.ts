import { describe, expect, it } from 'vitest'

import type { CatalogVideo } from './catalog'
import { filterVideos } from './filterVideos'

function makeVideo(overrides: Partial<CatalogVideo> = {}): CatalogVideo {
  return {
    id: 'aaaaaaaaaaa',
    title: 'Énergie et souveraineté',
    publishedAt: '2025-01-04T00:00:00Z',
    durationSeconds: 3_600,
    thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg',
    embeddable: true,
    kind: 'video',
    liveStatus: 'none',
    descriptionExcerpt: 'Présentation de la vidéo',
    chapterStatus: 'ready',
    chapterSource: 'ai-transcript',
    chapters: [
      { startSeconds: 0, title: 'Ouverture et présentation' },
      { startSeconds: 300, title: 'Premier thème abordé' },
      { startSeconds: 720, title: 'Deuxième thème abordé' },
    ],
    ...overrides,
  }
}

describe('filterVideos', () => {
  it('sorts recent videos first without mutating its input', () => {
    const videos = [
      makeVideo({ id: 'bbbbbbbbbbb', publishedAt: '2025-01-01T00:00:00Z' }),
      makeVideo({ id: 'aaaaaaaaaaa', publishedAt: '2025-01-04T00:00:00Z' }),
    ]
    const snapshot = structuredClone(videos)

    const result = filterVideos(videos, { query: '', filter: 'all', order: 'recent' })

    expect(result.map((video) => video.id)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb'])
    expect(videos).toEqual(snapshot)
  })

  it('searches titles without case or accent sensitivity', () => {
    const videos = [
      makeVideo({ id: 'aaaaaaaaaaa', title: 'Énergie et souveraineté' }),
      makeVideo({ id: 'bbbbbbbbbbb', title: 'Économie et institutions' }),
    ]

    const result = filterVideos(videos, { query: '  ENERGIE  ', filter: 'all', order: 'recent' })

    expect(result.map((video) => video.id)).toEqual(['aaaaaaaaaaa'])
  })

  it('searches chapter titles', () => {
    const videos = [
      makeVideo({
        id: 'aaaaaaaaaaa',
        title: 'Entretien avec une chercheuse',
        chapters: [
          { startSeconds: 0, title: 'Présentation générale' },
          { startSeconds: 300, title: 'GÉOPOLITIQUE européenne' },
          { startSeconds: 720, title: 'Questions du public' },
        ],
      }),
      makeVideo({ id: 'bbbbbbbbbbb', title: 'Économie et institutions' }),
    ]

    const result = filterVideos(videos, { query: 'geopolitique', filter: 'all', order: 'recent' })

    expect(result.map((video) => video.id)).toEqual(['aaaaaaaaaaa'])
  })

  it('filters standard videos', () => {
    const videos = [
      makeVideo({ id: 'aaaaaaaaaaa', kind: 'video' }),
      makeVideo({
        id: 'bbbbbbbbbbb',
        kind: 'live',
        liveStatus: 'none',
      }),
    ]

    const result = filterVideos(videos, { query: '', filter: 'video', order: 'recent' })

    expect(result.map((video) => video.id)).toEqual(['aaaaaaaaaaa'])
  })

  it('filters every live upload, including replays', () => {
    const videos = [
      makeVideo({ id: 'aaaaaaaaaaa', kind: 'video' }),
      makeVideo({
        id: 'bbbbbbbbbbb',
        kind: 'live',
        liveStatus: 'none',
      }),
      makeVideo({
        id: 'ccccccccccc',
        kind: 'live',
        liveStatus: 'live',
        chapterStatus: 'live',
        chapterSource: null,
        chapters: [],
      }),
    ]

    const result = filterVideos(videos, { query: '', filter: 'live', order: 'recent' })

    expect(result.map((video) => video.id)).toEqual(['bbbbbbbbbbb', 'ccccccccccc'])
  })

  it('filters videos whose chapters are ready', () => {
    const videos = [
      makeVideo({ id: 'aaaaaaaaaaa', chapterStatus: 'ready' }),
      makeVideo({
        id: 'bbbbbbbbbbb',
        chapterStatus: 'pending',
        chapterSource: null,
        chapters: [],
      }),
    ]

    const result = filterVideos(videos, { query: '', filter: 'with-chapters', order: 'recent' })

    expect(result.map((video) => video.id)).toEqual(['aaaaaaaaaaa'])
  })

  it('filters every video without ready chapters', () => {
    const videos = [
      makeVideo({ id: 'aaaaaaaaaaa', chapterStatus: 'ready' }),
      makeVideo({ id: 'bbbbbbbbbbb', chapterStatus: 'pending', chapterSource: null, chapters: [] }),
      makeVideo({ id: 'ccccccccccc', chapterStatus: 'retry', chapterSource: null, chapters: [] }),
      makeVideo({ id: 'ddddddddddd', chapterStatus: 'unavailable', chapterSource: null, chapters: [] }),
      makeVideo({
        id: 'eeeeeeeeeee',
        kind: 'live',
        liveStatus: 'live',
        chapterStatus: 'live',
        chapterSource: null,
        chapters: [],
      }),
      makeVideo({
        id: 'fffffffffff',
        kind: 'live',
        liveStatus: 'upcoming',
        chapterStatus: 'upcoming',
        chapterSource: null,
        chapters: [],
      }),
    ]

    const result = filterVideos(videos, { query: '', filter: 'without-chapters', order: 'recent' })

    expect(result.map((video) => video.id)).toEqual([
      'bbbbbbbbbbb',
      'ccccccccccc',
      'ddddddddddd',
      'eeeeeeeeeee',
      'fffffffffff',
    ])
  })

  it('sorts oldest videos first by their absolute publication time', () => {
    const videos = [
      makeVideo({ id: 'bbbbbbbbbbb', publishedAt: '2025-01-01T00:00:00Z' }),
      makeVideo({ id: 'aaaaaaaaaaa', publishedAt: '2025-01-01T01:00:00+02:00' }),
    ]

    const result = filterVideos(videos, { query: '', filter: 'all', order: 'oldest' })

    expect(result.map((video) => video.id)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb'])
  })

  it('sorts an accepted RFC3339 leap second chronologically', () => {
    const videos = [
      makeVideo({ id: 'bbbbbbbbbbb', publishedAt: '1990-12-31T23:59:60Z' }),
      makeVideo({ id: 'aaaaaaaaaaa', publishedAt: '1990-12-31T23:59:59Z' }),
      makeVideo({ id: 'ccccccccccc', publishedAt: '1991-01-01T00:00:00Z' }),
    ]

    const recent = filterVideos(videos, { query: '', filter: 'all', order: 'recent' })
    const oldest = filterVideos(videos, { query: '', filter: 'all', order: 'oldest' })

    expect(recent.map((video) => video.id)).toEqual(['ccccccccccc', 'bbbbbbbbbbb', 'aaaaaaaaaaa'])
    expect(oldest.map((video) => video.id)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'])
  })
})
