import { runJobAsync } from "../../lib/runJobAsync";

export type RgpUna = {
  una: string;
  type?: string;
  type_libelle?: string;
  type_description?: string;
  synthese?: string | null;
  urgent?: boolean;
  sensible?: boolean;
  groupe?: string | number | null;
  groupe_libelle?: string | null;
  commune?: string | null;
  commune_libelle?: string | null;
  date_submit?: string;
  numero?: number;
  annee?: number;
};

export type RgpParsed =
  | { data?: RgpUna | RgpUna[]; error?: { code: string; message: string } }
  | null;

export type RgpReply = { text: string; parsed: RgpParsed; message: string };

export async function sendRgpPrompt(
  prompt: string,
  fetchImpl: typeof fetch = fetch
): Promise<RgpReply> {
  return runJobAsync<RgpReply>("/api/rgp/chat", { prompt }, { fetchImpl });
}
