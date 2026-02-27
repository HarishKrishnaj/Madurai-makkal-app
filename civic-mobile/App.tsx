import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import {
  DISPOSAL_COOLDOWN_HOURS,
  FIRST_TIME_USER_BONUS_POINTS,
  MADURAI_BINS,
  REGULAR_REWARD_POINTS,
  REWARD_CATALOG
} from './src/data/bins';
import {
  fetchBinsFromBackend,
  logUserLocation,
  markBinUsed,
  reportBinFull,
  suggestNextAvailableBin,
  syncCleanupProof,
  syncComplaint,
  syncComplaintUpdate,
  syncDisposal,
  syncFraudAlert,
  syncRedemption,
  syncUserProfile,
  syncWalletEntry,
  validateGeoOnServer
} from './src/services/backend';
import { buildAnalytics } from './src/services/analytics';
import {
  imageHash,
  validateCleanupConsistency,
  validateDisposalImage
} from './src/services/ai';
import {
  getSessionProfile,
  loginWithEmailPassword,
  LOGIN_CREDENTIALS,
  signOut
} from './src/services/auth';
import {
  fraudRiskScore,
  isDuplicateImage,
  isLocationAnomaly,
  makeFraudAlert
} from './src/services/fraud';
import {
  getHighAccuracyLocation,
  MAX_ALLOWED_ACCURACY_METERS,
  MAX_LOCATION_AGE_SECONDS
} from './src/services/locationEngine';
import { isSupabaseConfigured } from './src/services/supabase';
import { loadState, saveState } from './src/services/storage';
import {
  AppState,
  AuthState,
  Bin,
  CleanupProof,
  Complaint,
  DisposalRecord,
  FraudAlert,
  FraudAlertType,
  IssueCategory,
  LocationSnapshot,
  PendingAction,
  PendingActionType,
  RedemptionRecord,
  Role,
  UserProfile,
  WalletEntry,
  WasteSizeClass
} from './src/types';
import { distanceMeters, formatMeters } from './src/utils/geo';

const nowIso = (): string => new Date().toISOString();

const makeId = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

const ROLE_TABS: Record<Role, string[]> = {
  citizen: ['Dispose', 'Report', 'Wallet', 'Redeem', 'Insights'],
  worker: ['Tasks', 'Insights'],
  admin: ['Monitor', 'Fraud', 'Bins', 'Analytics']
};

const TAB_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  Dispose: 'trash-can-outline',
  Report: 'alert-circle-outline',
  Wallet: 'wallet-outline',
  Redeem: 'ticket-percent-outline',
  Insights: 'chart-box-outline',
  Tasks: 'clipboard-check-outline',
  Monitor: 'shield-check-outline',
  Fraud: 'shield-alert-outline',
  Bins: 'delete-variant',
  Analytics: 'chart-line'
};

const TAB_GUIDANCE: Record<
  string,
  {
    title: string;
    subtitle: string;
    nextStep: string;
  }
> = {
  Dispose: {
    title: 'Verified Disposal Flow',
    subtitle: 'Select bin, confirm QR, capture live image, and lock GPS before submission.',
    nextStep: 'Capture GPS first for faster verification.'
  },
  Report: {
    title: 'Smart Issue Reporting',
    subtitle: 'Capture live issue photo and submit with category + geo-tag in one pass.',
    nextStep: 'Keep issue description short and specific.'
  },
  Wallet: {
    title: 'Green Wallet',
    subtitle: 'Track earned points from verified disposal actions.',
    nextStep: 'Redeem points from Rewards when balance is sufficient.'
  },
  Redeem: {
    title: 'Coupon Redemption',
    subtitle: 'Use points for utility and transport coupon rewards.',
    nextStep: 'Choose rewards with higher value per point.'
  },
  Insights: {
    title: 'Citizen Insights',
    subtitle: 'View impact metrics for disposals, complaints, and city cleanliness.',
    nextStep: 'Switch time filter to compare recent activity.'
  },
  Tasks: {
    title: 'Worker Cleanup Tasks',
    subtitle: 'Upload geo-verified proof from complaint location only.',
    nextStep: 'Capture live photo after cleaning and then submit.'
  },
  Monitor: {
    title: 'Admin Verification',
    subtitle: 'Review cleanup proof and approve only when geo + visual evidence is valid.',
    nextStep: 'Reject proofs that show mismatch or remote submission.'
  },
  Fraud: {
    title: 'Fraud Monitoring',
    subtitle: 'Review AI-flagged misuse patterns and close alerts after verification.',
    nextStep: 'Prioritize high-risk alerts first.'
  },
  Bins: {
    title: 'Bin Registry',
    subtitle: 'Track approved bins, status, QR mapping, and current availability.',
    nextStep: 'Reported-full bins should be redirected quickly.'
  },
  Analytics: {
    title: 'Cleanliness Analytics',
    subtitle: 'Use trends and hotspot data for ward-wise planning decisions.',
    nextStep: 'Check resolution and participation trends together.'
  }
};

const ISSUE_CATEGORIES: IssueCategory[] = [
  'roadside_dumping',
  'overflowing_bin',
  'open_garbage_heap',
  'blocked_drain',
  'public_area_unclean'
];

const WASTE_SIZES: WasteSizeClass[] = ['large', 'medium', 'small', 'home_daily'];

const DEMO_PROFILE: UserProfile = {
  id: 'demo-user-001',
  email: 'citizen@maduraimakkal.app',
  role: 'citizen',
  name: 'Demo Citizen',
  ward: 'Ward 12',
  deviceId: 'demo-device',
  createdAt: nowIso()
};

const DEFAULT_AUTH_STATE: AuthState = {
  stage: 'login',
  isLoading: false,
  email: '',
  password: '',
  user: undefined
};

const DEFAULT_STATE: AppState = {
  isOnline: true,
  bins: MADURAI_BINS,
  disposals: [],
  complaints: [],
  wallet: {
    points: 0,
    history: []
  },
  redemptions: [],
  fraudAlerts: [],
  pendingActions: [],
  usedImageHashes: [],
  lastActionByUser: {},
  syncLog: []
};

const FRAUD_SEVERITY: Record<FraudAlertType, FraudAlert['severity']> = {
  duplicate_image: 'high',
  location_anomaly: 'high',
  before_after_mismatch: 'high',
  qr_mismatch: 'medium',
  geo_fence_failure: 'high',
  mock_location_detected: 'high',
  cooldown_violation: 'medium',
  location_accuracy_failure: 'medium',
  timestamp_invalid: 'medium'
};

const addLog = (state: AppState, message: string): AppState => ({
  ...state,
  syncLog: [`${new Date().toLocaleTimeString()} - ${message}`, ...state.syncLog].slice(0, 40)
});

const createCouponCode = (): string => {
  const segA = Math.random().toString(36).slice(2, 6).toUpperCase();
  const segB = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CLEANMADURAI-${segA}-${segB}`;
};

const formatCategory = (value: IssueCategory): string =>
  value
    .split('_')
    .map((chunk) => `${chunk.slice(0, 1).toUpperCase()}${chunk.slice(1)}`)
    .join(' ');

const captureLivePhoto = async (): Promise<string | null> => {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Permission needed', 'Camera access is required for live capture.');
    return null;
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.6,
    allowsEditing: false
  });

  if (result.canceled) {
    return null;
  }

  return result.assets[0]?.uri ?? null;
};

const toUserSnapshot = (snapshot: LocationSnapshot) => ({
  location: snapshot.location,
  accuracyMeters: snapshot.accuracyMeters,
  timestamp: snapshot.timestamp
});

const App = (): JSX.Element => {
  const [authState, setAuthState] = useState<AuthState>(DEFAULT_AUTH_STATE);
  const [appState, setAppState] = useState<AppState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  const [role, setRole] = useState<Role>('citizen');
  const [activeTabByRole, setActiveTabByRole] = useState<Record<Role, string>>({
    citizen: 'Dispose',
    worker: 'Tasks',
    admin: 'Monitor'
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [selectedBinId, setSelectedBinId] = useState(MADURAI_BINS[0].id);
  const [scanQrCode, setScanQrCode] = useState('');
  const [disposalPhotoUri, setDisposalPhotoUri] = useState('');
  const [disposalLocation, setDisposalLocation] = useState<LocationSnapshot | null>(null);
  const [wasteSize, setWasteSize] = useState<WasteSizeClass>('medium');

  const [issueCategory, setIssueCategory] = useState<IssueCategory>('roadside_dumping');
  const [issueDescription, setIssueDescription] = useState('');
  const [issuePhotoUri, setIssuePhotoUri] = useState('');
  const [issueLocation, setIssueLocation] = useState<LocationSnapshot | null>(null);

  const [cleanupComplaintId, setCleanupComplaintId] = useState('');
  const [cleanupPhotoUri, setCleanupPhotoUri] = useState('');
  const [cleanupLocation, setCleanupLocation] = useState<LocationSnapshot | null>(null);

  const [lastGpsStatus, setLastGpsStatus] = useState<LocationSnapshot | null>(null);

  const [timeFilter, setTimeFilter] = useState<'today' | 'last_7_days' | 'last_30_days'>('last_7_days');

  const deviceId = useMemo(
    () => `${Platform.OS}-${String(Platform.Version)}-${Math.random().toString(36).slice(2, 8)}`,
    []
  );

  useEffect(() => {
    const hydrate = async (): Promise<void> => {
      const stored = await loadState();
      if (stored) {
        setAppState(stored);
      }

      const session = await getSessionProfile();
      if (session.profile) {
        setAuthState({
          stage: 'authenticated',
          isLoading: false,
          email: session.profile.email,
          password: '',
          user: session.profile,
          sessionToken: session.session?.access_token
        });
        setRole(session.profile.role);
      }

      setHydrated(true);
    };

    void hydrate();
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    void saveState(appState);
  }, [appState, hydrated]);

  useEffect(() => {
    if (authState.stage !== 'authenticated') {
      return;
    }

    const loadBins = async (): Promise<void> => {
      const bins = await fetchBinsFromBackend(MADURAI_BINS);
      setAppState((previous) => ({
        ...previous,
        bins
      }));
      if (bins.length > 0) {
        setSelectedBinId((current) => (bins.some((item) => item.id === current) ? current : bins[0].id));
      }
    };

    void loadBins();
  }, [authState.stage]);

  const userId = authState.user?.id ?? DEMO_PROFILE.id;
  const activeTab = activeTabByRole[role];
  const activeGuide = TAB_GUIDANCE[activeTab];

  const selectedBin =
    appState.bins.find((item) => item.id === selectedBinId) ?? appState.bins[0] ?? MADURAI_BINS[0];

  const openComplaints = useMemo(
    () => appState.complaints.filter((item) => item.status !== 'resolved'),
    [appState.complaints]
  );

  const reviewComplaints = useMemo(
    () => appState.complaints.filter((item) => item.status === 'in_progress' && item.cleanupProof),
    [appState.complaints]
  );

  useEffect(() => {
    if (!cleanupComplaintId && openComplaints[0]) {
      setCleanupComplaintId(openComplaints[0].id);
    }
  }, [openComplaints, cleanupComplaintId]);

  const analytics = useMemo(
    () =>
      buildAnalytics(
        appState.disposals,
        appState.complaints,
        appState.bins,
        appState.wallet.history,
        appState.redemptions
      ),
    [appState.disposals, appState.complaints, appState.bins, appState.wallet.history, appState.redemptions]
  );

  const appendFraudAlerts = useCallback(
    (state: AppState, actionId: string, types: FraudAlertType[], messages: Record<FraudAlertType, string>) => {
      if (types.length === 0) {
        return state;
      }

      const score = fraudRiskScore(types);
      const alerts = types.map((type) =>
        makeFraudAlert(type, actionId, messages[type], FRAUD_SEVERITY[type], nowIso(), score)
      );

      return {
        ...state,
        fraudAlerts: [...alerts, ...state.fraudAlerts]
      };
    },
    []
  );

  const syncActionToBackend = useCallback(
    async (action: PendingAction, nextState: AppState): Promise<void> => {
      if (!authState.user) {
        return;
      }

      if (action.type === 'dispose') {
        const disposal = nextState.disposals.find((item) => item.id === action.id);
        if (!disposal) {
          return;
        }

        await syncDisposal(disposal);
        await markBinUsed(disposal.binId);

        const relatedWalletEntries = nextState.wallet.history.filter(
          (item) => item.referenceId === action.id
        );
        for (const item of relatedWalletEntries) {
          await syncWalletEntry(item, authState.user.id);
        }

        await logUserLocation(
          authState.user.id,
          disposal.location,
          disposal.accuracyMeters,
          authState.user.deviceId
        );

        const bin = nextState.bins.find((item) => item.id === disposal.binId);
        if (bin) {
          const serverResult = await validateGeoOnServer({
            binLocation: bin.location,
            userLocation: disposal.location,
            allowedRadiusMeters: 5,
            accuracyMeters: disposal.accuracyMeters,
            locationAgeSeconds: 0
          });

          if (!serverResult.valid) {
            setAppState((previous) =>
              addLog(
                {
                  ...previous,
                  fraudAlerts: [
                    makeFraudAlert(
                      'geo_fence_failure',
                      action.id,
                      'Server-side geovalidation failed.',
                      'high',
                      nowIso(),
                      70
                    ),
                    ...previous.fraudAlerts
                  ]
                },
                'Server-side geovalidation flagged this disposal.'
              )
            );
          }
        }
      }

      if (action.type === 'report_issue') {
        const complaint = nextState.complaints.find((item) => item.id === action.id);
        if (!complaint) {
          return;
        }

        await syncComplaint(complaint);
        await logUserLocation(
          authState.user.id,
          complaint.location,
          (action.payload as { location: LocationSnapshot }).location.accuracyMeters,
          authState.user.deviceId
        );
      }

      if (action.type === 'submit_cleanup') {
        const complaint = nextState.complaints.find(
          (item) => item.cleanupProof?.id === action.id
        );
        if (!complaint || !complaint.cleanupProof) {
          return;
        }

        await syncCleanupProof(complaint.cleanupProof, complaint.id);
        await syncComplaint(complaint);
        await syncComplaintUpdate(
          complaint.id,
          complaint.status,
          authState.user.id,
          'Cleanup proof submitted'
        );
      }

      if (action.type === 'verify_cleanup') {
        const payload = action.payload as {
          complaintId: string;
          accepted: boolean;
        };

        const complaint = nextState.complaints.find((item) => item.id === payload.complaintId);
        if (!complaint) {
          return;
        }

        await syncComplaint(complaint);
        await syncComplaintUpdate(
          complaint.id,
          complaint.status,
          authState.user.id,
          payload.accepted ? 'Resolved by admin verification' : 'Rejected and reopened'
        );
      }

      if (action.type === 'redeem_reward') {
        const redemption = nextState.redemptions.find((item) => item.id === action.id);
        if (!redemption) {
          return;
        }

        await syncRedemption(redemption, authState.user.id);

        const relatedWalletEntries = nextState.wallet.history.filter(
          (item) => item.referenceId === action.id
        );
        for (const item of relatedWalletEntries) {
          await syncWalletEntry(item, authState.user.id);
        }
      }

      if (action.type === 'report_bin_full') {
        const payload = action.payload as { binId: string; reason: string };
        await reportBinFull(payload.binId, authState.user.id, payload.reason);
      }

      const latestFraud = nextState.fraudAlerts.slice(0, 8);
      for (const alert of latestFraud) {
        await syncFraudAlert(alert, authState.user.id);
      }
    },
    [authState.user]
  );

  const applyAction = useCallback(
    (state: AppState, action: PendingAction): AppState => {
      if (action.type === 'dispose') {
        const payload = action.payload as {
          binId: string;
          qrCodeId: string;
          photoUri: string;
          wasteSize: WasteSizeClass;
          location: LocationSnapshot;
          userId: string;
          createdAt: string;
        };

        const bin = state.bins.find((item) => item.id === payload.binId);
        if (!bin) {
          return addLog(state, `Disposal ${action.id} failed: selected bin not found.`);
        }

        const distance = distanceMeters(payload.location.location, bin.location);
        const qrVerified = payload.qrCodeId.trim() === bin.qrCodeId;

        const locationAgeTooOld = payload.location.ageSeconds > MAX_LOCATION_AGE_SECONDS;
        const lowAccuracy = payload.location.accuracyMeters > MAX_ALLOWED_ACCURACY_METERS;

        const geoVerified =
          distance <= 5 &&
          !locationAgeTooOld &&
          !lowAccuracy &&
          !payload.location.isMocked;

        const aiResult = validateDisposalImage(payload.photoUri, payload.qrCodeId);
        const aiVerified =
          aiResult.qualityPassed && aiResult.binDetected && aiResult.wasteDetected;

        const imgHash = imageHash(payload.photoUri);
        const duplicate = isDuplicateImage(state.usedImageHashes, imgHash);
        const locationAnomaly = isLocationAnomaly(
          state.lastActionByUser[payload.userId],
          payload.location.location,
          payload.createdAt
        );

        const cooldownCutoff = Date.now() - DISPOSAL_COOLDOWN_HOURS * 60 * 60 * 1000;
        const cooldownViolation = state.disposals.some(
          (item) =>
            item.userId === payload.userId &&
            item.binId === payload.binId &&
            new Date(item.createdAt).getTime() > cooldownCutoff
        );

        const fraudFlags: FraudAlertType[] = [];
        const messages: Record<FraudAlertType, string> = {
          duplicate_image: 'Duplicate image detected.',
          location_anomaly: 'Frequent location jump detected.',
          before_after_mismatch: 'Before/after mismatch detected.',
          qr_mismatch: 'QR does not match selected bin.',
          geo_fence_failure: 'Geo-fence validation failed.',
          mock_location_detected: 'Fake GPS detected. Action blocked.',
          cooldown_violation: 'Bin cooldown policy violated.',
          location_accuracy_failure: 'GPS accuracy above allowed threshold.',
          timestamp_invalid: 'Location timestamp is too old.'
        };

        if (!qrVerified) fraudFlags.push('qr_mismatch');
        if (!geoVerified) fraudFlags.push('geo_fence_failure');
        if (payload.location.isMocked) fraudFlags.push('mock_location_detected');
        if (duplicate) fraudFlags.push('duplicate_image');
        if (locationAnomaly) fraudFlags.push('location_anomaly');
        if (cooldownViolation) fraudFlags.push('cooldown_violation');
        if (lowAccuracy) fraudFlags.push('location_accuracy_failure');
        if (locationAgeTooOld) fraudFlags.push('timestamp_invalid');

        const verified =
          bin.status === 'available' &&
          qrVerified &&
          geoVerified &&
          aiVerified &&
          fraudFlags.length === 0;

        const isFirstSuccessful = state.disposals.every(
          (item) => !(item.userId === payload.userId && item.verified)
        );

        const basePoints = verified ? REGULAR_REWARD_POINTS[payload.wasteSize] : 0;
        const bonusPoints = verified && isFirstSuccessful ? FIRST_TIME_USER_BONUS_POINTS : 0;
        const pointsAwarded = basePoints + bonusPoints;

        const disposal: DisposalRecord = {
          id: action.id,
          userId: payload.userId,
          binId: payload.binId,
          qrCodeId: payload.qrCodeId,
          photoUri: payload.photoUri,
          imageHash: imgHash,
          location: payload.location.location,
          accuracyMeters: payload.location.accuracyMeters,
          createdAt: payload.createdAt,
          distanceMeters: distance,
          geoVerified,
          qrVerified,
          aiVerified,
          wasteSize: payload.wasteSize,
          fraudFlags,
          verified,
          pointsAwarded,
          rejectionReason: verified ? undefined : aiResult.failureReason ?? 'Validation failed'
        };

        let next: AppState = {
          ...state,
          disposals: [disposal, ...state.disposals],
          usedImageHashes: duplicate ? state.usedImageHashes : [imgHash, ...state.usedImageHashes],
          lastActionByUser: {
            ...state.lastActionByUser,
            [payload.userId]: toUserSnapshot(payload.location)
          },
          bins: state.bins.map((item) =>
            item.id === payload.binId && verified
              ? { ...item, lastUsedAt: payload.createdAt }
              : item
          )
        };

        if (pointsAwarded > 0) {
          const entries: WalletEntry[] = [
            {
              id: makeId('wallet'),
              type: 'earn',
              points: basePoints,
              reason: `AI verified ${payload.wasteSize} waste disposal`,
              source: 'ai_disposal_verified',
              referenceId: action.id,
              createdAt: payload.createdAt
            }
          ];

          if (bonusPoints > 0) {
            entries.push({
              id: makeId('wallet'),
              type: 'earn',
              points: bonusPoints,
              reason: 'First successful disposal bonus',
              source: 'first_time_bonus',
              referenceId: action.id,
              createdAt: payload.createdAt
            });
          }

          next = {
            ...next,
            wallet: {
              points: next.wallet.points + pointsAwarded,
              history: [...entries, ...next.wallet.history]
            }
          };
        }

        next = appendFraudAlerts(next, action.id, fraudFlags, messages);

        return addLog(
          next,
          verified
            ? `Disposal ${action.id} verified. ${pointsAwarded} points credited.`
            : `Disposal ${action.id} rejected. ${disposal.rejectionReason ?? 'Validation failed.'}`
        );
      }

      if (action.type === 'report_issue') {
        const payload = action.payload as {
          category: IssueCategory;
          description: string;
          photoUri: string;
          location: LocationSnapshot;
          userId: string;
          createdAt: string;
        };

        const imgHash = imageHash(payload.photoUri);
        const duplicate = isDuplicateImage(state.usedImageHashes, imgHash);
        const anomaly = isLocationAnomaly(
          state.lastActionByUser[payload.userId],
          payload.location.location,
          payload.createdAt
        );

        const fraudFlags: FraudAlertType[] = [];
        const messages: Record<FraudAlertType, string> = {
          duplicate_image: 'Complaint image is reused.',
          location_anomaly: 'Complaint submitted from suspicious movement pattern.',
          before_after_mismatch: 'Before/after mismatch detected.',
          qr_mismatch: 'QR mismatch detected.',
          geo_fence_failure: 'Geo-fence failure detected.',
          mock_location_detected: 'Fake GPS detected in complaint report.',
          cooldown_violation: 'Action frequency exceeded.',
          location_accuracy_failure: 'Low GPS accuracy in complaint report.',
          timestamp_invalid: 'Complaint location timestamp is stale.'
        };

        if (duplicate) fraudFlags.push('duplicate_image');
        if (anomaly) fraudFlags.push('location_anomaly');
        if (payload.location.isMocked) fraudFlags.push('mock_location_detected');
        if (payload.location.accuracyMeters > MAX_ALLOWED_ACCURACY_METERS)
          fraudFlags.push('location_accuracy_failure');
        if (payload.location.ageSeconds > MAX_LOCATION_AGE_SECONDS)
          fraudFlags.push('timestamp_invalid');

        const complaint: Complaint = {
          id: action.id,
          userId: payload.userId,
          category: payload.category,
          description: payload.description,
          photoUri: payload.photoUri,
          imageHash: imgHash,
          location: payload.location.location,
          createdAt: payload.createdAt,
          status: 'open',
          reportFraudFlags: fraudFlags
        };

        let next: AppState = {
          ...state,
          complaints: [complaint, ...state.complaints],
          usedImageHashes: duplicate ? state.usedImageHashes : [imgHash, ...state.usedImageHashes],
          lastActionByUser: {
            ...state.lastActionByUser,
            [payload.userId]: toUserSnapshot(payload.location)
          }
        };

        next = appendFraudAlerts(next, action.id, fraudFlags, messages);
        return addLog(next, `Complaint ${action.id} submitted with geo-tag evidence.`);
      }

      if (action.type === 'report_bin_full') {
        const payload = action.payload as {
          binId: string;
        };

        const next: AppState = {
          ...state,
          bins: state.bins.map((item) =>
            item.id === payload.binId
              ? {
                  ...item,
                  status: 'reported_full'
                }
              : item
          )
        };

        return addLog(next, `Bin ${payload.binId} marked as reported full.`);
      }

      if (action.type === 'submit_cleanup') {
        const payload = action.payload as {
          complaintId: string;
          photoUri: string;
          location: LocationSnapshot;
          userId: string;
          createdAt: string;
        };

        const complaintIndex = state.complaints.findIndex((item) => item.id === payload.complaintId);
        if (complaintIndex < 0) {
          return addLog(state, `Cleanup ${action.id} failed. Complaint not found.`);
        }

        const complaint = state.complaints[complaintIndex];

        const distance = distanceMeters(payload.location.location, complaint.location);
        const geoOk =
          distance <= 10 &&
          payload.location.accuracyMeters <= MAX_ALLOWED_ACCURACY_METERS &&
          payload.location.ageSeconds <= MAX_LOCATION_AGE_SECONDS &&
          !payload.location.isMocked;

        const imgHash = imageHash(payload.photoUri);
        const duplicate = isDuplicateImage(state.usedImageHashes, imgHash);
        const beforeAfterMismatch = !validateCleanupConsistency(complaint.photoUri, payload.photoUri);

        const fraudFlags: FraudAlertType[] = [];
        const messages: Record<FraudAlertType, string> = {
          duplicate_image: 'Cleanup image is reused.',
          location_anomaly: 'Cleanup location anomaly detected.',
          before_after_mismatch: 'Cleanup proof appears identical to complaint image.',
          qr_mismatch: 'QR mismatch detected.',
          geo_fence_failure: 'Cleanup proof submitted outside complaint perimeter.',
          mock_location_detected: 'Fake GPS detected in cleanup proof.',
          cooldown_violation: 'Action frequency exceeded.',
          location_accuracy_failure: 'Low GPS accuracy in cleanup proof.',
          timestamp_invalid: 'Cleanup location timestamp is stale.'
        };

        if (!geoOk) fraudFlags.push('geo_fence_failure');
        if (duplicate) fraudFlags.push('duplicate_image');
        if (beforeAfterMismatch) fraudFlags.push('before_after_mismatch');
        if (payload.location.isMocked) fraudFlags.push('mock_location_detected');
        if (payload.location.accuracyMeters > MAX_ALLOWED_ACCURACY_METERS)
          fraudFlags.push('location_accuracy_failure');
        if (payload.location.ageSeconds > MAX_LOCATION_AGE_SECONDS)
          fraudFlags.push('timestamp_invalid');

        const proof: CleanupProof = {
          id: action.id,
          submittedBy: payload.userId,
          photoUri: payload.photoUri,
          imageHash: imgHash,
          location: payload.location.location,
          accuracyMeters: payload.location.accuracyMeters,
          createdAt: payload.createdAt,
          watermark: `${payload.createdAt} @ ${payload.location.location.latitude.toFixed(5)}, ${payload.location.location.longitude.toFixed(5)} | complaint:${payload.complaintId}`,
          distanceFromComplaintMeters: distance,
          aiCleanVerified: !beforeAfterMismatch,
          fraudFlags
        };

        const updated = [...state.complaints];
        updated[complaintIndex] = {
          ...complaint,
          status: geoOk ? 'in_progress' : complaint.status,
          cleanupProof: proof
        };

        let next: AppState = {
          ...state,
          complaints: updated,
          usedImageHashes: duplicate ? state.usedImageHashes : [imgHash, ...state.usedImageHashes],
          lastActionByUser: {
            ...state.lastActionByUser,
            [payload.userId]: toUserSnapshot(payload.location)
          }
        };

        next = appendFraudAlerts(next, action.id, fraudFlags, messages);

        return addLog(
          next,
          geoOk
            ? `Cleanup proof submitted for ${payload.complaintId}.`
            : `Cleanup proof rejected for ${payload.complaintId}.`
        );
      }

      if (action.type === 'verify_cleanup') {
        const payload = action.payload as {
          complaintId: string;
          accepted: boolean;
          notes?: string;
          verifiedBy: string;
          createdAt: string;
        };

        const complaintIndex = state.complaints.findIndex((item) => item.id === payload.complaintId);
        if (complaintIndex < 0) {
          return addLog(state, `Verification ${action.id} failed. Complaint not found.`);
        }

        const complaint = state.complaints[complaintIndex];
        const nextComplaints = [...state.complaints];
        nextComplaints[complaintIndex] = {
          ...complaint,
          status: payload.accepted ? 'resolved' : 'open',
          resolvedAt: payload.accepted ? payload.createdAt : undefined,
          verification: {
            accepted: payload.accepted,
            notes: payload.notes,
            verifiedBy: payload.verifiedBy,
            verifiedAt: payload.createdAt
          }
        };

        return addLog(
          {
            ...state,
            complaints: nextComplaints
          },
          payload.accepted
            ? `Complaint ${payload.complaintId} resolved.`
            : `Complaint ${payload.complaintId} reopened.`
        );
      }

      if (action.type === 'redeem_reward') {
        const payload = action.payload as {
          rewardId: string;
          rewardTitle: string;
          pointsRequired: number;
          createdAt: string;
        };

        if (state.wallet.points < payload.pointsRequired) {
          return addLog(state, 'Redemption blocked: insufficient points.');
        }

        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
        const redemption: RedemptionRecord = {
          id: action.id,
          rewardId: payload.rewardId,
          rewardTitle: payload.rewardTitle,
          couponCode: createCouponCode(),
          pointsUsed: payload.pointsRequired,
          status: 'active',
          createdAt: payload.createdAt,
          expiresAt
        };

        const walletEntry: WalletEntry = {
          id: makeId('wallet'),
          type: 'redeem',
          points: payload.pointsRequired,
          reason: `Redeemed ${payload.rewardTitle}`,
          source: 'coupon_redemption',
          referenceId: action.id,
          createdAt: payload.createdAt
        };

        return addLog(
          {
            ...state,
            redemptions: [redemption, ...state.redemptions],
            wallet: {
              points: state.wallet.points - payload.pointsRequired,
              history: [walletEntry, ...state.wallet.history]
            }
          },
          `Redeemed ${payload.rewardTitle}. Coupon generated.`
        );
      }

      return state;
    },
    [appendFraudAlerts]
  );

  const runAction = useCallback(
    (action: PendingAction, fromQueue: boolean): void => {
      if (!fromQueue && !appState.isOnline) {
        setAppState((previous) =>
          addLog(
            {
              ...previous,
              pendingActions: [...previous.pendingActions, action]
            },
            `Queued ${action.type} for offline sync.`
          )
        );
        return;
      }

      let nextStateSnapshot: AppState | null = null;

      setAppState((previous) => {
        const next = applyAction(previous, action);
        nextStateSnapshot = next;
        return next;
      });

      if (nextStateSnapshot && appState.isOnline) {
        void syncActionToBackend(action, nextStateSnapshot);
      }
    },
    [appState.isOnline, applyAction, syncActionToBackend]
  );

  const syncPending = useCallback(() => {
    if (!appState.isOnline || appState.pendingActions.length === 0) {
      return;
    }

    const queued = appState.pendingActions;

    setAppState((previous) => ({
      ...previous,
      pendingActions: []
    }));

    queued.forEach((item) => runAction(item, true));
  }, [appState.isOnline, appState.pendingActions, runAction]);

  useEffect(() => {
    if (appState.isOnline && appState.pendingActions.length > 0) {
      syncPending();
    }
  }, [appState.isOnline, appState.pendingActions.length, syncPending]);

  const captureGps = async (
    setter: (snapshot: LocationSnapshot | null) => void
  ): Promise<void> => {
    const result = await getHighAccuracyLocation();
    if (result.snapshot) {
      setter(result.snapshot);
      setLastGpsStatus(result.snapshot);

      if (authState.user) {
        void logUserLocation(
          authState.user.id,
          result.snapshot.location,
          result.snapshot.accuracyMeters,
          authState.user.deviceId
        );
      }
    }

    if (result.error) {
      Alert.alert('Location', result.error);
    }
  };

  const submitDisposal = (): void => {
    if (!selectedBin) {
      Alert.alert('Bin required', 'Choose a registered bin.');
      return;
    }

    if (!scanQrCode.trim()) {
      Alert.alert('QR required', 'Scan or enter the bin QR code.');
      return;
    }

    if (!disposalPhotoUri) {
      Alert.alert('Live capture required', 'Capture a live disposal photo.');
      return;
    }

    if (!disposalLocation) {
      Alert.alert('Location required', 'Capture GPS before submitting.');
      return;
    }

    const action: PendingAction = {
      id: makeId('dispose'),
      type: 'dispose',
      createdAt: nowIso(),
      payload: {
        binId: selectedBin.id,
        qrCodeId: scanQrCode.trim(),
        photoUri: disposalPhotoUri,
        wasteSize,
        location: disposalLocation,
        userId,
        createdAt: nowIso()
      }
    };

    runAction(action, false);
    setDisposalPhotoUri('');
    setScanQrCode('');
  };

  const submitComplaint = (): void => {
    if (!issueDescription.trim()) {
      Alert.alert('Description required', 'Describe the issue before submitting.');
      return;
    }

    if (!issuePhotoUri) {
      Alert.alert('Live capture required', 'Capture issue photo using live camera.');
      return;
    }

    if (!issueLocation) {
      Alert.alert('Location required', 'Capture GPS before reporting.');
      return;
    }

    const action: PendingAction = {
      id: makeId('complaint'),
      type: 'report_issue',
      createdAt: nowIso(),
      payload: {
        category: issueCategory,
        description: issueDescription.trim(),
        photoUri: issuePhotoUri,
        location: issueLocation,
        userId,
        createdAt: nowIso()
      }
    };

    runAction(action, false);
    setIssueDescription('');
    setIssuePhotoUri('');
  };

  const submitCleanup = (): void => {
    if (!cleanupComplaintId) {
      Alert.alert('Complaint required', 'Select complaint first.');
      return;
    }

    if (!cleanupPhotoUri) {
      Alert.alert('Live capture required', 'Capture cleanup proof image.');
      return;
    }

    if (!cleanupLocation) {
      Alert.alert('Location required', 'Capture worker GPS before upload.');
      return;
    }

    const action: PendingAction = {
      id: makeId('cleanup'),
      type: 'submit_cleanup',
      createdAt: nowIso(),
      payload: {
        complaintId: cleanupComplaintId,
        photoUri: cleanupPhotoUri,
        location: cleanupLocation,
        userId,
        createdAt: nowIso()
      }
    };

    runAction(action, false);
    setCleanupPhotoUri('');
  };

  const verifyComplaint = (complaintId: string, accepted: boolean): void => {
    const action: PendingAction = {
      id: makeId('verify'),
      type: 'verify_cleanup',
      createdAt: nowIso(),
      payload: {
        complaintId,
        accepted,
        notes: accepted ? 'Geo proof + after image accepted.' : 'Insufficient proof. Rework required.',
        verifiedBy: userId,
        createdAt: nowIso()
      }
    };

    runAction(action, false);
  };

  const redeemReward = (rewardId: string, rewardTitle: string, pointsRequired: number): void => {
    const action: PendingAction = {
      id: makeId('redeem'),
      type: 'redeem_reward',
      createdAt: nowIso(),
      payload: {
        rewardId,
        rewardTitle,
        pointsRequired,
        createdAt: nowIso()
      }
    };

    runAction(action, false);
  };

  const flagBinFull = (binId: string): void => {
    const action: PendingAction = {
      id: makeId('binfull'),
      type: 'report_bin_full',
      createdAt: nowIso(),
      payload: {
        binId,
        reason: 'User reported full bin from disposal flow.'
      }
    };

    runAction(action, false);

    const currentBin = appState.bins.find((item) => item.id === binId);
    if (!currentBin) {
      return;
    }

    const next = suggestNextAvailableBin(appState.bins, binId, currentBin.location);
    if (next) {
      setSelectedBinId(next.id);
      Alert.alert('Bin full reported', `Redirected to next available bin: ${next.name}`);
    } else {
      Alert.alert('Bin full reported', 'No alternative bin is currently available.');
    }
  };

  const markFraudReviewed = (alertId: string): void => {
    setAppState((previous) => ({
      ...previous,
      fraudAlerts: previous.fraudAlerts.map((item) =>
        item.id === alertId ? { ...item, status: 'reviewed' } : item
      )
    }));
  };

  const onLogin = async (): Promise<void> => {
    setAuthState((previous) => ({ ...previous, isLoading: true, error: undefined }));

    const result = await loginWithEmailPassword(authState.email, authState.password, deviceId);
    if (!result.ok || !result.profile) {
      setAuthState((previous) => ({
        ...previous,
        isLoading: false,
        error: result.error ?? 'Login failed.'
      }));
      return;
    }

    setRole(result.profile.role);
    setAuthState({
      stage: 'authenticated',
      isLoading: false,
      email: result.profile.email,
      password: '',
      user: result.profile,
      sessionToken: result.sessionToken
    });

    void syncUserProfile(result.profile);
  };

  const onSignOut = async (): Promise<void> => {
    await signOut();
    setAuthState(DEFAULT_AUTH_STATE);
    setAppState(DEFAULT_STATE);
    setRole('citizen');
  };

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#0A3A2F" />
        <Text style={styles.loadingText}>Loading civic platform...</Text>
      </SafeAreaView>
    );
  }

  if (authState.stage !== 'authenticated') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.authContainer}>
          <View style={styles.authCard}>
            <Text style={styles.authTitle}>Madurai Makkal Connect</Text>
            <Text style={styles.authSubtitle}>
              Sign in with email/password. Role is assigned by credentials.
            </Text>

            <Text style={styles.label}>Email</Text>
            <TextInput
              value={authState.email}
              onChangeText={(value) =>
                setAuthState((previous) => ({ ...previous, email: value }))
              }
              placeholder="email@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              placeholderTextColor="#6b7280"
              style={styles.input}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              value={authState.password}
              onChangeText={(value) =>
                setAuthState((previous) => ({ ...previous, password: value }))
              }
              placeholder="Enter password"
              secureTextEntry
              placeholderTextColor="#6b7280"
              style={styles.input}
            />

            {authState.error ? <Text style={styles.errorText}>{authState.error}</Text> : null}

            {!isSupabaseConfigured ? (
              <Text style={styles.helperText}>
                Supabase auth unavailable. Demo credentials still work.
              </Text>
            ) : null}

            <Text style={styles.sectionSubtitle}>Demo Credentials</Text>
            {LOGIN_CREDENTIALS.map((item) => (
              <Pressable
                key={item.email}
                onPress={() =>
                  setAuthState((previous) => ({
                    ...previous,
                    email: item.email,
                    password: item.password
                  }))
                }
                style={styles.credentialCard}
              >
                <Text style={styles.credentialRole}>{item.role.toUpperCase()}</Text>
                <Text style={styles.credentialEmail}>{item.email}</Text>
              </Pressable>
            ))}

            <Pressable
              onPress={onLogin}
              style={styles.primaryButton}
              disabled={authState.isLoading}
            >
              {authState.isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Login</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <Pressable onPress={() => setDrawerOpen(true)} style={styles.iconButton}>
              <MaterialCommunityIcons name="menu" size={24} color="#F3FAF6" />
            </Pressable>
            <Text style={styles.headerTitle}>Madurai Makkal Connect</Text>
            <Pressable onPress={onSignOut} style={styles.iconButton}>
              <MaterialCommunityIcons name="logout" size={22} color="#F3FAF6" />
            </Pressable>
          </View>
          <Text style={styles.headerSubtitle}>
            AI + geo verified disposal, rewards, complaint accountability, and live analytics.
          </Text>

          <View style={styles.identityBlock}>
            <Text style={styles.headerIdentityText}>{authState.user?.name}</Text>
            <Text style={styles.headerIdentityMeta}>{authState.user?.email}</Text>
            <View style={styles.chipRow}>
              <View style={styles.headerChip}>
                <Text style={styles.headerChipText}>{authState.user?.role.toUpperCase()}</Text>
              </View>
              <View style={styles.headerChip}>
                <Text style={styles.headerChipText}>{authState.user?.ward}</Text>
              </View>
              <View style={styles.headerChip}>
                <Text style={styles.headerChipText}>TAB: {activeTab}</Text>
              </View>
            </View>
          </View>

          <View style={styles.networkRow}>
            <View>
              <Text style={styles.label}>Network</Text>
              <Text style={styles.value}>{appState.isOnline ? 'Online' : 'Offline queue active'}</Text>
            </View>
            <Switch
              value={appState.isOnline}
              onValueChange={(value: boolean) => {
                setAppState((previous) =>
                  addLog(
                    {
                      ...previous,
                      isOnline: value
                    },
                    value ? 'Switched to online mode.' : 'Switched to offline mode.'
                  )
                );
              }}
            />
          </View>

          <View style={styles.statsRow}>
            <InfoPill label="Wallet" value={`${appState.wallet.points} pts`} />
            <InfoPill label="Queued" value={String(appState.pendingActions.length)} />
            <InfoPill
              label="Open Flags"
              value={String(appState.fraudAlerts.filter((item) => item.status === 'open').length)}
            />
          </View>

          <Pressable
            onPress={syncPending}
            style={[styles.primaryButton, !appState.isOnline ? styles.disabledButton : null]}
            disabled={!appState.isOnline}
          >
            <Text style={styles.primaryButtonText}>Sync Pending Actions</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{activeGuide.title}</Text>
          <Text style={styles.helperText}>{activeGuide.subtitle}</Text>
          <View style={styles.callout}>
            <MaterialCommunityIcons name="lightbulb-on-outline" size={16} color="#0E6B54" />
            <Text style={styles.calloutText}>{activeGuide.nextStep}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Location & Geo-Permission Engine</Text>
          <Text style={styles.helperText}>
            Required permissions: ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION
          </Text>
          <View style={styles.statsRow}>
            <InfoPill
              label="Accuracy Target"
              value={`<= ${MAX_ALLOWED_ACCURACY_METERS}m`}
            />
            <InfoPill label="Max Age" value={`${MAX_LOCATION_AGE_SECONDS}s`} />
            <InfoPill
              label="Strength"
              value={lastGpsStatus ? lastGpsStatus.strength.toUpperCase() : 'NONE'}
            />
          </View>
          {lastGpsStatus ? (
            <Text style={styles.mono}>
              Last GPS: {lastGpsStatus.location.latitude.toFixed(5)},{' '}
              {lastGpsStatus.location.longitude.toFixed(5)} | ±{Math.round(lastGpsStatus.accuracyMeters)}m
            </Text>
          ) : (
            <Text style={styles.mono}>No GPS snapshot captured yet.</Text>
          )}
          <Pressable onPress={() => captureGps(setLastGpsStatus)} style={styles.ghostButton}>
            <Text style={styles.ghostButtonText}>Refresh Live GPS</Text>
          </Pressable>
        </View>

        <View style={styles.helperBanner}>
          <MaterialCommunityIcons name="gesture-tap-button" size={16} color="#245E50" />
          <Text style={styles.helperBannerText}>
            Use left drawer for all tabs and bottom icons for quick actions.
          </Text>
        </View>

        {role === 'citizen' && activeTab === 'Dispose' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Scan-to-Earn Waste Disposal</Text>
            <Text style={styles.helperText}>
              QR + geo + live camera + AI validation. Rewards are credited only if all checks pass.
            </Text>

            <Text style={styles.label}>Smart Public Bin Registry</Text>
            <View style={styles.segmentRow}>
              {appState.bins.map((bin) => (
                <Pressable
                  key={bin.id}
                  onPress={() => setSelectedBinId(bin.id)}
                  style={[
                    styles.segmentButton,
                    selectedBin?.id === bin.id ? styles.segmentButtonActive : null
                  ]}
                >
                  <Text style={selectedBin?.id === bin.id ? styles.segmentTextActive : styles.segmentText}>
                    {bin.id.replace('bin-', '#')}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.value}>{selectedBin?.name}</Text>
            <Text style={styles.mono}>Status: {selectedBin?.status}</Text>
            <Text style={styles.mono}>Expected QR: {selectedBin?.qrCodeId}</Text>

            <TextInput
              value={scanQrCode}
              onChangeText={setScanQrCode}
              placeholder="Scan or enter QR"
              placeholderTextColor="#6b7280"
              style={styles.input}
            />

            <Text style={styles.label}>Waste Size Classification</Text>
            <View style={styles.segmentRow}>
              {WASTE_SIZES.map((size) => (
                <Pressable
                  key={size}
                  onPress={() => setWasteSize(size)}
                  style={[styles.segmentButton, wasteSize === size ? styles.segmentButtonActive : null]}
                >
                  <Text style={wasteSize === size ? styles.segmentTextActive : styles.segmentText}>
                    {size.replace('_', ' ').toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.rowGap}>
              <Pressable
                onPress={() => setScanQrCode(selectedBin?.qrCodeId ?? '')}
                style={styles.ghostButton}
              >
                <Text style={styles.ghostButtonText}>Fill Expected QR</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  const photo = await captureLivePhoto();
                  if (photo) setDisposalPhotoUri(photo);
                }}
                style={styles.ghostButton}
              >
                <Text style={styles.ghostButtonText}>Live Camera Capture</Text>
              </Pressable>
              <Pressable onPress={() => captureGps(setDisposalLocation)} style={styles.ghostButton}>
                <Text style={styles.ghostButtonText}>Capture GPS</Text>
              </Pressable>
            </View>

            <Text style={styles.mono} numberOfLines={1}>
              Photo: {disposalPhotoUri || 'Not captured'}
            </Text>
            <Text style={styles.mono}>
              Location:{' '}
              {disposalLocation
                ? `${disposalLocation.location.latitude.toFixed(5)}, ${disposalLocation.location.longitude.toFixed(5)} (±${Math.round(disposalLocation.accuracyMeters)}m)`
                : 'Not captured'}
            </Text>

            <View style={styles.rowGap}>
              <Pressable onPress={submitDisposal} style={styles.primaryButtonInline}>
                <Text style={styles.primaryButtonText}>Submit Disposal</Text>
              </Pressable>
              {selectedBin ? (
                <Pressable onPress={() => flagBinFull(selectedBin.id)} style={styles.ghostButton}>
                  <Text style={styles.ghostButtonText}>Report Bin Full</Text>
                </Pressable>
              ) : null}
            </View>

            <Text style={styles.sectionSubtitle}>Recent Disposal Attempts</Text>
            {appState.disposals.length === 0 ? (
              <Text style={styles.helperText}>No disposal attempts yet.</Text>
            ) : null}
            {appState.disposals.slice(0, 5).map((item) => (
              <View key={item.id} style={styles.listItem}>
                <Text style={styles.value}>{item.verified ? 'VERIFIED' : 'REJECTED'}</Text>
                <Text style={styles.mono}>
                  Bin {item.binId} | Distance {formatMeters(item.distanceMeters)} | {item.pointsAwarded} pts
                </Text>
                <Text style={styles.mono}>
                  QR {item.qrVerified ? 'PASS' : 'FAIL'} | GEO {item.geoVerified ? 'PASS' : 'FAIL'} | AI{' '}
                  {item.aiVerified ? 'PASS' : 'FAIL'}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {role === 'citizen' && activeTab === 'Report' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Smart Complaint Reporting (311)</Text>
            <Text style={styles.helperText}>
              Live camera + auto GPS + category based issue submission.
            </Text>

            <Text style={styles.label}>Issue Category</Text>
            <View style={styles.segmentRow}>
              {ISSUE_CATEGORIES.map((category) => (
                <Pressable
                  key={category}
                  onPress={() => setIssueCategory(category)}
                  style={[
                    styles.segmentButton,
                    issueCategory === category ? styles.segmentButtonActive : null
                  ]}
                >
                  <Text
                    style={issueCategory === category ? styles.segmentTextActive : styles.segmentText}
                  >
                    {formatCategory(category)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              value={issueDescription}
              onChangeText={setIssueDescription}
              placeholder="Describe the civic issue"
              placeholderTextColor="#6b7280"
              style={[styles.input, styles.textArea]}
              multiline
            />

            <View style={styles.rowGap}>
              <Pressable
                onPress={async () => {
                  const photo = await captureLivePhoto();
                  if (photo) setIssuePhotoUri(photo);
                }}
                style={styles.ghostButton}
              >
                <Text style={styles.ghostButtonText}>Live Camera Capture</Text>
              </Pressable>
              <Pressable onPress={() => captureGps(setIssueLocation)} style={styles.ghostButton}>
                <Text style={styles.ghostButtonText}>Capture GPS</Text>
              </Pressable>
            </View>

            <Text style={styles.mono} numberOfLines={1}>
              Photo: {issuePhotoUri || 'Not captured'}
            </Text>
            <Text style={styles.mono}>
              Location:{' '}
              {issueLocation
                ? `${issueLocation.location.latitude.toFixed(5)}, ${issueLocation.location.longitude.toFixed(5)}`
                : 'Not captured'}
            </Text>

            <Pressable onPress={submitComplaint} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Submit Complaint</Text>
            </Pressable>

            <Text style={styles.sectionSubtitle}>Complaint Status</Text>
            {appState.complaints.length === 0 ? (
              <Text style={styles.helperText}>No complaints submitted yet.</Text>
            ) : null}
            {appState.complaints.slice(0, 6).map((item) => (
              <View key={item.id} style={styles.listItem}>
                <Text style={styles.value}>{item.status.toUpperCase()}</Text>
                <Text style={styles.mono}>{formatCategory(item.category)}</Text>
                <Text style={styles.mono}>{item.description}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {role === 'worker' && activeTab === 'Tasks' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Proof-of-Cleanliness Upload</Text>
            <Text style={styles.helperText}>
              Submit live geo-verified cleanup proof. Complaint can close only after admin review.
            </Text>

            <Text style={styles.label}>Select Complaint</Text>
            {openComplaints.length === 0 ? (
              <Text style={styles.helperText}>No open complaints available right now.</Text>
            ) : null}
            <View style={styles.segmentRow}>
              {openComplaints.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    setCleanupComplaintId(item.id);
                    setCleanupLocation(null);
                  }}
                  style={[
                    styles.segmentButton,
                    cleanupComplaintId === item.id ? styles.segmentButtonActive : null
                  ]}
                >
                  <Text
                    style={
                      cleanupComplaintId === item.id ? styles.segmentTextActive : styles.segmentText
                    }
                  >
                    {item.id.slice(-6)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.rowGap}>
              <Pressable
                onPress={async () => {
                  const photo = await captureLivePhoto();
                  if (photo) setCleanupPhotoUri(photo);
                }}
                style={styles.ghostButton}
              >
                <Text style={styles.ghostButtonText}>Live Camera Capture</Text>
              </Pressable>
              <Pressable onPress={() => captureGps(setCleanupLocation)} style={styles.ghostButton}>
                <Text style={styles.ghostButtonText}>Capture GPS</Text>
              </Pressable>
            </View>

            <Text style={styles.mono} numberOfLines={1}>
              Photo: {cleanupPhotoUri || 'Not captured'}
            </Text>
            <Text style={styles.mono}>
              Location:{' '}
              {cleanupLocation
                ? `${cleanupLocation.location.latitude.toFixed(5)}, ${cleanupLocation.location.longitude.toFixed(5)}`
                : 'Not captured'}
            </Text>

            <Pressable onPress={submitCleanup} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Submit Cleanup Proof</Text>
            </Pressable>
          </View>
        ) : null}

        {role === 'admin' && activeTab === 'Monitor' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Official Verification Console</Text>
            <Text style={styles.helperText}>
              Approve or reject cleanup proof to move complaint to resolved state.
            </Text>

            {reviewComplaints.length === 0 ? (
              <Text style={styles.helperText}>No complaints awaiting verification.</Text>
            ) : null}

            {reviewComplaints.map((item) => (
              <View key={item.id} style={styles.listItem}>
                <Text style={styles.value}>{item.id}</Text>
                <Text style={styles.mono}>{item.description}</Text>
                <Text style={styles.mono}>
                  Proof distance: {formatMeters(item.cleanupProof?.distanceFromComplaintMeters ?? 0)}
                </Text>
                <Text style={styles.mono}>
                  Watermark: {item.cleanupProof?.watermark ?? 'Not available'}
                </Text>
                <View style={styles.rowGap}>
                  <Pressable
                    onPress={() => verifyComplaint(item.id, true)}
                    style={[styles.ghostButton, styles.approveButton]}
                  >
                    <Text style={styles.ghostButtonText}>Approve</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => verifyComplaint(item.id, false)}
                    style={[styles.ghostButton, styles.rejectButton]}
                  >
                    <Text style={styles.ghostButtonText}>Reject</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {role === 'admin' && activeTab === 'Bins' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Smart Public Bin Registry</Text>
            {appState.bins.map((bin) => (
              <View key={bin.id} style={styles.listItem}>
                <Text style={styles.value}>{bin.name}</Text>
                <Text style={styles.mono}>{bin.id}</Text>
                <Text style={styles.mono}>Status: {bin.status}</Text>
                <Text style={styles.mono}>QR: {bin.qrCodeId}</Text>
                <Text style={styles.mono}>
                  {bin.location.latitude.toFixed(5)}, {bin.location.longitude.toFixed(5)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {(role === 'citizen' && activeTab === 'Wallet') ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Green Wallet (Reward Ledger)</Text>
            <Text style={styles.value}>{appState.wallet.points} points</Text>
            <Text style={styles.helperText}>
              First-time bonus: +{FIRST_TIME_USER_BONUS_POINTS} | Large: +20 | Medium: +10 | Small: +3
            </Text>

            <Text style={styles.sectionSubtitle}>Ledger</Text>
            {appState.wallet.history.length === 0 ? (
              <Text style={styles.helperText}>No wallet transactions yet.</Text>
            ) : null}
            {appState.wallet.history.slice(0, 8).map((entry) => (
              <View key={entry.id} style={styles.listItem}>
                <Text style={styles.value}>
                  {entry.type === 'earn' ? '+' : '-'}{entry.points} {entry.reason}
                </Text>
                <Text style={styles.mono}>{new Date(entry.createdAt).toLocaleString()}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {(role === 'citizen' && activeTab === 'Redeem') ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Reward Redemption (Coupon-Based)</Text>
            {REWARD_CATALOG.map((item) => (
              <View key={item.id} style={styles.rewardRow}>
                <View>
                  <Text style={styles.value}>{item.title}</Text>
                  <Text style={styles.mono}>{item.pointsRequired} points</Text>
                  <Text style={styles.mono}>{item.usage}</Text>
                </View>
                <Pressable
                  onPress={() => redeemReward(item.id, item.title, item.pointsRequired)}
                  style={styles.ghostButton}
                >
                  <Text style={styles.ghostButtonText}>Redeem</Text>
                </Pressable>
              </View>
            ))}

            <Text style={styles.sectionSubtitle}>Generated Coupons</Text>
            {appState.redemptions.length === 0 ? (
              <Text style={styles.helperText}>No coupons generated yet.</Text>
            ) : null}
            {appState.redemptions.slice(0, 6).map((item) => (
              <View key={item.id} style={styles.listItem}>
                <Text style={styles.value}>{item.rewardTitle}</Text>
                <Text style={styles.mono}>Code: {item.couponCode}</Text>
                <Text style={styles.mono}>Expires: {new Date(item.expiresAt).toLocaleDateString()}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {(role === 'admin' && activeTab === 'Fraud') ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Fraud & Misuse Detection Engine</Text>
            {appState.fraudAlerts.length === 0 ? (
              <Text style={styles.helperText}>No suspicious activity flagged yet.</Text>
            ) : null}
            {appState.fraudAlerts.map((alert) => (
              <View key={alert.id} style={styles.listItem}>
                <Text style={styles.value}>
                  {alert.type} ({alert.severity})
                </Text>
                <Text style={styles.mono}>Risk Score: {alert.riskScore}</Text>
                <Text style={styles.mono}>{alert.message}</Text>
                <Text style={styles.mono}>Status: {alert.status}</Text>
                {alert.status === 'open' ? (
                  <Pressable onPress={() => markFraudReviewed(alert.id)} style={styles.ghostButton}>
                    <Text style={styles.ghostButtonText}>Mark Reviewed</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {activeTab === 'Insights' || (role === 'admin' && activeTab === 'Analytics') ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Cleanliness Analytics Dashboard</Text>

            <View style={styles.segmentRow}>
              {(['today', 'last_7_days', 'last_30_days'] as const).map((range) => (
                <Pressable
                  key={range}
                  onPress={() => setTimeFilter(range)}
                  style={[styles.segmentButton, timeFilter === range ? styles.segmentButtonActive : null]}
                >
                  <Text style={timeFilter === range ? styles.segmentTextActive : styles.segmentText}>
                    {range.replace(/_/g, ' ').toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.statsRow}>
              <InfoPill label="Disposals" value={String(analytics.totalDisposals)} />
              <InfoPill label="Complaints" value={String(analytics.totalComplaints)} />
              <InfoPill label="Verified" value={`${analytics.verificationRate}%`} />
            </View>

            <View style={styles.statsRow}>
              <InfoPill label="Open" value={String(analytics.openComplaints)} />
              <InfoPill label="Resolved" value={String(analytics.resolvedComplaints)} />
              <InfoPill label="Users" value={String(analytics.activeUsers)} />
            </View>

            <View style={styles.statsRow}>
              <InfoPill label="Rewards Out" value={`${analytics.totalRewardsDistributed}`} />
              <InfoPill label="Redemptions" value={String(analytics.totalRedemptions)} />
              <InfoPill label="Avg Resolve" value={`${analytics.avgResolutionHours}h`} />
            </View>

            <Text style={styles.sectionSubtitle}>Dumping Hotspots</Text>
            {analytics.hotspots.length === 0 ? (
              <Text style={styles.helperText}>No hotspots yet.</Text>
            ) : null}
            {analytics.hotspots.map((spot) => (
              <View key={spot.zone} style={styles.listItem}>
                <Text style={styles.value}>{spot.zone}</Text>
                <Text style={styles.mono}>Issue density: {spot.issueCount}</Text>
              </View>
            ))}

            <Text style={styles.sectionSubtitle}>Bin Usage</Text>
            {analytics.binUsage.map((row) => (
              <View key={row.binId} style={styles.listItem}>
                <Text style={styles.value}>{row.name}</Text>
                <Text style={styles.mono}>
                  Total: {row.totalDisposals} | Verified: {row.verifiedDisposals}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>System Sync Log</Text>
          {appState.syncLog.length === 0 ? (
            <Text style={styles.helperText}>No events yet.</Text>
          ) : null}
          {appState.syncLog.slice(0, 20).map((line, index) => (
            <Text key={`${line}-${String(index)}`} style={styles.mono}>
              {line}
            </Text>
          ))}
        </View>
      </ScrollView>

      <BottomIconMenu
        tabs={ROLE_TABS[role].slice(0, 4)}
        active={activeTab}
        onChange={(value) =>
          setActiveTabByRole((previous) => ({
            ...previous,
            [role]: value
          }))
        }
      />

      {drawerOpen ? (
        <View style={styles.drawerOverlay}>
          <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)} />
          <View style={styles.drawerPanel}>
            <Text style={styles.sectionTitle}>Menu</Text>
            <Text style={styles.mono}>{authState.user?.role.toUpperCase()}</Text>
            {ROLE_TABS[role].map((tab) => (
              <Pressable
                key={tab}
                onPress={() => {
                  setActiveTabByRole((previous) => ({
                    ...previous,
                    [role]: tab
                  }));
                  setDrawerOpen(false);
                }}
                style={[
                  styles.drawerItem,
                  activeTab === tab ? styles.drawerItemActive : null
                ]}
              >
                <MaterialCommunityIcons
                  name={TAB_ICONS[tab] ?? 'view-dashboard-outline'}
                  size={18}
                  color={activeTab === tab ? '#F2FBF7' : '#15453A'}
                />
                <Text
                  style={[
                    styles.drawerItemText,
                    activeTab === tab ? styles.drawerItemTextActive : null
                  ]}
                >
                  {tab}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
};

const BottomIconMenu = ({
  tabs,
  active,
  onChange
}: {
  tabs: string[];
  active: string;
  onChange: (value: string) => void;
}): JSX.Element => (
  <View style={styles.bottomMenu}>
    {tabs.map((tab) => (
      <Pressable
        key={tab}
        onPress={() => onChange(tab)}
        style={styles.bottomMenuItem}
      >
        <MaterialCommunityIcons
          name={TAB_ICONS[tab] ?? 'view-dashboard-outline'}
          size={22}
          color={active === tab ? '#0E6B54' : '#5B6F68'}
        />
        <Text style={active === tab ? styles.bottomMenuLabelActive : styles.bottomMenuLabel}>
          {tab}
        </Text>
      </Pressable>
    ))}
  </View>
);

const InfoPill = ({ label, value }: { label: string; value: string }): JSX.Element => (
  <View style={styles.infoPill}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F3F7F5'
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F7F5'
  },
  loadingText: {
    marginTop: 8,
    color: '#0A3A2F',
    fontWeight: '600'
  },
  container: {
    flex: 1
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    gap: 12,
    paddingBottom: 110
  },
  authContainer: {
    padding: 18,
    justifyContent: 'center',
    flexGrow: 1
  },
  authCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D4E0DA',
    padding: 18,
    gap: 12,
    shadowColor: '#0B2E25',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3
  },
  authTitle: {
    color: '#0A3A2F',
    fontSize: 24,
    fontWeight: '800'
  },
  authSubtitle: {
    color: '#3C6A5D',
    lineHeight: 20
  },
  credentialCard: {
    borderWidth: 1,
    borderColor: '#CFE0D9',
    borderRadius: 10,
    padding: 10,
    gap: 2,
    backgroundColor: '#F8FCFA'
  },
  credentialRole: {
    color: '#0F5846',
    fontWeight: '800',
    fontSize: 12
  },
  credentialEmail: {
    color: '#305A4E',
    fontSize: 13,
    fontWeight: '600'
  },
  headerCard: {
    backgroundColor: '#0A3A2F',
    borderRadius: 18,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#2F6F5F',
    shadowColor: '#081F19',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2D6E5D'
  },
  headerTitle: {
    color: '#F3FAF6',
    fontSize: 20,
    fontWeight: '800'
  },
  headerSubtitle: {
    color: '#D7E7DF',
    lineHeight: 20
  },
  identityBlock: {
    gap: 6
  },
  headerIdentityText: {
    color: '#F3FAF6',
    fontSize: 16,
    fontWeight: '700'
  },
  headerIdentityMeta: {
    color: '#BBD7CD',
    fontSize: 13
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap'
  },
  headerChip: {
    borderWidth: 1,
    borderColor: '#397E6C',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#104A3D'
  },
  headerChipText: {
    color: '#E2F3EC',
    fontSize: 11,
    fontWeight: '700'
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D4E0DA',
    padding: 14,
    gap: 10,
    shadowColor: '#0A2B22',
    shadowOpacity: 0.05,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0A3A2F'
  },
  sectionSubtitle: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '700',
    color: '#1E584A'
  },
  helperText: {
    color: '#3E665C',
    lineHeight: 19
  },
  helperBanner: {
    borderWidth: 1,
    borderColor: '#CFE0D9',
    borderRadius: 12,
    backgroundColor: '#EEF7F3',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  helperBannerText: {
    color: '#245E50',
    fontWeight: '600',
    flex: 1
  },
  callout: {
    borderWidth: 1,
    borderColor: '#CFE0D9',
    borderRadius: 12,
    backgroundColor: '#F3FAF7',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  calloutText: {
    color: '#1D594B',
    fontWeight: '600',
    flex: 1
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#2D5C4F'
  },
  value: {
    color: '#153D33',
    fontSize: 15,
    fontWeight: '600'
  },
  mono: {
    color: '#415D54',
    fontSize: 12
  },
  input: {
    borderWidth: 1,
    borderColor: '#C3D4CC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F8FBF9',
    color: '#103B30'
  },
  textArea: {
    minHeight: 88,
    textAlignVertical: 'top'
  },
  primaryButton: {
    backgroundColor: '#0E6B54',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44
  },
  primaryButtonInline: {
    backgroundColor: '#0E6B54',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  disabledButton: {
    opacity: 0.5
  },
  primaryButtonText: {
    color: '#F5FFFB',
    fontWeight: '700'
  },
  ghostButton: {
    borderWidth: 1,
    borderColor: '#8FAAA0',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  ghostButtonText: {
    color: '#14453A',
    fontWeight: '600'
  },
  rowGap: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap'
  },
  networkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap'
  },
  segmentButton: {
    borderWidth: 1,
    borderColor: '#A9C5BC',
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#F0F7F3'
  },
  segmentButtonActive: {
    backgroundColor: '#1B7A61',
    borderColor: '#1B7A61'
  },
  segmentText: {
    color: '#1A4D3F',
    fontWeight: '600'
  },
  segmentTextActive: {
    color: '#F2FBF7',
    fontWeight: '700'
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap'
  },
  tabButton: {
    borderWidth: 1,
    borderColor: '#B4CAC2',
    borderRadius: 16,
    paddingVertical: 7,
    paddingHorizontal: 13,
    backgroundColor: '#F5FBF8'
  },
  tabButtonActive: {
    backgroundColor: '#154E40',
    borderColor: '#154E40'
  },
  tabText: {
    color: '#1A4A3D',
    fontWeight: '600'
  },
  tabTextActive: {
    color: '#EEFAF4',
    fontWeight: '700'
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap'
  },
  infoPill: {
    borderWidth: 1,
    borderColor: '#98B4AA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 94,
    backgroundColor: '#EEF7F2'
  },
  infoLabel: {
    color: '#2B5E50',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: '700'
  },
  infoValue: {
    color: '#113F34',
    fontSize: 16,
    fontWeight: '800'
  },
  listItem: {
    borderWidth: 1,
    borderColor: '#D4E2DB',
    borderRadius: 10,
    padding: 10,
    gap: 4,
    backgroundColor: '#FAFDFC'
  },
  rewardRow: {
    borderWidth: 1,
    borderColor: '#D2E0D9',
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10
  },
  approveButton: {
    borderColor: '#4A8D48'
  },
  rejectButton: {
    borderColor: '#8C5050'
  },
  bottomMenu: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D4E0DA',
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
    shadowColor: '#0A2B22',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6
  },
  bottomMenuItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2
  },
  bottomMenuLabel: {
    fontSize: 11,
    color: '#5B6F68',
    fontWeight: '600'
  },
  bottomMenuLabelActive: {
    fontSize: 11,
    color: '#0E6B54',
    fontWeight: '700'
  },
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row'
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.25)'
  },
  drawerPanel: {
    width: 240,
    backgroundColor: '#FFFFFF',
    borderRightWidth: 1,
    borderRightColor: '#D0DDD6',
    paddingHorizontal: 14,
    paddingTop: 42,
    gap: 8
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#BFD1CA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  drawerItemActive: {
    backgroundColor: '#1B7A61',
    borderColor: '#1B7A61'
  },
  drawerItemText: {
    color: '#15453A',
    fontWeight: '600'
  },
  drawerItemTextActive: {
    color: '#F2FBF7'
  },
  errorText: {
    color: '#B22222',
    fontWeight: '600'
  }
});

export default App;
