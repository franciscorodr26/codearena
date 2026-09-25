/**
 * IP Geolocation Service
 * Uses ip-api.com for IP to location lookup (free tier: 45 requests/minute)
 */

const logger = require('../utils/logger');

// Simple in-memory cache to avoid rate limiting
const locationCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get location from IP address using ip-api.com
 * @param {string} ip - IP address to lookup
 * @returns {Promise<string|null>} - Location string like "San Francisco, CA" or null
 */
async function getLocationFromIP(ip) {
  // Handle localhost/private IPs
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return null;
  }

  // Clean IP (remove IPv6 prefix if present)
  const cleanIP = ip.replace(/^::ffff:/, '');

  // Check cache first
  const cached = locationCache.get(cleanIP);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.location;
  }

  try {
    // ip-api.com free endpoint (HTTP only, HTTPS requires paid plan)
    // Fields: city, region, country
    const response = await fetch(`http://ip-api.com/json/${cleanIP}?fields=status,city,regionName,country`, {
      timeout: 3000 // 3 second timeout
    });

    if (!response.ok) {
      logger.warn(`[GEOLOCATION] API request failed: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.status !== 'success') {
      logger.warn(`[GEOLOCATION] Lookup failed for IP ${cleanIP}: ${data.message || 'unknown error'}`);
      return null;
    }

    // Format location string
    let location = null;
    if (data.city && data.regionName) {
      // US-style: "San Francisco, CA" - use state abbreviation for US
      if (data.country === 'United States') {
        const stateAbbrev = getUSStateAbbreviation(data.regionName);
        location = `${data.city}, ${stateAbbrev || data.regionName}`;
      } else {
        // International: "London, England" or "Tokyo, Japan"
        location = `${data.city}, ${data.regionName}`;
      }
    } else if (data.city) {
      location = data.city;
    } else if (data.country) {
      location = data.country;
    }

    // Cache the result
    locationCache.set(cleanIP, {
      location,
      timestamp: Date.now()
    });

    logger.info(`[GEOLOCATION] Resolved ${cleanIP} to ${location}`);
    return location;

  } catch (err) {
    logger.error(`[GEOLOCATION] Error looking up IP ${cleanIP}:`, err.message);
    return null;
  }
}

/**
 * Get US state abbreviation from full name
 */
function getUSStateAbbreviation(stateName) {
  const states = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
    'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
    'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
    'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
    'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
    'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
    'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
    'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
    'District of Columbia': 'DC'
  };
  return states[stateName] || null;
}

/**
 * Extract client IP from request, handling proxies
 */
function getClientIP(req) {
  // Check various headers for proxy/load balancer scenarios
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, first one is the client
    return forwardedFor.split(',')[0].trim();
  }

  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return realIP;
  }

  // Fallback to direct connection IP
  return req.ip || req.connection?.remoteAddress || null;
}

module.exports = {
  getLocationFromIP,
  getClientIP
};
