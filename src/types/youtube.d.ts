declare namespace YT {
  type PlayerState = -1 | 0 | 1 | 2 | 3 | 5

  const PlayerState: Readonly<{
    UNSTARTED: -1
    ENDED: 0
    PLAYING: 1
    PAUSED: 2
    BUFFERING: 3
    CUED: 5
  }>

  interface PlayerEvent {
    target: Player
  }

  interface OnErrorEvent extends PlayerEvent {
    data: number
  }

  interface OnStateChangeEvent extends PlayerEvent {
    data: PlayerState
  }

  interface PlayerOptions {
    host?: string
    playerVars?: {
      playsinline?: 0 | 1
      enablejsapi?: 0 | 1
      origin?: string
    }
    events?: {
      onReady?: (event: PlayerEvent) => void
      onError?: (event: OnErrorEvent) => void
      onStateChange?: (event: OnStateChangeEvent) => void
    }
  }

  interface VideoByIdOptions {
    videoId: string
    startSeconds?: number
  }

  class Player {
    constructor(element: HTMLElement | string, options: PlayerOptions)
    cueVideoById(videoId: string, startSeconds?: number): void
    loadVideoById(options: VideoByIdOptions): void
    seekTo(seconds: number, allowSeekAhead: boolean): void
    playVideo(): void
    getCurrentTime(): number
    getPlayerState(): PlayerState
    destroy(): void
  }
}

interface Window {
  YT?: typeof YT
  onYouTubeIframeAPIReady?: () => void
}
