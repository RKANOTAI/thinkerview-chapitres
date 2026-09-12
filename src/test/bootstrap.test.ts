import { describe, expect, it } from 'vitest'

describe('test harness', () => {
  it('runs in jsdom', () => {
    expect(document.createElement('main')).toBeInstanceOf(HTMLElement)
  })
})
