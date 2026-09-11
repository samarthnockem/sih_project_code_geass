import type { Types } from "mongoose";
import { AuditEventModel, type AuditEventAction } from "../models/audit-event.js";

type RecordAuditEventInput = {
  walletAddress: string;
  action: AuditEventAction;
  detail: string;
  assetId?: string | Types.ObjectId | null;
  blockchainTxHash?: string | null;
};

const forbiddenDetailPattern =
  /\b(cookie|session|private\s*key|raw\s*aes|wrapped\s*key|plaintext|password|seed\s*phrase|mnemonic)\b/i;

function normalizeWallet(walletAddress: string) {
  return walletAddress.trim().toLowerCase();
}

function safeDetail(detail: string) {
  const normalized = detail.replace(/\s+/g, " ").trim();
  if (!normalized || forbiddenDetailPattern.test(normalized)) {
    return "Product activity recorded";
  }
  return normalized.slice(0, 1000);
}

export async function recordAuditEvent(input: RecordAuditEventInput) {
  return AuditEventModel.create({
    walletAddress: normalizeWallet(input.walletAddress),
    assetId: input.assetId ?? null,
    action: input.action,
    detail: safeDetail(input.detail),
    blockchainTxHash: input.blockchainTxHash ? input.blockchainTxHash.toLowerCase() : null,
    timestamp: new Date()
  });
}

export function safeAuditEvent(event: {
  _id?: unknown;
  walletAddress: string;
  assetId?: unknown;
  action: string;
  detail: string;
  blockchainTxHash?: string | null;
  timestamp?: Date | string | null;
}) {
  return {
    id: event._id?.toString(),
    walletAddress: event.walletAddress,
    assetId: event.assetId ? event.assetId.toString() : null,
    action: event.action,
    detail: event.detail,
    blockchainTxHash: event.blockchainTxHash || null,
    timestamp: event.timestamp instanceof Date ? event.timestamp.toISOString() : event.timestamp || null
  };
}
