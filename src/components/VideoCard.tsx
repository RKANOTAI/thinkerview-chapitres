import type { CatalogVideo } from '../domain/catalog'

interface VideoCardProps {
  video: CatalogVideo
  selected: boolean
  onSelect: (videoId: string) => void
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  if (hours === 0) {
    return `${minutes} min`
  }
  return `${hours} h ${minutes.toString().padStart(2, '0')}`
}

function formatPublishedAt(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function getVideoBadge(video: CatalogVideo): string {
  if (video.liveStatus === 'live') {
    return 'DIRECT'
  }
  if (video.liveStatus === 'upcoming') {
    return 'À VENIR'
  }
  return video.kind === 'live' ? 'REPLAY' : 'VIDÉO'
}

const chapterLabels: Record<CatalogVideo['chapterStatus'], string> = {
  ready: 'Chapitres disponibles',
  pending: 'Chapitres en préparation',
  retry: 'Nouvelle tentative prévue',
  unavailable: 'Chapitres indisponibles',
  live: 'Direct en cours',
  upcoming: 'Direct programmé',
}

export function VideoCard({ video, selected, onSelect }: VideoCardProps) {
  const youtubeUrl = `https://www.youtube.com/watch?v=${video.id}`

  return (
    <article className="video-card" data-selected={selected}>
      <button
        className="video-card-select"
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
            <span className="video-kind">{getVideoBadge(video)}</span>
            <span>{formatPublishedAt(video.publishedAt)}</span>
          </span>
          <strong>{video.title}</strong>
          <span>{video.descriptionExcerpt}</span>
          <span className="chapter-state">{chapterLabels[video.chapterStatus]}</span>
        </span>
      </button>
      <a
        className="card-external"
        href={youtubeUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Voir ${video.title} sur YouTube`}
      >
        <span aria-hidden="true">↗</span>
      </a>
    </article>
  )
}
