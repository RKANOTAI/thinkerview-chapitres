import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Catalog, CatalogVideo } from './domain/catalog'
import App from './App'

function makeVideo(overrides: Partial<CatalogVideo> = {}): CatalogVideo {
  return {
    id: 'aaaaaaaaaaa',
    title: 'Entretien du catalogue réel',
    publishedAt: '2026-09-01T12:00:00Z',
    durationSeconds: 3_600,
    thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg',
    embeddable: true,
    kind: 'video',
    liveStatus: 'none',
    descriptionExcerpt: 'Une description issue du catalogue public.',
    chapterStatus: 'pending',
    chapterSource: null,
    chapters: [],
    ...overrides,
  }
}

function makeCatalog(videos: CatalogVideo[]): Catalog {
  return {
    schemaVersion: 1,
    channel: {
      id: 'UCQgWpmt02UtJkyO32HGUASQ',
      handle: '@thinkerview',
      title: 'Thinkerview',
      url: 'https://www.youtube.com/@thinkerview',
    },
    syncedAt: '2026-09-15T10:00:00Z',
    playlistItemCount: videos.length,
    unavailableVideoIds: [],
    videos,
  }
}

describe('catalogue V1', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/')
  })

  it('annonce le chargement puis affiche le catalogue public validé', async () => {
    let respond!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      respond = resolve
    })
    const fetchMock = vi.fn(() => response)
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    expect(screen.getByRole('status')).toHaveTextContent('Chargement du catalogue')

    respond(Response.json(makeCatalog([
      makeVideo({ id: 'aaaaaaaaaaa', publishedAt: '2026-08-01T12:00:00Z' }),
      makeVideo({
        id: 'bbbbbbbbbbb',
        title: 'Entretien le plus récent',
        publishedAt: '2026-09-01T12:00:00Z',
      }),
    ])))

    expect(await screen.findByRole('heading', { name: 'Entretien le plus récent' }))
      .toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}data/catalog.json`)
    expect(screen.queryByText('Mode aperçu')).not.toBeInTheDocument()
  })

  it('ouvre directement le lecteur et le catalogue sans bloc introductif', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json(makeCatalog([makeVideo()]))),
    )

    render(<App />)

    expect(await screen.findByRole('region', { name: 'Lecture en cours' }))
      .toBeInTheDocument()
    expect(document.querySelector('.intro')).not.toBeInTheDocument()
    expect(screen.queryByText('Les longs entretiens,')).not.toBeInTheDocument()
  })

  it('permet de réessayer puis annonce le mode aperçu si le catalogue est vide', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json(makeCatalog([])))
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Impossible de charger le catalogue',
    )
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))

    expect(await screen.findByText('Mode aperçu')).toBeInTheDocument()
    expect(screen.getByRole('heading', {
      name: /Menace de guerre ou basculement de l'ordre mondial/i,
    })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('recherche et filtre le catalogue complet depuis des contrôles accessibles', async () => {
    const user = userEvent.setup()
    const videos = [
      makeVideo({ id: 'aaaaaaaaaaa', title: 'Énergie et souveraineté' }),
      makeVideo({
        id: 'bbbbbbbbbbb',
        title: 'Replay économique',
        kind: 'live',
        publishedAt: '2026-08-01T12:00:00Z',
      }),
      makeVideo({
        id: 'ccccccccccc',
        title: 'Direct diplomatique',
        kind: 'live',
        liveStatus: 'live',
        chapterStatus: 'live',
        publishedAt: '2026-07-01T12:00:00Z',
      }),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(makeCatalog(videos))))

    render(<App />)

    const header = await screen.findByRole('banner')
    expect(within(header).getByText('3 vidéos publiques')).toBeInTheDocument()
    expect(within(header).getByRole('link', { name: 'Chaîne Thinkerview sur YouTube' }))
      .toHaveAttribute('href', 'https://www.youtube.com/@thinkerview')

    await user.type(screen.getByRole('searchbox', { name: 'Rechercher' }), 'energie')
    expect(screen.getByRole('button', { name: /Énergie et souveraineté/ }))
      .toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Replay économique/ }))
      .not.toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox', { name: 'Rechercher' }))
    await user.click(screen.getByRole('button', { name: 'Directs' }))

    expect(screen.getByRole('button', { name: 'Directs' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Énergie et souveraineté/ }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Replay économique/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Direct diplomatique/ })).toBeInTheDocument()
  })
})