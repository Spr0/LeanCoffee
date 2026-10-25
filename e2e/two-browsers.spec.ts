import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// Gate 2: create a board in one browser, join from another, and see each other live.
test('facilitator and participant see each other and live changes', async ({ browser }) => {
  const facilitator = await (await browser.newContext()).newPage()
  const participant = await (await browser.newContext()).newPage()

  await facilitator.goto('/')
  await facilitator.getByLabel('Your name').fill('Fran')
  await facilitator.getByLabel('Board name').fill(`E2E two browsers ${Date.now()}`)
  await facilitator.getByRole('button', { name: '60 min' }).click()
  await facilitator.getByRole('button', { name: 'Create board' }).click()
  await expect(facilitator.getByTestId('room-code')).toHaveText(
    /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/,
  )
  await expect(facilitator.getByText('FACILITATOR', { exact: true })).toBeVisible()
  await expect(facilitator.getByRole('button', { name: '60', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(facilitator.getByRole('button', { name: 'Copy recovery link' })).toBeVisible()
  expect((await new AxeBuilder({ page: facilitator }).analyze()).violations).toEqual([])

  const link = facilitator.url()
  await participant.goto(link)
  await expect(participant.getByText('You are invited to')).toBeVisible()
  expect((await new AxeBuilder({ page: participant }).analyze()).violations).toEqual([])
  await participant.getByLabel('Your name').fill('Pat')
  await participant.getByRole('button', { name: 'Join session' }).click()
  await expect(participant.getByText('Waiting for Fran to start the session')).toBeVisible()

  // Each sees the other, live.
  const people = (page: typeof facilitator) => page.getByRole('list', { name: 'People here now' })
  await expect(people(facilitator)).toContainText('Pat')
  await expect(people(participant)).toContainText('Fran')
  await expect(
    facilitator.getByRole('button', { name: 'Start brainstorm for 2 people' }),
  ).toBeVisible()

  // Participants cannot change rules; facilitator changes arrive live.
  await expect(participant.getByRole('button', { name: 'Increase Voting' })).toBeDisabled()
  await facilitator.getByRole('button', { name: 'Increase Voting' }).click()
  await expect(participant.getByRole('group', { name: 'Voting' })).toContainText('2:00')

  // A reload keeps the participant's identity (no second join).
  await participant.reload()
  await expect(participant.getByText('Waiting for Fran to start the session')).toBeVisible()
  await expect(people(facilitator)).not.toContainText('Pat (2)')

  await facilitator.getByRole('button', { name: 'Start brainstorm for 2 people' }).click()
  await expect(participant.getByRole('heading', { name: 'Brainstorm' })).toBeVisible()
  await expect(participant.getByRole('navigation', { name: 'Session progress' })).toBeVisible()
})
