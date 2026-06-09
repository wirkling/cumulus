// Developer portfolios that can feed the Cumulus fleet. TAMAX (Berlin·Brandenburg)
// is real-ish (crawled). HEIDEWERK (Hamburg·Lüneburg) is MOCK — it exists to show
// that the opportunity doesn't stop with a single partner's portfolio.
import { TAMAX_PORTFOLIO, type PortfolioSite } from './tamax-portfolio';

export interface Developer {
  id: string;
  name: string;
  region: string;
  tagline: string;
  sites: PortfolioSite[];
}

// A second, fictional family developer in the Hamburg / Lüneburg Heath region.
// connectionKw = estimated max grid connection (all-electric assumption).
export const HEIDEWERK_PORTFOLIO: PortfolioSite[] = [
  { id: 1, name: 'Elbquartier Harburg', typ: 'Wohn- und Gewerbequartier', status: 'In Planung', ort: 'Hamburg-Harburg', connectionKw: 1450, built: false, lat: 53.46, lng: 9.98 },
  { id: 2, name: 'Schlossviertel', typ: 'Wohnquartier (Geschossbau)', status: 'Abgeschlossen', ort: 'Lüneburg', connectionKw: 880, built: true, lat: 53.25, lng: 10.41 },
  { id: 3, name: 'Heidehöfe', typ: 'Wohngebiet (Neubaugebiet, EFH)', status: 'In Planung', ort: 'Buchholz i.d. Nordheide', connectionKw: 360, built: false, lat: 53.32, lng: 9.87 },
  { id: 4, name: 'Marktpassage', typ: 'Einzelhandels- & Dienstleistungszentrum', status: 'Abgeschlossen', ort: 'Winsen (Luhe)', connectionKw: 620, built: true, lat: 53.36, lng: 10.21 },
  { id: 5, name: 'Hafencampus Stade', typ: 'Büro-/Gewerbecampus', status: 'In Planung', ort: 'Stade', connectionKw: 1100, built: false, lat: 53.6, lng: 9.48 },
  { id: 6, name: 'Estetal-Carré', typ: 'Wohnen & Gewerbe', status: 'Im Bau', ort: 'Buxtehude', connectionKw: 540, built: false, lat: 53.48, lng: 9.7 },
  { id: 7, name: 'Bergedorfer Tor', typ: 'Hochpunkt Wohnen/Büro (22 Geschosse)', status: 'In Planung', ort: 'Hamburg-Bergedorf', connectionKw: 2100, built: false, lat: 53.49, lng: 10.21 },
  { id: 8, name: 'Salzquartier', typ: 'Wohnen 65+ & Pflege', status: 'In Planung', ort: 'Lüneburg-Kaltenmoor', connectionKw: 740, built: false, lat: 53.26, lng: 10.44 },
  { id: 9, name: 'Elbterrassen', typ: 'Wohnquartier am Wasser', status: 'Abgeschlossen', ort: 'Geesthacht', connectionKw: 480, built: true, lat: 53.43, lng: 10.38 },
  { id: 10, name: 'Nordheide Logistik', typ: 'Gewerbe-/Logistikpark', status: 'In Planung', ort: 'Seevetal', connectionKw: 1600, built: false, lat: 53.4, lng: 10.05 },
  { id: 11, name: 'Altstadtkontor', typ: 'Bestandssanierung Büro', status: 'Im Bestand', ort: 'Uelzen', connectionKw: 210, built: true, lat: 52.97, lng: 10.56 },
  { id: 12, name: 'Altonaer Höfe', typ: 'Bestandssanierung Wohnen (Altbau)', status: 'Abgeschlossen', ort: 'Hamburg-Altona', connectionKw: 320, built: true, lat: 53.55, lng: 9.94 },
];

export const TAMAX: Developer = {
  id: 'tamax',
  name: 'TAMAX',
  region: 'Berlin · Brandenburg',
  tagline: 'Die Heimat von morgen — Wohnen, Arbeiten, Altern.',
  sites: TAMAX_PORTFOLIO,
};

export const HEIDEWERK: Developer = {
  id: 'heidewerk',
  name: 'Heidewerk',
  region: 'Hamburg · Lüneburg',
  tagline: 'Quartiere zwischen Elbe und Heide.',
  sites: HEIDEWERK_PORTFOLIO,
};

export const DEVELOPERS: Developer[] = [TAMAX, HEIDEWERK];
