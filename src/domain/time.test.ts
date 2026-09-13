import { describe, expect, it } from 'vitest'

import { formatTimestamp, parseIsoDuration, parseTimestampLabel } from './time'

describe('parseIsoDuration', () => {
  it.each([
    ['PT2H3M4S', 7_384],
    ['PT45M', 2_700],
    ['PT9S', 9],
    ['P1D', 86_400],
    ['P1DT2H3M4S', 93_784],
    ['P0D', 0],
    ['PT0S', 0],
    ['P0DT0H0M0S', 0],
    ['P104249991374DT7H36M31S', Number.MAX_SAFE_INTEGER],
  ])('parses %s', (value, expected) => {
    expect(parseIsoDuration(value)).toBe(expected)
  })

  it.each([
    'P',
    'PT',
    'P1Y',
    'P1M',
    'P1W',
    'P1DT',
    'P1D2H',
    'PT1D',
    'PT1.5S',
    'PT-1S',
    'pt1s',
  ])('rejects unsupported form %s', (value) => {
    expect(() => parseIsoDuration(value)).toThrow(/Durée ISO/)
  })

  it.each([
    'P104249991374DT7H36M32S',
    'PT9007199254740992S',
    'P999999999999999999999999999999D',
  ])('rejects unsafe duration %s', (value) => {
    expect(() => parseIsoDuration(value)).toThrow(/Durée ISO/)
  })
})

describe('formatTimestamp', () => {
  it.each([
    [7_384, '2:03:04'],
    [125, '2:05'],
    [0, '0:00'],
    [Number.MAX_SAFE_INTEGER, '2501999792983:36:31'],
  ])('formats %s seconds', (value, expected) => {
    expect(formatTimestamp(value)).toBe(expected)
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    1.5,
    -1,
  ])('rejects non-safe integer %s', (value) => {
    expect(() => formatTimestamp(value)).toThrow(/Timestamp/)
  })
})

describe('parseTimestampLabel', () => {
  it.each([
    ['2:05', 125],
    ['1:02:03', 3_723],
    ['00:00', 0],
    ['150119987579016:31', Number.MAX_SAFE_INTEGER],
    ['2501999792983:36:31', Number.MAX_SAFE_INTEGER],
  ])('parses %s', (value, expected) => {
    expect(parseTimestampLabel(value)).toBe(expected)
  })

  it.each([
    '1:60',
    '1:60:00',
    'abc',
    '-1:20',
    '1.5:20',
    ' 1:20',
    '1:20 ',
    '1::20',
  ])('rejects malformed timestamp %s', (value) => {
    expect(() => parseTimestampLabel(value)).toThrow(/Timestamp/)
  })

  it.each([
    '150119987579016:32',
    '2501999792983:36:32',
    '999999999999999999999999999999:00',
  ])('rejects unsafe timestamp %s', (value) => {
    expect(() => parseTimestampLabel(value)).toThrow(/Timestamp/)
  })
})
