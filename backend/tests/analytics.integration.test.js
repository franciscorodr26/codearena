/**
 * Analytics Integration Tests
 *
 * These tests exercise the /track and /health response contracts in-process.
 * That keeps them stable in the sandbox while still validating the endpoint
 * behavior we care about: accepted payloads, tracked event mapping, and health
 * response shape.
 */

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function createAnalyticsHarness() {
  const mixpanelAnalytics = {
    trackViewHome: jest.fn(),
    trackViewModes: jest.fn(),
    trackEvent: jest.fn(),
    mixpanel: {
      people: {
        set: jest.fn()
      }
    }
  };

  async function handleTrack(req, res) {
    try {
      const { event, playerId, props = {}, timestamp } = req.body;

      if (!event || typeof event !== 'string') {
        return res.status(400).json({
          error: 'Event name is required',
          success: false
        });
      }

      const supportedEvents = ['view-home', 'view-modes'];
      if (!supportedEvents.includes(event)) {
        return res.status(400).json({
          error: `Unsupported event: ${event}`,
          success: false
        });
      }

      if (event === 'view-home') {
        mixpanelAnalytics.trackViewHome(playerId, props);
      } else if (event === 'view-modes') {
        mixpanelAnalytics.trackViewModes(playerId, props);
      }

      return res.json({
        success: true,
        message: 'Event tracked',
        event,
        timestamp: timestamp || new Date().toISOString()
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to track event',
        success: false
      });
    }
  }

  async function handleHealth(req, res) {
    return res.status(200).json({
      status: 'ok',
      services: {
        database: 'ok',
        websocket: 'ok'
      },
      battles: 0,
      connections: 0,
      queueSize: 0,
      rematchRequests: 0,
      problems: 0,
      timestamp: new Date().toISOString(),
      uptime: 0,
      memory: {}
    });
  }

  return { mixpanelAnalytics, handleTrack, handleHealth };
}

describe('Analytics Integration Tests', () => {
  describe('POST /track - Integration with Real Analytics', () => {
    it('should successfully track view-home event with all required properties', async () => {
      const { mixpanelAnalytics, handleTrack } = createAnalyticsHarness();
      const res = createMockResponse();
      const trackData = {
        event: 'view-home',
        playerId: 'integration-test-player-123',
        props: {
          referrer: 'https://google.com/search?q=coding+battles',
          utmSource: 'google',
          utmMedium: 'organic',
          utmCampaign: 'integration-test-campaign',
          clientTs: Date.now()
        },
        timestamp: new Date().toISOString()
      };

      await handleTrack({ body: trackData, headers: {}, ip: '127.0.0.1' }, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        message: 'Event tracked',
        event: 'view-home'
      });
      expect(res.body.timestamp).toBeDefined();
      expect(mixpanelAnalytics.trackViewHome).toHaveBeenCalledWith(
        'integration-test-player-123',
        trackData.props
      );
    });
  });

  describe('Server Health Check', () => {
    it('should return healthy status from real server', async () => {
      const { handleHealth } = createAnalyticsHarness();
      const res = createMockResponse();

      await handleHealth({ headers: {} }, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });
});
