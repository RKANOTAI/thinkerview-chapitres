import { expect, test } from '@playwright/test'

test('le lecteur occupe la largeur principale avec les chapitres à droite', async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', (route) => route.abort())
  await page.goto('/thinkerview-chapitres/')

  const player = page.locator('.player-frame')
  const chapters = page.getByRole('complementary', { name: 'Chapitres' })
  await expect(player).toBeVisible()
  await expect(chapters).toBeVisible()

  const playerBox = await player.boundingBox()
  const chaptersBox = await chapters.boundingBox()
  expect(playerBox).not.toBeNull()
  expect(chaptersBox).not.toBeNull()
  expect(playerBox!.width).toBeGreaterThanOrEqual(900)
  expect(chaptersBox!.x).toBeGreaterThanOrEqual(playerBox!.x + playerBox!.width)
})
