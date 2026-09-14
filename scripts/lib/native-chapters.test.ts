import { describe, expect, it } from 'vitest'

import { parseNativeChapters } from './native-chapters'

describe('parseNativeChapters', () => {
  it('extrait les formats de timestamp YouTube à deux et trois segments', () => {
    expect(parseNativeChapters([
      '0:00 Introduction',
      '10:15 Sujet',
      '1:02:03 Conclusion',
    ].join('\n'))).toEqual([
      { startSeconds: 0, title: 'Introduction' },
      { startSeconds: 615, title: 'Sujet' },
      { startSeconds: 3_723, title: 'Conclusion' },
    ])
  })

  it.each(['-', '–', '—'])('retire le séparateur « %s » placé après le timestamp', (separator) => {
    expect(parseNativeChapters([
      `0:00 ${separator} Introduction`,
      `0:10 ${separator} Sujet`,
      `0:20 ${separator} Conclusion`,
    ].join('\n'))).toEqual([
      { startSeconds: 0, title: 'Introduction' },
      { startSeconds: 10, title: 'Sujet' },
      { startSeconds: 20, title: 'Conclusion' },
    ])
  })

  it('ignore les lignes invalides sans analyser leur éventuel HTML', () => {
    expect(parseNativeChapters([
      'Présentation libre',
      '<p>0:05 Faux chapitre HTML</p>',
      '0:00 Introduction',
      '0:60 Timestamp invalide',
      '0:10 Sujet',
      '0:20 Conclusion',
    ].join('\n'))).toEqual([
      { startSeconds: 0, title: 'Introduction' },
      { startSeconds: 10, title: 'Sujet' },
      { startSeconds: 20, title: 'Conclusion' },
    ])
  })

  it.each([
    { description: '', count: 0 },
    { description: '0:00 Introduction', count: 1 },
    { description: '0:00 Introduction\n0:10 Sujet', count: 2 },
  ])('rejette un ensemble de $count chapitre(s)', ({ description }) => {
    expect(parseNativeChapters(description)).toEqual([])
  })

  it('rejette un ensemble dont le premier timestamp ne vaut pas zéro', () => {
    expect(parseNativeChapters([
      '0:01 Introduction tardive',
      '0:11 Sujet',
      '0:21 Conclusion',
    ].join('\n'))).toEqual([])
  })

  it.each([
    ['dupliqué', '0:00 Introduction\n0:20 Sujet\n0:20 Conclusion'],
    ['décroissant', '0:00 Introduction\n0:20 Sujet\n0:10 Conclusion'],
  ])('rejette un timestamp %s', (_case, description) => {
    expect(parseNativeChapters(description)).toEqual([])
  })

  it('rejette un écart inférieur à dix secondes', () => {
    expect(parseNativeChapters([
      '0:00 Introduction',
      '0:09 Sujet trop proche',
      '0:20 Conclusion',
    ].join('\n'))).toEqual([])
  })
})
