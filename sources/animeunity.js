import { ANIME } from '@consumet/extensions';

const provider = new ANIME.AnimeUnity();

export async function search(query) {
  return provider.search(query);
}

export async function fetchAnimeInfo(id) {
  return provider.fetchAnimeInfo(id);
}

export async function fetchEpisodeSources(episodeId) {
  return provider.fetchEpisodeSources(episodeId);
}

export default {
  key: 'animeunity',
  label: 'AnimeUnity',
  search,
  fetchAnimeInfo,
  fetchEpisodeSources,
};
