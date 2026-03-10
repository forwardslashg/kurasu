import * as p from '@clack/prompts';
import * as c from 'colorette';
import terminalImage from 'terminal-image';
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
const VER = 'v1.0.0';


// TODO: find a better fix
let shouldExit = false;
process.removeAllListeners('SIGINT');
process.on('SIGINT', () => {
    shouldExit = true;
    process.exit(0);
});

function buildMpvHeaderFields(headers = {}) {
    return Object.entries(headers)
        .filter(([key, value]) => key && value !== undefined && value !== null)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(',');
}

function normalizeMpvExtraArgs(rawValue) {
    if (Array.isArray(rawValue)) {
        return rawValue
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter(Boolean);
    }

    if (typeof rawValue !== 'string') {
        return [];
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
        return [];
    }
    const tokens = trimmed.match(/(?:[^\s\"']+|\"[^\"]*\"|'[^']*')+/g) ?? [];
    return tokens
        .map((token) => token.replace(/^\"(.*)\"$|^'(.*)'$/, '$1$2'))
        .filter(Boolean);
}

function openInMpv(stream, mpvExtraArgs) {
    if (!stream?.url) {
        throw new Error('Missing stream URL for mpv playback!');
    }

    const check = spawnSync('mpv', ['--version'], { stdio: 'ignore' });
    if (check.error || check.status !== 0) {
        throw new Error('mpv is not installed or not available in PATH.');
    }

    const args = ['--force-window=immediate'];

    const extraArgs = normalizeMpvExtraArgs(mpvExtraArgs);
    if (extraArgs.length > 0) {
        args.push(...extraArgs);
    }

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

async function waitForUserInput(message = 'Press Enter to continue...') {
    const result = await p.text({
        message,
        validate(value) {
            return undefined;
        },
    });

    if (p.isCancel(result)) {
        process.exit(0);
    }
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

p.intro(c.magenta("Kurasu ") + c.gray(VER));


async function playEpisode(episode, animeInfo, animeTitle, searchQuery, alternateTitles, selectedLanguage, streamEntries, config) {
    const episodes = animeInfo.episodes ?? [];
    const currentIndex = episodes.findIndex(ep => ep.id === episode.id);
    
    try {
        let currentStream = streamEntries.find(s => (s._language ?? 'unknown') === selectedLanguage);
        
        if (!currentStream && streamEntries.length > 0) {
            currentStream = streamEntries[0];
        }
        
        if (!currentStream?.url) {
            p.log.error('No playable source for this episode.');
            return null;
        }

        try {
            openInMpv(currentStream, config.mpvExtraArgs);
            p.log.success(`Opening stream in mpv...`);
        } catch (mpvErr) {
            p.log.warn(`Could not launch mpv automatically: ${mpvErr.message}`);
        }

        let continueWatching = true;
        while (continueWatching) {
            await waitForUserInput('Once you have finished watcing, press Enter to continue...');
            
            const navigationOptions = [];
            
            if (currentIndex > 0) {
                navigationOptions.push({ value: 'prev', label: `Previous Episode (${episodes[currentIndex - 1].number})` });
            }
            
            if (currentIndex < episodes.length - 1) {
                navigationOptions.push({ value: 'next', label: `Next Episode (${episodes[currentIndex + 1].number})` });
            }
            
            navigationOptions.push({ value: 'replay', label: `Replay This Episode` });
            navigationOptions.push({ value: 'back', label: `Back to Episode selection` });

            const action = await p.select({
                message: 'What would you like to do?',
                options: navigationOptions,
            });

            if (p.isCancel(action)) {
                process.exit(0);
            }

            if (action === 'next') {
                const nextEpisode = episodes[currentIndex + 1];
                const nextStream = await fetchEpisodeSourcesAuto({
                    episodeId: nextEpisode.id,
                    animeTitle: animeTitle,
                    searchQuery: searchQuery,
                    alternateTitles: alternateTitles,
                    episodeNumber: nextEpisode.number,
                });
                
                const nextStreamFiltered = nextStream.streamEntries.filter(
                    (entry) => (entry._language ?? 'unknown') === selectedLanguage
                );
                const bestNextSource = pickBestSource({ streamEntries: nextStreamFiltered });
                
                if (bestNextSource?.url) {
                    streamEntries = nextStreamFiltered;
                    episode = nextEpisode;
                    p.log.success(`Playing Episode ${nextEpisode.number}`);
                    return await playEpisode(nextEpisode, animeInfo, animeTitle, searchQuery, alternateTitles, selectedLanguage, nextStreamFiltered, config);
                }
            } else if (action === 'prev') {
                const prevEpisode = episodes[currentIndex - 1];
                const prevStream = await fetchEpisodeSourcesAuto({
                    episodeId: prevEpisode.id,
                    animeTitle: animeTitle,
                    searchQuery: searchQuery,
                    alternateTitles: alternateTitles,
                    episodeNumber: prevEpisode.number,
                });
                
                const prevStreamFiltered = prevStream.streamEntries.filter(
                    (entry) => (entry._language ?? 'unknown') === selectedLanguage
                );
                const bestPrevSource = pickBestSource({ streamEntries: prevStreamFiltered });
                
                if (bestPrevSource?.url) {
                    streamEntries = prevStreamFiltered;
                    episode = prevEpisode;
                    p.log.success(`Playing Episode ${prevEpisode.number}`);
                    return await playEpisode(prevEpisode, animeInfo, animeTitle, searchQuery, alternateTitles, selectedLanguage, prevStreamFiltered, config);
                }
            } else if (action === 'replay') {
                p.log.success(`Replaying Episode ${episode.number}`);
                return await playEpisode(episode, animeInfo, animeTitle, searchQuery, alternateTitles, selectedLanguage, streamEntries, config);
            } else if (action === 'back') {
                continueWatching = false;
            }
        }
    } catch (err) {
        p.log.error('Error during playback: ' + err.message);
        return null;
    }
}

// playback
async function playAnime(animeInfo, animeTitle, searchQuery = '', alternateTitles = [], config) {
    const episodes = animeInfo?.episodes ?? [];

    if (episodes.length === 0) {
        p.log.warn('This anime has no available episodes.');
        return;
    }

    while (true) {
        const episodeOptions = episodes.map((ep) => ({
            value: ep.id,
            label: `Episode ${ep.number}${ep.title ? `: ${ep.title}` : ''}`,
        }));
        
        episodeOptions.push({ value: 'back', label: `<-- Go Back` });

        const selectedEpisodeId = await p.select({
            message: `Pick an episode for ${c.cyan(animeTitle)}:`,
            options: episodeOptions,
        });

        if (p.isCancel(selectedEpisodeId)) {
            process.exit(0);
        }

        if (selectedEpisodeId === 'back') {
            break;
        }

        const selectedEpisode = episodes.find((ep) => ep.id === selectedEpisodeId);
        
        try {
            const s = p.spinner();
            s.start('Fetching episode sources...');
            
            const sourceResponse = await fetchEpisodeSourcesAuto({
                episodeId: selectedEpisodeId,
                animeTitle: animeTitle,
                searchQuery: searchQuery,
                alternateTitles: alternateTitles,
                episodeNumber: selectedEpisode?.number,
            });
            
            s.stop('Sources loaded!');

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
                continue;
            }

            availableLangOptions.push({ value: 'back', label: `<-- Go Back` });

            const selectedLanguage = await p.select({
                message: 'Choose audio language:',
                options: availableLangOptions,
            });

            if (p.isCancel(selectedLanguage)) {
                process.exit(0);
            }

            if (selectedLanguage === 'back') {
                continue;
            }

            const filteredStreams = streamEntries.filter((entry) => (entry._language ?? 'unknown') === selectedLanguage);
            const bestSource = pickBestSource({ streamEntries: filteredStreams });

            if (!bestSource?.url) {
                p.log.error('No playable source returned by provider.');
                continue;
            }

            p.log.success(`Selected: ${c.cyan(animeTitle)} - Episode ${selectedEpisode.number}`);

            await playEpisode(selectedEpisode, animeInfo, animeTitle, searchQuery, alternateTitles, selectedLanguage, filteredStreams, config);
        } catch (err) {
            p.log.error('Failed to fetch episode sources: ' + err.message);
        }
    }
}

// Main menu loop
async function mainMenu() {
    while (true) {
        const menuOptions = [
            { value: 'anime', label: `Watch Anime` },
            { value: 'list', label: `Manage List` },
            { value: 'exit', label: `Exit` },
        ];

        const selectedOption = await p.select({
            message: `Hello ${c.green(name)}! Please select an option:`,
            options: menuOptions,
        });

        // Check if user pressed CTRL+C
        if (p.isCancel(selectedOption)) {
            process.exit(0);
        }

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

                watchingOptions.push({ value: 'search', label: `Search` });
                watchingOptions.push({ value: 'back', label: `<-- Go Back` });

                const animeSelection = await p.select({
                    message: 'choose:',
                    options: watchingOptions,
                });

                // Check if user pressed CTRL+C
                if (p.isCancel(animeSelection)) {
                    process.exit(0);
                }

                if (animeSelection === 'back') {
                    continue;
                }

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

                    // Check if user pressed CTRL+C
                    if (p.isCancel(query)) {
                        process.exit(0);
                    }

                    const searchResults = await searchAnime(query);
                    const resultList = searchResults?.results ?? [];

                    if (resultList.length === 0) {
                        p.log.warn(`No anime found for ${c.cyan(query)}.`);
                        continue;
                    }

                    const resultOptions = resultList.slice(0, 15).map((anime) => ({
                        value: anime.id,
                        label: `${anime.title} ${c.gray(`[${anime._source}] [sub ${anime.sub ?? 0} | dub ${anime.dub ?? 0}]`)}`,
                    }));

                    resultOptions.push({ value: 'back', label: `<-- Go Back` });

                    const animeId = await p.select({
                        message: `Results for ${c.cyan(query)}:`,
                        options: resultOptions,
                    });

                    // Check if user pressed CTRL+C
                    if (p.isCancel(animeId)) {
                        process.exit(0);
                    }

                    if (animeId === 'back') {
                        continue;
                    }

                    const animeInfo = await fetchAnimeInfoById(animeId);
                    p.log.success(`Selected: ${c.cyan(animeInfo.title)}`);
                    
                    await playAnime(animeInfo, animeInfo.title, query, [animeInfo.japaneseTitle, animeInfo.aliasTitle].filter(Boolean), config);

                } else {
                    // Handle AniList anime selection
                    const selectedAnime = watchingAnime.find(
                        (anime) => `anime:${anime.id}` === animeSelection
                    );

                    if (selectedAnime) {
                        p.log.success(`Selected: ${c.cyan(selectedAnime.name)}`);
                        
                        try {
                            // Search for anime to get the proper source ID
                            const searchResults = await searchAnime(selectedAnime.name);
                            const bestResultMatch = searchResults?.results?.[0];
                            
                            if (bestResultMatch) {
                                const animeInfo = await fetchAnimeInfoById(bestResultMatch.id);
                                await playAnime(animeInfo, animeInfo.title, selectedAnime.name, [animeInfo.japaneseTitle, animeInfo.aliasTitle].filter(Boolean), config);
                            } else {
                                p.log.warn('Could not find this anime in any source.');
                            }
                        } catch (err) {
                            p.log.error('Failed to fetch anime info: ' + err.message);
                        }
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
    }
}

mainMenu().catch(err => {
    p.log.error('Fatal error: ' + err.message);
    process.exit(1);
});