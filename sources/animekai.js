import { ANIME, StreamingServers, SubOrSub } from '@consumet/extensions';

const provider = new ANIME.AnimeKai();

const fallbackLanguages = [SubOrSub.SUB, SubOrSub.DUB];

export async function search(query, page = 1) {
  return provider.search(query, page);
}

export async function fetchAnimeInfo(id) {
  return provider.fetchAnimeInfo(id);
}

export async function fetchEpisodeSources(episodeId, options = {}) {
  const { server, subOrDub, retryOnNoSources = true } = options;
  const langsToTry = subOrDub
    ? [subOrDub, ...fallbackLanguages.filter((candidate) => candidate !== subOrDub)]
    : fallbackLanguages;

  const attempts = [];

  for (const lang of langsToTry) {
    try {
      // AnimeKai defaults to MegaUp and usually resolves correctly without explicit server.
      const defaultResponse = await provider.fetchEpisodeSources(episodeId, server, lang);
      if (defaultResponse?.sources?.length) {
        return {
          ...defaultResponse,
          _resolvedServer: server ?? StreamingServers.MegaUp,
          _resolvedLanguage: lang,
        };
      }
    } catch (err) {
      attempts.push(`default/${lang}: ${err?.message ?? 'unknown error'}`);
    }

    let servers = [];
    try {
      servers = await provider.fetchEpisodeServers(episodeId, lang);
    } catch (err) {
      attempts.push(`servers/${lang}: ${err?.message ?? 'unknown error'}`);
    }

    const serverNames = [
      ...new Set(
        servers
          .map((item) => {
            const raw = String(item?.name ?? '').toLowerCase();
            if (raw.includes('megaup')) {
              return StreamingServers.MegaUp;
            }
            return raw;
          })
          .filter(Boolean)
      ),
    ];

    for (const currentServer of serverNames) {
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
  key: 'animekai',
  label: 'Animekai',
  search,
  fetchAnimeInfo,
  fetchEpisodeSources,
};
