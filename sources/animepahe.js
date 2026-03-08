import { ANIME } from '@consumet/extensions';

const provider = new ANIME.AnimePahe();

export async function search(query) {
  return provider.search(query);
}

export async function fetchAnimeInfo(id) {
  return provider.fetchAnimeInfo(id);
}

export async function fetchEpisodeSources(episodeId, options = {}) {
  const { subOrDub } = options;
  const response = await provider.fetchEpisodeSources(episodeId);
  const hasDub = Array.isArray(response?.sources) && response.sources.some((s) => s?.isDub === true);
  const hasSub = Array.isArray(response?.sources) && response.sources.some((s) => s?.isDub !== true);

  let sources = Array.isArray(response?.sources) ? response.sources : [];

  if (subOrDub === 'dub') {
    sources = sources.filter((s) => s?.isDub === true);
  } else if (subOrDub === 'sub') {
    sources = sources.filter((s) => s?.isDub !== true);
  }

  return {
    ...response,
    sources,
    _resolvedLanguage: hasDub && !hasSub ? 'dub' : hasSub && !hasDub ? 'sub' : 'unknown',
  };
}

export default {
  key: 'animepahe',
  label: 'AnimePahe',
  search,
  fetchAnimeInfo,
  fetchEpisodeSources,
};
