import * as p from '@clack/prompts';
import * as c from 'colorette';
import terminalImage from 'terminal-image';
import { ICONS } from './utils/icons.js';
import fs from 'fs';
import { getUserData } from './anilist.js';

async function FTS() {
    let responses = {};
    p.intro(`First Time Setup`);

const name = await p.text({
  message: 'What is your name?',
  placeholder: 'Enter your name',
  validate(value) {
    if (value === undefined) return 'You need to input a name.';
  },
});

responses.name = name;
// console.log(responses);
if (name.toLowerCase().includes('burger')) {
  console.log(await terminalImage.file('./assets/burg.jpg', {width: '50%', height: '40%'}));
}

p.outro(`Nice to meet you, ${c.green(name)}! ${ICONS.ICON_HEART}`);

const usingAniList = await p.confirm({
  message: 'Do you use AniList integration?',
});

responses.usingAniList = usingAniList;

if (usingAniList) {
    console.log(c.cyan('Open this URL in your browser to get your token: ') + c.magenta('https://anilist.co/api/v2/oauth/authorize?client_id=36966&response_type=token'));
    let anilistToken;

    // Keep prompt validation synchronous; verify token asynchronously after submission.
    while (!anilistToken) {
      const tokenInput = await p.text({
        message: 'Please enter your AniList token:',
        placeholder: 'AniList Token',
        validate(value) {
          if (value === undefined || value.trim() === '') return 'You need to input a token.';
        },
      });

      if (p.isCancel(tokenInput)) {
        p.cancel('Setup cancelled.');
        process.exit(0);
      }

      try {
        await getUserData(tokenInput);
        anilistToken = tokenInput;
      } catch {
        p.log.error('Invalid token, please try again.');
      }
    }

    responses.anilistToken = anilistToken;
}

// end of fts, push to config.json
fs.writeFileSync('./config.json', JSON.stringify(responses, null, 2));
}

export default FTS;