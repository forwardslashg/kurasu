import * as p from '@clack/prompts';
import * as c from 'colorette';
import terminalImage from 'terminal-image';
import { ICONS } from './utils/icons.js';
import fs from 'fs';
import { spawn, spawnSync } from 'child_process';
import FTS from './firstTimeSetup.js';
import { getUserData, getWatchingAnime } from './anilist.js';
import {
    searchAnime,
    fetchAnimeInfoById,
    fetchEpisodeSourcesAuto,
    pickBestSource,
} from './watchAnime.js';
const VER = 'v0.0.1';

function buildMpvHeaderFields(headers = {}) {
    return Object.entries(headers)
        .filter(([key, value]) => key && value !== undefined && value !== null)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(',');
}

function openInMpv(stream) {
    if (!stream?.url) {
        throw new Error('Missing stream URL for MPV playback.');
    }

    const check = spawnSync('mpv', ['--version'], { stdio: 'ignore' });
    if (check.error || check.status !== 0) {
        throw new Error('mpv is not installed or not available in PATH.');
    }

    const args = ['--force-window=immediate'];

    const headerFields = buildMpvHeaderFields(stream._headers ?? {});
    if (headerFields) {
        args.push(`--http-header-fields=${headerFields}`);
    }

    const firstSubtitle = Array.isArray(stream._subtitles) ? stream._subtitles[0] : null;
    if (firstSubtitle?.url) {
        args.push(`--sub-file=${firstSubtitle.url}`);
    }

    args.push(stream.url);

    const mpv = spawn('mpv', args, {
        detached: true,
        stdio: 'ignore',
    });

    mpv.unref();
}
if (!fs.existsSync('./config.json')) {
    await FTS();
}
let config = JSON.parse(fs.readFileSync('./config.json', 'utf-8')); 
let name = config.name;
let anilistToken = config.anilistToken;
let usingAniList = config.usingAniList !== false;
if (usingAniList && !config.aniListUserId) {
    try {
        const userData = await getUserData(anilistToken);
        if (userData && userData.id) {
            config.aniListUserId = userData.id;
            fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
        } else {
            throw new Error('No user ID, is your token valid?');
        }
    } catch (err) {
        console.log(c.red('Failed to fetch AniList user data. Please check your token and try again.'));
        console.log(c.gray(`Error: ${err.message}`));
    }
}
let userId = config.aniListUserId;
p.intro(c.magenta("Kurasu ") + c.gray(VER))

const menuOptions = [
    { value: 'anime', label: `${ICONS.ICON_FILE_VIDEO} Watch Anime` },
    { value: 'list', label: `${ICONS.ICON_BOOKMARK} Manage List` },
    { value: 'exit', label: `${ICONS.ICON_CROSS} Exit` },
];

const selectedOption = await p.select({
    message: `Hello ${c.green(name)}! Please select an option:`,
    options: menuOptions,
});

const selectedName = menuOptions.find(opt => opt.value === selectedOption)?.label;
p.log.success(`You selected ${c.cyan(selectedName)}`);

if (selectedOption === 'exit') {
    p.outro('Goodbye!');
    process.exit(0);
}

if (selectedOption === 'anime') {
    try {
        let watchingAnime = [];
        if (usingAniList) {
            watchingAnime = await getWatchingAnime(userId, anilistToken);
        }

        const watchingOptions = watchingAnime.map((anime) => ({
            value: `anime:${anime.id}`,
            label: `${anime.name} ${c.gray(`[watching ${anime.watchedEpisodes}/${anime.totalEpisodes ?? '?'}]`)}`,
        }));

        watchingOptions.push({ value: 'search', label: `${ICONS.ICON_SEARCH} Search` });

        const animeSelection = await p.select({
            message: 'choose:',
            options: watchingOptions,
        });

        if (animeSelection === 'search') {
            const query = await p.text({
                message: 'Search anime:',
                placeholder: 'e.g. bocchi the rock',
                validate(value) {
                    if (!value || value.trim().length === 0) {
                        return 'Please enter a search query.';
                    }
                    return undefined;
                },
            });

            if (p.isCancel(query)) {
                p.cancel('Search canceled.');
                process.exit(0);
            }

            const searchResults = await searchAnime(query);
            const resultList = searchResults?.results ?? [];

            if (resultList.length === 0) {
                p.log.warn(`No anime found for ${c.cyan(query)}.`);
                p.outro('Done.');
                process.exit(0);
            }

            const resultOptions = resultList.slice(0, 15).map((anime) => ({
                value: anime.id,
                label: `${anime.title} ${c.gray(`[${anime._source}] [sub ${anime.sub ?? 0} | dub ${anime.dub ?? 0}]`)}`,
            }));

            const animeId = await p.select({
                message: `Results for ${c.cyan(query)}:`,
                options: resultOptions,
            });

            if (p.isCancel(animeId)) {
                p.cancel('Selection canceled.');
                process.exit(0);
            }

            const animeInfo = await fetchAnimeInfoById(animeId);
            const episodes = animeInfo?.episodes ?? [];

            if (episodes.length === 0) {
                p.log.warn('This anime has no available episodes.');
                p.outro('Done.');
                process.exit(0);
            }

            const episodeOptions = episodes.map((ep) => ({
                value: ep.id,
                label: `Episode ${ep.number}${ep.title ? `: ${ep.title}` : ''}`,
            }));

            const selectedEpisodeId = await p.select({
                message: `Pick an episode for ${c.cyan(animeInfo.title)}:`,
                options: episodeOptions,
            });

            if (p.isCancel(selectedEpisodeId)) {
                p.cancel('Episode selection canceled.');
                process.exit(0);
            }

            const selectedEpisode = episodes.find((ep) => ep.id === selectedEpisodeId);
            const sourceResponse = await fetchEpisodeSourcesAuto({
                episodeId: selectedEpisodeId,
                animeTitle: animeInfo.title,
                searchQuery: query,
                alternateTitles: [animeInfo.japaneseTitle, animeInfo.aliasTitle].filter(Boolean),
                episodeNumber: selectedEpisode?.number,
            });

            const { countsByLanguage = {}, streamEntries = [] } = sourceResponse;
            const streamCountLabel = `Found streams: sub ${countsByLanguage.sub ?? 0}, dub ${countsByLanguage.dub ?? 0}, unknown ${countsByLanguage.unknown ?? 0}`;
            p.log.info(streamCountLabel);

            const availableLangOptions = [];
            if ((countsByLanguage.sub ?? 0) > 0) {
                availableLangOptions.push({ value: 'sub', label: `Sub (${countsByLanguage.sub})` });
            }
            if ((countsByLanguage.dub ?? 0) > 0) {
                availableLangOptions.push({ value: 'dub', label: `Dub (${countsByLanguage.dub})` });
            }
            if ((countsByLanguage.unknown ?? 0) > 0) {
                availableLangOptions.push({ value: 'unknown', label: `Unknown (${countsByLanguage.unknown})` });
            }

            if (availableLangOptions.length === 0) {
                p.log.error('No streams available after scanning all sources.');
                p.outro('Done.');
                process.exit(0);
            }

            const selectedLanguage = await p.select({
                message: 'Choose audio language:',
                options: availableLangOptions,
            });

            if (p.isCancel(selectedLanguage)) {
                p.cancel('Language selection canceled.');
                process.exit(0);
            }

            const filteredStreams = streamEntries.filter((entry) => (entry._language ?? 'unknown') === selectedLanguage);
            const bestSource = pickBestSource({ streamEntries: filteredStreams });

            if (!bestSource?.url) {
                p.log.error('No playable source returned by provider.');
                p.outro('Done.');
                process.exit(0);
            }

            p.log.success(`Selected: ${c.cyan(animeInfo.title)}`);
            // p.log.info(`Source URL (${bestSource.quality ?? 'auto'}): ${bestSource.url}`);
            // p.log.info(`Streams in selected language: ${filteredStreams.length}`);
            // p.log.info(`Selected provider: ${bestSource._source ?? 'unknown'}`);

            if (bestSource?._resolvedServer || bestSource?._language) {
                // p.log.info(
                //     `Resolved via ${bestSource?._resolvedServer ?? 'unknown server'} / ${bestSource?._language ?? 'unknown language'}`
                // );
            }

            if (bestSource?._headers) {
                // p.log.info(`Use headers when streaming: ${JSON.stringify(bestSource._headers)}`);
            }

            try {
                openInMpv(bestSource);
                p.log.success('Opening stream in mpv...');
            } catch (mpvErr) {
                p.log.warn(`Could not launch mpv automatically: ${mpvErr.message}`);
            }
        } else {
            const selectedAnime = watchingAnime.find(
                (anime) => `anime:${anime.id}` === animeSelection
            );

            if (selectedAnime) {
                p.log.success(`Selected: ${c.cyan(selectedAnime.name)}`);
            }
        }
    } catch (err) {
        p.log.error('Failed to load anime data or episode sources.');
        console.log(c.gray(`Error: ${err.message}`));
    }

}


if (selectedOption === 'list') {
    p.log.info('This feature is coming soon!');
}