import { ANIME } from '@consumet/extensions';

const provider = new ANIME.AnimeSama();

export async function search(query) {
  return provider.search(query);
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
    // Fall back to provider default extraction when server list is unavailable.
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
  key: 'animesama',
  label: 'AnimeSama',
  search,
  fetchAnimeInfo,
  fetchEpisodeSources,
};
