import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { CatalogVideo } from '../domain/catalog'
import { VideoList } from './VideoList'

function makeVideos(): CatalogVideo[] {
  return Array.from({ length: 25 }, (_, index) => ({
    id: index.toString().padStart(11, '0'),
    title: `Entretien ${index + 1}`,
    publishedAt: `2026-08-${(index % 28 + 1).toString().padStart(2, '0')}T12:00:00Z`,
    durationSeconds: 3_600,
    thumbnailUrl: `https://i.ytimg.com/vi/${index.toString().padStart(11, '0')}/hqdefault.jpg`,
    embeddable: true,
    kind: index < 2 ? 'live' : 'video',
    liveStatus: index === 0 ? 'live' : 'none',
    descriptionExcerpt: `Description ${index + 1}`,
    chapterStatus: index === 0 ? 'live' : 'pending',
    chapterSource: null,
    chapters: [],
  }))
}

describe('VideoList', () => {
  afterEach(cleanup)

  it('affiche 24 cartes paresseuses puis une page supplémentaire et les bons badges', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const videos = makeVideos()

    const { container, rerender } = render(
      <VideoList
        videos={videos}
        selectedVideoId={videos[0].id}
        onSelect={onSelect}
        pageKey="tout-récent"
      />,
    )

    expect(screen.getAllByRole('button', { name: /Entretien \d+/ })).toHaveLength(24)
    expect(screen.getByText('DIRECT')).toBeInTheDocument()
    expect(screen.getByText('REPLAY')).toBeInTheDocument()
    expect(screen.getAllByText('VIDÉO').length).toBeGreaterThan(0)
    expect([...container.querySelectorAll('img')]
      .every((image) => image.getAttribute('loading') === 'lazy'))
      .toBe(true)

    await user.click(screen.getByRole('button', { name: 'Afficher plus' }))
    expect(screen.getAllByRole('button', { name: /Entretien \d+/ })).toHaveLength(25)

    rerender(
      <VideoList
        videos={videos}
        selectedVideoId={videos[0].id}
        onSelect={onSelect}
        pageKey="directs-récent"
      />,
    )
    expect(screen.getAllByRole('button', { name: /Entretien \d+/ })).toHaveLength(24)
  })
})
