"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

// Google Ads tag with Consent Mode v2. Nothing is stored until the visitor accepts (UK GDPR / PECR).
// Set NEXT_PUBLIC_GOOGLE_ADS_ID=AW-XXXXXXXXX and/or NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX to switch it on.

const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const TAG_ID = ADS_ID || GA_ID;
const KEY = "zs-consent";

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

function readConsent(): "granted" | "denied" | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function GoogleTag() {
  const [choice, setChoice] = useState<"granted" | "denied" | null | "unknown">("unknown");
  useEffect(() => setChoice(readConsent()), []);
  if (!TAG_ID) return null;

  const decide = (v: "granted" | "denied") => {
    try {
      localStorage.setItem(KEY, v);
    } catch {}
    window.gtag?.("consent", "update", { ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v });
    setChoice(v);
  };

  return (
    <>
      <Script id="gtag-consent" strategy="afterInteractive">{`
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;
var c=null;try{c=localStorage.getItem('${KEY}')}catch(e){}
var v=c==='granted'?'granted':'denied';
gtag('consent','default',{ad_storage:v,ad_user_data:v,ad_personalization:v,analytics_storage:v,wait_for_update:500});
gtag('set','url_passthrough',true);
gtag('js',new Date());${ADS_ID ? `gtag('config','${ADS_ID}');` : ""}${GA_ID ? `gtag('config','${GA_ID}');` : ""}`}</Script>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${TAG_ID}`} strategy="afterInteractive" />
      {choice === null && (
        <div style={{ position: "fixed", left: 16, right: 16, bottom: 16, maxWidth: 560, margin: "0 auto", background: "#16181d", color: "#fff", borderRadius: 12, padding: "14px 16px", fontSize: 14, zIndex: 50, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 260px" }}>We use cookies to see how people use this page and which of our Google ads work. Nothing else.</span>
          <button onClick={() => decide("denied")} style={{ background: "transparent", color: "#fff", border: "1px solid #555", borderRadius: 8, padding: "8px 12px", cursor: "pointer", margin: 0 }}>
            No thanks
          </button>
          <button onClick={() => decide("granted")} style={{ background: "#fff", color: "#16181d", border: 0, borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontWeight: 600, margin: 0 }}>
            Accept
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Fire a Google Ads conversion (and a matching GA4 event) once per page load.
 * `label` is the conversion label from Google Ads; `event` is the GA4 event name.
 */
export function Conversion({ label, value, event }: { label?: string; value?: number; event?: string }) {
  useEffect(() => {
    if (!TAG_ID) return;
    const fire = () => {
      const money = value ? { value, currency: "GBP" } : {};
      if (ADS_ID && label) window.gtag?.("event", "conversion", { send_to: `${ADS_ID}/${label}`, ...money });
      if (GA_ID && event) window.gtag?.("event", event, { send_to: GA_ID, ...money });
    };
    if (typeof window.gtag === "function") fire();
    else setTimeout(fire, 1500);
  }, [label, value, event]);
  return null;
}
