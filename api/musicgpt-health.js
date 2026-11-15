// Read-only, non-billable MusicGPT authorization diagnostic.
// No secret or upstream response body is sent to the browser.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const key = process.env.PULSE_MUSICGPT_OWNER_TOKEN;
  if (!key) return res.status(503).json({ ok: false, configured: false, message: 'MusicGPT server token is missing' });
  try {
    const response = await fetch('https://api.musicgpt.com/api/public/v1/getAllVoices', {
      method: 'GET',
      headers: { Authorization: key, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    if (response.status === 401 || response.status === 403) {
      return res.status(502).json({ ok: false, configured: true, authorized: false, message: 'MusicGPT rejected the token' });
    }
    if (!response.ok) {
      return res.status(502).json({ ok: false, configured: true, authorized: null, message: 'MusicGPT service returned a non-success response' });
    }
    let payload;
    try { payload = await response.json(); } catch {
      return res.status(502).json({ ok: false, configured: true, authorized: null, message: 'Unexpected MusicGPT response' });
    }
    const authorized = payload?.success === true && Array.isArray(payload.voices);
    return res.status(authorized ? 200 : 502).json({
      ok: authorized,
      configured: true,
      authorized,
      message: authorized ? 'MusicGPT read-only authentication check passed' : 'MusicGPT response did not match the expected schema'
    });
  } catch {
    return res.status(502).json({ ok: false, configured: true, authorized: null, message: 'MusicGPT could not be reached' });
  }
}
