import { describe, expect, it } from 'vitest'

import channelFixture from '../../tests/fixtures/youtube/channel.json'
import firstPlaylistFixture from '../../tests/fixtures/youtube/playlist-1.json'
import secondPlaylistFixture from '../../tests/fixtures/youtube/playlist-2.json'
import videosFixture from '../../tests/fixtures/youtube/videos.json'
import { fetchYouTubeCatalog } from './youtube'

function fixtureFetch(requests: URL[]): typeof fetch {
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

describe('YouTube Data API client', () => {
  it('resolves the channel and its real uploads playlist from the handle', async () => {
    const requests: URL[] = []

    const catalog = await fetchYouTubeCatalog({
      apiKey: 'fixture-key',
      fetchImpl: fixtureFetch(requests),
    })

    const channelRequest = requests[0]
    expect(channelRequest.pathname).toBe('/youtube/v3/channels')
    expect(channelRequest.searchParams.get('part')).toBe('snippet,contentDetails')
    expect(channelRequest.searchParams.get('forHandle')).toBe('@thinkerview')
    expect(catalog.channel).toEqual({
      id: 'UCQgWpmt02UtJkyO32HGUASQ',
      handle: '@thinkerview',
      title: 'Thinkerview',
      url: 'https://www.youtube.com/@thinkerview',
      uploadsPlaylistId: 'UUQgWpmt02UtJkyO32HGUASQ',
    })
  })

  it('rejects ambiguous channel lookup results before fetching the playlist', async () => {
    const requests: URL[] = []
    const fallbackFetch = fixtureFetch(requests)
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        requests.push(url)
        return Response.json({ items: [channelFixture.items[0], channelFixture.items[0]] })
      }
      return fallbackFetch(input)
    }) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow(/channels\.list.*exactement une chaîne/)
    expect(requests).toHaveLength(1)
  })

  it('rejects a non-array channels.list items field', async () => {
    const fetchImpl = (async () => Response.json({ items: 'x' })) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow(/channels\.list.*items doit être un tableau/)
  })

  it('rejects a channel whose id is not the expected literal', async () => {
    const requests: URL[] = []
    const fallbackFetch = fixtureFetch(requests)
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        requests.push(url)
        return Response.json({
          items: [{ ...channelFixture.items[0], id: 'UC0000000000000000000000' }],
        })
      }
      return fallbackFetch(input)
    }) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow(/channels\.list.*ID de chaîne inattendu/)
    expect(requests).toHaveLength(1)
  })

  it('rejects a malformed uploads playlist before fetching it', async () => {
    const requests: URL[] = []
    const fallbackFetch = fixtureFetch(requests)
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        requests.push(url)
        return Response.json({
          items: [{
            ...channelFixture.items[0],
            contentDetails: { relatedPlaylists: { uploads: 42 } },
          }],
        })
      }
      return fallbackFetch(input)
    }) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow(/channels\.list.*playlist uploads invalide/)
    expect(requests).toHaveLength(1)
  })

  it('follows every uploads playlist page with fifty items requested', async () => {
    const requests: URL[] = []

    const catalog = await fetchYouTubeCatalog({
      apiKey: 'fixture-key',
      fetchImpl: fixtureFetch(requests),
    })

    const playlistRequests = requests.filter((url) => url.pathname.endsWith('/playlistItems'))
    expect(playlistRequests).toHaveLength(2)
    expect(playlistRequests[0].searchParams.get('part')).toBe('contentDetails,snippet,status')
    expect(playlistRequests[0].searchParams.get('playlistId')).toBe('UUQgWpmt02UtJkyO32HGUASQ')
    expect(playlistRequests[0].searchParams.get('maxResults')).toBe('50')
    expect(playlistRequests[0].searchParams.has('pageToken')).toBe(false)
    expect(playlistRequests[1].searchParams.get('pageToken')).toBe('PAGE_2')
    expect(catalog.playlistItemCount).toBe(4)
  })

  it('rejects a playlist item without a videoId instead of dropping it', async () => {
    const requests: URL[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      requests.push(url)
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      if (url.pathname.endsWith('/playlistItems')) {
        return Response.json({ items: [{ contentDetails: {} }] })
      }
      return Response.json({ items: [] })
    }) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow(/playlistItems\.list.*videoId/)
    expect(requests.map((url) => url.pathname)).toEqual([
      '/youtube/v3/channels',
      '/youtube/v3/playlistItems',
    ])
  })

  it('rejects a malformed playlist videoId', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      if (url.pathname.endsWith('/playlistItems')) {
        return Response.json({ items: [{ contentDetails: { videoId: 'short' } }] })
      }
      return Response.json({ items: [] })
    }) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow(/playlistItems\.list.*videoId invalide/)
  })

  it('rejects a malformed playlist item resource', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      return Response.json({ items: [null] })
    }) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow(/playlistItems\.list.*ressource.*index 0/)
  })

  it('rejects a malformed nextPageToken before requesting another page', async () => {
    const requests: URL[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      requests.push(url)
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      return Response.json(url.searchParams.has('pageToken')
        ? { items: [] }
        : { items: [], nextPageToken: 42 })
    }) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow(/playlistItems\.list.*nextPageToken/)
    expect(requests).toHaveLength(2)
  })

  it('rejects a repeated nextPageToken instead of looping', async () => {
    let playlistRequestCount = 0
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      if (url.pathname.endsWith('/playlistItems')) {
        playlistRequestCount += 1
        if (playlistRequestCount > 2) {
          throw new Error('La pagination aurait continué')
        }
        return Response.json({ items: [], nextPageToken: 'LOOP' })
      }
      return Response.json({ items: [] })
    }) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow(/playlistItems\.list.*nextPageToken répété/)
    expect(playlistRequestCount).toBe(2)
  })

  it('loads video details in batches of at most fifty ids', async () => {
    const videoIds = Array.from({ length: 101 }, (_, index) => `v${String(index).padStart(10, '0')}`)
    const requests: URL[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      requests.push(url)

      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      if (url.pathname.endsWith('/playlistItems')) {
        return Response.json({
          items: videoIds.map((videoId) => ({ contentDetails: { videoId } })),
        })
      }
      if (url.pathname.endsWith('/videos')) {
        return Response.json({ items: [] })
      }
      throw new Error(`Requête inattendue: ${url.pathname}`)
    }) as typeof fetch

    await fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl })

    const videoRequests = requests.filter((url) => url.pathname.endsWith('/videos'))
    expect(videoRequests).toHaveLength(3)
    expect(videoRequests.map((url) => url.searchParams.get('id')?.split(',').length)).toEqual([50, 50, 1])
    expect(videoRequests[0].searchParams.get('part')).toBe('snippet,contentDetails,status,liveStreamingDetails')
  })

  it('rejects videos.list responses that omit items', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      if (url.pathname.endsWith('/playlistItems')) {
        return Response.json({ items: [{ contentDetails: { videoId: 'aaaaaaaaaaa' } }] })
      }
      return Response.json({})
    }) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow(/videos\.list.*items/)
  })

  it('rejects a malformed videos.list resource', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      if (url.pathname.endsWith('/playlistItems')) {
        return Response.json({ items: [{ contentDetails: { videoId: 'aaaaaaaaaaa' } }] })
      }
      return Response.json({ items: [null] })
    }) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow(/videos\.list.*ressource.*index 0/)
  })

  it('rejects a videos.list resource with invalid required metadata', async () => {
    const invalidVideo = {
      ...videosFixture.items[0],
      snippet: { ...videosFixture.items[0].snippet, publishedAt: 'not-a-date' },
    }
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      if (url.pathname.endsWith('/playlistItems')) {
        return Response.json({ items: [{ contentDetails: { videoId: invalidVideo.id } }] })
      }
      return Response.json({ items: [invalidVideo] })
    }) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow(/videos\.list.*ressource.*index 0/)
  })

  it('rejects an array used as liveStreamingDetails', async () => {
    const invalidVideo = { ...videosFixture.items[0], liveStreamingDetails: [] }
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      if (url.pathname.endsWith('/playlistItems')) {
        return Response.json({ items: [{ contentDetails: { videoId: invalidVideo.id } }] })
      }
      return Response.json({ items: [invalidVideo] })
    }) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow(/videos\.list.*ressource.*index 0/)
  })

  it('normalizes public video details, including completed livestreams', async () => {
    const catalog = await fetchYouTubeCatalog({
      apiKey: 'fixture-key',
      fetchImpl: fixtureFetch([]),
    })

    expect(catalog.videos).toEqual([
      {
        id: 'bbbbbbbbbbb',
        title: 'Ancien direct',
        description: 'Ce direct est désormais disponible en replay',
        publishedAt: '2025-03-01T10:00:00Z',
        durationSeconds: 2_700,
        thumbnailUrl: 'https://i.ytimg.com/vi/bbbbbbbbbbb/sddefault.jpg',
        embeddable: false,
        kind: 'live',
        liveStatus: 'none',
      },
      {
        id: 'aaaaaaaaaaa',
        title: 'Entretien standard',
        description: 'Description de la vidéo standard',
        publishedAt: '2025-02-01T10:00:00Z',
        durationSeconds: 7_384,
        thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg',
        embeddable: true,
        kind: 'video',
        liveStatus: 'none',
      },
      {
        id: 'ccccccccccc',
        title: 'Direct programmé',
        description: 'Une prochaine émission',
        publishedAt: '2025-02-01T10:00:00Z',
        durationSeconds: 0,
        thumbnailUrl: 'https://i.ytimg.com/vi/ccccccccccc/default.jpg',
        embeddable: true,
        kind: 'live',
        liveStatus: 'upcoming',
      },
    ])
  })

  it('reports playlist ids omitted from videos.list as unavailable', async () => {
    const catalog = await fetchYouTubeCatalog({
      apiKey: 'fixture-key',
      fetchImpl: fixtureFetch([]),
    })

    expect(catalog.unavailableVideoIds).toEqual(['ddddddddddd'])
    expect(catalog.playlistItemCount).toBe(catalog.videos.length + catalog.unavailableVideoIds.length)
  })

  it('rejects invalid JSON with a stable endpoint error', async () => {
    const fetchImpl = (async () => new Response('{', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

    await expect(fetchYouTubeCatalog({ apiKey: 'fixture-key', fetchImpl }))
      .rejects.toThrow('Réponse YouTube channels.list invalide: JSON illisible')
  })

  it('rejects a 2xx videos.list error envelope without propagating its message', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/channels')) {
        return Response.json(channelFixture)
      }
      if (url.pathname.endsWith('/playlistItems')) {
        return Response.json({ items: [{ contentDetails: { videoId: 'aaaaaaaaaaa' } }] })
      }
      return Response.json({ error: { message: 'Quota dépassé' } })
    }) as typeof fetch

    const error = await fetchYouTubeCatalog({
      apiKey: 'fixture-key',
      fetchImpl,
    }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Erreur YouTube videos.list')
    expect((error as Error).message).not.toContain('Quota dépassé')
  })

  it('does not expose the API key from a network error message', async () => {
    const apiKey = 'fixture-secret-key'
    const fetchImpl = (async (input: string | URL | Request) => {
      throw new Error(`Échec réseau pour ${input.toString()} avec ${apiKey}`)
    }) as typeof fetch

    const error = await fetchYouTubeCatalog({ apiKey, fetchImpl }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Erreur réseau YouTube channels.list')
    expect((error as Error).message).not.toContain(apiKey)
    expect((error as Error).message).not.toContain('googleapis.com')
    expect(JSON.stringify(error)).not.toContain(apiKey)
  })

  it('reports stable HTTP errors without leaking the API key', async () => {
    const apiKey = 'fixture-secret-key'
    const fetchImpl = (async (input: string | URL | Request) => Response.json({
      error: { message: `Quota dépassé pour ${input.toString()} avec ${apiKey}` },
    }, { status: 403, statusText: 'Forbidden' })) as typeof fetch

    const error = await fetchYouTubeCatalog({ apiKey, fetchImpl }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Erreur YouTube channels.list (HTTP 403)')
    expect((error as Error).message).not.toContain('Quota dépassé')
    expect((error as Error).message).not.toContain(apiKey)
    expect((error as Error).message).not.toContain('key=')
    expect(JSON.stringify(error)).not.toContain(apiKey)
  })

  it('redacts a form-encoded API key from an API error', async () => {
    const apiKey = 'fixture secret&key'
    const encodedApiKey = new URLSearchParams({ key: apiKey }).toString().slice('key='.length)
    const fetchImpl = (async () => Response.json({
      error: { message: `Quota dépassé pour ${encodedApiKey}` },
    }, { status: 403, statusText: 'Forbidden' })) as typeof fetch

    const error = await fetchYouTubeCatalog({ apiKey, fetchImpl }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Erreur YouTube channels.list (HTTP 403)')
    expect((error as Error).message).not.toContain(apiKey)
    expect((error as Error).message).not.toContain(encodedApiKey)
  })

  it('does not expose a repeatedly encoded API key in the error message', async () => {
    const apiKey = 'fixture secret&key'
    const encodedApiKey = encodeURIComponent(encodeURIComponent(apiKey))
    const fetchImpl = (async () => Response.json({
      error: { message: `Quota dépassé pour ${encodedApiKey}` },
    }, { status: 403, statusText: 'Forbidden' })) as typeof fetch

    const error = await fetchYouTubeCatalog({ apiKey, fetchImpl }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Erreur YouTube channels.list (HTTP 403)')
    expect((error as Error).message).not.toContain(encodedApiKey)
  })
})
