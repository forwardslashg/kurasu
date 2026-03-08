// yeah i used ai to generate this #imalazypieceofshit
import { SOURCE_KEYS, getSource } from './sources/index.js';

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleSimilarity(a, b) {
  const aTokens = new Set(normalizeText(a).split(' ').filter(Boolean));
  const bTokens = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(aTokens.size, bTokens.size);
}

function parseQualityScore(quality) {
  const text = String(quality ?? '').toLowerCase();
  if (!text) {
    return 0;
  }

  if (text.includes('4k')) {
    return 2160;
  }
  if (text.includes('2k')) {
    return 1440;
  }

  const match = text.match(/(\d{3,4})\s*p/);
  if (match) {
    return Number(match[1]);
  }

  return 0;
}

function uniqueById(items = []) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = item?.id;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }

  return out;
}

function encodeScopedId(sourceKey, rawId) {
  return `${sourceKey}::${rawId}`;
}

function decodeScopedId(scopedId, explicitSource) {
  if (explicitSource) {
    return {
      sourceKey: explicitSource,
      rawId: scopedId,
    };
  }

  if (typeof scopedId !== 'string' || !scopedId.includes('::')) {
    throw new Error(
      'Missing source prefix in id. Expected format "source::id" or pass options.source.'
    );
  }

  const [sourceKey, ...rest] = scopedId.split('::');
  return {
    sourceKey,
    rawId: rest.join('::'),
  };
}

function sourceKeyFromScopedId(scopedId) {
  if (typeof scopedId !== 'string' || !scopedId.includes('::')) {
    return null;
  }
  return scopedId.split('::')[0] ?? null;
}

function normalizeSearchResults(sourceKey, payload) {
  const results = payload?.results ?? [];
  return results.map((item) => ({
    ...item,
    id: encodeScopedId(sourceKey, item.id),
    _rawId: item.id,
    _source: sourceKey,
  }));
}

function findEpisodeByNumber(episodes, episodeNumber) {
  const target = Number(episodeNumber);
  if (!Number.isFinite(target)) {
    return null;
  }

  return (
    episodes.find((ep) => Number(ep.number) === target) ||
    episodes.find((ep) => {
      const title = normalizeText(ep.title);
      return title.includes(`episode ${target}`) || title.endsWith(` ${target}`);
    }) ||
    null
  );
}

function buildTitleVariants(title) {
  const raw = String(title ?? '').trim();
  const variants = new Set([raw]);

  variants.add(
    raw
      .replace(/season\s*\d+/gi, '')
      .replace(/part\s*\d+/gi, '')
      .replace(/\b2nd\s+season\b/gi, '')
      .replace(/\b3rd\s+season\b/gi, '')
      .replace(/\b4th\s+season\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
  );

  variants.add(raw.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim());

  return [...variants].filter(Boolean);
}

async function resolveProviderEpisodeCandidates(sourceKey, queries, episodeNumber) {
  const variants = [...new Set((queries ?? []).flatMap((query) => buildTitleVariants(query)))].filter(Boolean);
  const candidateBucket = [];

  for (const query of variants) {
    try {
      const rawSearch = await searchAnime(query, { source: sourceKey });
      candidateBucket.push(...(rawSearch?.results ?? []));
    } catch {
      // ignore individual variant failures
    }
  }

  const candidates = uniqueById(candidateBucket)
    .map((item) => ({
      ...item,
      _similarity: Math.max(
        ...variants.map((query) => titleSimilarity(query, item.title))
      ),
    }))
    .sort((a, b) => b._similarity - a._similarity)
    .slice(0, 10);

  const episodeCandidates = [];

  for (const candidate of candidates) {
    try {
      const info = await fetchAnimeInfoById(candidate.id);
      const episodes = info?.episodes ?? [];

      const exact = findEpisodeByNumber(episodes, episodeNumber);
      if (exact?.id) {
        episodeCandidates.push({
          anime: info,
          episode: exact,
          candidate,
          isExactNumberMatch: true,
        });
      }

      for (const ep of episodes.slice(0, 3)) {
        if (!ep?.id) {
          continue;
        }

        episodeCandidates.push({
          anime: info,
          episode: ep,
          candidate,
          isExactNumberMatch: false,
        });
      }
    } catch {
      // Keep trying other candidates from this provider.
    }
  }

  return uniqueById(
    episodeCandidates.map((item) => ({
      ...item,
      id: item.episode.id,
    }))
  )
    .sort((a, b) => {
      if (a.isExactNumberMatch !== b.isExactNumberMatch) {
        return Number(b.isExactNumberMatch) - Number(a.isExactNumberMatch);
      }

      return (b.candidate?._similarity ?? 0) - (a.candidate?._similarity ?? 0);
    })
    .slice(0, 6);
}

function assertSourceExists(sourceKey) {
  const source = getSource(sourceKey);
  if (!source) {
    throw new Error(`Unknown source: ${sourceKey}`);
  }
  return source;
}

export async function searchAnime(query, options = {}) {
  assertNonEmptyString(query, 'query');
  const {
    page = 1,
    source = 'auto',
    providers,
  } = options;

  const enabledProviders =
    Array.isArray(providers) && providers.length > 0
      ? providers
      : source === 'auto'
      ? SOURCE_KEYS
      : [source];

  const settled = await Promise.all(
    enabledProviders.map(async (sourceKey) => {
      const adapter = assertSourceExists(sourceKey);
      try {
        const payload = await adapter.search(query.trim(), page);
        return {
          sourceKey,
          payload,
        };
      } catch (err) {
        return {
          sourceKey,
          payload: { results: [] },
          error: err?.message ?? 'search failed',
        };
      }
    })
  );

  const combinedResults = settled.flatMap(({ sourceKey, payload }) =>
    normalizeSearchResults(sourceKey, payload)
  );

  const failures = settled
    .filter((item) => item.error)
    .map((item) => `${item.sourceKey}: ${item.error}`);

  return {
    currentPage: page,
    hasNextPage: false,
    totalPages: 1,
    results: combinedResults,
    _failures: failures,
  };
}

export async function fetchAnimeInfoById(id, options = {}) {
  assertNonEmptyString(id, 'anime id');
  const { source } = options;
  const { sourceKey, rawId } = decodeScopedId(id.trim(), source);
  const adapter = assertSourceExists(sourceKey);

  const payload = await adapter.fetchAnimeInfo(rawId);
  const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];

  return {
    ...payload,
    id: encodeScopedId(sourceKey, payload?.id ?? rawId),
    _rawId: payload?.id ?? rawId,
    _source: sourceKey,
    episodes: episodes.map((ep) => ({
      ...ep,
      id: encodeScopedId(sourceKey, ep.id),
      _rawId: ep.id,
      _source: sourceKey,
    })),
  };
}

export async function fetchEpisodeSourcesById(episodeId, options = {}) {
  assertNonEmptyString(episodeId, 'episode id');
  const { source } = options;
  const { sourceKey, rawId } = decodeScopedId(episodeId.trim(), source);
  const adapter = assertSourceExists(sourceKey);

  const payload = await adapter.fetchEpisodeSources(rawId, options);
  if (!payload?.sources?.length) {
    throw new Error(`No sources returned from ${sourceKey}`);
  }

  return {
    ...payload,
    _source: sourceKey,
  };
}

export async function fetchEpisodeSourcesAuto(params = {}) {
  const {
    episodeId,
    animeTitle,
    searchQuery,
    alternateTitles = [],
    episodeNumber,
    source,
    providers,
  } = params;
  assertNonEmptyString(episodeId, 'episode id');

  const primarySource = source ?? sourceKeyFromScopedId(episodeId);
  const fallbackProviders =
    Array.isArray(providers) && providers.length > 0
      ? providers
      : SOURCE_KEYS;

  const providerOrder = [
    ...(primarySource ? [primarySource] : []),
    ...fallbackProviders.filter((key) => key !== primarySource),
  ];

  const attempts = [];
  const streamSets = [];
  const probeLanguages = ['sub', 'dub'];

  const sourceSupportsLanguageProbe = (key) => ['hianime', 'animekai', 'animepahe'].includes(key);

  for (const sourceKey of providerOrder) {
    try {
      let scopedEpisodeId = episodeId;
      let episodeMeta = null;

      if (sourceKey !== primarySource) {
        const allTitleQueries = [animeTitle, searchQuery, ...alternateTitles]
          .filter((value) => typeof value === 'string' && value.trim().length > 0)
          .flatMap((value) => buildTitleVariants(value));

        if (!allTitleQueries.length || !Number.isFinite(Number(episodeNumber))) {
          attempts.push(`${sourceKey}: missing title queries or episodeNumber for fallback`);
          continue;
        }

        const resolvedCandidates = await resolveProviderEpisodeCandidates(
          sourceKey,
          allTitleQueries,
          episodeNumber
        );

        if (!resolvedCandidates.length) {
          attempts.push(`${sourceKey}: no matching episode found`);
          continue;
        }

        let providerSuccess = false;
        for (const resolved of resolvedCandidates) {
          try {
            scopedEpisodeId = resolved.episode.id;
            episodeMeta = {
              animeId: resolved.anime.id,
              animeTitle: resolved.anime.title,
              episodeId: resolved.episode.id,
              episodeNumber: resolved.episode.number,
            };

            const langsToTry = sourceSupportsLanguageProbe(sourceKey) ? probeLanguages : [undefined];

            for (const lang of langsToTry) {
              try {
                const resolvedSource = await fetchEpisodeSourcesById(scopedEpisodeId, {
                  source: sourceKey,
                  subOrDub: lang,
                  retryOnNoSources: false,
                });
                const sources = Array.isArray(resolvedSource?.sources) ? resolvedSource.sources : [];

                if (!sources.length) {
                  attempts.push(`${sourceKey}: no ${lang ?? 'default'} sources for ${resolved.episode.id}`);
                  continue;
                }

                streamSets.push({
                  sourceKey,
                  language:
                    resolvedSource?._resolvedLanguage ??
                    (sourceSupportsLanguageProbe(sourceKey) ? lang ?? 'unknown' : 'unknown'),
                  headers: resolvedSource?.headers,
                  subtitles: resolvedSource?.subtitles ?? [],
                  intro: resolvedSource?.intro,
                  outro: resolvedSource?.outro,
                  resolvedServer: resolvedSource?._resolvedServer,
                  episode: episodeMeta,
                  sources,
                });
                providerSuccess = true;
              } catch (langErr) {
                attempts.push(`${sourceKey}: ${langErr?.message ?? 'unknown error'} (${resolved.episode.id}/${lang ?? 'default'})`);
              }
            }

            if (providerSuccess) {
              break;
            }
          } catch (innerErr) {
            attempts.push(`${sourceKey}: ${innerErr?.message ?? 'unknown error'} (${resolved.episode.id})`);
          }
        }

        if (!providerSuccess) {
          continue;
        }
      } else {
        const langsToTry = sourceSupportsLanguageProbe(sourceKey) ? probeLanguages : [undefined];
        let primaryHadSuccess = false;

        for (const lang of langsToTry) {
          try {
            const resolvedSource = await fetchEpisodeSourcesById(scopedEpisodeId, {
              source: sourceKey,
              subOrDub: lang,
              retryOnNoSources: false,
            });
            const sources = Array.isArray(resolvedSource?.sources) ? resolvedSource.sources : [];

            if (!sources.length) {
              attempts.push(`${sourceKey}: no ${lang ?? 'default'} sources returned`);
              continue;
            }

            streamSets.push({
              sourceKey,
              language:
                resolvedSource?._resolvedLanguage ??
                (sourceSupportsLanguageProbe(sourceKey) ? lang ?? 'unknown' : 'unknown'),
              headers: resolvedSource?.headers,
              subtitles: resolvedSource?.subtitles ?? [],
              intro: resolvedSource?.intro,
              outro: resolvedSource?.outro,
              resolvedServer: resolvedSource?._resolvedServer,
              episode: episodeMeta,
              sources,
            });
            primaryHadSuccess = true;
          } catch (langErr) {
            attempts.push(`${sourceKey}: ${langErr?.message ?? 'unknown error'} (${lang ?? 'default'})`);
          }
        }

        if (!primaryHadSuccess) {
          continue;
        }
      }
    } catch (err) {
      attempts.push(`${sourceKey}: ${err?.message ?? 'unknown error'}`);
    }
  }

  if (streamSets.length === 0) {
    const summarizedAttempts = attempts.slice(0, 12).join(' | ');
    const overflow = attempts.length > 12 ? ` | ...and ${attempts.length - 12} more` : '';
    throw new Error(`No sources found across providers. Tried: ${summarizedAttempts}${overflow}`);
  }

  const streamEntries = streamSets.flatMap((set) =>
    (set.sources ?? []).map((stream) => ({
      ...stream,
      _source: set.sourceKey,
      _language:
        set.language === 'unknown'
          ? stream?.isDub === true
            ? 'dub'
            : 'sub'
          : set.language,
      _resolvedServer: set.resolvedServer,
      _headers: set.headers,
      _subtitles: set.subtitles,
      _intro: set.intro,
      _outro: set.outro,
    }))
  );

  const countsByLanguage = {
    sub: streamEntries.filter((entry) => entry._language === 'sub').length,
    dub: streamEntries.filter((entry) => entry._language === 'dub').length,
    unknown: streamEntries.filter((entry) => entry._language !== 'sub' && entry._language !== 'dub').length,
  };

  const bestOverall = [...streamEntries].sort((a, b) => {
    const qualityDelta = parseQualityScore(b.quality) - parseQualityScore(a.quality);
    if (qualityDelta !== 0) {
      return qualityDelta;
    }

    if (Boolean(b.isM3U8) !== Boolean(a.isM3U8)) {
      return Number(Boolean(b.isM3U8)) - Number(Boolean(a.isM3U8));
    }

    return 0;
  })[0] ?? null;

  return {
    streamSets,
    streamEntries,
    countsByLanguage,
    bestOverall,
    attempts,
  };
}

export function pickBestSource(sourceResponse, preferredQuality = '1080p') {
  const allEntries = Array.isArray(sourceResponse?.streamEntries)
    ? sourceResponse.streamEntries
    : Array.isArray(sourceResponse?.sources)
    ? sourceResponse.sources
    : [];

  if (!allEntries.length) {
    return null;
  }

  const exact = allEntries.find((s) => String(s.quality ?? '').toLowerCase() === String(preferredQuality).toLowerCase());
  if (exact) {
    return exact;
  }

  return [...allEntries].sort((a, b) => parseQualityScore(b.quality) - parseQualityScore(a.quality))[0] ?? null;
}

export default {
  SOURCE_KEYS,
  searchAnime,
  fetchAnimeInfoById,
  fetchEpisodeSourcesById,
  fetchEpisodeSourcesAuto,
  pickBestSource,
};


