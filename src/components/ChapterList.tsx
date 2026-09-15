import type { CatalogVideo } from '../domain/catalog'
import { formatTimestamp } from '../domain/time'

interface ChapterListProps {
  video: CatalogVideo
  currentTime: number
  onPlay: (startSeconds: number) => void
}

const emptyStateMessages: Record<Exclude<CatalogVideo['chapterStatus'], 'ready'>, string> = {
  pending: 'Les chapitres de cet entretien sont en préparation.',
  retry: 'Une nouvelle tentative de génération des chapitres est programmée.',
  unavailable: 'Les chapitres sont indisponibles pour cet entretien.',
  live: 'Le direct est en cours : aucun chapitre n’est encore disponible.',
  upcoming: 'Ce direct n’a pas encore commencé.',
}

export function ChapterList({ video, currentTime, onPlay }: ChapterListProps) {
  const activeChapter = video.chapters.findLast((chapter) => chapter.startSeconds <= currentTime)

  return (
    <aside className="chapters-panel" aria-label="Chapitres">
      <div className="chapters-heading">
        <p className="eyebrow">Navigation</p>
        <span>{video.chapters.length || '—'}</span>
      </div>

      {video.chapterStatus === 'ready' ? (
        <>
          {video.chapterSource === 'ai-transcript' && (
            <div className="ai-notice">
              <strong>Généré par IA</strong>
              <span>
                Chapitres générés automatiquement par IA — vérifiez les propos dans la vidéo originale.
              </span>
            </div>
          )}
          {video.chapterSource === 'youtube-description' && (
            <p className="chapter-provenance">Chapitres publiés avec la vidéo originale</p>
          )}
          <ol>
            {video.chapters.map((chapter) => (
              <li key={chapter.startSeconds}>
                <button
                  type="button"
                  aria-label={`${formatTimestamp(chapter.startSeconds)} ${chapter.title}`}
                  aria-current={activeChapter?.startSeconds === chapter.startSeconds ? 'true' : undefined}
                  onClick={() => onPlay(chapter.startSeconds)}
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
          <p>{emptyStateMessages[video.chapterStatus]}</p>
        </div>
      )}
    </aside>
  )
}
