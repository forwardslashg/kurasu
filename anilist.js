const ANILIST_BASE = "https://graphql.anilist.co/";

async function getUserData(accessToken) {
  const res = await fetch(ANILIST_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      query: `
        query {
          Viewer {
            id
            name
          }
        }
      `
    })
  });

  const data = await res.json();
  return data.data.Viewer;
}

async function getWatchingAnime(userId, accessToken) {
  const res = await fetch(ANILIST_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      query: `
        query ($userId: Int!) {
          MediaListCollection(userId: $userId, type: ANIME, status: CURRENT) {
            lists {
              entries {
                score
                progress
                media {
                  id
                  episodes
                  title {
                    english
                    romaji
                  }
                  bannerImage
                }
              }
            }
          }
        }
      `,
      variables: { userId }
    })
  });

  const data = await res.json();
  const entries = data.data.MediaListCollection.lists.flatMap(l => l.entries);

  return entries.map(entry => ({
    id: entry.media.id,
    name: entry.media.title.english ?? entry.media.title.romaji,
    watchedEpisodes: entry.progress ?? 0,
    totalEpisodes: entry.media.episodes ?? null,
    score: entry.score || null,
    banner: entry.media.bannerImage ?? null
  }));
}

export { getUserData, getWatchingAnime };