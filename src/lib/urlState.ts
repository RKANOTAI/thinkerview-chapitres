import { VIDEO_ID_PATTERN } from '../domain/catalog'

export interface PlayerUrlState {
  videoId: string | null
  startSeconds: number
}

function isValidStartSeconds(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function parseStartSeconds(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) {
    return 0
  }
  const seconds = Number(value)
  return isValidStartSeconds(seconds) ? seconds : 0
}

export function parsePlayerUrl(search: string): PlayerUrlState {
  const parameters = new URLSearchParams(search)
  const videoId = parameters.get('v')
  if (videoId === null || !VIDEO_ID_PATTERN.test(videoId)) {
    return { videoId: null, startSeconds: 0 }
  }

  return {
    videoId,
    startSeconds: parseStartSeconds(parameters.get('t')),
  }
}

export function buildPlayerUrl(baseUrl: URL, state: PlayerUrlState): string {
  const url = new URL(baseUrl.href)
  url.search = ''
  url.hash = ''
  if (state.videoId !== null && VIDEO_ID_PATTERN.test(state.videoId)) {
    url.searchParams.set('v', state.videoId)
    if (isValidStartSeconds(state.startSeconds) && state.startSeconds > 0) {
      url.searchParams.set('t', String(state.startSeconds))
    }
  }
  return url.href
}

export function replacePlayerUrl(state: PlayerUrlState): void {
  const url = buildPlayerUrl(new URL(window.location.href), state)
  window.history.replaceState(window.history.state, '', url)
}
