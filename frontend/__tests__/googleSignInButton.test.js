import React, { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import GoogleSignInButton from '../components/GoogleSignInButton'
import { config } from '../config/env'

jest.mock('../config/env', () => ({ config: { google_client_id: 'google-client' } }))

const scriptSelector = 'script[src="https://accounts.google.com/gsi/client"]'
let provider

beforeEach(() => {
  jest.useFakeTimers()
  delete window.google
  document.querySelectorAll(scriptSelector).forEach(script => script.remove())
  config.google_client_id = 'google-client'
  provider = {
    initialize: jest.fn(),
    renderButton: jest.fn(container => {
      const button = document.createElement('button')
      button.textContent = 'Provider sign-in'
      container.appendChild(button)
    })
  }
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
})

function finishLoading() {
  window.google = { accounts: { id: provider } }
  fireEvent.load(document.querySelector(scriptSelector))
}

test('StrictMode shares one script and renders one provider button', () => {
  render(<StrictMode><GoogleSignInButton onSuccess={jest.fn()} /></StrictMode>)
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1)
  finishLoading()
  expect(provider.initialize).toHaveBeenCalledTimes(1)
  expect(screen.getAllByRole('button', { name: 'Provider sign-in' })).toHaveLength(1)
})

test('parent rerenders preserve the button and use the latest callbacks', () => {
  const oldSuccess = jest.fn()
  const latestSuccess = jest.fn()
  const latestError = jest.fn()
  const { rerender } = render(<GoogleSignInButton onSuccess={oldSuccess} />)
  finishLoading()
  const originalButton = screen.getByRole('button', { name: 'Provider sign-in' })
  rerender(<GoogleSignInButton onSuccess={latestSuccess} onError={latestError} />)
  expect(provider.initialize).toHaveBeenCalledTimes(1)
  expect(provider.renderButton).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Provider sign-in' })).toBe(originalButton)
  const callback = provider.initialize.mock.calls[0][0].callback
  act(() => callback({ credential: 'credential' }))
  expect(latestSuccess).toHaveBeenCalledWith('credential')
  expect(oldSuccess).not.toHaveBeenCalled()
  act(() => callback({}))
  expect(latestError).toHaveBeenCalledWith(expect.any(Error))
})

test('failed script load gives a visible retry and can recover', () => {
  const onError = jest.fn()
  render(<GoogleSignInButton onSuccess={jest.fn()} onError={onError} />)
  const failedScript = document.querySelector(scriptSelector)
  fireEvent.error(failedScript)
  expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in is unavailable')
  expect(onError).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Retry Google sign-in' }))
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1)
  expect(document.querySelector(scriptSelector)).not.toBe(failedScript)
  finishLoading()
  expect(screen.getByRole('button', { name: 'Provider sign-in' })).toBeInTheDocument()
})

test('a stalled script stops showing a skeleton after the loading deadline', () => {
  render(<GoogleSignInButton onSuccess={jest.fn()} />)
  act(() => jest.advanceTimersByTime(15000))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toBeInTheDocument()
})

test('unmount removes listeners and ignores stale provider callbacks', () => {
  const onSuccess = jest.fn()
  const onError = jest.fn()
  const { unmount } = render(<GoogleSignInButton onSuccess={onSuccess} onError={onError} />)
  finishLoading()
  const callback = provider.initialize.mock.calls[0][0].callback
  unmount()
  act(() => callback({ credential: 'stale' }))
  act(() => jest.advanceTimersByTime(15000))
  expect(onSuccess).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
})

test('route changes reuse a pending script without notifying the previous page', () => {
  const oldError = jest.fn()
  const oldPage = render(<GoogleSignInButton onSuccess={jest.fn()} onError={oldError} />)
  oldPage.unmount()
  render(<GoogleSignInButton onSuccess={jest.fn()} />)
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1)
  finishLoading()
  expect(oldError).not.toHaveBeenCalled()
  expect(provider.renderButton).toHaveBeenCalledTimes(1)
})

test('disabled buttons prevent keyboard interaction and ignore incoming credentials', () => {
  const onSuccess = jest.fn()
  const { rerender } = render(<GoogleSignInButton onSuccess={onSuccess} />)
  finishLoading()
  rerender(<GoogleSignInButton onSuccess={onSuccess} disabled />)
  const button = screen.getByRole('button', { name: 'Provider sign-in' })
  expect(button.parentElement).toHaveAttribute('inert')
  act(() => provider.initialize.mock.calls[0][0].callback({ credential: 'credential' }))
  expect(onSuccess).not.toHaveBeenCalled()
  expect(provider.renderButton).toHaveBeenCalledTimes(1)
})

test('unconfigured Google sign-in does not load a provider script', () => {
  config.google_client_id = ''
  const { container } = render(<GoogleSignInButton onSuccess={jest.fn()} />)
  expect(container).toBeEmptyDOMElement()
  expect(document.querySelector(scriptSelector)).toBeNull()
})

test('initialization errors display a retry instead of an empty button', () => {
  provider.initialize.mockImplementationOnce(() => { throw new Error('Provider unavailable') })
  render(<GoogleSignInButton onSuccess={jest.fn()} />)
  finishLoading()
  expect(screen.getByRole('alert')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Retry Google sign-in' }))
  expect(screen.getByRole('button', { name: 'Provider sign-in' })).toBeInTheDocument()
})
