import { Bin, Complaint, DisposalRecord, RedemptionRecord, WalletEntry } from '../types';
import { hotspotKey } from '../utils/geo';

export type BinUsageRow = {
  binId: string;
  name: string;
  ward: string;
  totalDisposals: number;
  verifiedDisposals: number;
};

export type HotspotRow = {
  zone: string;
  issueCount: number;
};

export type AnalyticsSnapshot = {
  totalDisposals: number;
  totalComplaints: number;
  verifiedDisposals: number;
  verificationRate: number;
  openComplaints: number;
  resolvedComplaints: number;
  avgResolutionHours: number;
  activeUsers: number;
  totalRewardsDistributed: number;
  totalRedemptions: number;
  binUsage: BinUsageRow[];
  hotspots: HotspotRow[];
};

const toHours = (milliseconds: number): number => milliseconds / (1000 * 60 * 60);

export const buildAnalytics = (
  disposals: DisposalRecord[],
  complaints: Complaint[],
  bins: Bin[],
  walletEntries: WalletEntry[],
  redemptions: RedemptionRecord[]
): AnalyticsSnapshot => {
  const binUsage = bins
    .map((bin) => {
      const binDisposals = disposals.filter((item) => item.binId === bin.id);
      return {
        binId: bin.id,
        name: bin.name,
        ward: bin.ward,
        totalDisposals: binDisposals.length,
        verifiedDisposals: binDisposals.filter((item) => item.aiVerified && item.geoVerified).length
      };
    })
    .sort((left, right) => right.totalDisposals - left.totalDisposals);

  const resolutionDurations = complaints
    .filter((item) => item.status === 'resolved' && item.resolvedAt)
    .map((item) => {
      const created = new Date(item.createdAt).getTime();
      const resolved = new Date(item.resolvedAt ?? item.createdAt).getTime();
      return Math.max(resolved - created, 0);
    });

  const hotspotMap = new Map<string, number>();

  disposals
    .filter((item) => !item.verified)
    .forEach((item) => {
      const key = hotspotKey(item.location);
      hotspotMap.set(key, (hotspotMap.get(key) ?? 0) + 1);
    });

  complaints
    .filter((item) => item.status !== 'resolved')
    .forEach((item) => {
      const key = hotspotKey(item.location);
      hotspotMap.set(key, (hotspotMap.get(key) ?? 0) + 1);
    });

  const hotspots = [...hotspotMap.entries()]
    .map(([zone, issueCount]) => ({ zone, issueCount }))
    .sort((left, right) => right.issueCount - left.issueCount)
    .slice(0, 6);

  const verifiedDisposals = disposals.filter((item) => item.verified).length;
  const totalDisposals = disposals.length;
  const verificationRate = totalDisposals === 0 ? 0 : (verifiedDisposals / totalDisposals) * 100;

  const avgResolutionHours =
    resolutionDurations.length === 0
      ? 0
      : resolutionDurations.reduce((sum, current) => sum + toHours(current), 0) /
        resolutionDurations.length;

  const uniqueUsers = new Set<string>();
  disposals.forEach((item) => uniqueUsers.add(item.userId));
  complaints.forEach((item) => uniqueUsers.add(item.userId));

  const totalRewardsDistributed = walletEntries
    .filter((entry) => entry.type === 'earn')
    .reduce((sum, entry) => sum + entry.points, 0);

  return {
    totalDisposals,
    totalComplaints: complaints.length,
    verifiedDisposals,
    verificationRate: Number(verificationRate.toFixed(1)),
    openComplaints: complaints.filter((item) => item.status !== 'resolved').length,
    resolvedComplaints: complaints.filter((item) => item.status === 'resolved').length,
    avgResolutionHours: Number(avgResolutionHours.toFixed(2)),
    activeUsers: uniqueUsers.size,
    totalRewardsDistributed,
    totalRedemptions: redemptions.length,
    binUsage,
    hotspots
  };
};
