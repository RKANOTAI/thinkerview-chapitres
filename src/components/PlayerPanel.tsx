import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { CatalogVideo } from '../domain/catalog'
import { formatTimestamp } from '../domain/time'
import { buildPlayerUrl, replacePlayerUrl } from '../lib/urlState'
import {
  YouTubeController,
  type YouTubeControllerOptions,
} from '../lib/youtubeIframe'
import { ChapterList } from './ChapterList'

interface PlayerPanelProps {
  video: CatalogVideo
  startSeconds: number
  onStartSecondsChange?: (startSeconds: number) => void
  createController?: (
    element: HTMLElement,
    options: YouTubeControllerOptions,
  ) => YouTubeController
}

function createYouTubeController(
  element: HTMLElement,
  options: YouTubeControllerOptions,
): YouTubeController {
  return new YouTubeController(element, options)
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  return hours > 0 ? `${hours} h ${minutes.toString().padStart(2, '0')}` : `${minutes} min`
}

function getYouTubeUrl(videoId: string, startSeconds: number): string {
  const url = new URL('https://www.youtube.com/watch')
  url.searchParams.set('v', videoId)
  if (startSeconds > 0) {
    url.searchParams.set('t', `${startSeconds}s`)
  }
  return url.href
}

function getReportUrl(video: CatalogVideo, currentTime: number): string {
  const activeChapter = video.chapters.findLast(
    (chapter) => chapter.startSeconds <= currentTime,
  )
  const url = new URL('https://github.com/RKANOTAI/thinkerview-chapitres/issues/new')
  url.searchParams.set('title', `Erreur de chapitre — ${video.title}`)
  url.searchParams.set('body', [
    `Vidéo : ${video.title}`,
    `URL : ${getYouTubeUrl(video.id, Math.floor(currentTime))}`,
    activeChapter === undefined
      ? `Instant : ${formatTimestamp(Math.floor(currentTime))}`
      : `Chapitre : ${formatTimestamp(activeChapter.startSeconds)} — ${activeChapter.title}`,
    '',
    'Correction proposée :',
  ].join('\n'))
  return url.href
}

export function PlayerPanel({
  video,
  startSeconds,
  onStartSecondsChange,
  createController = createYouTubeController,
}: PlayerPanelProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<YouTubeController | null>(null)
  const currentVideoIdRef = useRef(video.id)
  useLayoutEffect(() => {
    currentVideoIdRef.current = video.id
  }, [video.id])
  const [playbackTime, setPlaybackTime] = useState({ videoId: video.id, seconds: startSeconds })
  const [playbackState, setPlaybackState] = useState({
    videoId: video.id,
    state: -1 as YT.PlayerState,
  })
  const [failedVideoId, setFailedVideoId] = useState<string | null>(null)
  const [copyResult, setCopyResult] = useState<{
    videoId: string
    status: 'copied' | 'error'
  } | null>(null)
  const currentTime = playbackTime.videoId === video.id ? playbackTime.seconds : startSeconds
  const playerState = playbackState.videoId === video.id ? playbackState.state : -1
  const playerFailed = failedVideoId === video.id
  const copyStatus = copyResult?.videoId === video.id ? copyResult.status : 'idle'

  useEffect(() => {
    if (!video.embeddable || mountRef.current === null) {
      return
    }

    let active = true
    const controller = createController(mountRef.current, {
      onStateChange: (state) => {
        if (active) {
          setPlaybackState({ videoId: currentVideoIdRef.current, state })
        }
      },
      onError: () => {
        if (active) {
          const videoId = currentVideoIdRef.current
          setPlaybackState({ videoId, state: -1 })
          setFailedVideoId(videoId)
        }
      },
    })
    controllerRef.current = controller

    return () => {
      active = false
      controller.destroy()
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [createController, video.embeddable])

  useEffect(() => {
    if (!video.embeddable || controllerRef.current === null) {
      return
    }

    let active = true
    void controllerRef.current.cue(video.id, startSeconds).catch(() => {
      if (active) {
        setFailedVideoId(video.id)
      }
    })
    return () => {
      active = false
    }
  }, [startSeconds, video.id, video.embeddable])

  useEffect(() => {
    if (playerState !== 1 || controllerRef.current === null) {
      return
    }

    const intervalId = window.setInterval(() => {
      const nextTime = controllerRef.current?.getCurrentTime()
      if (nextTime !== undefined && Number.isFinite(nextTime) && nextTime >= 0) {
        setPlaybackTime({ videoId: currentVideoIdRef.current, seconds: nextTime })
      }
    }, 1_000)

    return () => window.clearInterval(intervalId)
  }, [playerState])

  const playChapter = (chapterStartSeconds: number) => {
    setPlaybackTime({ videoId: video.id, seconds: chapterStartSeconds })
    setCopyResult(null)
    onStartSecondsChange?.(chapterStartSeconds)
    replacePlayerUrl({ videoId: video.id, startSeconds: chapterStartSeconds })

    if (controllerRef.current !== null) {
      void controllerRef.current.playAt(video.id, chapterStartSeconds).catch(() => {
        setFailedVideoId(video.id)
      })
    }
  }

  const copyShareUrl = async () => {
    const shareUrl = buildPlayerUrl(new URL(window.location.href), {
      videoId: video.id,
      startSeconds: Math.max(0, Math.floor(currentTime)),
    })
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopyResult({ videoId: video.id, status: 'copied' })
    } catch {
      setCopyResult({ videoId: video.id, status: 'error' })
    }
  }

  const fallback = !video.embeddable || playerFailed
  const timestamp = Math.max(0, Math.floor(currentTime))

  return (
    <section className="player-section" aria-label="Lecture en cours">
      <div className="player-column">
        <div className="player-frame">
          {video.embeddable && (
            <div ref={mountRef} className="youtube-player" data-testid="youtube-player" />
          )}
          {fallback && (
            <div className="player-fallback">
              <p>
                {video.embeddable
                  ? 'Le lecteur intégré est indisponible.'
                  : 'Cette vidéo ne peut pas être lue sur ce site.'}
              </p>
              <a href={getYouTubeUrl(video.id, timestamp)} target="_blank" rel="noreferrer">
                Voir sur YouTube
              </a>
            </div>
          )}
        </div>

        <div className="player-copy">
          <p className="eyebrow">Lecture en cours</p>
          <h2>{video.title}</h2>
          <p>{video.descriptionExcerpt}</p>
          <div className="player-actions">
            <span>{formatDuration(video.durationSeconds)}</span>
            <a href={getYouTubeUrl(video.id, timestamp)} target="_blank" rel="noreferrer">
              Ouvrir sur YouTube ↗
            </a>
            <button type="button" onClick={() => void copyShareUrl()}>Copier le lien</button>
            <a href={getReportUrl(video, timestamp)} target="_blank" rel="noreferrer">
              Signaler une erreur
            </a>
            {copyStatus !== 'idle' && (
              <span role="status">
                {copyStatus === 'copied' ? 'Lien copié' : 'Copie indisponible'}
              </span>
            )}
          </div>
        </div>
      </div>

      <ChapterList video={video} currentTime={currentTime} onPlay={playChapter} />
    </section>
  )
}
