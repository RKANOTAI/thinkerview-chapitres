import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import App from './App'

describe('aperçu V1', () => {
  afterEach(() => {
    cleanup()
    window.history.replaceState(null, '', '/')
  })

  it('cherche un entretien et lance un chapitre dans le lecteur unique', async () => {
    window.history.replaceState(null, '', '/thinkerview-chapitres/')
    const user = userEvent.setup()

    render(<App />)

    const player = screen.getByRole('region', { name: 'Lecture en cours' })
    expect(within(player).getByRole('heading', {
      name: /Menace de guerre ou basculement de l'ordre mondial/i,
    })).toBeInTheDocument()

    const iframe = screen.getByTitle('Lecteur YouTube')
    expect(iframe).toHaveAttribute(
      'src',
      expect.stringContaining('/embed/Mls6_9KOpqI'),
    )

    await user.click(screen.getByRole('button', {
      name: /Intelligence artificielle et course technologique/i,
    }))

    expect(iframe).toHaveAttribute('src', expect.stringContaining('start=1662'))
    expect(window.location.search).toBe('?v=Mls6_9KOpqI&t=1662')

    await user.type(screen.getByRole('searchbox', { name: 'Rechercher' }), 'énergie')

    expect(screen.getByRole('button', {
      name: /Fin définitive de l'énergie bon marché/i,
    })).toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: /L'Euro et l’UE sont bientôt morts/i,
    })).not.toBeInTheDocument()
  })
})
