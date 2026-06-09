// Developer portfolios that can feed the Cumulus fleet. TAMAX (Berlin·Brandenburg)
// is real-ish (crawled). SALLIER (Hamburg·Lüneburg) is a REAL family developer
// from Lüneburg (sallier.de, "Wir leben Immobilien") — included to show the
// opportunity doesn't stop with a single partner. Its project list and all
// compute figures here are ILLUSTRATIVE / estimated, not official SALLIER data.
import { TAMAX_PORTFOLIO, type PortfolioSite } from './tamax-portfolio';

export interface Developer {
  id: string;
  name: string;
  region: string;
  tagline: string;
  sites: PortfolioSite[];
}

// SALLIER projects — real locations/types in their north-German footprint
// (Hanseviertel IC14 in Lüneburg is a real reference); kW + status illustrative.
export const SALLIER_PORTFOLIO: PortfolioSite[] = [
  { id: 1, name: 'Hanseviertel IC14', typ: 'Wohnquartier (Neubau)', status: 'Abgeschlossen', ort: 'Lüneburg', connectionKw: 900, built: true, lat: 53.245, lng: 10.405 },
  { id: 2, name: 'Wohnquartier Harburger Tor', typ: 'Wohnneubau', status: 'In Planung', ort: 'Hamburg-Harburg', connectionKw: 1600, built: false, lat: 53.46, lng: 9.98 },
  { id: 3, name: 'Flächenentwicklung Winsen', typ: 'Baulandentwicklung Wohnen', status: 'In Planung', ort: 'Winsen (Luhe)', connectionKw: 720, built: false, lat: 53.36, lng: 10.21 },
  { id: 4, name: 'Heidberg-Quartier', typ: 'Baulandentwicklung Wohnen (EFH)', status: 'In Planung', ort: 'Bad Fallingbostel', connectionKw: 480, built: false, lat: 52.87, lng: 9.69 },
  { id: 5, name: 'Logistikpark Nordheide', typ: 'Logistikimmobilie', status: 'Im Bau', ort: 'Seevetal', connectionKw: 1500, built: false, lat: 53.4, lng: 10.05 },
  { id: 6, name: 'Quartier Am Sande', typ: 'Revitalisierung Bestand (Büro/Wohnen)', status: 'Im Bestand', ort: 'Lüneburg', connectionKw: 280, built: true, lat: 53.25, lng: 10.41 },
  { id: 7, name: 'Elbpanorama Altona', typ: 'Wohnneubau', status: 'In Planung', ort: 'Hamburg-Altona', connectionKw: 1150, built: false, lat: 53.55, lng: 9.94 },
  { id: 8, name: 'Gewerbepark Nordheide', typ: 'Gewerbe-/Handelspark', status: 'Abgeschlossen', ort: 'Buchholz i.d. Nordheide', connectionKw: 640, built: true, lat: 53.32, lng: 9.87 },
  { id: 9, name: 'Stadtkoppel', typ: 'Wohnquartier', status: 'In Planung', ort: 'Uelzen', connectionKw: 540, built: false, lat: 52.97, lng: 10.56 },
  { id: 10, name: 'Hafenkontor Stade', typ: 'Büro-/Gewerbeobjekt', status: 'In Planung', ort: 'Stade', connectionKw: 880, built: false, lat: 53.6, lng: 9.48 },
  { id: 11, name: 'Marschenhöfe', typ: 'Wohnen (EFH/Doppelhaus)', status: 'Im Vertrieb', ort: 'Winsen-Roydorf', connectionKw: 300, built: false, lat: 53.37, lng: 10.24 },
  { id: 12, name: 'Bürocampus Bergedorf', typ: 'Büro-/Verwaltungsgebäude', status: 'In Planung', ort: 'Hamburg-Bergedorf', connectionKw: 1300, built: false, lat: 53.49, lng: 10.21 },
];

export const TAMAX: Developer = {
  id: 'tamax',
  name: 'TAMAX',
  region: 'Berlin · Brandenburg',
  tagline: 'Die Heimat von morgen — Wohnen, Arbeiten, Altern.',
  sites: TAMAX_PORTFOLIO,
};

export const SALLIER: Developer = {
  id: 'sallier',
  name: 'SALLIER',
  region: 'Hamburg · Lüneburg',
  tagline: 'Wir leben Immobilien.',
  sites: SALLIER_PORTFOLIO,
};

export const DEVELOPERS: Developer[] = [TAMAX, SALLIER];
