import { useEffect, useMemo, useState } from 'react'

import './App.css'
import { Header } from './components/Header'
import { PlayerPanel } from './components/PlayerPanel'
import { SearchToolbar } from './components/SearchToolbar'
import { previewVideos } from './data/previewVideos'
import { StatusNotice } from './components/StatusNotice'
import { VideoList } from './components/VideoList'
import { parseCatalog, type Catalog } from './domain/catalog'
import { filterVideos, type VideoFilter, type VideoOrder } from './domain/filterVideos'
import { parsePlayerUrl, replacePlayerUrl } from './lib/urlState'

type CatalogLoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; catalog: Catalog }

function App() {
  const [initialSelection] = useState(() => parsePlayerUrl(window.location.search))
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [catalogState, setCatalogState] = useState<CatalogLoadState>({ status: 'loading' })
  const [selectedVideoId, setSelectedVideoId] = useState(initialSelection.videoId)
  const [startSeconds, setStartSeconds] = useState(initialSelection.startSeconds)
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<VideoFilter>('all')
  const [activeOrder, setActiveOrder] = useState<VideoOrder>('recent')

  useEffect(() => {
    let active = true

    void fetch(`${import.meta.env.BASE_URL}data/catalog.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Catalogue indisponible (${response.status})`)
        }
        return response.json() as Promise<unknown>
      })
      .then((input) => {
        if (active) {
          setCatalogState({ status: 'ready', catalog: parseCatalog(input) })
        }
      })
      .catch(() => {
        if (active) {
          setCatalogState({ status: 'error' })
        }
      })

    return () => {
      active = false
    }
  }, [loadAttempt])

  const videos = useMemo(() => {
    if (catalogState.status !== 'ready') {
      return []
    }
    const source = catalogState.catalog.videos.length > 0
      ? catalogState.catalog.videos
      : previewVideos
    return filterVideos(source, { query: '', filter: 'all', order: 'recent' })
  }, [catalogState])
  const selectedVideoFromUrl = videos.find((video) => video.id === selectedVideoId)
  const selectedVideo = selectedVideoFromUrl ?? videos[0]
  const selectedStartSeconds = selectedVideoFromUrl === undefined ? 0 : startSeconds
  const visibleVideos = useMemo(
    () => filterVideos(videos, {
      query,
      filter: activeFilter,
      order: activeOrder,
    }),
    [activeFilter, activeOrder, query, videos],
  )

  const selectVideo = (videoId: string) => {
    setSelectedVideoId(videoId)
    setStartSeconds(0)
    replacePlayerUrl({ videoId, startSeconds: 0 })
  }

  if (catalogState.status === 'loading') {
    return <StatusNotice kind="loading" />
  }

  if (catalogState.status === 'error') {
    return (
      <StatusNotice
        kind="error"
        onRetry={() => {
          setCatalogState({ status: 'loading' })
          setLoadAttempt((attempt) => attempt + 1)
        }}
      />
    )
  }

  const previewMode = catalogState.catalog.videos.length === 0

  return (
    <div className="site-shell">
      <Header
        totalVideos={videos.length}
        channelUrl={catalogState.catalog.channel.url}
        previewMode={previewMode}
      />

      {previewMode && (
        <div className="preview-notice" role="status">
          <strong>Mode aperçu</strong>
          <span>Le catalogue public est vide : cette sélection réduite permet de tester le parcours.</span>
        </div>
      )}

      <main>
        <div className="content-layout">
          <div className="player-sticky">
            <PlayerPanel
              video={selectedVideo}
              startSeconds={selectedStartSeconds}
            />
          </div>

          <section className="catalog-section" aria-labelledby="catalog-title">
          <div className="catalog-heading">
            <div>
              <p className="eyebrow">{previewMode ? 'Sélection de démonstration' : 'Catalogue public'}</p>
              <h2 id="catalog-title">Explorer les entretiens</h2>
            </div>
            <span>{visibleVideos.length.toString().padStart(2, '0')} résultat{visibleVideos.length > 1 ? 's' : ''}</span>
          </div>

          <SearchToolbar
            query={query}
            filter={activeFilter}
            order={activeOrder}
            onQueryChange={setQuery}
            onFilterChange={setActiveFilter}
            onOrderChange={setActiveOrder}
          />

            <VideoList
              videos={visibleVideos}
              selectedVideoId={selectedVideo.id}
              onSelect={selectVideo}
              pageKey={`${query}\u0000${activeFilter}\u0000${activeOrder}`}
            />
          </section>
        </div>
      </main>

      <footer>
        <p>Projet indépendant non affilié à Thinkerview.</p>
        <nav aria-label="Liens et mentions">
          <a href={catalogState.catalog.channel.url} target="_blank" rel="noreferrer">
            Source vidéo · YouTube
          </a>
          <a
            href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.fr"
            target="_blank"
            rel="noreferrer"
          >
            Données · CC BY-NC-SA 4.0
          </a>
          <a
            href="https://github.com/RKANOTAI/thinkerview-chapitres"
            target="_blank"
            rel="noreferrer"
          >
            Code source · GitHub
          </a>
        </nav>
      </footer>
    </div>
  )
}

export default App
