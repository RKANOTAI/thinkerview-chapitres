interface StatusNoticeProps {
  kind: 'loading' | 'error'
  onRetry?: () => void
}

export function StatusNotice({ kind, onRetry }: StatusNoticeProps) {
  const isError = kind === 'error'

  return (
    <main className="status-page">
      <section className="status-notice" role={isError ? 'alert' : 'status'}>
        <p className="eyebrow">Catalogue public</p>
        <h1>{isError ? 'Impossible de charger le catalogue' : 'Chargement du catalogue…'}</h1>
        <p>
          {isError
            ? 'Les données publiées sont momentanément indisponibles.'
            : 'Validation des vidéos et des chapitres en cours.'}
        </p>
        {isError && onRetry !== undefined && (
          <button type="button" onClick={onRetry}>Réessayer</button>
        )}
      </section>
    </main>
  )
}
