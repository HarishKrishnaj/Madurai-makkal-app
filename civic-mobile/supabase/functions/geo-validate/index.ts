// Supabase Edge Function: geo-validate
// Deploy with: supabase functions deploy geo-validate

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const EARTH_RADIUS_M = 6371000;

const toRadians = (value: number): number => (value * Math.PI) / 180;

const haversineDistance = (
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number => {
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  try {
    const payload = await req.json();

    const binLatitude = Number(payload.bin_latitude);
    const binLongitude = Number(payload.bin_longitude);
    const userLatitude = Number(payload.user_latitude);
    const userLongitude = Number(payload.user_longitude);
    const allowedRadius = Number(payload.allowed_radius_meters ?? 5);
    const accuracy = Number(payload.accuracy ?? 999);
    const ageSeconds = Number(payload.location_age_seconds ?? 999);

    if (
      !Number.isFinite(binLatitude) ||
      !Number.isFinite(binLongitude) ||
      !Number.isFinite(userLatitude) ||
      !Number.isFinite(userLongitude)
    ) {
      return new Response(
        JSON.stringify({
          valid: false,
          reason: 'invalid_coordinates'
        }),
        {
          status: 400,
          headers
        }
      );
    }

    const distance = haversineDistance(binLatitude, binLongitude, userLatitude, userLongitude);
    const valid = distance <= allowedRadius && accuracy <= 10 && ageSeconds <= 30;

    return new Response(
      JSON.stringify({
        valid,
        distance_meters: distance,
        reason: valid ? null : 'geofence_or_accuracy_failed'
      }),
      {
        status: 200,
        headers
      }
    );
  } catch (_error) {
    return new Response(
      JSON.stringify({
        valid: false,
        reason: 'invalid_payload'
      }),
      {
        status: 400,
        headers
      }
    );
  }
});
