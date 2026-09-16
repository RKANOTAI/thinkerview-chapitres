const IFRAME_API_URL = 'https://www.youtube.com/iframe_api'
const IFRAME_API_TIMEOUT_MS = 10_000

let iframeApiPromise: Promise<typeof YT> | null = null

function isYouTubeIframeApiReady(api: typeof YT | undefined): api is typeof YT {
  return api !== undefined && typeof api.Player === 'function'
}

export function loadYouTubeIframeApi(): Promise<typeof YT> {
  if (iframeApiPromise !== null) {
    return iframeApiPromise
  }

  if (isYouTubeIframeApiReady(window.YT)) {
    iframeApiPromise = Promise.resolve(window.YT)
    return iframeApiPromise
  }

  const existingReadyCallback = window.onYouTubeIframeAPIReady
  const hadExistingReadyCallback = Object.prototype.hasOwnProperty.call(
    window,
    'onYouTubeIframeAPIReady',
  )

  let resolveAttempt!: (api: typeof YT) => void
  let rejectAttempt!: (reason: unknown) => void
  const attemptPromise = new Promise<typeof YT>((resolve, reject) => {
    resolveAttempt = resolve
    rejectAttempt = reject
  })
  iframeApiPromise = attemptPromise

  let settled = false
  let script: HTMLScriptElement | null = null
  let scriptErrorCallback: (() => void) | null = null
  let timeoutId: number | null = null

  const restoreReadyCallback = () => {
    if (window.onYouTubeIframeAPIReady !== readyCallback) {
      return
    }
    if (hadExistingReadyCallback) {
      window.onYouTubeIframeAPIReady = existingReadyCallback
    } else {
      Reflect.deleteProperty(window, 'onYouTubeIframeAPIReady')
    }
  }
  const cleanUpAttempt = (removeScript: boolean) => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
      timeoutId = null
    }
    if (script !== null && scriptErrorCallback !== null) {
      script.removeEventListener('error', scriptErrorCallback)
      scriptErrorCallback = null
    }
    restoreReadyCallback()
    if (removeScript) {
      script?.remove()
    }
  }
  const failAttempt = (reason: unknown) => {
    if (settled) {
      return
    }
    settled = true
    cleanUpAttempt(true)
    if (iframeApiPromise === attemptPromise) {
      iframeApiPromise = null
    }
    rejectAttempt(reason)
  }
  const completeAttempt = (api: typeof YT) => {
    if (settled) {
      return
    }
    settled = true
    cleanUpAttempt(false)
    resolveAttempt(api)
  }
  const readyCallback = () => {
    if (settled) {
      return
    }

    let existingCallbackThrew = false
    let existingCallbackError: unknown
    try {
      existingReadyCallback?.()
    } catch (error) {
      existingCallbackThrew = true
      existingCallbackError = error
    }

    if (isYouTubeIframeApiReady(window.YT)) {
      completeAttempt(window.YT)
    } else {
      failAttempt(new Error('L’API IFrame YouTube est indisponible'))
    }

    if (existingCallbackThrew) {
      throw existingCallbackError
    }
  }

  try {
    window.onYouTubeIframeAPIReady = readyCallback
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${IFRAME_API_URL}"]`,
    )
    script = existingScript ?? document.createElement('script')
    if (existingScript === null) {
      script.src = IFRAME_API_URL
      script.async = true
    }
    scriptErrorCallback = () => {
      failAttempt(new Error('Impossible de charger l’API IFrame YouTube'))
    }
    script.addEventListener('error', scriptErrorCallback, { once: true })
    timeoutId = window.setTimeout(() => {
      failAttempt(new Error('Délai de chargement de l’API IFrame YouTube dépassé'))
    }, IFRAME_API_TIMEOUT_MS)
    if (existingScript === null) {
      document.head.append(script)
    }
  } catch (error) {
    failAttempt(error)
  }

  return attemptPromise
}

export interface YouTubeControllerOptions {
  onStateChange?: (state: YT.PlayerState) => void
  onError?: (error: Error) => void
}

export class YouTubeController {
  private readonly playerPromise: Promise<YT.Player | null>
  private player: YT.Player | null = null
  private destroyed = false

  constructor(element: HTMLElement, options: YouTubeControllerOptions = {}) {
    this.playerPromise = loadYouTubeIframeApi()
      .then((api) => new Promise<YT.Player | null>((resolve) => {
        new api.Player(element, {
          host: 'https://www.youtube-nocookie.com',
          playerVars: {
            enablejsapi: 1,
            origin: window.location.origin,
            playsinline: 1,
          },
          events: {
            onReady: (event) => {
              if (this.destroyed) {
                event.target.destroy()
                resolve(null)
                return
              }
              this.player = event.target
              resolve(event.target)
            },
            onStateChange: (event) => options.onStateChange?.(event.data),
            onError: (event) => {
              options.onError?.(new Error(`Erreur du lecteur YouTube (${event.data})`))
            },
          },
        })
      }))
      .catch((reason: unknown) => {
        const error = reason instanceof Error
          ? reason
          : new Error('Le lecteur YouTube est indisponible')
        options.onError?.(error)
        throw error
      })
  }

  async cue(videoId: string, startSeconds: number): Promise<void> {
    const player = await this.playerPromise
    player?.cueVideoById(videoId, startSeconds)
  }

  async playAt(videoId: string, startSeconds: number): Promise<void> {
    const player = await this.playerPromise
    if (player === null) {
      return
    }
    player.loadVideoById({ videoId, startSeconds })
  }

  getCurrentTime(): number {
    return this.player?.getCurrentTime() ?? 0
  }

  getPlayerState(): YT.PlayerState {
    return this.player?.getPlayerState() ?? -1
  }

  destroy(): void {
    this.destroyed = true
    this.player?.destroy()
    this.player = null
  }
}
