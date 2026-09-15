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
})
