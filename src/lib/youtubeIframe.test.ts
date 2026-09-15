import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const IFRAME_API_URL = 'https://www.youtube.com/iframe_api'

function installFakeApi(): void {
  window.YT = {
    Player: vi.fn(),
    PlayerState: {
      UNSTARTED: -1,
      ENDED: 0,
      PLAYING: 1,
      PAUSED: 2,
      BUFFERING: 3,
      CUED: 5,
    },
  } as unknown as typeof YT
}

function installControllableApi() {
  const player = {
    cueVideoById: vi.fn(),
    loadVideoById: vi.fn(),
    seekTo: vi.fn(),
    playVideo: vi.fn(),
    getCurrentTime: vi.fn(() => 812.4),
    getPlayerState: vi.fn(() => 1 as YT.PlayerState),
    destroy: vi.fn(),
  }
  let options: YT.PlayerOptions | undefined
  const Player = vi.fn(function (_element: HTMLElement | string, playerOptions: YT.PlayerOptions) {
    options = playerOptions
    queueMicrotask(() => playerOptions.events?.onReady?.({ target: player as unknown as YT.Player }))
    return player
  })
  window.YT = {
    Player: Player as unknown as typeof YT.Player,
    PlayerState: {
      UNSTARTED: -1,
      ENDED: 0,
      PLAYING: 1,
      PAUSED: 2,
      BUFFERING: 3,
      CUED: 5,
    },
  } as typeof YT
  return { Player, player, getOptions: () => options }
}

describe('loadYouTubeIframeApi', () => {
  beforeEach(() => {
    vi.resetModules()
    Reflect.deleteProperty(window, 'YT')
    Reflect.deleteProperty(window, 'onYouTubeIframeAPIReady')
    document.querySelectorAll(`script[src="${IFRAME_API_URL}"]`).forEach((script) => script.remove())
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'YT')
    Reflect.deleteProperty(window, 'onYouTubeIframeAPIReady')
    document.querySelectorAll(`script[src="${IFRAME_API_URL}"]`).forEach((script) => script.remove())
  })

  it('loads the iframe API through one shared promise and one script', async () => {
    const { loadYouTubeIframeApi } = await import('./youtubeIframe')

    const firstLoad = loadYouTubeIframeApi()
    const secondLoad = loadYouTubeIframeApi()

    expect(secondLoad).toBe(firstLoad)
    expect(document.querySelectorAll(`script[src="${IFRAME_API_URL}"]`)).toHaveLength(1)

    installFakeApi()
    window.onYouTubeIframeAPIReady?.()

    await expect(firstLoad).resolves.toBe(window.YT)
  })

  it('reuses an iframe API script that is already loading', async () => {
    const existingScript = document.createElement('script')
    existingScript.src = IFRAME_API_URL
    document.head.append(existingScript)
    const { loadYouTubeIframeApi } = await import('./youtubeIframe')

    const loading = loadYouTubeIframeApi()

    expect(document.querySelectorAll(`script[src="${IFRAME_API_URL}"]`)).toHaveLength(1)
    expect(existingScript.isConnected).toBe(true)

    installFakeApi()
    window.onYouTubeIframeAPIReady?.()

    await expect(loading).resolves.toBe(window.YT)
  })

  it('returns an already available API without injecting a script', async () => {
    installFakeApi()
    const availableApi = window.YT
    const { loadYouTubeIframeApi } = await import('./youtubeIframe')

    const loading = loadYouTubeIframeApi()

    expect(document.querySelectorAll(`script[src="${IFRAME_API_URL}"]`)).toHaveLength(0)
    await expect(loading).resolves.toBe(availableApi)
  })

  it('waits until Player is usable when the YT namespace is only partially initialized', async () => {
    window.YT = {} as typeof YT
    const { loadYouTubeIframeApi } = await import('./youtubeIframe')

    const loading = loadYouTubeIframeApi()

    expect(document.querySelectorAll(`script[src="${IFRAME_API_URL}"]`)).toHaveLength(1)
    installFakeApi()
    window.onYouTubeIframeAPIReady?.()

    await expect(loading).resolves.toBe(window.YT)
  })

  it('rejects a ready callback until Player is usable', async () => {
    const { loadYouTubeIframeApi } = await import('./youtubeIframe')

    const loading = loadYouTubeIframeApi()
    window.YT = {} as typeof YT
    window.onYouTubeIframeAPIReady?.()

    await expect(loading).rejects.toThrow('L’API IFrame YouTube est indisponible')
  })

  it('allows a new attempt after a script loading error', async () => {
    const { loadYouTubeIframeApi } = await import('./youtubeIframe')

    const firstLoad = loadYouTubeIframeApi()
    const [firstScript] = document.querySelectorAll<HTMLScriptElement>(
      `script[src="${IFRAME_API_URL}"]`,
    )
    firstScript.dispatchEvent(new Event('error'))

    await expect(firstLoad).rejects.toThrow('Impossible de charger l’API IFrame YouTube')

    const secondLoad = loadYouTubeIframeApi()
    const scripts = document.querySelectorAll<HTMLScriptElement>(
      `script[src="${IFRAME_API_URL}"]`,
    )
    expect(secondLoad).not.toBe(firstLoad)
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).not.toBe(firstScript)

    installFakeApi()
    window.onYouTubeIframeAPIReady?.()

    await expect(secondLoad).resolves.toBe(window.YT)
  })

  it('cleans up and allows a new attempt when script insertion throws', async () => {
    const append = vi.spyOn(document.head, 'append').mockImplementationOnce(() => {
      throw new Error('Échec de l’insertion')
    })
    const { loadYouTubeIframeApi } = await import('./youtubeIframe')

    const firstLoad = loadYouTubeIframeApi()
    append.mockRestore()

    await expect(firstLoad).rejects.toThrow('Échec de l’insertion')
    expect(Object.prototype.hasOwnProperty.call(window, 'onYouTubeIframeAPIReady')).toBe(false)

    const secondLoad = loadYouTubeIframeApi()
    expect(secondLoad).not.toBe(firstLoad)
    expect(document.querySelectorAll(`script[src="${IFRAME_API_URL}"]`)).toHaveLength(1)

    installFakeApi()
    window.onYouTubeIframeAPIReady?.()

    await expect(secondLoad).resolves.toBe(window.YT)
  })

  it('times out after ten seconds, cleans up, and allows a new attempt', async () => {
    vi.useFakeTimers()
    const { loadYouTubeIframeApi } = await import('./youtubeIframe')

    const firstLoad = loadYouTubeIframeApi()
    const [firstScript] = document.querySelectorAll<HTMLScriptElement>(
      `script[src="${IFRAME_API_URL}"]`,
    )
    const settled = vi.fn()
    void firstLoad.then(
      () => settled('resolved'),
      (error: unknown) => settled(error),
    )

    await vi.advanceTimersByTimeAsync(10_000)

    expect(settled).toHaveBeenCalledOnce()
    expect(settled.mock.calls[0]?.[0]).toEqual(
      new Error('Délai de chargement de l’API IFrame YouTube dépassé'),
    )
    expect(firstScript.isConnected).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(window, 'onYouTubeIframeAPIReady')).toBe(false)

    const secondLoad = loadYouTubeIframeApi()
    expect(secondLoad).not.toBe(firstLoad)
    expect(document.querySelectorAll(`script[src="${IFRAME_API_URL}"]`)).toHaveLength(1)

    installFakeApi()
    window.onYouTubeIframeAPIReady?.()

    await expect(secondLoad).resolves.toBe(window.YT)
  })

  it('allows a new attempt when the ready callback provides no API', async () => {
    const existingReadyCallback = vi.fn()
    window.onYouTubeIframeAPIReady = existingReadyCallback
    const { loadYouTubeIframeApi } = await import('./youtubeIframe')

    const firstLoad = loadYouTubeIframeApi()
    const [firstScript] = document.querySelectorAll<HTMLScriptElement>(
      `script[src="${IFRAME_API_URL}"]`,
    )
    window.onYouTubeIframeAPIReady?.()

    await expect(firstLoad).rejects.toThrow('L’API IFrame YouTube est indisponible')
    expect(existingReadyCallback).toHaveBeenCalledOnce()
    expect(window.onYouTubeIframeAPIReady).toBe(existingReadyCallback)
    expect(firstScript.isConnected).toBe(false)

    const secondLoad = loadYouTubeIframeApi()
    expect(secondLoad).not.toBe(firstLoad)
    expect(document.querySelectorAll(`script[src="${IFRAME_API_URL}"]`)).toHaveLength(1)

    installFakeApi()
    window.onYouTubeIframeAPIReady?.()

    await expect(secondLoad).resolves.toBe(window.YT)
  })

  it('ignores a late script error from a settled attempt', async () => {
    const { loadYouTubeIframeApi } = await import('./youtubeIframe')

    const firstLoad = loadYouTubeIframeApi()
    const [firstScript] = document.querySelectorAll<HTMLScriptElement>(
      `script[src="${IFRAME_API_URL}"]`,
    )
    window.onYouTubeIframeAPIReady?.()
    await expect(firstLoad).rejects.toThrow('L’API IFrame YouTube est indisponible')

    const secondLoad = loadYouTubeIframeApi()
    firstScript.dispatchEvent(new Event('error'))
    const thirdLoad = loadYouTubeIframeApi()

    expect(thirdLoad).toBe(secondLoad)
    expect(document.querySelectorAll(`script[src="${IFRAME_API_URL}"]`)).toHaveLength(1)

    installFakeApi()
    window.onYouTubeIframeAPIReady?.()

    await expect(secondLoad).resolves.toBe(window.YT)
  })

  it('preserves an existing ready callback', async () => {
    const existingReadyCallback = vi.fn()
    window.onYouTubeIframeAPIReady = existingReadyCallback
    const { loadYouTubeIframeApi } = await import('./youtubeIframe')

    const loading = loadYouTubeIframeApi()
    installFakeApi()
    window.onYouTubeIframeAPIReady?.()

    await expect(loading).resolves.toBe(window.YT)
    expect(existingReadyCallback).toHaveBeenCalledOnce()
  })

  it('settles and restores the loader when the existing callback throws', async () => {
    const existingReadyCallback = vi.fn(() => {
      throw new Error('Échec du callback existant')
    })
    window.onYouTubeIframeAPIReady = existingReadyCallback
    const { loadYouTubeIframeApi } = await import('./youtubeIframe')

    const loading = loadYouTubeIframeApi()
    const settled = vi.fn()
    void loading.then(
      () => settled('resolved'),
      () => settled('rejected'),
    )
    installFakeApi()

    expect(() => window.onYouTubeIframeAPIReady?.()).toThrow('Échec du callback existant')
    await Promise.resolve()

    expect(settled).toHaveBeenCalledWith('resolved')
    expect(window.onYouTubeIframeAPIReady).toBe(existingReadyCallback)
  })

  it('creates a privacy-enhanced controller and cues a selection without autoplay', async () => {
    const { Player, player, getOptions } = installControllableApi()
    const { YouTubeController } = await import('./youtubeIframe')
    const mount = document.createElement('div')

    const controller = new YouTubeController(mount)
    await controller.cue('aaaaaaaaaaa', 305)

    expect(Player).toHaveBeenCalledWith(mount, expect.objectContaining({
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        enablejsapi: 1,
        origin: window.location.origin,
        playsinline: 1,
      },
    }))
    expect(getOptions()).toBeDefined()
    expect(player.cueVideoById).toHaveBeenCalledWith('aaaaaaaaaaa', 305)
    expect(player.playVideo).not.toHaveBeenCalled()
  })

  it('loads, seeks and plays an explicit chapter while exposing playback state', async () => {
    const { player } = installControllableApi()
    const { YouTubeController } = await import('./youtubeIframe')
    const controller = new YouTubeController(document.createElement('div'))

    await controller.playAt('aaaaaaaaaaa', 720)

    expect(player.loadVideoById).toHaveBeenCalledWith('aaaaaaaaaaa', 720)
    expect(player.seekTo).toHaveBeenCalledWith(720, true)
    expect(player.playVideo).toHaveBeenCalledOnce()
    expect(controller.getCurrentTime()).toBe(812.4)
    expect(controller.getPlayerState()).toBe(1)

    controller.destroy()
    expect(player.destroy).toHaveBeenCalledOnce()
  })

  it('forwards player state and errors to the interface', async () => {
    const { player, getOptions } = installControllableApi()
    const onStateChange = vi.fn()
    const onError = vi.fn()
    const { YouTubeController } = await import('./youtubeIframe')
    const controller = new YouTubeController(document.createElement('div'), {
      onStateChange,
      onError,
    })
    await controller.cue('aaaaaaaaaaa', 0)

    getOptions()?.events?.onStateChange?.({
      target: player as unknown as YT.Player,
      data: 1,
    })
    getOptions()?.events?.onError?.({
      target: player as unknown as YT.Player,
      data: 101,
    })

    expect(onStateChange).toHaveBeenCalledWith(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Erreur du lecteur YouTube (101)',
    }))
  })

  it('destroys a player that becomes ready after the controller was unmounted', async () => {
    const player = {
      cueVideoById: vi.fn(),
      loadVideoById: vi.fn(),
      seekTo: vi.fn(),
      playVideo: vi.fn(),
      getCurrentTime: vi.fn(() => 0),
      getPlayerState: vi.fn(() => -1 as YT.PlayerState),
      destroy: vi.fn(),
    }
    let options: YT.PlayerOptions | undefined
    const Player = vi.fn(function (_element: HTMLElement | string, nextOptions: YT.PlayerOptions) {
      options = nextOptions
      return player
    })
    window.YT = {
      Player: Player as unknown as typeof YT.Player,
      PlayerState: {
        UNSTARTED: -1,
        ENDED: 0,
        PLAYING: 1,
        PAUSED: 2,
        BUFFERING: 3,
        CUED: 5,
      },
    } as typeof YT
    const { YouTubeController } = await import('./youtubeIframe')
    const controller = new YouTubeController(document.createElement('div'))
    const cue = controller.cue('aaaaaaaaaaa', 0)
    await Promise.resolve()

    controller.destroy()
    options?.events?.onReady?.({ target: player as unknown as YT.Player })
    await cue

    expect(player.destroy).toHaveBeenCalledOnce()
    expect(player.cueVideoById).not.toHaveBeenCalled()
  })
})
