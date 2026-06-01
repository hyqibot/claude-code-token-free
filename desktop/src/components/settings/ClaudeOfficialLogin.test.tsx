import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { ClaudeOfficialLogin, openAuthorizationUrl } from './ClaudeOfficialLogin'
import { useHahaOAuthStore } from '../../stores/hahaOAuthStore'
import { useSettingsStore } from '../../stores/settingsStore'

const shellMock = vi.hoisted(() => ({
  open: vi.fn(),
}))

const hahaOAuthApiMock = vi.hoisted(() => ({
  status: vi.fn(),
  start: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-shell', () => shellMock)
vi.mock('../../api/hahaOAuth', () => ({
  hahaOAuthApi: hahaOAuthApiMock,
}))

describe('ClaudeOfficialLogin', () => {
  const authorizeUrl = 'https://claude.ai/oauth/authorize?state=test'
  let originalWindowOpen: typeof window.open

  beforeEach(() => {
    originalWindowOpen = window.open
    useSettingsStore.setState({ locale: 'en' })
    useHahaOAuthStore.setState(useHahaOAuthStore.getInitialState(), true)
    shellMock.open.mockReset()
    hahaOAuthApiMock.status.mockReset()
    hahaOAuthApiMock.start.mockReset()
    hahaOAuthApiMock.logout.mockReset()
    hahaOAuthApiMock.status.mockResolvedValue({ loggedIn: false })
    hahaOAuthApiMock.start.mockResolvedValue({ authorizeUrl, state: 'test' })
    window.open = vi.fn(() => null) as unknown as typeof window.open
  })

  afterEach(() => {
    cleanup()
    window.open = originalWindowOpen
  })

  it('falls back to window.open when Tauri shell open fails', async () => {
    shellMock.open.mockRejectedValue(new Error('shell unavailable'))
    window.open = vi.fn(() => ({ closed: false }) as Window) as unknown as typeof window.open

    expect(await openAuthorizationUrl(authorizeUrl)).toBe(true)

    expect(shellMock.open).toHaveBeenCalledWith(authorizeUrl)
    expect(window.open).toHaveBeenCalledWith(authorizeUrl, '_blank', 'noopener,noreferrer')
  })

  it('shows a manual authorization link when automatic opening fails', async () => {
    shellMock.open.mockRejectedValue(new Error('shell unavailable'))

    render(<ClaudeOfficialLogin />)

    const button = await screen.findByRole('button', { name: /sign in to claude/i })
    await act(async () => {
      fireEvent.click(button)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText(/could not open the browser automatically/i)).toBeInTheDocument()
    })
    const link = screen.getByRole('link', { name: /open authorization link/i })
    expect(link).toHaveAttribute('href', authorizeUrl)
  })
})
