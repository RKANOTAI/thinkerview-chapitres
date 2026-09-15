interface HeaderProps {
  totalVideos: number
  channelUrl: string
  previewMode: boolean
}

export function Header({ totalVideos, channelUrl, previewMode }: HeaderProps) {
  return (
    <header className="topbar">
      <a className="brand" href="./" aria-label="Accueil de Chapitres libres">
        <span className="brand-mark" aria-hidden="true">C//</span>
        <span>Chapitres libres</span>
      </a>
      <span className="catalog-total">
        {totalVideos} {previewMode ? 'vidéos de démonstration' : 'vidéos publiques'}
      </span>
      <a
        className="channel-link"
        href={channelUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="Chaîne Thinkerview sur YouTube"
      >
        Chaîne originale <span aria-hidden="true">↗</span>
      </a>
    </header>
  )
}
