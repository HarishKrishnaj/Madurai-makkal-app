import {
  Bin,
  Complaint,
  CleanupProof,
  Coordinates,
  DisposalRecord,
  FraudAlert,
  RedemptionRecord,
  UserProfile,
  WalletEntry
} from '../types';
import { distanceMeters } from '../utils/geo';
import { supabase, withSupabase } from './supabase';

type GeoValidationPayload = {
  binLocation: Coordinates;
  userLocation: Coordinates;
  allowedRadiusMeters: number;
  accuracyMeters: number;
  locationAgeSeconds: number;
};

export const fetchBinsFromBackend = async (fallbackBins: Bin[]): Promise<Bin[]> =>
  withSupabase(async (client) => {
    const { data, error } = await client
      .from('bins')
      .select('id, bin_name, qr_code_id, latitude, longitude, status, last_used_at, created_at')
      .order('created_at', { ascending: true });

    if (error || !data || data.length === 0) {
      return fallbackBins;
    }

    return data.map((row) => ({
      id: row.id,
      name: row.bin_name,
      qrCodeId: row.qr_code_id,
      ward: 'Ward',
      location: {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude)
      },
      status: row.status,
      lastUsedAt: row.last_used_at ?? undefined,
      createdAt: row.created_at
    })) as Bin[];
  }, fallbackBins);

export const logUserLocation = async (
  userId: string,
  location: Coordinates,
  accuracy: number,
  deviceId: string
): Promise<void> => {
  if (!supabase) {
    return;
  }

  await supabase.from('user_location_logs').insert({
    user_id: userId,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy,
    device_id: deviceId,
    created_at: new Date().toISOString()
  });
};

export const validateGeoOnServer = async (payload: GeoValidationPayload): Promise<{
  valid: boolean;
  distanceMeters: number;
}> => {
  const fallbackDistance = distanceMeters(payload.userLocation, payload.binLocation);
  const fallbackValid =
    payload.accuracyMeters <= 10 &&
    payload.locationAgeSeconds <= 30 &&
    fallbackDistance <= payload.allowedRadiusMeters;

  if (!supabase) {
    return {
      valid: fallbackValid,
      distanceMeters: fallbackDistance
    };
  }

  const { data, error } = await supabase.functions.invoke('geo-validate', {
    body: {
      bin_latitude: payload.binLocation.latitude,
      bin_longitude: payload.binLocation.longitude,
      user_latitude: payload.userLocation.latitude,
      user_longitude: payload.userLocation.longitude,
      allowed_radius_meters: payload.allowedRadiusMeters,
      accuracy: payload.accuracyMeters,
      location_age_seconds: payload.locationAgeSeconds
    }
  });

  if (error || !data) {
    return {
      valid: fallbackValid,
      distanceMeters: fallbackDistance
    };
  }

  return {
    valid: Boolean(data.valid),
    distanceMeters: Number(data.distance_meters ?? fallbackDistance)
  };
};

export const reportBinFull = async (
  binId: string,
  reportedBy: string,
  reason: string
): Promise<void> => {
  if (!supabase) {
    return;
  }

  await supabase.from('bin_reports').insert({
    bin_id: binId,
    reported_by: reportedBy,
    reason,
    reported_at: new Date().toISOString()
  });

  await supabase
    .from('bins')
    .update({ status: 'reported_full' })
    .eq('id', binId);
};

export const markBinUsed = async (binId: string): Promise<void> => {
  if (!supabase) {
    return;
  }

  await supabase
    .from('bins')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', binId);
};

export const syncDisposal = async (disposal: DisposalRecord): Promise<void> => {
  if (!supabase) {
    return;
  }

  await supabase.from('disposals').upsert({
    id: disposal.id,
    user_id: disposal.userId,
    bin_id: disposal.binId,
    ai_verified: disposal.aiVerified,
    geo_verified: disposal.geoVerified,
    qr_verified: disposal.qrVerified,
    distance_m: disposal.distanceMeters,
    accuracy_m: disposal.accuracyMeters,
    points_awarded: disposal.pointsAwarded,
    waste_size: disposal.wasteSize,
    image_hash: disposal.imageHash,
    captured_at: disposal.createdAt,
    created_at: disposal.createdAt
  });
};

export const syncWalletEntry = async (entry: WalletEntry, userId: string): Promise<void> => {
  if (!supabase) {
    return;
  }

  await supabase.from('wallet_entries').insert({
    id: entry.id,
    user_id: userId,
    points: entry.points,
    reason: entry.reason,
    source: entry.source,
    created_at: entry.createdAt
  });
};

export const syncRedemption = async (redemption: RedemptionRecord, userId: string): Promise<void> => {
  if (!supabase) {
    return;
  }

  await supabase.from('reward_redemptions').insert({
    id: redemption.id,
    user_id: userId,
    reward_id: redemption.rewardId,
    coupon_code: redemption.couponCode,
    points_used: redemption.pointsUsed,
    status: redemption.status,
    created_at: redemption.createdAt,
    expires_at: redemption.expiresAt
  });
};

export const syncComplaint = async (complaint: Complaint): Promise<void> => {
  if (!supabase) {
    return;
  }

  await supabase.from('complaints').upsert({
    id: complaint.id,
    user_id: complaint.userId,
    category: complaint.category,
    description: complaint.description,
    photo_url: complaint.photoUri,
    image_hash: complaint.imageHash,
    latitude: complaint.location.latitude,
    longitude: complaint.location.longitude,
    status: complaint.status,
    created_at: complaint.createdAt,
    resolved_at: complaint.resolvedAt ?? null
  });
};

export const syncComplaintUpdate = async (
  complaintId: string,
  status: string,
  updatedBy: string,
  remarks: string
): Promise<void> => {
  if (!supabase) {
    return;
  }

  await supabase.from('complaint_updates').insert({
    complaint_id: complaintId,
    status,
    updated_by: updatedBy,
    remarks,
    updated_at: new Date().toISOString()
  });
};

export const syncCleanupProof = async (proof: CleanupProof, complaintId: string): Promise<void> => {
  if (!supabase) {
    return;
  }

  await supabase.from('cleanup_proofs').insert({
    id: proof.id,
    complaint_id: complaintId,
    submitted_by: proof.submittedBy,
    photo_url: proof.photoUri,
    image_hash: proof.imageHash,
    latitude: proof.location.latitude,
    longitude: proof.location.longitude,
    distance_from_complaint_m: proof.distanceFromComplaintMeters,
    created_at: proof.createdAt
  });
};

export const syncFraudAlert = async (alert: FraudAlert, userId: string): Promise<void> => {
  if (!supabase) {
    return;
  }

  await supabase.from('fraud_flags').insert({
    id: alert.id,
    user_id: userId,
    fraud_type: alert.type,
    risk_score: alert.riskScore,
    details: alert.message,
    created_at: alert.createdAt
  });
};

export const suggestNextAvailableBin = (
  bins: Bin[],
  currentBinId: string,
  origin?: Coordinates
): Bin | null => {
  const candidates = bins.filter(
    (item) => item.id !== currentBinId && item.status === 'available'
  );

  if (candidates.length === 0) {
    return null;
  }

  if (!origin) {
    return candidates[0];
  }

  return candidates
    .map((item) => ({
      bin: item,
      distance: distanceMeters(item.location, origin)
    }))
    .sort((left, right) => left.distance - right.distance)[0]?.bin ?? null;
};

export const syncUserProfile = async (profile: UserProfile): Promise<void> => {
  if (!supabase) {
    return;
  }

  await supabase.from('users').upsert(
    {
      id: profile.id,
      phone_number: profile.email,
      name: profile.name,
      ward: profile.ward,
      device_id: profile.deviceId,
      created_at: profile.createdAt
    },
    {
      onConflict: 'id'
    }
  );
};
