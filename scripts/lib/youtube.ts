import {
  sourceVideoSchema,
  VIDEO_ID_PATTERN,
  type SourceCatalog,
  type SourceVideo,
} from '../../src/domain/catalog'
import { parseIsoDuration } from '../../src/domain/time'

const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3'
const THINKERVIEW_HANDLE = '@thinkerview'
const THINKERVIEW_CHANNEL_ID = 'UCQgWpmt02UtJkyO32HGUASQ'
const THINKERVIEW_URL = 'https://www.youtube.com/@thinkerview'

export type YouTubeCatalogData = Pick<
  SourceCatalog,
  'channel' | 'playlistItemCount' | 'unavailableVideoIds' | 'videos'
>

export interface FetchYouTubeCatalogOptions {
  apiKey: string
  fetchImpl?: typeof fetch
}

interface ListResponse {
  items: unknown[]
  nextPageToken: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseListResponse(value: unknown, endpoint: string): ListResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error(`Réponse ${endpoint}.list invalide: items doit être un tableau`)
  }
  return { items: value.items, nextPageToken: value.nextPageToken }
}

async function requestJson(
  endpoint: string,
  searchParams: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const url = new URL(`${YOUTUBE_API_BASE_URL}/${endpoint}`)
  for (const [name, value] of Object.entries(searchParams)) {
    url.searchParams.set(name, value)
  }

  let response: Response
  try {
    response = await fetchImpl(url)
  } catch {
    throw new Error(`Erreur réseau YouTube ${endpoint}.list`)
  }
  if (!response.ok) {
    throw new Error(`Erreur YouTube ${endpoint}.list (HTTP ${response.status})`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Réponse YouTube ${endpoint}.list invalide: JSON illisible`)
  }
  if (isRecord(payload) && Object.hasOwn(payload, 'error')) {
    throw new Error(`Erreur YouTube ${endpoint}.list`)
  }
  return payload
}

async function fetchPlaylistVideoIds(
  uploadsPlaylistId: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  const videoIds: string[] = []
  const seenPageTokens = new Set<string>()
  let pageToken: string | undefined

  do {
    const searchParams: Record<string, string> = {
      part: 'contentDetails,snippet,status',
      playlistId: uploadsPlaylistId,
      maxResults: '50',
      key: apiKey,
    }
    if (pageToken) {
      searchParams.pageToken = pageToken
    }

    const response = parseListResponse(
      await requestJson('playlistItems', searchParams, fetchImpl),
      'playlistItems',
    )
    for (const [itemIndex, item] of response.items.entries()) {
      if (!isRecord(item)) {
        throw new Error(`Réponse playlistItems.list invalide: ressource invalide à l’index ${itemIndex}`)
      }
      const contentDetails = item.contentDetails
      const videoId = isRecord(contentDetails) ? contentDetails.videoId : undefined
      if (typeof videoId !== 'string' || videoId.length === 0) {
        throw new Error(`Réponse playlistItems.list invalide: videoId manquant à l’index ${itemIndex}`)
      }
      if (!VIDEO_ID_PATTERN.test(videoId)) {
        throw new Error(`Réponse playlistItems.list invalide: videoId invalide à l’index ${itemIndex}`)
      }
      videoIds.push(videoId)
    }
    const nextPageToken = response.nextPageToken
    if (nextPageToken !== undefined && (typeof nextPageToken !== 'string' || nextPageToken.length === 0)) {
      throw new Error('Réponse playlistItems.list invalide: nextPageToken invalide')
    }
    if (nextPageToken !== undefined && seenPageTokens.has(nextPageToken)) {
      throw new Error('Réponse playlistItems.list invalide: nextPageToken répété')
    }
    if (nextPageToken !== undefined) {
      seenPageTokens.add(nextPageToken)
    }
    pageToken = nextPageToken
  } while (pageToken)

  return videoIds
}

async function fetchVideoDetails(
  videoIds: string[],
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<unknown[]> {
  const videos: unknown[] = []

  for (let index = 0; index < videoIds.length; index += 50) {
    const response = parseListResponse(await requestJson('videos', {
      part: 'snippet,contentDetails,status,liveStreamingDetails',
      id: videoIds.slice(index, index + 50).join(','),
      key: apiKey,
    }, fetchImpl), 'videos')
    videos.push(...response.items)
  }

  return videos
}

function normalizeVideo(resource: unknown, itemIndex: number): SourceVideo {
  if (!isRecord(resource)) {
    throw new Error(`Réponse videos.list invalide: ressource invalide à l’index ${itemIndex}`)
  }
  const { id, snippet, contentDetails, status, liveStreamingDetails } = resource
  if (!isRecord(snippet) || !isRecord(contentDetails) || !isRecord(status)) {
    throw new Error(`Réponse videos.list invalide: ressource invalide à l’index ${itemIndex}`)
  }
  const liveStatus = snippet.liveBroadcastContent
  const thumbnails = snippet.thumbnails
  const thumbnailUrl = (['maxres', 'standard', 'high', 'medium', 'default'] as const)
    .map((name) => isRecord(thumbnails) && isRecord(thumbnails[name])
      ? thumbnails[name].url
      : undefined)
    .find((url): url is string => typeof url === 'string' && url.length > 0)

  if (
    typeof id !== 'string'
    || id.length === 0
    || typeof snippet.title !== 'string'
    || snippet.title.length === 0
    || typeof snippet.description !== 'string'
    || typeof snippet.publishedAt !== 'string'
    || snippet.publishedAt.length === 0
    || typeof contentDetails.duration !== 'string'
    || contentDetails.duration.length === 0
    || typeof status.embeddable !== 'boolean'
    || !thumbnailUrl
    || (liveStatus !== 'none' && liveStatus !== 'live' && liveStatus !== 'upcoming')
    || (liveStreamingDetails !== undefined && !isRecord(liveStreamingDetails))
  ) {
    throw new Error(`Réponse videos.list invalide: ressource invalide à l’index ${itemIndex}`)
  }

  let durationSeconds: number
  try {
    durationSeconds = parseIsoDuration(contentDetails.duration)
  } catch {
    throw new Error(`Réponse videos.list invalide: ressource invalide à l’index ${itemIndex}`)
  }

  const parsed = sourceVideoSchema.safeParse({
    id,
    title: snippet.title,
    description: snippet.description,
    publishedAt: snippet.publishedAt,
    durationSeconds,
    thumbnailUrl,
    embeddable: status.embeddable,
    kind: liveStreamingDetails === undefined ? 'video' : 'live',
    liveStatus,
  })
  if (!parsed.success) {
    throw new Error(`Réponse videos.list invalide: ressource invalide à l’index ${itemIndex}`)
  }
  return parsed.data
}

function compareVideos(left: SourceVideo, right: SourceVideo): number {
  const publishedOrder = Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
  if (publishedOrder !== 0) {
    return publishedOrder
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

export async function fetchYouTubeCatalog({
  apiKey,
  fetchImpl = fetch,
}: FetchYouTubeCatalogOptions): Promise<YouTubeCatalogData> {
  const response = parseListResponse(await requestJson('channels', {
    part: 'snippet,contentDetails',
    forHandle: THINKERVIEW_HANDLE,
    key: apiKey,
  }, fetchImpl), 'channels')
  if (response.items.length !== 1) {
    throw new Error('Réponse channels.list invalide: exactement une chaîne est requise')
  }
  const channel = response.items[0]
  if (!isRecord(channel)) {
    throw new Error('Réponse channels.list invalide: ressource chaîne invalide')
  }
  const snippet = channel.snippet
  const contentDetails = channel.contentDetails
  const relatedPlaylists = isRecord(contentDetails) ? contentDetails.relatedPlaylists : undefined
  const uploadsPlaylistId = isRecord(relatedPlaylists) ? relatedPlaylists.uploads : undefined

  if (channel.id !== THINKERVIEW_CHANNEL_ID) {
    throw new Error('Réponse channels.list invalide: ID de chaîne inattendu')
  }
  if (!isRecord(snippet) || snippet.title !== 'Thinkerview') {
    throw new Error('Réponse channels.list invalide: titre de chaîne invalide')
  }
  if (typeof uploadsPlaylistId !== 'string' || uploadsPlaylistId.trim().length === 0) {
    throw new Error('Réponse channels.list invalide: playlist uploads invalide')
  }

  const playlistVideoIds = await fetchPlaylistVideoIds(uploadsPlaylistId, apiKey, fetchImpl)
  const videos = (await fetchVideoDetails(playlistVideoIds, apiKey, fetchImpl))
    .map(normalizeVideo)
    .sort(compareVideos)
  const publicVideoIds = new Set(videos.map((video) => video.id))
  const unavailableVideoIds = playlistVideoIds.filter((videoId) => !publicVideoIds.has(videoId))

  return {
    channel: {
      id: channel.id,
      handle: THINKERVIEW_HANDLE,
      title: snippet.title,
      url: THINKERVIEW_URL,
      uploadsPlaylistId,
    },
    playlistItemCount: playlistVideoIds.length,
    unavailableVideoIds,
    videos,
  }
}
