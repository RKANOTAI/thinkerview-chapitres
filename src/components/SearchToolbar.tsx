import type { VideoFilter, VideoOrder } from '../domain/filterVideos'

const availableFilters = [
  { value: 'all', label: 'Tout' },
  { value: 'video', label: 'Vidéos' },
  { value: 'live', label: 'Directs' },
  { value: 'with-chapters', label: 'Avec chapitres' },
  { value: 'without-chapters', label: 'Sans chapitres' },
] satisfies ReadonlyArray<{ value: VideoFilter; label: string }>

interface SearchToolbarProps {
  query: string
  filter: VideoFilter
  order: VideoOrder
  onQueryChange: (query: string) => void
  onFilterChange: (filter: VideoFilter) => void
  onOrderChange: (order: VideoOrder) => void
}

export function SearchToolbar({
  query,
  filter,
  order,
  onQueryChange,
  onFilterChange,
  onOrderChange,
}: SearchToolbarProps) {
  return (
    <div className="catalog-tools">
      <label className="search-field">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          aria-label="Rechercher"
          value={query}
          placeholder="Rechercher un invité, un thème…"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      <div className="filter-list" aria-label="Filtrer les entretiens">
        {availableFilters.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => onFilterChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className="order-field">
        <span>Trier</span>
        <select
          aria-label="Ordre d’affichage"
          value={order}
          onChange={(event) => onOrderChange(event.target.value as VideoOrder)}
        >
          <option value="recent">Plus récentes</option>
          <option value="oldest">Plus anciennes</option>
        </select>
      </label>
    </div>
  )
}
