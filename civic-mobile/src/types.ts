export type Role = 'citizen' | 'worker' | 'admin';

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type BinStatus = 'available' | 'reported_full' | 'temporarily_disabled';

export type Bin = {
  id: string;
  name: string;
  qrCodeId: string;
  ward: string;
  location: Coordinates;
  status: BinStatus;
  lastUsedAt?: string;
  createdAt: string;
};

export type WasteSizeClass = 'large' | 'medium' | 'small' | 'home_daily';

export type WalletEntry = {
  id: string;
  type: 'earn' | 'redeem';
  points: number;
  reason: string;
  source:
    | 'ai_disposal_verified'
    | 'first_time_bonus'
    | 'coupon_redemption'
    | 'manual_adjustment';
  referenceId?: string;
  createdAt: string;
};

export type WalletState = {
  points: number;
  history: WalletEntry[];
};

export type RewardCatalogItem = {
  id: string;
  title: string;
  pointsRequired: number;
  usage: string;
};

export type RedemptionRecord = {
  id: string;
  rewardId: string;
  rewardTitle: string;
  couponCode: string;
  pointsUsed: number;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'used' | 'expired';
};

export type FraudAlertType =
  | 'duplicate_image'
  | 'location_anomaly'
  | 'before_after_mismatch'
  | 'qr_mismatch'
  | 'geo_fence_failure'
  | 'mock_location_detected'
  | 'cooldown_violation'
  | 'location_accuracy_failure'
  | 'timestamp_invalid';

export type FraudAlert = {
  id: string;
  type: FraudAlertType;
  severity: 'low' | 'medium' | 'high';
  message: string;
  actionId: string;
  riskScore: number;
  status: 'open' | 'reviewed' | 'blocked';
  createdAt: string;
};

export type DisposalImageValidation = {
  qualityPassed: boolean;
  binDetected: boolean;
  wasteDetected: boolean;
  confidence: number;
  failureReason?: string;
};

export type DisposalRecord = {
  id: string;
  userId: string;
  binId: string;
  qrCodeId: string;
  photoUri: string;
  imageHash: string;
  location: Coordinates;
  accuracyMeters: number;
  createdAt: string;
  distanceMeters: number;
  geoVerified: boolean;
  qrVerified: boolean;
  aiVerified: boolean;
  wasteSize: WasteSizeClass;
  fraudFlags: FraudAlertType[];
  verified: boolean;
  pointsAwarded: number;
  rejectionReason?: string;
};

export type IssueCategory =
  | 'roadside_dumping'
  | 'overflowing_bin'
  | 'open_garbage_heap'
  | 'blocked_drain'
  | 'public_area_unclean';

export type CleanupProof = {
  id: string;
  submittedBy: string;
  photoUri: string;
  imageHash: string;
  location: Coordinates;
  accuracyMeters: number;
  createdAt: string;
  watermark: string;
  distanceFromComplaintMeters: number;
  aiCleanVerified: boolean;
  fraudFlags: FraudAlertType[];
};

export type ComplaintStatus = 'open' | 'assigned' | 'in_progress' | 'resolved';

export type Complaint = {
  id: string;
  userId: string;
  category: IssueCategory;
  description: string;
  photoUri: string;
  imageHash: string;
  location: Coordinates;
  createdAt: string;
  status: ComplaintStatus;
  reportFraudFlags: FraudAlertType[];
  cleanupProof?: CleanupProof;
  resolvedAt?: string;
  verification?: {
    verifiedBy: string;
    accepted: boolean;
    notes?: string;
    verifiedAt: string;
  };
};

export type UserLocationSnapshot = {
  location: Coordinates;
  accuracyMeters: number;
  timestamp: string;
};

export type LocationStrength = 'strong' | 'medium' | 'weak' | 'none';

export type LocationSnapshot = {
  location: Coordinates;
  accuracyMeters: number;
  timestamp: string;
  ageSeconds: number;
  isMocked: boolean;
  strength: LocationStrength;
};

export type AuthStage = 'login' | 'authenticated';

export type UserProfile = {
  id: string;
  email: string;
  role: Role;
  name: string;
  ward: string;
  deviceId: string;
  createdAt: string;
};

export type AuthState = {
  stage: AuthStage;
  isLoading: boolean;
  email: string;
  password: string;
  error?: string;
  sessionToken?: string;
  user?: UserProfile;
};

export type PendingActionType =
  | 'dispose'
  | 'report_issue'
  | 'submit_cleanup'
  | 'verify_cleanup'
  | 'redeem_reward'
  | 'report_bin_full';

export type PendingAction = {
  id: string;
  type: PendingActionType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type AppState = {
  isOnline: boolean;
  bins: Bin[];
  disposals: DisposalRecord[];
  complaints: Complaint[];
  wallet: WalletState;
  redemptions: RedemptionRecord[];
  fraudAlerts: FraudAlert[];
  pendingActions: PendingAction[];
  usedImageHashes: string[];
  lastActionByUser: Record<string, UserLocationSnapshot>;
  syncLog: string[];
};
