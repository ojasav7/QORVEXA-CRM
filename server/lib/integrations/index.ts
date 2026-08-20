// Provider registry + status (Phase 16 · ADR-028).
// Provider choice is environment configuration (never org state); this module
// reports the ACTIVE provider per capability + whether it is actually usable
// (key present, sender set). Never exposes a secret — just booleans.
import { env } from "../../env";
import { twilioConfigured } from "./telephony";

export type CapabilityStatus = {
  provider: string; // "mock" | "resend" | "sendgrid" | "openai" | "twilio"
  configured: boolean; // the provider is selected AND has its key(s)
  notes: string[];
};

export function emailStatus(): CapabilityStatus {
  const notes: string[] = [];
  if (env.emailProvider === "resend") {
    if (!env.resendApiKey) notes.push("RESEND_API_KEY not set");
    if (!env.resendFromEmail) notes.push("RESEND_FROM_EMAIL not set (verified sender required)");
  } else if (env.emailProvider === "sendgrid") {
    if (!env.sendgridApiKey) notes.push("SENDGRID_API_KEY not set");
    if (!env.sendgridFromEmail) notes.push("SENDGRID_FROM_EMAIL not set (verified sender required)");
  }
  return {
    provider: env.emailProvider,
    configured: env.emailProvider !== "mock" && notes.length === 0,
    notes,
  };
}

export function aiStatus(): CapabilityStatus {
  const notes: string[] = [];
  if (env.aiProvider === "openai") {
    if (!env.openaiApiKey) notes.push("OPENAI_API_KEY not set");
    notes.push(`default model: ${env.openaiModel}`);
  }
  return {
    provider: env.aiProvider,
    configured: env.aiProvider === "openai" && Boolean(env.openaiApiKey),
    notes,
  };
}

export function telephonyStatus(): CapabilityStatus {
  const notes: string[] = [];
  if (twilioConfigured()) {
    notes.push(`from: ${env.twilioFromNumber}`);
  } else {
    notes.push("set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER to enable");
  }
  return {
    provider: twilioConfigured() ? "twilio" : "mock",
    configured: twilioConfigured(),
    notes,
  };
}

export function integrationsStatus() {
  return {
    email: emailStatus(),
    ai: aiStatus(),
    telephony: telephonyStatus(),
    webhooks: {
      email: env.emailWebhookSecret ? "signature-required" : "token-proof (dev)",
    },
  };
}
