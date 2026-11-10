import { env } from "../env";
import { fetchJson } from "../http";

export interface Place {
  id: string;
  name: string;
  website: string | null;
  address: string | null;
  phone: string | null;
  rating: number | null;
  reviews: number | null;
}

interface PlacesResponse {
  places?: {
    id: string;
    displayName?: { text: string };
    websiteUri?: string;
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    rating?: number;
    userRatingCount?: number;
  }[];
  nextPageToken?: string;
}

/** Google Places API (New) text search, e.g. "electricians in Leeds". Up to 60 results. */
export async function searchPlaces(textQuery: string, maxResults = 60): Promise<Place[]> {
  const key = env.placesKey();
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  const out: Place[] = [];
  let pageToken: string | undefined;
  do {
    const data = await fetchJson<PlacesResponse>("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
        "x-goog-fieldmask":
          "places.id,places.displayName,places.websiteUri,places.formattedAddress,places.nationalPhoneNumber,places.rating,places.userRatingCount,nextPageToken",
      },
      body: JSON.stringify({ textQuery, pageSize: 20, regionCode: "GB", ...(pageToken ? { pageToken } : {}) }),
    });
    for (const p of data.places ?? []) {
      out.push({
        id: p.id,
        name: p.displayName?.text ?? "Unknown",
        website: p.websiteUri ?? null,
        address: p.formattedAddress ?? null,
        phone: p.nationalPhoneNumber ?? null,
        rating: p.rating ?? null,
        reviews: p.userRatingCount ?? null,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken && out.length < maxResults);
  return out.slice(0, maxResults);
}

/** UK postcode from a formatted address, if present. */
export function postcodeFrom(address: string | null): string | null {
  if (!address) return null;
  const m = address.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
  return m ? `${m[1]} ${m[2]}` : null;
}

export function cityFrom(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  // "..., Leeds LS1 4AP, UK" -> "Leeds"
  const withPc = parts.find((p) => /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(p));
  if (withPc) return withPc.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, "").trim() || null;
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}
