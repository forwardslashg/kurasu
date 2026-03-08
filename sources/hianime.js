import { ANIME, StreamingServers, SubOrSub } from '@consumet/extensions';

const provider = new ANIME.Hianime();

const fallbackServers = [
  StreamingServers.VidCloud,
  StreamingServers.VidStreaming,
  StreamingServers.StreamSB,
  StreamingServers.StreamTape,
];

const fallbackLanguages = [SubOrSub.SUB, SubOrSub.DUB];

export async function search(query, page = 1) {
  return provider.search(query, page);
}

export async function fetchAnimeInfo(id) {
  return provider.fetchAnimeInfo(id);
}

export async function fetchEpisodeSources(episodeId, options = {}) {
  const { server, subOrDub, retryOnNoSources = true } = options;

  // Try provider defaults first because server availability can shift over time.
  try {
    const defaultResponse = await provider.fetchEpisodeSources(episodeId, server, subOrDub);
    if (defaultResponse?.sources?.length) {
      return {
        ...defaultResponse,
        _resolvedServer: server,
        _resolvedLanguage: subOrDub,
      };
    }
  } catch {
    // Continue with explicit fallback attempts.
  }

  const serversToTry = server
    ? [server, ...fallbackServers.filter((candidate) => candidate !== server)]
    : fallbackServers;
  const langsToTry = subOrDub
    ? [subOrDub, ...fallbackLanguages.filter((candidate) => candidate !== subOrDub)]
    : fallbackLanguages;

  const attempts = [];

  for (const lang of langsToTry) {
    for (const currentServer of serversToTry) {
      try {
        const response = await provider.fetchEpisodeSources(episodeId, currentServer, lang);
        if (response?.sources?.length) {
          return {
            ...response,
            _resolvedServer: currentServer,
            _resolvedLanguage: lang,
          };
        }
        attempts.push(`${currentServer}/${lang}: no sources returned`);
      } catch (err) {
        attempts.push(`${currentServer}/${lang}: ${err?.message ?? 'unknown error'}`);
      }

      if (!retryOnNoSources) {
        break;
      }
    }

    if (!retryOnNoSources) {
      break;
    }
  }

  throw new Error(`No sources returned. Tried: ${attempts.join(' | ')}`);
}

export default {
  key: 'hianime',
  label: 'Hianime',
  search,
  fetchAnimeInfo,
  fetchEpisodeSources,
};
