import { useMemo, useState } from 'react'

import './App.css'
import type { CatalogVideo } from './domain/catalog'
import { filterVideos, type VideoFilter } from './domain/filterVideos'
import { previewVideos } from './data/previewVideos'
import { parsePlayerUrl, replacePlayerUrl } from './lib/urlState'

const availableFilters = [
  { value: 'all', label: 'Tout' },
  { value: 'with-chapters', label: 'Chapitrés' },
  { value: 'without-chapters', label: 'À enrichir' },
] satisfies ReadonlyArray<{ value: VideoFilter; label: string }>

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  return `${hours} h ${minutes.toString().padStart(2, '0')}`
}

function formatTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatPublishedAt(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function getInitialSelection(): { videoId: string; startSeconds: number } {
  const urlState = parsePlayerUrl(window.location.search)
  const selectedVideo = previewVideos.find((video) => video.id === urlState.videoId)
  return selectedVideo === undefined
    ? { videoId: previewVideos[0].id, startSeconds: 0 }
    : { videoId: selectedVideo.id, startSeconds: urlState.startSeconds }
}

function getEmbedUrl(videoId: string, startSeconds: number, autoplay: boolean): string {
  const parameters = new URLSearchParams({
    autoplay: autoplay ? '1' : '0',
    rel: '0',
    playsinline: '1',
    start: String(startSeconds),
  })
  return `https://www.youtube-nocookie.com/embed/${videoId}?${parameters}`
}

function getYouTubeUrl(videoId: string, startSeconds: number): string {
  const url = new URL('https://www.youtube.com/watch')
  url.searchParams.set('v', videoId)
  if (startSeconds > 0) {
    url.searchParams.set('t', `${startSeconds}s`)
  }
  return url.href
}

function VideoCard({
  video,
  selected,
  onSelect,
}: {
  video: CatalogVideo
  selected: boolean
  onSelect: (videoId: string) => void
}) {
  return (
    <button
      className="video-card"
      data-selected={selected}
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(video.id)}
    >
      <span className="thumbnail-wrap">
        <img src={video.thumbnailUrl} alt="" loading="lazy" />
        <span className="duration">{formatDuration(video.durationSeconds)}</span>
      </span>
      <span className="card-copy">
        <span className="card-kicker">
          {formatPublishedAt(video.publishedAt)}
          <span aria-hidden="true">·</span>
          {video.chapterStatus === 'ready' ? 'Chapitres disponibles' : 'Chapitres à venir'}
        </span>
        <strong>{video.title}</strong>
        <span>{video.descriptionExcerpt}</span>
      </span>
      <span className="card-arrow" aria-hidden="true">↗</span>
    </button>
  )
}

function App() {
  const [initialSelection] = useState(getInitialSelection)
  const [selectedVideoId, setSelectedVideoId] = useState(initialSelection.videoId)
  const [startSeconds, setStartSeconds] = useState(initialSelection.startSeconds)
  const [autoplay, setAutoplay] = useState(false)
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<VideoFilter>('all')

  const selectedVideo = previewVideos.find((video) => video.id === selectedVideoId)
    ?? previewVideos[0]
  const visibleVideos = useMemo(
    () => filterVideos(previewVideos, {
      query,
      filter: activeFilter,
      order: 'recent',
    }),
    [activeFilter, query],
  )

  const selectVideo = (videoId: string) => {
    setSelectedVideoId(videoId)
    setStartSeconds(0)
    setAutoplay(false)
    replacePlayerUrl({ videoId, startSeconds: 0 })
  }

  const playChapter = (chapterStartSeconds: number) => {
    setStartSeconds(chapterStartSeconds)
    setAutoplay(true)
    replacePlayerUrl({ videoId: selectedVideo.id, startSeconds: chapterStartSeconds })
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Accueil de Chapitres libres">
          <span className="brand-mark" aria-hidden="true">C//</span>
          <span>Chapitres libres</span>
        </a>
        <span className="preview-badge">Aperçu V1</span>
        <a className="channel-link" href="https://www.youtube.com/@thinkerview" target="_blank" rel="noreferrer">
          Chaîne originale <span aria-hidden="true">↗</span>
        </a>
      </header>

      <main>
        <section className="intro">
          <p className="eyebrow">Regarder moins au hasard. Comprendre plus vite.</p>
          <h1>Les longs entretiens,<br /><em>enfin navigables.</em></h1>
          <p className="intro-copy">
            Une première version légère pour rechercher, choisir et ouvrir directement un sujet
            dans un entretien Thinkerview.
          </p>
          <div className="intro-meta" aria-label="Contenu de l’aperçu">
            <span><strong>{previewVideos.length}</strong> entretiens</span>
            <span><strong>1</strong> chapitré</span>
            <span><strong>1</strong> lecteur unique</span>
          </div>
        </section>

        <section className="player-section" aria-label="Lecture en cours">
          <div className="player-frame">
            <iframe
              src={getEmbedUrl(selectedVideo.id, startSeconds, autoplay)}
              title="Lecteur YouTube"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>

          <div className="player-copy">
            <p className="eyebrow">Lecture en cours</p>
            <h2>{selectedVideo.title}</h2>
            <p>{selectedVideo.descriptionExcerpt}</p>
            <div className="player-actions">
              <span>{formatDuration(selectedVideo.durationSeconds)}</span>
              <a
                href={getYouTubeUrl(selectedVideo.id, startSeconds)}
                target="_blank"
                rel="noreferrer"
              >
                Ouvrir sur YouTube ↗
              </a>
            </div>
          </div>

          <aside className="chapters-panel" aria-label="Chapitres">
            <div className="chapters-heading">
              <p className="eyebrow">Navigation</p>
              <span>{selectedVideo.chapters.length || '—'}</span>
            </div>
            {selectedVideo.chapterStatus === 'ready' ? (
              <>
                <p className="chapter-provenance">Repères générés depuis la transcription · à vérifier</p>
                <ol>
                  {selectedVideo.chapters.map((chapter, index) => (
                    <li key={chapter.startSeconds}>
                      <button
                        type="button"
                        data-active={
                          chapter.startSeconds <= startSeconds
                          && (selectedVideo.chapters[index + 1]?.startSeconds ?? Infinity) > startSeconds
                        }
                        onClick={() => playChapter(chapter.startSeconds)}
                      >
                        <span>{formatTimestamp(chapter.startSeconds)}</span>
                        {chapter.title}
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <div className="chapters-empty">
                <span aria-hidden="true">⌁</span>
                <p>Les chapitres de cet entretien seront ajoutés après validation.</p>
              </div>
            )}
          </aside>
        </section>

        <section className="catalog-section" aria-labelledby="catalog-title">
          <div className="catalog-heading">
            <div>
              <p className="eyebrow">Sélection de démonstration</p>
              <h2 id="catalog-title">Explorer les entretiens</h2>
            </div>
            <span>{visibleVideos.length.toString().padStart(2, '0')} résultat{visibleVideos.length > 1 ? 's' : ''}</span>
          </div>

          <div className="catalog-tools">
            <label className="search-field">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                aria-label="Rechercher"
                value={query}
                placeholder="Rechercher un invité, un thème…"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="filter-list" aria-label="Filtrer les entretiens">
              {availableFilters.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  data-active={activeFilter === filter.value}
                  onClick={() => setActiveFilter(filter.value)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="video-list">
            {visibleVideos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                selected={video.id === selectedVideo.id}
                onSelect={selectVideo}
              />
            ))}
            {visibleVideos.length === 0 && (
              <p className="no-results">Aucun entretien ne correspond à cette recherche.</p>
            )}
          </div>
        </section>
      </main>

      <footer>
        <p>Projet indépendant, sans affiliation avec Thinkerview.</p>
        <p>Les vidéos restent hébergées et publiées par leur auteur original.</p>
      </footer>
    </div>
  )
}

export default App
