jest.mock('../db', () => ({
  tryConsumeConsumerDailyUsage: jest.fn(async () => ({ allowed: true })),
  run: jest.fn(async () => ({}))
}))
jest.mock('../services/promptBattleRunner', () => ({
  runPlayerModel: jest.fn(async () => ({ text: 'Output', inputTokens: 1, outputTokens: 1, totalTokens: 2 })),
  countPromptTokens: jest.fn(async () => 1),
  getModelQuotaCost: jest.fn(() => 1),
  getAvailablePromptBattleModels: jest.fn(() => [{ id: 'test-model' }]),
  getDefaultPromptBattleModelId: jest.fn(() => 'test-model'),
  sanitizeModelId: jest.fn(() => 'test-model')
}))
jest.mock('../services/promptModelOutputScore', () => ({ evaluateModelOutputTiered: jest.fn(() => ({ scorePercent: 80 })) }))

describe('prompt battle disabled preview and reconnect contract', () => {
  let service, runner, socket, io, handlers, room
  const previousPreviewSetting = process.env.PROMPT_BATTLE_PREVIEW_ENABLED

  beforeEach(() => {
    jest.resetModules()
    process.env.PROMPT_BATTLE_PREVIEW_ENABLED = 'false'
    service = require('../services/promptBattleSocket')
    runner = require('../services/promptBattleRunner')
    handlers = {}
    socket = { id: 'reconnected-socket', userId: '1', username: 'Me', on: jest.fn((event, handler) => { handlers[event] = handler }), emit: jest.fn(), join: jest.fn() }
    io = { to: jest.fn(() => ({ emit: jest.fn() })) }
    room = {
      code: 'ABC123', status: 'running', endsAt: Date.now() + 60000,
      modelId: 'test-model', durationSec: 300,
      problem: { id: 'test-problem' }, problemPublic: { title: 'Test problem' },
      players: new Map([
        ['1', { username: 'Me', prompt: 'My prompt', submitCount: 1, submissionVersion: 1 }],
        ['2', { username: 'Friend', prompt: 'Their prompt', submitCount: 1, submissionVersion: 1 }]
      ])
    }
    service.rooms.set(room.code, room)
    service.registerPromptBattleHandlers(socket, io)
  })

  afterEach(() => {
    for (const current of service.rooms.values()) {
      clearTimeout(current.timer)
      clearTimeout(current.cleanupTimer)
    }
    service.rooms.clear()
    if (previousPreviewSetting === undefined) delete process.env.PROMPT_BATTLE_PREVIEW_ENABLED
    else process.env.PROMPT_BATTLE_PREVIEW_ENABLED = previousPreviewSetting
  })

  test('config and submission explicitly report disabled previews without model calls', () => {
    expect(socket.emit).toHaveBeenCalledWith('pb-config', expect.objectContaining({ previewEnabled: false }))
    const reply = jest.fn()
    handlers['pb-submit']({ prompt: 'A fresh prompt' }, reply)
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: true, previewEnabled: false, room: expect.objectContaining({ previewEnabled: false }) }))
    expect(runner.runPlayerModel).not.toHaveBeenCalled()
  })

  test('active battle rejoin restores room membership and submission state', () => {
    const reply = jest.fn()
    handlers['pb-rejoin-running-room']({ roomCode: room.code }, reply)
    expect(socket.join).toHaveBeenCalledWith('pb-ABC123')
    expect(room.players.get('1').socketId).toBe('reconnected-socket')
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: true, phase: 'playing', room: expect.objectContaining({ previewEnabled: false }) }))
  })

  test('completed results can be recovered by a member without rerunning scoring', async () => {
    await service.finalizeRoom(room.code, io)
    const callsAfterScoring = runner.runPlayerModel.mock.calls.length
    expect(room.status).toBe('done')
    expect(room.results.results).toHaveLength(2)
    const reply = jest.fn()
    handlers['pb-rejoin-running-room']({ roomCode: room.code }, reply)
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: true, phase: 'results', results: room.results }))
    expect(runner.runPlayerModel).toHaveBeenCalledTimes(callsAfterScoring)
  })

  test('nonmembers cannot retrieve another completed battle results', () => {
    room.status = 'done'
    room.results = { results: [], tie: true }
    socket.userId = '3'
    const reply = jest.fn()
    handlers['pb-rejoin-running-room']({ roomCode: room.code }, reply)
    expect(reply).toHaveBeenCalledWith({ ok: false, error: 'You are not in this battle' })
    expect(socket.join).not.toHaveBeenCalled()
  })
})
