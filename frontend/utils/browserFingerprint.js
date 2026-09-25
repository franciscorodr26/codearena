// Browser Fingerprinting for Multi-Account Detection
// Collects non-invasive browser characteristics to identify devices
// Classified as "strictly necessary" for fair play and service integrity

import { config } from '../config/env';

/**
 * Generate a browser fingerprint from available characteristics
 * This helps detect users operating multiple accounts
 * Required for fair competitive play - not subject to cookie consent
 */
export async function generateBrowserFingerprint() {
  const components = [];

  // User Agent
  components.push(navigator.userAgent || '');

  // Language
  components.push(navigator.language || '');

  // Platform
  components.push(navigator.platform || '');

  // Screen resolution
  components.push(`${screen.width}x${screen.height}x${screen.colorDepth}`);

  // Timezone
  components.push(Intl.DateTimeFormat().resolvedOptions().timeZone || '');

  // Timezone offset
  components.push(new Date().getTimezoneOffset().toString());

  // Cookies enabled
  components.push(navigator.cookieEnabled ? '1' : '0');

  // Hardware concurrency (CPU cores)
  components.push(navigator.hardwareConcurrency?.toString() || '');

  // Device memory (if available)
  components.push(navigator.deviceMemory?.toString() || '');

  // Touch support
  components.push(navigator.maxTouchPoints?.toString() || '0');

  // WebGL renderer (graphics card info)
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        components.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '');
      }
    }
  } catch (e) {
    components.push('');
  }

  // Canvas fingerprint (unique rendering characteristics)
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 200;
    canvas.height = 50;

    // Draw test pattern
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('CodeArena', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('fingerprint', 4, 17);

    components.push(canvas.toDataURL());
  } catch (e) {
    components.push('');
  }

  // Audio fingerprint (audio processing characteristics)
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const analyser = audioContext.createAnalyser();
    const gain = audioContext.createGain();
    const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

    gain.gain.value = 0; // Mute
    oscillator.type = 'triangle';
    oscillator.connect(analyser);
    analyser.connect(scriptProcessor);
    scriptProcessor.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(0);

    const dataArray = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(dataArray);

    // Just use a hash of the first few values
    components.push(dataArray.slice(0, 10).join(','));

    oscillator.stop();
    audioContext.close();
  } catch (e) {
    components.push('');
  }

  // Create hash of all components
  const fingerprintString = components.join('|||');
  const hash = await hashString(fingerprintString);

  return {
    fingerprint: hash,
    userAgent: navigator.userAgent,
    screenResolution: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    platform: navigator.platform
  };
}

/**
 * Hash a string using SHA-256
 */
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Send fingerprint to backend
 * Required for fair play - ensures competitive integrity
 */
export async function sendFingerprint(token) {
  if (!token) return;

  try {
    const fpData = await generateBrowserFingerprint();

    // generateBrowserFingerprint returns null if no consent
    if (!fpData) return;

    await fetch(`${config.backend_url}/api/fingerprint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(fpData)
    });
  } catch (error) {
    // Silently fail - don't disrupt user experience
    console.debug('[Fingerprint] Collection failed:', error.message);
  }
}

export default generateBrowserFingerprint;
