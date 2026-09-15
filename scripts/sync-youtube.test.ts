// @vitest-environment node

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import channelFixture from '../tests/fixtures/youtube/channel.json'
import firstPlaylistFixture from '../tests/fixtures/youtube/playlist-1.json'
import secondPlaylistFixture from '../tests/fixtures/youtube/playlist-2.json'
import videosFixture from '../tests/fixtures/youtube/videos.json'
import { parseSourceCatalog } from '../src/domain/catalog'
import { runYouTubeSyncCli, syncYouTube } from './sync-youtube'

const temporaryDirectories: string[] = []

async function temporaryOutputPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'thinkerview-youtube-sync-'))
  temporaryDirectories.push(directory)
  return join(directory, 'youtube-videos.json')
}

function fixtureFetch(requests: URL[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    requests.push(url)

    if (url.pathname.endsWith('/channels')) {
      return Response.json(channelFixture)
    }
    if (url.pathname.endsWith('/playlistItems')) {
      return Response.json(url.searchParams.get('pageToken') === 'PAGE_2'
        ? secondPlaylistFixture
        : firstPlaylistFixture)
    }
    if (url.pathname.endsWith('/videos')) {
      const ids = new Set(url.searchParams.get('id')?.split(',') ?? [])
      return Response.json({ items: videosFixture.items.filter((video) => ids.has(video.id)) })
    }

    throw new Error(`Requête inattendue: ${url.pathname}`)
  }) as typeof fetch
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })))
})

describe('YouTube synchronization', () => {
  it('returns code 2 with a short message when the API key is absent', async () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const fetchImpl = vi.fn()

    const exitCode = await runYouTubeSyncCli({
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    })

    expect(exitCode).toBe(2)
    expect(stdout).toEqual([])
    expect(stderr).toEqual(['YOUTUBE_API_KEY manquante\n'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('writes a generic stderr message when an upstream error contains an encoded API key', async () => {
    const apiKey = 'fixture secret&key'
    const encodedApiKey = encodeURIComponent(encodeURIComponent(apiKey))
    const stdout: string[] = []
    const stderr: string[] = []
    const fetchImpl = (async () => Response.json({
      error: { message: `Échec pour ${encodedApiKey}` },
    }, { status: 403, statusText: 'Forbidden' })) as typeof fetch

    const exitCode = await runYouTubeSyncCli({
      env: { YOUTUBE_API_KEY: apiKey },
      fetchImpl,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    })

    expect(exitCode).toBe(1)
    expect(stdout).toEqual([])
    expect(stderr).toEqual(['Échec de la synchronisation YouTube\n'])
    expect(stderr.join('')).not.toContain(apiKey)
    expect(stderr.join('')).not.toContain(encodedApiKey)
    expect(stderr.join('')).not.toContain('key=')
  })

  it('writes a validated source catalog on the first synchronization', async () => {
    const outputPath = await temporaryOutputPath()
    const requests: URL[] = []

    const summary = await syncYouTube({
      apiKey: 'fixture-key',
      outputPath,
      now: new Date('2026-04-05T06:07:08.000Z'),
      fetchImpl: fixtureFetch(requests),
    })

    const file = await readFile(outputPath, 'utf8')
    const catalog = parseSourceCatalog(JSON.parse(file))
    expect(catalog.schemaVersion).toBe(1)
    expect(catalog.syncedAt).toBe('2026-04-05T06:07:08.000Z')
    expect(catalog.playlistItemCount).toBe(4)
    expect(catalog.videos).toHaveLength(3)
    expect(catalog.unavailableVideoIds).toEqual(['ddddddddddd'])
    expect(requests[0].pathname).toBe('/youtube/v3/channels')
    expect(await readdir(join(outputPath, '..'))).toEqual(['youtube-videos.json'])
    expect(summary).toEqual({
      channelId: 'UCQgWpmt02UtJkyO32HGUASQ',
      playlistItems: 4,
      publicVideos: 3,
      unavailable: 1,
      changed: true,
    })
  })

  it('keeps concurrent writes to one output path atomic and isolated', async () => {
    const outputPath = await temporaryOutputPath()
    const titles = Array.from({ length: 16 }, (_, index) => `Entretien concurrent ${index}`)
    const results = await Promise.allSettled(titles.map((title, index) => {
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname.endsWith('/channels')) {
          return Response.json(channelFixture)
        }
        if (url.pathname.endsWith('/playlistItems')) {
          return Response.json(url.searchParams.get('pageToken') === 'PAGE_2'
            ? secondPlaylistFixture
            : firstPlaylistFixture)
        }
        const ids = new Set(url.searchParams.get('id')?.split(',') ?? [])
        return Response.json({
          items: videosFixture.items
            .map((video) => video.id === 'aaaaaaaaaaa'
              ? { ...video, snippet: { ...video.snippet, title } }
              : video)
            .filter((video) => ids.has(video.id)),
        })
      }) as typeof fetch

      return syncYouTube({
        apiKey: 'fixture-key',
        outputPath,
        now: new Date(`2026-04-05T06:07:${String(index).padStart(2, '0')}.000Z`),
        fetchImpl,
      })
    }))

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
    const catalog = parseSourceCatalog(JSON.parse(await readFile(outputPath, 'utf8')))
    expect(titles).toContain(catalog.videos.find((video) => video.id === 'aaaaaaaaaaa')?.title)
    expect(await readdir(join(outputPath, '..'))).toEqual(['youtube-videos.json'])
  })

  it('preserves syncedAt and every byte when fetched data is unchanged', async () => {
    const outputPath = await temporaryOutputPath()
    const requests: URL[] = []

    await syncYouTube({
      apiKey: 'fixture-key',
      outputPath,
      now: new Date('2026-04-05T06:07:08.000Z'),
      fetchImpl: fixtureFetch(requests),
    })
    const firstBytes = await readFile(outputPath)

    const summary = await syncYouTube({
      apiKey: 'fixture-key',
      outputPath,
      now: new Date('2026-05-06T07:08:09.000Z'),
      fetchImpl: fixtureFetch(requests),
    })
    const secondBytes = await readFile(outputPath)

    expect(secondBytes.equals(firstBytes)).toBe(true)
    expect(parseSourceCatalog(JSON.parse(secondBytes.toString())).syncedAt)
      .toBe('2026-04-05T06:07:08.000Z')
    expect(requests.filter((url) => url.pathname.endsWith('/channels'))).toHaveLength(2)
    expect(summary.changed).toBe(false)
  })

  it('preserves the previous file when playlistItems.list omits items', async () => {
    const outputPath = await temporaryOutputPath()
    await syncYouTube({
      apiKey: 'fixture-key',
      outputPath,
      now: new Date('2026-04-05T06:07:08.000Z'),
      fetchImpl: fixtureFetch(),
    })
    const previousBytes = await readFile(outputPath)
    const fallbackFetch = fixtureFetch()
    const invalidFetch = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/playlistItems')) {
        return Response.json({})
      }
      return fallbackFetch(input)
    }) as typeof fetch

    await expect(syncYouTube({
      apiKey: 'fixture-key',
      outputPath,
      now: new Date('2026-05-06T07:08:09.000Z'),
      fetchImpl: invalidFetch,
    })).rejects.toThrow(/playlistItems\.list.*items/)

    expect((await readFile(outputPath)).equals(previousBytes)).toBe(true)
  })

  it('updates syncedAt when a new upload appears', async () => {
    const outputPath = await temporaryOutputPath()
    await syncYouTube({
      apiKey: 'fixture-key',
      outputPath,
      now: new Date('2026-04-05T06:07:08.000Z'),
      fetchImpl: fixtureFetch(),
    })

    const addedVideo = {
      id: 'eeeeeeeeeee',
      snippet: {
        title: 'Nouvel entretien',
        description: 'Une nouvelle publication',
        publishedAt: '2026-05-06T07:00:00Z',
        liveBroadcastContent: 'none',
        thumbnails: {
          high: { url: 'https://i.ytimg.com/vi/eeeeeeeeeee/hqdefault.jpg' },
        },
      },
      contentDetails: { duration: 'PT9S' },
      status: { embeddable: true },
    }
    const changedFetch = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      if (url.pathname.endsWith('/playlistItems')) {
        return Response.json({
          items: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee']
            .map((videoId) => ({ contentDetails: { videoId } })),
        })
      }
      if (url.pathname.endsWith('/videos')) {
        const ids = new Set(url.searchParams.get('id')?.split(',') ?? [])
        return Response.json({
          items: [...videosFixture.items, addedVideo].filter((video) => ids.has(video.id)),
        })
      }
      throw new Error(`Requête inattendue: ${url.pathname}`)
    }) as typeof fetch

    const summary = await syncYouTube({
      apiKey: 'fixture-key',
      outputPath,
      now: new Date('2026-05-06T07:08:09.000Z'),
      fetchImpl: changedFetch,
    })

    const catalog = parseSourceCatalog(JSON.parse(await readFile(outputPath, 'utf8')))
    expect(catalog.syncedAt).toBe('2026-05-06T07:08:09.000Z')
    expect(catalog.videos.map((video) => video.id)).toContain('eeeeeeeeeee')
    expect(summary.changed).toBe(true)
  })

  it('updates the catalog when video metadata changes', async () => {
    const outputPath = await temporaryOutputPath()
    await syncYouTube({
      apiKey: 'fixture-key',
      outputPath,
      now: new Date('2026-04-05T06:07:08.000Z'),
      fetchImpl: fixtureFetch(),
    })

    const changedFetch = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      if (url.pathname.endsWith('/playlistItems')) {
        return Response.json(url.searchParams.get('pageToken') === 'PAGE_2'
          ? secondPlaylistFixture
          : firstPlaylistFixture)
      }
      if (url.pathname.endsWith('/videos')) {
        const ids = new Set(url.searchParams.get('id')?.split(',') ?? [])
        return Response.json({
          items: videosFixture.items
            .map((video) => video.id === 'aaaaaaaaaaa'
              ? {
                  ...video,
                  snippet: { ...video.snippet, title: 'Entretien standard corrigé' },
                }
              : video)
            .filter((video) => ids.has(video.id)),
        })
      }
      throw new Error(`Requête inattendue: ${url.pathname}`)
    }) as typeof fetch

    const summary = await syncYouTube({
      apiKey: 'fixture-key',
      outputPath,
      now: new Date('2026-05-06T07:08:09.000Z'),
      fetchImpl: changedFetch,
    })

    const catalog = parseSourceCatalog(JSON.parse(await readFile(outputPath, 'utf8')))
    expect(catalog.syncedAt).toBe('2026-05-06T07:08:09.000Z')
    expect(catalog.videos.find((video) => video.id === 'aaaaaaaaaaa')?.title)
      .toBe('Entretien standard corrigé')
    expect(summary.changed).toBe(true)
  })

  it('updates the catalog when a video disappears', async () => {
    const outputPath = await temporaryOutputPath()
    await syncYouTube({
      apiKey: 'fixture-key',
      outputPath,
      now: new Date('2026-04-05T06:07:08.000Z'),
      fetchImpl: fixtureFetch(),
    })

    const changedFetch = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      if (url.pathname.endsWith('/playlistItems')) {
        return Response.json({
          items: ['bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd']
            .map((videoId) => ({ contentDetails: { videoId } })),
        })
      }
      if (url.pathname.endsWith('/videos')) {
        const ids = new Set(url.searchParams.get('id')?.split(',') ?? [])
        return Response.json({ items: videosFixture.items.filter((video) => ids.has(video.id)) })
      }
      throw new Error(`Requête inattendue: ${url.pathname}`)
    }) as typeof fetch

    const summary = await syncYouTube({
      apiKey: 'fixture-key',
      outputPath,
      now: new Date('2026-05-06T07:08:09.000Z'),
      fetchImpl: changedFetch,
    })

    const catalog = parseSourceCatalog(JSON.parse(await readFile(outputPath, 'utf8')))
    expect(catalog.syncedAt).toBe('2026-05-06T07:08:09.000Z')
    expect(catalog.videos.map((video) => video.id)).not.toContain('aaaaaaaaaaa')
    expect(catalog.playlistItemCount).toBe(3)
    expect(summary.changed).toBe(true)
  })

  it('updates the catalog when unavailableVideoIds changes', async () => {
    const outputPath = await temporaryOutputPath()
    await syncYouTube({
      apiKey: 'fixture-key',
      outputPath,
      now: new Date('2026-04-05T06:07:08.000Z'),
      fetchImpl: fixtureFetch(),
    })

    const changedFetch = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      if (url.pathname.endsWith('/playlistItems')) {
        return Response.json({
          items: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'eeeeeeeeeee']
            .map((videoId) => ({ contentDetails: { videoId } })),
        })
      }
      if (url.pathname.endsWith('/videos')) {
        const ids = new Set(url.searchParams.get('id')?.split(',') ?? [])
        return Response.json({ items: videosFixture.items.filter((video) => ids.has(video.id)) })
      }
      throw new Error(`Requête inattendue: ${url.pathname}`)
    }) as typeof fetch

    const summary = await syncYouTube({
      apiKey: 'fixture-key',
      outputPath,
      now: new Date('2026-05-06T07:08:09.000Z'),
      fetchImpl: changedFetch,
    })

    const catalog = parseSourceCatalog(JSON.parse(await readFile(outputPath, 'utf8')))
    expect(catalog.syncedAt).toBe('2026-05-06T07:08:09.000Z')
    expect(catalog.unavailableVideoIds).toEqual(['eeeeeeeeeee'])
    expect(summary.changed).toBe(true)
  })
})
