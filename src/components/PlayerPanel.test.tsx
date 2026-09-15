import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { CatalogVideo } from '../domain/catalog'
import type { YouTubeController, YouTubeControllerOptions } from '../lib/youtubeIframe'
import { PlayerPanel } from './PlayerPanel'

function makeReadyVideo(overrides: Partial<CatalogVideo> = {}): CatalogVideo {
  return {
    id: 'aaaaaaaaaaa',
    title: 'Énergie, industrie et souveraineté',
    publishedAt: '2026-09-01T12:00:00Z',
    durationSeconds: 3_600,
    thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg',
    embeddable: true,
    kind: 'video',
    liveStatus: 'none',
    descriptionExcerpt: 'Un entretien à parcourir par sujet.',
    chapterStatus: 'ready',
    chapterSource: 'ai-transcript',
    chapters: [
      { startSeconds: 0, title: 'Ouverture' },
      { startSeconds: 300, title: 'Premier sujet' },
      { startSeconds: 720, title: 'Deuxième sujet' },
    ],
    ...overrides,
  }
}

describe('PlayerPanel', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
    window.history.replaceState(null, '', '/')
  })

  it('cue sans autoplay puis joue et partage le chapitre choisi', async () => {
    window.history.replaceState(null, '', '/thinkerview-chapitres/?v=aaaaaaaaaaa&t=300')
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const controller = {
      cue: vi.fn().mockResolvedValue(undefined),
      playAt: vi.fn().mockResolvedValue(undefined),
      getCurrentTime: vi.fn(() => 300),
      getPlayerState: vi.fn(() => -1),
      destroy: vi.fn(),
    } as unknown as YouTubeController
    const createController = vi.fn((
      _element: HTMLElement,
      _options: YouTubeControllerOptions,
    ) => controller)
    const onStartSecondsChange = vi.fn()

    render(
      <PlayerPanel
        video={makeReadyVideo()}
        startSeconds={300}
        onStartSecondsChange={onStartSecondsChange}
        createController={createController}
      />,
    )

    await waitFor(() => {
      expect(controller.cue).toHaveBeenCalledWith('aaaaaaaaaaa', 300)
    })
    expect(controller.playAt).not.toHaveBeenCalled()

    const chapter = screen.getByRole('button', { name: /12:00 Deuxième sujet/ })
    await user.click(chapter)

    expect(controller.playAt).toHaveBeenCalledWith('aaaaaaaaaaa', 720)
    expect(onStartSecondsChange).toHaveBeenCalledWith(720)
    expect(window.location.search).toBe('?v=aaaaaaaaaaa&t=720')
    expect(chapter).toHaveAttribute('aria-current', 'true')

    await user.click(screen.getByRole('button', { name: 'Copier le lien' }))
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/thinkerview-chapitres/?v=aaaaaaaaaaa&t=720`,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Lien copié')
    expect(screen.getByRole('link', { name: 'Signaler une erreur' }).getAttribute('href'))
      .toContain('github.com/RKANOTAI/thinkerview-chapitres/issues/new')
  })

  it('actualise le chapitre actif seulement pendant la lecture', async () => {
    vi.useFakeTimers()
    let controllerOptions: YouTubeControllerOptions | undefined
    const controller = {
      cue: vi.fn().mockResolvedValue(undefined),
      playAt: vi.fn().mockResolvedValue(undefined),
      getCurrentTime: vi.fn(() => 812.4),
      getPlayerState: vi.fn(() => 1),
      destroy: vi.fn(),
    } as unknown as YouTubeController
    const createController = vi.fn((
      _element: HTMLElement,
      options: YouTubeControllerOptions,
    ) => {
      controllerOptions = options
      return controller
    })

    render(
      <PlayerPanel
        video={makeReadyVideo()}
        startSeconds={0}
        onStartSecondsChange={vi.fn()}
        createController={createController}
      />,
    )
    await act(async () => Promise.resolve())

    expect(controller.getCurrentTime).not.toHaveBeenCalled()
    act(() => controllerOptions?.onStateChange?.(1))
    await act(async () => vi.advanceTimersByTimeAsync(1_000))

    expect(controller.getCurrentTime).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: /12:00 Deuxième sujet/ }))
      .toHaveAttribute('aria-current', 'true')

    act(() => controllerOptions?.onStateChange?.(2))
    vi.mocked(controller.getCurrentTime).mockClear()
    await act(async () => vi.advanceTimersByTimeAsync(2_000))
    expect(controller.getCurrentTime).not.toHaveBeenCalled()
  })

  it('propose YouTube sans initialiser de lecteur quand la vidéo n’est pas intégrable', () => {
    const createController = vi.fn()

    render(
      <PlayerPanel
        video={makeReadyVideo({
          embeddable: false,
          chapterStatus: 'unavailable',
          chapterSource: null,
          chapters: [],
        })}
        startSeconds={305}
        onStartSecondsChange={vi.fn()}
        createController={createController}
      />,
    )

    expect(createController).not.toHaveBeenCalled()
    expect(screen.queryByTestId('youtube-player')).not.toBeInTheDocument()
    expect(screen.getByText('Les chapitres sont indisponibles pour cet entretien.'))
      .toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voir sur YouTube' }))
      .toHaveAttribute('href', 'https://www.youtube.com/watch?v=aaaaaaaaaaa&t=305s')
  })
})
