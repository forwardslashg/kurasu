import { ANIME } from '@consumet/extensions';

const provider = new ANIME.KickAssAnime();

export async function search(query, page = 1) {
  return provider.search(query, page);
}

export async function fetchAnimeInfo(id) {
  return provider.fetchAnimeInfo(id);
}

export async function fetchEpisodeSources(episodeId, options = {}) {
  const { server } = options;

  if (server) {
    return provider.fetchEpisodeSources(episodeId, server);
  }

  let servers = [];
  try {
    servers = await provider.fetchEpisodeServers(episodeId);
  } catch {
    // If servers cannot be fetched, provider will try its default extraction path.
  }

  const serverNames = [...new Set(servers.map((item) => item?.name).filter(Boolean))];

  const attempts = [];
  for (const name of serverNames) {
    try {
      const response = await provider.fetchEpisodeSources(episodeId, name);
      if (response?.sources?.length) {
        return {
          ...response,
          _resolvedServer: name,
        };
      }
      attempts.push(`${name}: no sources returned`);
    } catch (err) {
      attempts.push(`${name}: ${err?.message ?? 'unknown error'}`);
    }
  }

  const fallback = await provider.fetchEpisodeSources(episodeId);
  if (fallback?.sources?.length) {
    return fallback;
  }

  throw new Error(`No sources returned. Tried: ${attempts.join(' | ') || 'default strategy'}`);
}

export default {
  key: 'kickassanime',
  label: 'Kickassanime',
  search,
  fetchAnimeInfo,
  fetchEpisodeSources,
};
