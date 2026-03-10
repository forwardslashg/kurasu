import hianime from './hianime.js';
import animepahe from './animepahe.js';
import animekai from './animekai.js';
import kickassanime from './kickassanime.js';
import animesaturn from './animesaturn.js';
import animeunity from './animeunity.js';
import animesama from './animesama.js';

export const SOURCES = {
  hianime,
  animepahe,
  animekai,
  kickassanime,
  animesaturn,
  animeunity,
  animesama,
};

export const SOURCE_KEYS = Object.keys(SOURCES);

export function getSource(key) {
  return SOURCES[key] ?? null;
}
