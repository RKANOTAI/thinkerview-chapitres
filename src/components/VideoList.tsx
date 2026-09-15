import { useState } from 'react'

import type { CatalogVideo } from '../domain/catalog'
import { VideoCard } from './VideoCard'

const PAGE_SIZE = 24

interface VideoListProps {
  videos: readonly CatalogVideo[]
  selectedVideoId: string
  onSelect: (videoId: string) => void
  pageKey: string
}

export function VideoList({ videos, selectedVideoId, onSelect, pageKey }: VideoListProps) {
  const [pagination, setPagination] = useState({ pageKey, visibleCount: PAGE_SIZE })
  const visibleCount = pagination.pageKey === pageKey ? pagination.visibleCount : PAGE_SIZE

  if (videos.length === 0) {
    return <p className="no-results">Aucun entretien ne correspond à cette recherche.</p>
  }

  const visibleVideos = videos.slice(0, visibleCount)

  return (
    <div className="video-list">
      {visibleVideos.map((video) => (
        <VideoCard
          key={video.id}
          video={video}
          selected={video.id === selectedVideoId}
          onSelect={onSelect}
        />
      ))}
      {visibleCount < videos.length && (
        <button
          className="load-more"
          type="button"
          onClick={() => setPagination({ pageKey, visibleCount: visibleCount + PAGE_SIZE })}
        >
          Afficher plus
        </button>
      )}
    </div>
  )
}
