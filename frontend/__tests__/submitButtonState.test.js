/**
 * @jest-environment jsdom
 */
import { render, screen, act } from '@testing-library/react'
import SubmitButton from '../components/ui/SubmitButton'

// Regression: the success label used to stick forever when a re-render within
// two seconds cancelled the reset timer, and it never cleared when `success`
// went back to false (a new problem loaded). Practice showed "All passed" on
// the next problem and the run button looked dead.
describe('SubmitButton success state', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  test('clears the success label as soon as success is false again', () => {
    const { rerender } = render(<SubmitButton label="Run tests" successLabel="All passed" success={false} enableSound={false} enableConfetti={false} />)
    expect(screen.getByRole('button')).toHaveTextContent('Run tests')
    rerender(<SubmitButton label="Run tests" successLabel="All passed" success enableSound={false} enableConfetti={false} />)
    expect(screen.getByRole('button')).toHaveTextContent('All passed')
    rerender(<SubmitButton label="Run tests" successLabel="All passed" success={false} enableSound={false} enableConfetti={false} />)
    expect(screen.getByRole('button')).toHaveTextContent('Run tests')
  })

  test('a re-render with a new callback does not cancel the two second reset', () => {
    const { rerender } = render(<SubmitButton label="Run tests" successLabel="All passed" success onSuccess={() => {}} enableSound={false} enableConfetti={false} />)
    expect(screen.getByRole('button')).toHaveTextContent('All passed')
    rerender(<SubmitButton label="Run tests" successLabel="All passed" success onSuccess={() => {}} enableSound={false} enableConfetti={false} />)
    act(() => { jest.advanceTimersByTime(2100) })
    expect(screen.getByRole('button')).toHaveTextContent('Run tests')
  })

  test('the error label behaves the same way', () => {
    const { rerender } = render(<SubmitButton label="Run tests" errorLabel="Not yet" error enableSound={false} />)
    expect(screen.getByRole('button')).toHaveTextContent('Not yet')
    rerender(<SubmitButton label="Run tests" errorLabel="Not yet" error={false} enableSound={false} />)
    expect(screen.getByRole('button')).toHaveTextContent('Run tests')
  })
})
